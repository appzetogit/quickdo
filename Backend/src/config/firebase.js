import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

let db = null;
let messaging = null;
let cachedServiceAccount = null;

const sanitizeString = (value) => String(value ?? '').trim();

/**
 * Service account from the admin-managed settings document, if one is stored there.
 * Set by server.js before Firebase is initialised, because credentials cannot be
 * swapped on a live firebase-admin app -- they have to be right at init time.
 */
let dbServiceAccount = null;
let dbDatabaseUrl = '';
export const setFirebaseServiceAccountOverride = (sa, databaseURL) => {
    dbServiceAccount = sa || null;
    dbDatabaseUrl = databaseURL || '';
};

const getServiceAccountFromEnv = () => {
    if (dbServiceAccount) return dbServiceAccount;
    if (cachedServiceAccount) return cachedServiceAccount;

    const rawJson = sanitizeString(config.firebaseServiceAccount);
    if (rawJson) {
        try {
            cachedServiceAccount = JSON.parse(rawJson);
            return cachedServiceAccount;
        } catch (err) {
            logger.error('Error parsing FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
        }
    }

    const pathValue = sanitizeString(config.firebaseServiceAccountPath);
    if (pathValue) {
        const filePath = resolve(process.cwd(), pathValue);
        if (existsSync(filePath)) {
            try {
                cachedServiceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
                return cachedServiceAccount;
            } catch (err) {
                logger.error(`Error reading or parsing firebase service account file at ${filePath}:`, err.message);
            }
        }
    }

    return null;
};

/**
 * Initializes Firebase Admin SDK with Service Account.
 * Supports both FCM and Realtime Database.
 */
export const initializeFirebaseRealtime = () => {
    try {
        // Declared before the early return below. It used to be declared after it, and
        // the early return referenced it -- a TDZ ReferenceError that stayed invisible
        // only because nothing else initialised Firebase first. The service-provider
        // module does (its firebaseAdmin.js runs at import time, before server.js calls
        // this), so that branch is now live.
        const databaseURL = dbDatabaseUrl || config.firebaseDatabaseUrl;

        if (admin.apps.length > 0) {
            db = databaseURL ? admin.database() : null;
            messaging = admin.messaging();
            return { db, messaging };
        }

        const serviceAccount = getServiceAccountFromEnv();

        if (!serviceAccount) {
            logger.warn('⚠️ Firebase service account not configured. Firebase features may not work.');
            return null;
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: databaseURL || undefined
        });

        if (databaseURL) {
            try {
                db = admin.database();
            } catch (dbError) {
                logger.error(`❌ Firebase Database initialization failed: ${dbError.message}`);
            }
        } else {
            logger.warn('⚠️ Firebase Database URL not configured. Realtime Database features will be unavailable.');
        }

        try {
            messaging = admin.messaging();
        } catch (msgError) {
            logger.error(`❌ Firebase Messaging initialization failed: ${msgError.message}`);
        }

        logger.info('✅ Firebase Realtime Database Initialized Successfully');
        return { db, messaging };
    } catch (error) {
        logger.error(`❌ Firebase Initialization Error: ${error.message}`);
        return null;
    }
};

/**
 * Returns the initialized Firebase Realtime Database instance.
 * @returns {admin.database.Database|null}
 */
export const getFirebaseDB = () => {
    if (!db) {
        logger.warn('⚠️ Firebase Realtime Database not initialized.');
        return null;
    }
    return db;
};

/**
 * Returns the initialized Firebase Messaging instance.
 * @returns {admin.messaging.Messaging|null}
 */
export const getFirebaseMessaging = () => {
    if (!messaging) {
        logger.warn('⚠️ Firebase Messaging not initialized.');
        return null;
    }
    return messaging;
};

/** Tests only: stand in a fake messaging client to see what would be sent. */
export const __setFirebaseMessagingForTests = (fake) => {
    messaging = fake;
};

export const getFirebaseDatabase = getFirebaseDB;
export const firebaseServerTimestamp = admin.database.ServerValue.TIMESTAMP;

export default admin;
