import { config } from '../../../../config/env.js';
import { getPublicFirebaseConfig, getFirebaseSettings } from '../../../../core/settings/firebaseSettings.service.js';
import { getGoogleMapsApiKey } from '../../../../core/settings/mapSettings.service.js';

const sanitize = (value) => (value ? String(value).trim().replace(/^['"]|['"]$/g, '') : '');

/**
 * Public runtime configuration for the frontend.
 *
 * Vite bakes import.meta.env into the bundle at BUILD time, so changing a Firebase
 * project used to mean a rebuild and redeploy of the frontend. Serving the same
 * values here lets the client read them at load time, so an admin can change the
 * Firebase project from the panel and the next page load picks it up.
 *
 * Firebase values now come from the settings document first (what the admin panel
 * writes), falling back to environment variables.
 *
 * ONLY non-secret, client-safe keys belong here. Everything below already ships
 * inside the browser bundle today. The Firebase service account private key is
 * deliberately NOT included -- getPublicFirebaseConfig() omits it.
 */
export const getPublicEnvController = async (_req, res, next) => {
    try {
        const fb = await getPublicFirebaseConfig();
        const { source } = await getFirebaseSettings();

        // Database-first (admin panel -> map_apis), env as fallback, same as Firebase.
        const googleMapsKey = sanitize(await getGoogleMapsApiKey());

        return res.status(200).json({
            success: true,
            message: 'Public environment variables fetched',
            data: {
                VITE_GOOGLE_MAPS_API_KEY: googleMapsKey || '',

                VITE_FIREBASE_API_KEY: fb.apiKey,
                VITE_FIREBASE_AUTH_DOMAIN: fb.authDomain,
                VITE_FIREBASE_PROJECT_ID: fb.projectId,
                VITE_FIREBASE_DATABASE_URL: fb.databaseURL,
                VITE_FIREBASE_STORAGE_BUCKET: fb.storageBucket,
                VITE_FIREBASE_MESSAGING_SENDER_ID: fb.messagingSenderId,
                VITE_FIREBASE_APP_ID: fb.appId,
                VITE_FIREBASE_MEASUREMENT_ID: fb.measurementId,
                VITE_FIREBASE_VAPID_KEY: fb.vapidKey,

                // Unprefixed aliases kept for older callers that read these names.
                FIREBASE_API_KEY: fb.apiKey,
                FIREBASE_AUTH_DOMAIN: fb.authDomain,
                FIREBASE_PROJECT_ID: fb.projectId,
                FIREBASE_DATABASE_URL: fb.databaseURL,
                FIREBASE_STORAGE_BUCKET: fb.storageBucket,
                FIREBASE_MESSAGING_SENDER_ID: fb.messagingSenderId,
                FIREBASE_APP_ID: fb.appId,
                FIREBASE_MEASUREMENT_ID: fb.measurementId,
                FIREBASE_VAPID_KEY: fb.vapidKey,

                // Lets the panel show whether it is serving admin-managed values or
                // still falling back to the server's environment.
                FIREBASE_CONFIG_SOURCE: source,
                NODE_ENV: config.nodeEnv || 'development'
            }
        });
    } catch (error) {
        next(error);
    }
};
