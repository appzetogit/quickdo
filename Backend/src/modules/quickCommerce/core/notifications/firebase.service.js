import crypto from 'crypto';
import { recordCustomerNotification } from '../../../../core/notifications/customerInbox.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { FoodAdmin } from '../admin/admin.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { isMobilePlatform, normalizePlatform } from '../../utils/platform.js';

const FIREBASE_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SEND_URL = (projectId) =>
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
const OWNER_MODELS = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner,
    ADMIN: FoodAdmin
};
const OWNER_TOKEN_FIELDS = {
    web: 'fcmTokens',
    mobile: 'fcmTokenMobile'
};
/** Keep a few recent devices, not long stale histories that cause duplicate pushes. */
const MAX_TOKENS_PER_PLATFORM = 3;

/**
 * Android notification channels. These MUST match channels the receiving app
 * actually creates: Android silently ignores an unknown channel_id and falls back
 * to FCM's auto-created "Miscellaneous" channel at IMPORTANCE_DEFAULT — no heads-up,
 * no sound, no full-screen intent. That failure is indistinguishable from the push
 * never arriving, which is why these defaults are taken from the apps' own source
 * rather than from what anyone assumed the ids were.
 *
 * Delivery app (quickcommerce_delivery, com.quickcommerce.delivery):
 *   'new_orders_v2' — Importance.max, full-screen incoming order alerts, and
 *   the sound is set on the channel (raw/neworder.mp3). From Android 8 the
 *   channel owns the sound, so the per-message `sound` below only affects
 *   older devices.
 *   The app also still registers the previous 'incoming_orders_channel_v3', so
 *   this id can change on either side independently; that legacy channel is
 *   due for removal from the app once this is deployed.
 *
 * User app (flutter-food-user-application, lib/src/platform/notifications/push_service.dart):
 *   'high_importance_channel' — Importance.max, and the manifest's
 *   com.google.firebase.messaging.default_notification_channel_id.
 *
 * A channel id cannot be re-pointed once created: Android freezes a channel's
 * importance and sound at creation, so the apps bump the suffix (_v2, _v3)
 * rather than editing one in place. That is why these ids look versioned.
 *
 * Both overridable, so a client-side rename is an env change rather than a deploy.
 */
/**
 * How long an undelivered new-order push stays valid.
 *
 * Slightly above the 45s driver acceptance window so an offer in flight is not
 * dropped a moment early, but far short of FCM's four-week default.
 */
const NEW_ORDER_TTL_SECONDS = Number(process.env.FCM_NEW_ORDER_TTL_SECONDS) || 60;

const NEW_ORDER_CHANNEL_ID = process.env.FCM_NEW_ORDER_CHANNEL_ID || 'new_orders_v2';
const DEFAULT_CHANNEL_ID = process.env.FCM_DEFAULT_CHANNEL_ID || 'high_importance_channel';

let cachedAccessToken = null;
let cachedAccessTokenExpiryMs = 0;
let cachedServiceAccount = null;

const sanitizeString = (value) => String(value ?? '').trim();
const normalizeNotificationText = (value) => {
    const raw = sanitizeString(value);
    if (!raw) return '';

    const repaired = (() => {
        // Typical mojibake markers when UTF-8 is decoded as latin1/cp1252.
        if (!/[ðÃÂâ]/.test(raw)) return raw;
        try {
            const decoded = Buffer.from(raw, 'latin1').toString('utf8');
            if (decoded && !decoded.includes('�')) return decoded;
            return decoded || raw;
        } catch {
            return raw;
        }
    })();

    return repaired
        // Remove leading module prefix if any sender still adds it.
        .replace(/^\s*(?:\p{Extended_Pictographic}\s*)?\[(user|shop|restaurant|delivery|admin|rider)\]\s*/iu, '')
        // Remove replacement-char mojibake tails like "�x}0".
        .replace(/�[A-Za-z0-9{}[\]\\/_.:-]*/g, ' ')
        // Remove remaining control chars and collapse spaces.
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        // Force plain text for notifications.
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const toBase64Url = (input) =>
    Buffer.from(JSON.stringify(input))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

const normalizePrivateKey = (key) => String(key || '').replace(/\\n/g, '\n').trim();

/**
 * Loads the service account saved in the admin panel into the cache.
 *
 * The resolver below is synchronous and used on hot paths, so it cannot read
 * the database itself. This primes it instead: called once at boot and again
 * whenever an admin saves, which is the only time the answer changes.
 *
 * A missing or unparseable stored credential leaves the cache alone, so the
 * env/file configuration keeps working rather than push going dark because
 * somebody pasted bad JSON.
 */
export async function reloadServiceAccountFromSettings() {
    cachedServiceAccount = null;
    try {
        const { FoodBusinessSettings } = await import('../../modules/food/admin/models/businessSettings.model.js');
        const doc = await FoodBusinessSettings.findOne().select('+firebaseServiceAccount').lean();
        const raw = sanitizeString(doc?.firebaseServiceAccount);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!parsed?.client_email || !parsed?.private_key) return false;

        cachedServiceAccount = parsed;
        logger.info(`Firebase service account loaded from admin settings (${parsed.project_id})`);
        return true;
    } catch (err) {
        logger.error(`Could not load Firebase service account from settings: ${err.message}`);
        return false;
    }
}

/** Drops the cached credential so the next read resolves afresh. */
export function clearCachedServiceAccount() {
    cachedServiceAccount = null;
    // Re-primed rather than left empty: clearing alone would silently fall back
    // to the env file until the next restart, which is the opposite of what
    // saving a new credential is meant to do.
    void reloadServiceAccountFromSettings();
}

/**
 * Database first, env second -- see the identical resolver in
 * core/notifications/firebase.service.js for why. Devices register tokens
 * against the project named in the settings document, so signing pushes with a
 * stale env key gets every one of them rejected as a SenderId mismatch.
 */
const resolveServiceAccount = async () => {
    if (cachedServiceAccount) return cachedServiceAccount;

    try {
        const { getFirebaseServiceAccount } = await import('../../../../core/settings/firebaseSettings.service.js');
        const fromDb = await getFirebaseServiceAccount();
        if (fromDb?.client_email && fromDb?.private_key) {
            cachedServiceAccount = fromDb;
            return cachedServiceAccount;
        }
    } catch {
        // The settings document is optional; fall back to env.
    }

    const rawJson = sanitizeString(config.firebaseServiceAccount || process.env.FIREBASE_SERVICE_ACCOUNT);
    if (rawJson) {
        cachedServiceAccount = JSON.parse(rawJson);
        return cachedServiceAccount;
    }

    const pathValue = sanitizeString(config.firebaseServiceAccountPath || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (pathValue) {
        const filePath = resolve(process.cwd(), pathValue);
        if (existsSync(filePath)) {
            cachedServiceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
            return cachedServiceAccount;
        }
    }

    throw new Error('Firebase service account is not configured. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH.');
};

export const invalidateFirebaseSenderCache = () => {
    cachedServiceAccount = null;
    cachedAccessToken = null;
    cachedAccessTokenExpiryMs = 0;
};

const getFirebaseProjectId = async () => {
    const account = await resolveServiceAccount();
    // The signing key's own project leads: an env-configured project id can name
    // a different project than the key, which is the mismatch being avoided.
    const projectId =
        sanitizeString(account.project_id) ||
        sanitizeString(config.firebaseProjectId) ||
        sanitizeString(process.env.FIREBASE_PROJECT_ID);
    if (!projectId) {
        throw new Error('Firebase project ID is not configured.');
    }
    return projectId;
};

const getFirebaseAccessToken = async () => {
    const now = Date.now();
    if (cachedAccessToken && cachedAccessTokenExpiryMs - now > 60_000) {
        return cachedAccessToken;
    }

    const account = await resolveServiceAccount();
    const privateKey = normalizePrivateKey(account.private_key);
    if (!account.client_email || !privateKey) {
        throw new Error('Firebase service account is missing client_email or private_key.');
    }

    const iat = Math.floor(now / 1000);
    const exp = iat + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: account.client_email,
        scope: FIREBASE_MESSAGING_SCOPE,
        aud: OAUTH_TOKEN_URL,
        iat,
        exp
    };

    const jwtUnsigned = `${toBase64Url(header)}.${toBase64Url(payload)}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(jwtUnsigned);
    signer.end();
    const signature = signer.sign(privateKey, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const assertion = `${jwtUnsigned}.${signature}`;

    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
    });

    const response = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Firebase OAuth token exchange failed (${response.status}): ${text}`);
    }

    const json = await response.json();
    cachedAccessToken = json.access_token;
    cachedAccessTokenExpiryMs = now + ((Number(json.expires_in) || 3600) * 1000);
    return cachedAccessToken;
};

const normalizeDataMap = (data = {}) => {
    const result = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (value === undefined || value === null) continue;
        result[String(key)] = String(value);
    }
    return result;
};

const buildMessagePayload = (payload = {}, token) => {
    const notification = {
        title: normalizeNotificationText(payload.title || payload.notification?.title || 'New notification'),
        body: normalizeNotificationText(payload.body || payload.notification?.body || '')
    };
    const data = normalizeDataMap(payload.data || {});
    if (data.title) data.title = normalizeNotificationText(data.title);
    if (data.body) data.body = normalizeNotificationText(data.body);
    const image =
        sanitizeString(payload.icon || payload.notification?.image || payload.notification?.icon || data.image || data.imageUrl);

    // If payload.dataOnly is true, we omit the 'notification' block.
    // This prevents FCM from auto-displaying while allowing app code to show a 'Local Notification'.
    const message = { token };

    if (!payload.dataOnly) {
        message.notification = notification;
        if (image) {
            message.notification.image = image;
        }
    }

    if (Object.keys(data).length > 0) {
        message.data = data;
    }

    // See NEW_ORDER_CHANNEL_ID / DEFAULT_CHANNEL_ID above for why these ids matter.
    const isNewOrderAlert = data.type === 'new_order';
    const isDataOnlyPush = Boolean(payload.dataOnly);

    message.android = {
        priority: 'high'
    };

    // A new-order offer is only valid for the acceptance window. Without a TTL, FCM
    // stores an undelivered message for up to four weeks and hands it over whenever
    // the device next comes online — so a rider could be woken by a full-screen alert
    // for an order that expired, or was taken by someone else, long ago. Expire the
    // message instead of relying on the app to notice the deadline has passed.
    if (isNewOrderAlert) {
        message.android.ttl = NEW_ORDER_TTL_SECONDS + 's';
    }
    if (!isDataOnlyPush) {
        message.android.notification = {
            channel_id: sanitizeString(payload.androidChannelId) ||
                (isNewOrderAlert ? NEW_ORDER_CHANNEL_ID : DEFAULT_CHANNEL_ID),
            default_vibrate_timings: true,
            default_light_settings: true,
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
            // A tag makes the OS-rendered copy addressable: the app can cancel
            // exactly this notification (cancel(0, tag)) once its own richer
            // alert is on screen, so hybrid pushes don't double-notify on
            // devices where the app's background handler actually runs.
            ...(sanitizeString(payload.androidTag)
                ? { tag: sanitizeString(payload.androidTag) }
                : {}),
            // Matches res/raw/neworder.mp3 in the delivery app. The previous
            // value named a resource that does not exist (the file is
            // tujh_bin1.mp3), and Android answers a missing sound resource with
            // the default tone rather than an error -- so it had been silently
            // wrong. Only affects pre-Android-8; above that the channel wins.
            ...(isNewOrderAlert ? { sound: 'neworder' } : {})
        };
    }

    // Background/terminated delivery on iOS: silent (content-available) pushes must use
    // priority 5 + push-type background or Apple throttles/drops them. Alert pushes get
    // priority 10, and new-order alerts add a custom sound plus time-sensitive so they
    // cut through Focus and the lock screen the way Android does.
    message.apns = {
        headers: {
            'apns-priority': isDataOnlyPush ? '5' : '10',
            'apns-push-type': isDataOnlyPush ? 'background' : 'alert',
            // Same reasoning as android.ttl above; APNs takes an absolute epoch.
            ...(isNewOrderAlert
                ? { 'apns-expiration': String(Math.floor(Date.now() / 1000) + NEW_ORDER_TTL_SECONDS) }
                : {})
        },
        payload: {
            aps: isDataOnlyPush
                ? { 'content-available': 1 }
                : {
                      // The iOS app bundles no custom sound, and APNs drops
                      // silently to the default tone for one it cannot find --
                      // so naming a missing file bought nothing and hid the
                      // fact that it was never playing. Restore a custom sound
                      // here only once the app actually ships the .caf.
                      sound: 'default',
                      'content-available': 1,
                      ...(isNewOrderAlert ? { 'interruption-level': 'time-sensitive' } : {})
                  }
        }
    };

    message.webpush = {
        headers: {
            Urgency: 'high'
        },
        notification: {
            title: notification.title,
            body: notification.body,
            icon: image || payload.icon || '/favicon.ico'
        }
    };

    return message;
};

const parseFirebaseError = async (response) => {
    try {
        return await response.json();
    } catch {
        try {
            const text = await response.text();
            return { error: { message: text } };
        } catch {
            return { error: { message: 'Unknown Firebase error' } };
        }
    }
};

const shouldRemoveTokenFromError = (errorJson, response) => {
    const status = response?.status;
    const message = String(errorJson?.error?.message || '').toUpperCase();
    return status === 404 || message.includes('UNREGISTERED') || message.includes('INVALID_ARGUMENT');
};

/** Transient FCM failures worth a retry. Anything else is permanent. */
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_SEND_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getOwnerModel = (ownerType) => OWNER_MODELS[String(ownerType || '').toUpperCase()] || null;

const getTokenFieldForPlatform = (platform) => OWNER_TOKEN_FIELDS[isMobilePlatform(platform) ? 'mobile' : 'web'];

const normalizeTokenList = (tokens = []) => {
    const normalized = [...new Set((Array.isArray(tokens) ? tokens : [tokens]).map(sanitizeString).filter(Boolean))];
    return normalized.slice(-MAX_TOKENS_PER_PLATFORM);
};

const readTokensFromDoc = (doc, platform) => {
    if (!doc) return [];
    if (platform) {
        return normalizeTokenList(doc[getTokenFieldForPlatform(platform)] || []);
    }
    // Keep per-platform caps, then unique across both buckets.
    return [
        ...new Set([
            ...normalizeTokenList(doc.fcmTokens || []),
            ...normalizeTokenList(doc.fcmTokenMobile || [])
        ])
    ];
};

/**
 * One FCM token must belong to at most one owner / platform bucket.
 * Prevents duplicate pushes when the same install was saved under multiple accounts or both web+mobile.
 */
export const detachFirebaseDeviceTokenEverywhere = async (token) => {
    const normalizedToken = sanitizeString(token);
    if (!normalizedToken) return { success: false };

    const models = Object.values(OWNER_MODELS);
    await Promise.all(
        models.flatMap((model) => [
            model.updateMany({ fcmTokens: normalizedToken }, { $pull: { fcmTokens: normalizedToken } }),
            model.updateMany({ fcmTokenMobile: normalizedToken }, { $pull: { fcmTokenMobile: normalizedToken } })
        ])
    );
    return { success: true };
};

export const listOwnerTokens = async ({ ownerType, ownerId, platform }) => {
    if (!ownerType || !ownerId) return [];
    const model = getOwnerModel(ownerType);
    if (!model) return [];
    const doc = await model.findById(ownerId).select('fcmTokens fcmTokenMobile').lean();
    return readTokensFromDoc(doc, platform);
};

export const upsertFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform = 'web' }) => {
    const normalizedToken = sanitizeString(token);
    const normalizedPlatform = normalizePlatform(platform);
    console.log(
        `[FCM-DEBUG] upsertFirebaseDeviceToken: ownerType=${ownerType}, ownerId=${ownerId}, platform=${normalizedPlatform}, tokenPreview=${normalizedToken?.slice(0, 10)}...`
    );

    if (!ownerType || !ownerId || !normalizedToken) {
        console.error('[FCM-DEBUG] upsert - Missing required fields');
        throw new Error('ownerType, ownerId, and token are required.');
    }

    const model = getOwnerModel(ownerType);
    if (!model) {
        console.error(`[FCM-DEBUG] upsert - Unsupported owner type: ${ownerType}`);
        throw new Error(`Unsupported owner type: ${ownerType}`);
    }

    // Detach first so this token cannot live on another user or the wrong platform list.
    await detachFirebaseDeviceTokenEverywhere(normalizedToken);

    const field = getTokenFieldForPlatform(normalizedPlatform);
    const otherField = field === OWNER_TOKEN_FIELDS.web ? OWNER_TOKEN_FIELDS.mobile : OWNER_TOKEN_FIELDS.web;

    // Atomic, NOT load-modify-save.
    //
    // This used to findById, mutate the arrays, and save(). Mongoose stamps a
    // version on documents with arrays, and save() fails with a VersionError
    // when anything else touched them in between — which happens constantly
    // here: detachFirebaseDeviceTokenEverywhere above rewrites those very
    // arrays, and a client retrying its registration fires several saves within
    // a second. The endpoint then returned 500 and the device never registered,
    // so pushes stopped for that account entirely.
    //
    // $addToSet / $pull are applied by the server against whatever the document
    // currently holds, so concurrent writers cannot invalidate each other and no
    // version is consulted at all.
    const result = await model.updateOne(
        { _id: ownerId },
        {
            $addToSet: { [field]: normalizedToken },
            // Never keep the same token in both buckets on this document.
            $pull: { [otherField]: normalizedToken },
        },
    );

    if (!result.matchedCount) {
        console.error(`[FCM-DEBUG] upsert - Owner profile not found for id ${ownerId}`);
        throw new Error('Owner profile not found.');
    }

    console.log('[FCM-DEBUG] upsert - Token list updated atomically.');
    return { success: true };
};

/**
 * Makes [token] the owner's ONLY device token, dropping every token it had before.
 *
 * For roles whose sessions are single-device (see SESSION_SCOPED_MODELS in
 * auth.middleware), logging in elsewhere already evicts the previous session's JWT.
 * Its push token used to survive that, so the signed-out phone kept receiving
 * pushes for the account: a rider's old handset went on raising full-screen order
 * alerts it could no longer accept, and a restaurant's old device kept getting new
 * order notifications. Killing the session and leaving its notifications alive is
 * half a logout.
 *
 * upsertFirebaseDeviceToken alone does not cover this. It detaches the token from
 * OTHER owners — which is the same-device-new-account case — but appends to the
 * current owner's list, which is exactly the list that needs emptying here.
 *
 * Only ever called with a real replacement token in hand. Clearing the list when
 * login could not supply one would leave the device that just signed in unable to
 * receive anything at all.
 */
export const replaceFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform = 'mobile' }) => {
    const normalizedToken = sanitizeString(token);
    if (!ownerType || !ownerId || !normalizedToken) {
        throw new Error('ownerType, ownerId, and token are required.');
    }

    const model = getOwnerModel(ownerType);
    if (!model) throw new Error(`Unsupported owner type: ${ownerType}`);

    await model.updateOne(
        { _id: ownerId },
        { $set: { fcmTokens: [], fcmTokenMobile: [] } },
    );

    return upsertFirebaseDeviceToken({ ownerType, ownerId, token: normalizedToken, platform });
};

export const removeFirebaseDeviceToken = async ({ ownerType, ownerId, token }) => {
    const normalizedToken = sanitizeString(token);
    if (!ownerType || !ownerId) {
        throw new Error('ownerType and ownerId are required.');
    }

    // Logout without a token used to throw here. The delivery and restaurant apps
    // call this on logout with no body, so every logout raised a 500 that the app
    // swallowed ("logging out locally regardless") and the token stayed attached --
    // the rider signed out and kept getting new-order alerts.
    //
    // No token means "this authenticated owner is signing out": clear the whole
    // list. Scoped by ownerId, so it can only ever affect the caller's own account.
    if (!normalizedToken) {
        const model = getOwnerModel(ownerType);
        if (!model) throw new Error(`Unsupported owner type: ${ownerType}`);
        await model.updateOne(
            { _id: ownerId },
            { $set: { fcmTokens: [], fcmTokenMobile: [] } },
        );
        return { success: true, cleared: 'all' };
    }

    // Token identity is global: scrub every owner/platform so leftovers cannot cause duplicate pushes.
    await detachFirebaseDeviceTokenEverywhere(normalizedToken);
    return { success: true };
};

/**
 * Send one FCM message, retrying transient failures (network throw, 429/5xx) with
 * exponential backoff: immediate, +300ms, +600ms. Permanent failures (unregistered token,
 * invalid argument) return straight away with remove:true so the caller prunes the token —
 * retrying those only delays cleanup.
 */
const sendMessageWithRetry = async (message, { projectId, accessToken }) => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(FCM_SEND_URL(projectId), {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            });

            if (response.ok) {
                return { ok: true, response: await response.json() };
            }

            const errorJson = await parseFirebaseError(response);
            const remove = shouldRemoveTokenFromError(errorJson, response);
            const retryable = !remove && RETRYABLE_HTTP_STATUSES.has(response.status);
            if (retryable && attempt < MAX_SEND_ATTEMPTS) {
                await sleep(300 * 2 ** (attempt - 1));
                continue;
            }
            return {
                ok: false,
                remove,
                error: errorJson?.error?.message || `FCM send failed (${response.status})`
            };
        } catch (error) {
            lastError = error;
            if (attempt < MAX_SEND_ATTEMPTS) {
                await sleep(300 * 2 ** (attempt - 1));
                continue;
            }
        }
    }
    return { ok: false, remove: false, error: lastError?.message || String(lastError) };
};

export const sendPushNotification = async (tokens, payload = {}) => {
    const projectId = await getFirebaseProjectId();
    const accessToken = await getFirebaseAccessToken();
    const uniqueTokens = normalizeTokenList(tokens);

    if (uniqueTokens.length === 0) {
        return { successCount: 0, failureCount: 0, results: [] };
    }

    const results = await Promise.all(
        uniqueTokens.map(async (token) => {
            const message = buildMessagePayload(payload, token);
            const result = await sendMessageWithRetry(message, { projectId, accessToken });
            return { token, ...result };
        })
    );

    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;
    return { successCount, failureCount, results };
};

export const sendNotificationToOwner = async ({ ownerType, ownerId, payload, platform } = {}) => {
    // Every customer push is also filed in the one inbox the app reads
    // (core/notifications/customerInbox.js), before the device check: a customer
    // with notifications off still finds it there. Never blocks the push.
    if (String(ownerType || '').toUpperCase() === 'USER' && !payload?.skipInbox) {
        await recordCustomerNotification({
            vertical: 'quickCommerce',
            userId: ownerId,
            title: payload?.title || payload?.notification?.title,
            message: payload?.body || payload?.message || payload?.notification?.body,
            data: payload?.data,
            image: payload?.image,
        });
    }

    // Clone payload to avoid side-effects across batched sends.
    const enrichedPayload = { ...payload };

    const tokens = await listOwnerTokens({ ownerType, ownerId, platform });
    if (!tokens.length) {
        return { successCount: 0, failureCount: 0, results: [] };
    }
    try {
        console.log(`[FCM] Sending to ${ownerType}:${ownerId}. Title: "${enrichedPayload.title || 'Data Only'}"`);
        const response = await sendPushNotification(tokens, enrichedPayload);
        const invalidTokens = (response.results || [])

            .filter((item) => !item.ok && item.remove)
            .map((item) => item.token)
            .filter(Boolean);
        if (invalidTokens.length > 0) {
            const model = getOwnerModel(ownerType);
            const doc = model ? await model.findById(ownerId) : null;
            if (doc) {
                const fieldNames = platform
                    ? [getTokenFieldForPlatform(platform)]
                    : [OWNER_TOKEN_FIELDS.web, OWNER_TOKEN_FIELDS.mobile];
                for (const field of fieldNames) {
                    doc[field] = normalizeTokenList((Array.isArray(doc[field]) ? doc[field] : []).filter((t) => !invalidTokens.includes(t)));
                }
                await doc.save();
            }
        }
        logger.info(
            `FCM push sent to ${ownerType}:${ownerId} (${platform || 'all'}). Success=${response.successCount}, Failure=${response.failureCount}`
        );
        return response;
    } catch (error) {
        logger.warn(`FCM push failed for ${ownerType}:${ownerId}: ${error.message}`);
        return { successCount: 0, failureCount: tokens.length, error: error.message };
    }
};

export const sendNotificationToOwners = async (targets = [], payload = {}) => {
    // 🔍 Tip #6: Deduplicate targets by ownerType:ownerId before sending
    // This prevents duplicate notifications if the same person is listed twice (e.g. as USER and partner)
    const uniqueTargets = Array.isArray(targets) 
        ? [...new Map(targets.filter(t => t?.ownerType && t?.ownerId).map(t => [`${t.ownerType}:${t.ownerId}`, t])).values()]
        : [];

    const results = [];
    for (const target of uniqueTargets) {
        results.push(
            await sendNotificationToOwner({
                ownerType: target.ownerType,
                ownerId: target.ownerId,
                platform: target.platform,
                payload
            })
        );
    }
    return results;
};

export const notifyAdminsSafely = async (payload = {}) => {
    try {
        const admins = await FoodAdmin.find({ isActive: true }).select('_id').lean();
        if (!admins.length) return [];
        
        const targets = admins.map(a => ({
            ownerType: 'ADMIN',
            ownerId: String(a._id)
        }));
        
        return await sendNotificationToOwners(targets, payload);
    } catch (e) {
        logger.error(`Error notifying admins: ${e.message}`);
        return [];
    }
};

export const sendTestNotification = async ({ ownerType, ownerId, platform }) => {
    return sendNotificationToOwner({
        ownerType,
        ownerId,
        platform,
        payload: {
            title: 'Test Notification',
            body: 'This is a test notification from Firebase push',
            data: {
                type: 'test',
                link: '/'
            }
        }
    });
};
export const notifyOwnerSafely = async (target = {}, payload = {}) => {
    try {
        return await sendNotificationToOwner({ ...target, payload });
    } catch (error) {
        logger.warn(`FCM individual push failed: ${error.message}`);
        return null;
    }
};

export const notifyOwnersSafely = async (targets = [], payload = {}) => {
    try {
        return await sendNotificationToOwners(targets, payload);
    } catch (error) {
        logger.warn(`FCM broadcast push failed: ${error.message}`);
        return [];
    }
};

/**
 * An alert that needs BOTH action buttons and delivery on locked-down ROMs.
 *
 * These two requirements cannot be met by one FCM message, which is the trap a
 * single "hybrid" message fell into:
 *
 *  - A message carrying a notification block is rendered by Android itself, and
 *    the app's background handler is never called. FCM's notification block has
 *    no concept of action buttons, so Accept/Reject cannot exist on it.
 *  - A data-only message DOES reach the handler, which can build a rich
 *    notification with Accept/Reject — but delivering it requires Android to
 *    start the app process, which Vivo, Oppo and Xiaomi refuse without
 *    Autostart. There the message is accepted and silently dropped.
 *
 * So both are sent. On a healthy device the data-only message arrives, the
 * handler posts the rich notification and cancels the plain one by its tag, and
 * the user sees exactly one alert with buttons. On a restricted ROM the
 * data-only message goes nowhere and the plain one is all that renders — no
 * buttons, but the order is not missed, which is the outcome that matters.
 *
 * The tag is the contract that keeps a healthy device from showing two: the app
 * cancels id 0 with this tag. Change it here and the app must change with it.
 */
export const notifyOwnersActionableAlert = async (targets = [], payload = {}) => {
    const { androidTag, androidChannelId, ...rest } = payload;

    // Notification leg FIRST, data-only second — the order matters.
    //
    // The app cancels the plain copy by tag when its handler runs. Sending
    // data-only first meant the handler cancelled a notification that had not
    // arrived yet, and the plain copy then appeared afterwards and stayed —
    // leaving two alerts on screen instead of one, on exactly the devices that
    // were working correctly.
    //
    // This way the plain copy is posted first, and the handler cancels
    // something that actually exists.
    await notifyOwnersSafely(targets, { ...rest, androidTag, androidChannelId });

    return notifyOwnersSafely(targets, { ...rest, dataOnly: true });
};
