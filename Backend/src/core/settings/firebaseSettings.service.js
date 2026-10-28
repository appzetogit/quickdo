import { AdminThirdPartySetting } from '../../modules/taxi/admin/models/AdminThirdPartySetting.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Firebase configuration, resolved DATABASE-FIRST with environment fallback.
 *
 * Why: these values used to live only in .env, which meant changing a Firebase
 * project required editing files on the server and redeploying the frontend (the
 * client config is baked in at build time by Vite). Storing them in the settings
 * document lets the admin panel change them, and lets the frontend pick them up on
 * its next load.
 *
 * Storage is the existing `firebase` block on the third-party settings document --
 * the one the admin panel already reads and writes through
 * GET/PATCH /api/v1/taxi/admin/integration-settings/firebase. Its type is Mixed, so
 * the two fields it lacked (vapid key, service account JSON) need no schema change.
 *
 * Env remains the fallback for every field. An empty database, a fresh deploy or a
 * blanked-out settings form therefore degrades to exactly the previous behaviour
 * instead of leaving Firebase unconfigured.
 */

// A settings read per request would be silly; a stale value for a few seconds after
// an admin saves is fine. The admin write path calls invalidate() so the panel
// still feels immediate.
const CACHE_MS = 30_000;
let cache = null;
let cachedAt = 0;

export const invalidateFirebaseSettingsCache = () => {
    cache = null;
    cachedAt = 0;
};

const clean = (value) => (value === undefined || value === null ? '' : String(value).trim().replace(/^['"]|['"]$/g, ''));

const readFromDb = async () => {
    try {
        const doc = await AdminThirdPartySetting.findOne({}).lean();
        return doc?.firebase || {};
    } catch (err) {
        // A settings lookup must never take down a request path that only needed a
        // client config. Fall through to env.
        logger.error(`Firebase settings lookup failed, using env: ${err.message}`);
        return {};
    }
};

/**
 * @returns {Promise<{apiKey,authDomain,projectId,databaseURL,storageBucket,messagingSenderId,appId,measurementId,vapidKey,serviceAccount,source}>}
 */
export const getFirebaseSettings = async () => {
    if (cache && Date.now() - cachedAt < CACHE_MS) return cache;

    const db = await readFromDb();
    const pick = (dbKey, envValue) => clean(db[dbKey]) || clean(envValue);

    const resolved = {
        apiKey: pick('firebase_api_key', config.firebaseWebApiKey),
        authDomain: pick('firebase_auth_domain', config.firebaseWebAuthDomain),
        projectId: pick('firebase_project_id', config.firebaseProjectId),
        databaseURL: pick('firebase_database_url', config.firebaseDatabaseUrl),
        storageBucket: pick('firebase_storage_bucket', config.firebaseWebStorageBucket),
        messagingSenderId: pick('firebase_messaging_sender_id', config.firebaseWebMessagingSenderId),
        appId: pick('firebase_app_id', config.firebaseWebAppId),
        measurementId: pick('firebase_measurement_id', config.firebaseWebMeasurementId),
        vapidKey: pick('firebase_vapid_key', config.firebaseWebVapidKey),
        // SERVER-SIDE ONLY. Never goes out over the public config endpoint.
        serviceAccount: pick('firebase_service_account', config.firebaseServiceAccount),
    };

    // Only the fields resolved above count. The stored block also carries
    // `firebase_json_name`, which the taxi defaults populate with a filename -- keying
    // off "any non-empty key" therefore reported 'database' for a completely empty
    // config, and the startup log claimed credentials came from the settings document
    // when they had in fact come from env.
    const RESOLVED_KEYS = [
        'firebase_api_key', 'firebase_auth_domain', 'firebase_project_id', 'firebase_database_url',
        'firebase_storage_bucket', 'firebase_messaging_sender_id', 'firebase_app_id',
        'firebase_measurement_id', 'firebase_vapid_key', 'firebase_service_account',
    ];
    resolved.source = RESOLVED_KEYS.some((k) => clean(db[k])) ? 'database' : 'env';

    cache = resolved;
    cachedAt = Date.now();
    return resolved;
};

/**
 * The subset that is safe to hand to a browser. Everything here already ships inside
 * the client bundle today; the service account and anything else secret does not.
 */
export const getPublicFirebaseConfig = async () => {
    const s = await getFirebaseSettings();
    return {
        apiKey: s.apiKey,
        authDomain: s.authDomain,
        projectId: s.projectId,
        databaseURL: s.databaseURL,
        storageBucket: s.storageBucket,
        messagingSenderId: s.messagingSenderId,
        appId: s.appId,
        measurementId: s.measurementId,
        vapidKey: s.vapidKey,
    };
};

/** Parsed service account for firebase-admin, or null. Server-side only. */
export const getFirebaseServiceAccount = async () => {
    const { serviceAccount } = await getFirebaseSettings();
    if (!serviceAccount) return null;
    try {
        return JSON.parse(serviceAccount);
    } catch (err) {
        logger.error(`FIREBASE service account is not valid JSON: ${err.message}`);
        return null;
    }
};
