/**
 * Quick commerce's Firebase: the platform's, not a second copy.
 *
 * This file used to hold its own firebase-admin setup, and nothing ever called
 * its `initializeFirebaseRealtime()` -- server.js initialises the platform's
 * (src/config/firebase.js) and only that one. So this module's `db` and
 * `messaging` stayed null for the life of the process and its getters threw
 * "Firebase Realtime Database not initialized" on every call. The callers catch
 * it, so nothing crashed: quick-commerce and medical live order tracking simply
 * never reached Firebase, and customers never saw the rider move. Production's
 * error log had 273 of them.
 *
 * It also read credentials from the environment only, where the platform module
 * honours the ones set in Master > Settings. firebase-admin keeps ONE default
 * app per process and whichever module initialised first would have decided the
 * credentials for both -- so an admin's Firebase settings could be silently
 * ignored depending on load order.
 *
 * Re-exporting the platform module fixes both: one initialisation, one set of
 * credentials, and getters that return null rather than throw when Firebase is
 * genuinely not configured -- which is what every caller here already checks.
 */
export {
    initializeFirebaseRealtime,
    getFirebaseDB,
    getFirebaseMessaging,
    default,
} from '../../../config/firebase.js';
