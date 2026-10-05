/**
 * Runtime configuration, fetched from the backend instead of baked in by Vite.
 *
 * Vite inlines import.meta.env at BUILD time, so changing the Firebase project used
 * to require rebuilding and redeploying the frontend. The backend serves the same
 * values at /api/v1/env/public, sourced from the settings document the admin panel
 * writes, so an admin can switch Firebase projects and the next page load picks it up.
 *
 * import.meta.env remains the fallback for every key. If the endpoint is unreachable,
 * slow, or the deployment predates it, behaviour is exactly what it was before.
 *
 * Fetched once per page load and cached in memory. Deliberately NOT persisted to
 * localStorage: a stale cached config surviving a project switch is the exact failure
 * this is meant to remove.
 */

const buildTime = {
    VITE_GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY || '',
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    VITE_FIREBASE_DATABASE_URL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID || '',
    VITE_FIREBASE_MEASUREMENT_ID: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
    VITE_FIREBASE_VAPID_KEY: import.meta.env.VITE_FIREBASE_VAPID_KEY || '',
};

let resolved = { ...buildTime };
let inflight = null;

const endpoint = () => {
    const base = import.meta.env.VITE_API_BASE_URL || '';
    // VITE_API_BASE_URL is `<origin>/api/v1`; the config route lives at `<origin>/api/v1/env/public`.
    if (base) return `${String(base).replace(/\/+$/, '')}/env/public`;
    return '/api/v1/env/public';
};

/**
 * Fetch runtime config once. Values that come back empty do NOT overwrite a
 * build-time value -- a blank field in the settings form should fall back, not blank
 * out a working config.
 */
export const loadRuntimeEnv = async () => {
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const res = await fetch(endpoint(), { credentials: 'omit' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            const data = body?.data || {};

            const merged = { ...buildTime };
            for (const key of Object.keys(buildTime)) {
                const value = data[key];
                if (value !== undefined && value !== null && String(value).trim() !== '') {
                    merged[key] = String(value).trim();
                }
            }
            resolved = merged;

            if (data.FIREBASE_CONFIG_SOURCE === 'database') {
                console.info('[runtimeEnv] Firebase config served from the admin settings');
            }
        } catch (err) {
            // Non-fatal by design: keep the build-time values.
            console.warn(`[runtimeEnv] falling back to build-time env: ${err.message}`);
        }
        return resolved;
    })();

    return inflight;
};

/** Current value: runtime if loaded, build-time otherwise. Never throws. */
export const env = (key) => resolved[key] ?? '';

/** Whole resolved map, for callers that want to destructure. */
export const getRuntimeEnv = () => ({ ...resolved });

export const firebaseConfigFromEnv = () => ({
    apiKey: env('VITE_FIREBASE_API_KEY'),
    authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: env('VITE_FIREBASE_PROJECT_ID'),
    databaseURL: env('VITE_FIREBASE_DATABASE_URL'),
    storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: env('VITE_FIREBASE_APP_ID'),
    measurementId: env('VITE_FIREBASE_MEASUREMENT_ID'),
});
