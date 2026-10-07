import crypto from 'crypto';
import { recordCustomerNotification } from './customerInbox.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { FoodAdmin } from '../admin/admin.model.js';
import { Driver as TaxiDriver } from '../../modules/taxi/driver/models/Driver.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AuthError } from '../auth/errors.js';

const FIREBASE_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SEND_URL = (projectId) =>
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
const OWNER_MODELS = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner,
    ADMIN: FoodAdmin,
    DRIVER: TaxiDriver
};
const OWNER_ROLE_ALIASES = {
    USER: 'USER',
    RESTAURANT: 'RESTAURANT',
    DELIVERY_PARTNER: 'DELIVERY_PARTNER',
    ADMIN: 'ADMIN',
    TAXI_USER: 'USER',
    DRIVER: 'DRIVER'
};
const OWNER_TOKEN_FIELD_CONFIG = {
    USER: { web: 'fcmTokens', mobile: 'fcmTokenMobile' },
    RESTAURANT: { web: 'fcmTokens', mobile: 'fcmTokenMobile' },
    DELIVERY_PARTNER: { web: 'fcmTokens', mobile: 'fcmTokenMobile' },
    ADMIN: { web: 'fcmTokens', mobile: 'fcmTokenMobile' },
    DRIVER: { web: 'fcmTokenWeb', mobile: 'fcmTokenMobile' }
};
const OWNER_APP_PREFIXES = {
    USER: '👤 [User]',
    RESTAURANT: '🏪 [Shop]',
    DELIVERY_PARTNER: '🛵 [Rider]',
    ADMIN: '🛡️ [Admin]'
};

let cachedAccessToken = null;
let cachedAccessTokenExpiryMs = 0;
let cachedServiceAccount = null;

const sanitizeString = (value) => String(value ?? '').trim();

const toBase64Url = (input) =>
    Buffer.from(JSON.stringify(input))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

const normalizePrivateKey = (key) => String(key || '').replace(/\\n/g, '\n').trim();

/**
 * The service account this process signs FCM requests with.
 *
 * Database first, env second. The admin panel writes Firebase credentials to the
 * settings document, and the client config served to web and mobile is read from
 * that same document -- so devices register tokens against whichever project the
 * database names. Resolving the sender from env only meant the two halves could
 * disagree, and they did: tokens were minted for the project in the database
 * while every push was signed by the stale project still sitting in .env. FCM
 * rejected all of them with "SenderId mismatch", so no notification was ever
 * delivered while both halves looked individually correct.
 *
 * Env remains the fallback for a deployment that has no settings document yet.
 */
const resolveServiceAccount = async () => {
    if (cachedServiceAccount) return cachedServiceAccount;

    try {
        const { getFirebaseServiceAccount } = await import('../settings/firebaseSettings.service.js');
        const fromDb = await getFirebaseServiceAccount();
        if (fromDb?.client_email && fromDb?.private_key) {
            cachedServiceAccount = fromDb;
            return cachedServiceAccount;
        }
    } catch {
        // Fall through to env: the settings document is optional, and a database
        // problem here must not be reported as a missing credential.
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

/**
 * Drop the cached credentials and access token.
 *
 * Called when an admin saves new Firebase settings. The OAuth token is minted
 * from the service account, so keeping it after the account changes would keep
 * sending from the old project until it expired an hour later.
 */
export const invalidateFirebaseSenderCache = () => {
    cachedServiceAccount = null;
    cachedAccessToken = null;
    cachedAccessTokenExpiryMs = 0;
};

const getFirebaseProjectId = async () => {
    const account = await resolveServiceAccount();
    // The account's own project_id leads deliberately. config.firebaseProjectId
    // comes from env and can name a different project than the key signing the
    // request, which is the same mismatch this function exists to avoid.
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
        title: sanitizeString(payload.title || payload.notification?.title || 'New notification'),
        body: sanitizeString(payload.body || payload.notification?.body || '')
    };
    const data = normalizeDataMap(payload.data || {});
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

    message.android = {
        priority: 'high',
        notification: {
            // Caller-specified so a client that created its own channel (a
            // dedicated new-order sound, its own importance level) actually
            // gets it — an unrecognised channel id is silently demoted by
            // Android to low importance, which posts with no sound and no
            // heads-up, indistinguishable from the push never arriving.
            channel_id: payload.androidChannelId || 'default',
            sound: 'default',
            default_vibrate_timings: true,
            default_light_settings: true,
            // Lets the client collapse/replace a plain tray copy once its own
            // richer local notification is showing, instead of leaving both
            // on screen. Undefined is fine — FCM omits the key.
            tag: payload.androidTag
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

const normalizeOwnerType = (ownerType) => {
    const normalized = String(ownerType || '').trim().toUpperCase();
    return OWNER_ROLE_ALIASES[normalized] || null;
};

const getOwnerModel = (ownerType) => OWNER_MODELS[normalizeOwnerType(ownerType)] || null;

const getTokenFieldForOwnerPlatform = (ownerType, platform) => {
    const normalizedOwnerType = normalizeOwnerType(ownerType);
    const config = OWNER_TOKEN_FIELD_CONFIG[normalizedOwnerType];
    if (!config) return null;
    return platform === 'mobile' ? config.mobile : config.web;
};

const normalizeTokenList = (tokens = []) => {
    const normalized = [...new Set((Array.isArray(tokens) ? tokens : [tokens]).map(sanitizeString).filter(Boolean))];
    return normalized.slice(-10);
};

const readTokenFieldAsList = (doc, fieldName) => {
    if (!doc || !fieldName) return [];
    return normalizeTokenList(doc[fieldName] || []);
};

const writeTokenFieldFromList = (doc, fieldName, tokens) => {
    const normalizedTokens = normalizeTokenList(tokens);
    if (!fieldName) return;
    if (Array.isArray(doc[fieldName])) {
        doc[fieldName] = normalizedTokens;
        return;
    }
    // Scalar token fields (e.g. TaxiDriver.fcmTokenMobile) should keep the latest token.
    doc[fieldName] = normalizedTokens[normalizedTokens.length - 1] || '';
};

const readTokensFromDoc = (doc, platform) => {
    if (!doc) return [];
    if (platform) {
        const field = getTokenFieldForOwnerPlatform(doc.__ownerType, platform);
        return readTokenFieldAsList(doc, field);
    }
    const webField = getTokenFieldForOwnerPlatform(doc.__ownerType, 'web');
    const mobileField = getTokenFieldForOwnerPlatform(doc.__ownerType, 'mobile');
    return normalizeTokenList([...readTokenFieldAsList(doc, webField), ...readTokenFieldAsList(doc, mobileField)]);
};

export const listOwnerTokens = async ({ ownerType, ownerId, platform }) => {
    if (!ownerType || !ownerId) return [];
    const model = getOwnerModel(ownerType);
    if (!model) return [];
    const doc = await model.findById(ownerId).select('fcmTokens fcmTokenMobile fcmTokenWeb').lean();
    if (doc) doc.__ownerType = ownerType;
    return readTokensFromDoc(doc, platform);
};

export const upsertFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform = 'web' }) => {
    const normalizedToken = sanitizeString(token);
    
    if (!ownerType || !ownerId || !normalizedToken) {
        throw new Error('ownerType, ownerId, and token are required.');
    }

    const normalizedPlatform = platform === 'mobile' ? 'mobile' : 'web';
    const model = getOwnerModel(ownerType);
    if (!model) {
        throw new Error(`Unsupported owner type: ${ownerType}`);
    }

    const doc = await model.findById(ownerId);
    if (!doc) {
        throw new AuthError('Session is stale or invalid for this account. Please login again.');
    }

    const field = getTokenFieldForOwnerPlatform(ownerType, normalizedPlatform);
    if (!field) {
        throw new Error(`Unsupported owner type: ${ownerType}`);
    }
    const existingTokens = readTokenFieldAsList(doc, field);
    const tokens = normalizeTokenList([...existingTokens, normalizedToken]);

    // Atomic $set rather than doc.save(). save() sends back the __v it read, so
    // two concurrent registrations — the app registers on launch AND on every
    // resume — race, and the loser throws VersionError and 500s. The token then
    // never lands, and that device silently receives no pushes at all.
    await model.updateOne(
      { _id: doc._id },
      {
        $set: {
          [field]: Array.isArray(doc[field])
            ? tokens
            : (tokens[tokens.length - 1] || ''),
        },
      },
    );
    return { success: true };
};

export const removeFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform }) => {
    const normalizedToken = sanitizeString(token);
    if (!ownerType || !ownerId || !normalizedToken) {
        throw new Error('ownerType, ownerId, and token are required.');
    }
    const model = getOwnerModel(ownerType);
    if (!model) {
        throw new Error(`Unsupported owner type: ${ownerType}`);
    }
    const doc = await model.findById(ownerId);
    if (!doc) {
        return { success: false };
    }

    if (platform) {
        const field = getTokenFieldForOwnerPlatform(ownerType, platform);
        const existing = readTokenFieldAsList(doc, field);
        writeTokenFieldFromList(doc, field, existing.filter((t) => t !== normalizedToken));
    } else {
        const webField = getTokenFieldForOwnerPlatform(ownerType, 'web');
        const mobileField = getTokenFieldForOwnerPlatform(ownerType, 'mobile');
        writeTokenFieldFromList(doc, webField, readTokenFieldAsList(doc, webField).filter((t) => t !== normalizedToken));
        writeTokenFieldFromList(
            doc,
            mobileField,
            readTokenFieldAsList(doc, mobileField).filter((t) => t !== normalizedToken)
        );
    }

    await doc.save();
    return { success: true };
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
            try {
                const response = await fetch(FCM_SEND_URL(projectId), {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message })
                });

                if (!response.ok) {
                    const errorJson = await parseFirebaseError(response);
                    return {
                        token,
                        ok: false,
                        remove: shouldRemoveTokenFromError(errorJson, response),
                        error: errorJson?.error?.message || `FCM send failed (${response.status})`
                    };
                }

                return {
                    token,
                    ok: true,
                    response: await response.json()
                };
            } catch (error) {
                return {
                    token,
                    ok: false,
                    remove: false,
                    error: error?.message || String(error)
                };
            }
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
            vertical: 'food',
            userId: ownerId,
            title: payload?.title || payload?.notification?.title,
            message: payload?.body || payload?.message || payload?.notification?.body,
            data: payload?.data,
            image: payload?.image,
        });
    }

    // 💡 Clone the payload to avoid side-effects (e.g. adding multiple prefixes to the same object during broadcasting)
    const enrichedPayload = { ...payload };

    // 🏷️ Add Highlighter Prefix to the Title
    if (enrichedPayload && !enrichedPayload.skipHighlighter) {
        const typeKey = String(ownerType || '').toUpperCase();
        const prefix = OWNER_APP_PREFIXES[typeKey] || '';
        
        if (prefix) {
            // Get original title from any potential field
            let originalTitle = enrichedPayload.title || enrichedPayload.notification?.title || 'New notification';
            
            // Safety: Ensure we don't ADD the prefix if it's already there (defensive check)
            if (!originalTitle.includes(prefix)) {
                enrichedPayload.title = `${prefix} ${originalTitle}`.trim();
            } else {
                enrichedPayload.title = originalTitle;
            }
        }
    }

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
                    ? [getTokenFieldForOwnerPlatform(ownerType, platform)]
                    : [getTokenFieldForOwnerPlatform(ownerType, 'web'), getTokenFieldForOwnerPlatform(ownerType, 'mobile')];
                for (const field of fieldNames) {
                    if (!field) continue;
                    writeTokenFieldFromList(
                        doc,
                        field,
                        readTokenFieldAsList(doc, field).filter((t) => !invalidTokens.includes(t))
                    );
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


/**
 * Two pushes, not one: a plain notification-bearing message first, then a
 * data-only message with the same payload.
 *
 * A single message that carries both a `notification` block and `data` is
 * intercepted by the Android FCM client whenever the app is backgrounded or
 * killed — it renders the plain notification itself and never wakes the
 * client's background message handler, so Accept/Reject action buttons (which
 * only that handler can attach) silently never appear. Sending the plain
 * message FIRST and the data-only one SECOND means: a device that never
 * starts the app in the background still gets an alert, and a device that
 * does gets the richer one and cancels the plain copy — by [androidTag] — once
 * its own is on screen. Cancelling before the plain copy has posted would
 * cancel nothing and leave two notifications up, which is why the order here
 * is fixed rather than parallel.
 */
export const notifyOwnersActionableAlert = async (targets = [], payload = {}) => {
    const { androidTag, androidChannelId, data, ...rest } = payload;

    // The plain copy must carry no `data` at all -- buildMessagePayload attaches
    // `data` whenever it's present regardless of `dataOnly`, so leaving it in
    // `rest` here silently recreates the combined notification+data message the
    // comment above warns about, and a backgrounded/killed app never gets woken
    // for the real (data-only) copy below.
    await sendNotificationToOwners(targets, { ...rest, androidTag, androidChannelId });
    return sendNotificationToOwners(targets, { ...rest, data, dataOnly: true });
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
