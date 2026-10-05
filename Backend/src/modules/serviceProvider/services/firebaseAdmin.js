/**
 * Firebase Admin Service
 * Handles push notification sending via Firebase Cloud Messaging (FCM)
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
// Initialize Firebase Admin SDK
let serviceAccount;

try {
  if (process.env.FIREBASE_CONFIG) {
    // Production: Use environment variable JSON content
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Alternative Env Var
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Master's key (src/config/env.js -> config.firebaseServiceAccount). Reading it
    // here means SP shares the platform's single set of Firebase credentials instead
    // of needing its own service-account JSON on disk.
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Local: Use file path
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './config/truliq-firebase-adminsdk-fbsvc-ce65e5c441.json';
    serviceAccount = require(path.resolve(__dirname, '..', serviceAccountPath));
  }
} catch (error) {
  console.error('❌ Failed to load Firebase credentials:', error.message);
}

// Initialize only if not already initialized.
//
// This module is required at import time (routes -> controllers -> here), which is
// BEFORE server.js calls initializeFirebaseRealtime(). So inside master this is
// usually the call that creates the process-wide default app -- and whatever
// databaseURL it passes becomes the Realtime Database for every module, including
// master's live delivery tracking in config/socket.js.
//
// It used to hardcode the Truliq RTDB, which would have silently pointed master's
// order tracking at the service-provider's Firebase project. Prefer the platform's
// configured URL (the same VITE_FIREBASE_DATABASE_URL that config/env.js reads) and
// keep the Truliq URL only as a fallback for running this module standalone.
const RTDB_URL =
  process.env.VITE_FIREBASE_DATABASE_URL ||
  process.env.FIREBASE_DATABASE_URL ||
  'https://truliq-default-rtdb.asia-southeast1.firebasedatabase.app/';

if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: RTDB_URL
  });
  console.log(`✅ Firebase Admin SDK initialized (rtdb: ${RTDB_URL})`);
}

const NotificationLog = require('../models/NotificationLog');

/**
 * The firebase-admin app to send from.
 *
 * The default app is created at import time from env credentials, but the admin
 * panel stores the platform's Firebase service account in the database, and web
 * and mobile clients register their FCM tokens against whichever project that
 * document names. When the two disagree -- as they did -- every push is rejected
 * with "SenderId mismatch" while both halves look individually fine.
 *
 * Credentials cannot be swapped on a live firebase-admin app, so a separate
 * named app is created for the database-resolved account and cached by its
 * client_email. If the settings document is missing or unreadable the default
 * env-based app is used, which is the previous behaviour.
 */
let _dbApp = null;
let _dbAppKey = '';

async function getMessagingApp() {
  try {
    const { getFirebaseServiceAccount } = await import('../../../core/settings/firebaseSettings.service.js');
    const sa = await getFirebaseServiceAccount();
    if (!sa || !sa.client_email || !sa.private_key) return admin;

    if (_dbApp && _dbAppKey === sa.client_email) return _dbApp;

    const name = 'sp-fcm';
    const existing = admin.apps.find((a) => a && a.name === name);
    if (existing) {
      // The stored account changed; the old app cannot be re-credentialed.
      if (_dbAppKey && _dbAppKey !== sa.client_email) {
        await existing.delete().catch(() => {});
      } else {
        _dbApp = existing;
        _dbAppKey = sa.client_email;
        return _dbApp;
      }
    }

    _dbApp = admin.initializeApp({ credential: admin.credential.cert(sa) }, name);
    _dbAppKey = sa.client_email;
    return _dbApp;
  } catch (err) {
    console.warn('[FCM] Falling back to env Firebase credentials:', err.message);
    return admin;
  }
}



/**
 * Send push notification to multiple tokens
 * @param {string[]|Object} recipientOrTokens - Array of FCM tokens or a Mongoose Document (User/Worker/Vendor)
 * @param {Object} payload - Notification payload
 * @param {string} payload.title - Notification title
 * @param {string} payload.body - Notification body
 * @param {Object} payload.data - Additional data (optional)
 * @param {string} payload.notificationId - Custom unique ID for deduplication (optional)
 * @returns {Promise<Object>} - Response with success/failure counts
 */
async function sendPushNotification(recipientOrTokens, payload) {
  try {
    // 1. Generate/Extract unique notification ID (SOP Step 4)
    const userId = (recipientOrTokens && recipientOrTokens._id) ? String(recipientOrTokens._id) : 'anonymous';
    const type = payload.data?.type || 'generic';
    const relatedId = payload.data?.bookingId || payload.data?.id || Date.now();
    
    // If notificationId is provided in payload, use it, otherwise generate one
    const notificationId = payload.notificationId || `${userId}_${type}_${relatedId}`;

    // 2. Check NotificationLog (SOP Section 6, Step 4)
    // Allow repeated tests to bypass dedupe
    if (notificationId !== 'test-notification') {
      const alreadySent = await NotificationLog.findOne({ notificationId });
      if (alreadySent) {
        console.log(`[FCM] 🚫 Duplicate notification prevented: ${notificationId}`);
        return { successCount: 0, failureCount: 0, duplicate: true };
      }
    }

    // 3. Extract tokens
    let tokens = [];
    let recipient = recipientOrTokens;

    // If ID string is passed, try to fetch the user/worker/vendor
    if (typeof recipientOrTokens === 'string') {
      const Worker = require('../models/Worker');
      const User = require('../models/User');
      const Vendor = require('../models/Vendor');

      // Try fetching from all 3 collections
      const [worker, user, vendor] = await Promise.all([
        Worker.findById(recipientOrTokens),
        User.findById(recipientOrTokens),
        Vendor.findById(recipientOrTokens)
      ]);
      recipient = worker || user || vendor;
    }

    if (Array.isArray(recipient)) {
      tokens = recipient;
    } else if (recipient && typeof recipient === 'object') {
      const modelTokens = recipient.fcmTokens || [];
      const mobileTokens = recipient.fcmTokenMobile || [];
      const singleToken = recipient.fcmToken;
      
      tokens = [...modelTokens, ...mobileTokens];
      if (singleToken) tokens.push(singleToken);
    }

    if (!tokens || tokens.length === 0) {
      console.log('[FCM] No tokens found for recipient');
      return { successCount: 0, failureCount: 0 };
    }

    // Remove duplicates and empty values (Robust deduplication)
    const uniqueTokens = Array.from(new Set(tokens.filter(t => t && typeof t === 'string' && t.trim().length > 0)));


    if (uniqueTokens.length === 0) {
      console.log('No valid FCM tokens after filtering');
      return { successCount: 0, failureCount: 0 };
    }

    // ✅ Build complete data payload (all as strings - FCM requirement)
    const stringData = {
      title: payload.title || 'App Notification',
      body: payload.body || 'New Update',
      notificationId: String(notificationId),
    };
    if (payload.data) {
      Object.keys(payload.data).forEach(key => {
        stringData[key] = String(payload.data[key]);
      });
    }
    // Always ensure these are set correctly
    stringData.title = payload.title || 'App Notification';
    stringData.body = payload.body || 'New Update';
    stringData.notificationId = String(notificationId);
    if (payload.icon) stringData.icon = payload.icon;

    const message = {
      data: stringData,
      tokens: uniqueTokens,

      // Android: high priority
      android: {
        priority: 'high',
      },

      // WebPush: high urgency
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' },
        fcmOptions: { link: payload.data?.link || '/' }
      },
    };

    // If NOT data-only, add the standard notification objects
    if (!payload.dataOnly) {
      message.notification = {
        title: payload.title || 'App Notification',
        body: payload.body || 'New Update',
      };
      message.android.notification = {
        title: payload.title || 'App Notification',
        body: payload.body || 'New Update',
        icon: 'ic_notification',
        color: '#FF6B00',
        sound: 'default',
        channelId: payload.channelId || 'high_importance_channel',
        priority: 'high',
        visibility: 'public',
        defaultSound: true,
        defaultVibrateTimings: true,
      };
      message.apns = {
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
        payload: {
          aps: {
            alert: {
              title: payload.title || 'App Notification',
              body: payload.body || 'New Update',
            },
            sound: 'default',
            badge: 1,
            'mutable-content': 1,
            'content-available': 1
          }
        }
      };
    } else {
      // Data-only requires background push type for iOS
      message.apns = {
        headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
        payload: {
          aps: {
            'content-available': 1,
          }
        }
      };
    }

    // Log intent
    console.log(`[FCM] Sending standard notification to ${uniqueTokens.length} tokens:`, payload.title);

    const messagingApp = await getMessagingApp();
    const response = await messagingApp.messaging().sendEachForMulticast(message);

    console.log(`✅ Push notification sent - Success: ${response.successCount}, Failed: ${response.failureCount}`);

    // 4. Save log (LOCK) - SOP Section 6, Step 4
    if (response.successCount > 0) {
      try {
        await NotificationLog.create({ 
          notificationId, 
          userId, 
          tokens: uniqueTokens 
        });
      } catch (logErr) {
        // Ignore duplicate key error if another process just saved it
        if (logErr.code !== 11000) console.error('[FCM Log Error]:', logErr);
      }
    }

    // Log failed tokens for debugging and cleanup invalid ones
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          console.log(`❌ Failed token[${idx}]: ${errorCode} - ${resp.error?.message}`);

          if (errorCode === 'messaging/registration-token-not-registered' ||
            errorCode === 'messaging/invalid-registration-token') {
            invalidTokens.push(uniqueTokens[idx]);
          }
        }
      });

      // Cleanup invalid tokens
      if (invalidTokens.length > 0) {
        removeInvalidTokens(invalidTokens);
      }
    }

    return response;
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    throw error;
  }
}

/**
 * Remove invalid FCM tokens from all collections
 * @param {string[]} tokens - Array of invalid tokens to remove
 */
async function removeInvalidTokens(tokens) {
  try {
    console.log(`[FCM Cleanup] Removing ${tokens.length} invalid tokens...`);
    const User = require('../models/User');
    const Vendor = require('../models/Vendor');
    const Worker = require('../models/Worker');

    const updateQuery = {
      $pull: {
        fcmTokens: { $in: tokens },
        fcmTokenMobile: { $in: tokens }
      }
    };

    // We run updates in parallel for all collections as a token might belong to any
    await Promise.all([
      User.updateMany({ $or: [{ fcmTokens: { $in: tokens } }, { fcmTokenMobile: { $in: tokens } }] }, updateQuery),
      Vendor.updateMany({ $or: [{ fcmTokens: { $in: tokens } }, { fcmTokenMobile: { $in: tokens } }] }, updateQuery),
      Worker.updateMany({ $or: [{ fcmTokens: { $in: tokens } }, { fcmTokenMobile: { $in: tokens } }] }, updateQuery)
    ]);

    console.log('[FCM Cleanup] ✅ Invalid tokens removed from database');
  } catch (err) {
    console.error('[FCM Cleanup] ❌ Error removing tokens:', err);
  }
}

/**
 * Send notification to a specific user
 * @param {string} userId - User's MongoDB _id
 * @param {Object} payload - Notification payload
 * @param {boolean} includeMobile - Include mobile tokens (default: true)
 */
async function sendNotificationToUser(userId, payload, includeMobile = true) {
  try {
    const User = require('../models/User');
    const user = await User.findById(userId);

    if (!user) {
      console.log(`[FCM] ❌ User not found for notification: ${userId}`);
      return;
    }

    let tokens = [];
    if (user.fcmTokens && user.fcmTokens.length > 0) {
      tokens = [...tokens, ...user.fcmTokens];
    }
    if (includeMobile && user.fcmTokenMobile && user.fcmTokenMobile.length > 0) {
      tokens = [...tokens, ...user.fcmTokenMobile];
    }

    if (tokens.length === 0) {
      console.log(`[FCM] ⚠️ No FCM tokens found for user: ${userId}`);
      return;
    }

    console.log(`[FCM] 📤 Sending notification to user ${user.name} (${userId}) on ${tokens.length} devices`);

    // Add priority and sound for user notifications too
    const finalPayload = {
      ...payload,
      highPriority: payload.priority === 'high' ||
        ['booking_accepted', 'worker_started', 'journey_started', 'work_done', 'work_completed', 'booking_completed', 'vendor_reached', 'visit_verified', 'payment_success', 'payment_received', 'work_started', 'in_progress', 'worker_accepted'].includes(payload.data?.type),
      dataOnly: false // Explicitly disable dataOnly to force system tray notification
    };

    await sendPushNotification(tokens, finalPayload);
  } catch (error) {
    console.error(`[FCM] ❌ Error sending notification to user ${userId}:`, error);
  }
}

/**
 * Send notification to a specific vendor
 * @param {string} vendorId - Vendor's MongoDB _id
 * @param {Object} payload - Notification payload
 * @param {boolean} includeMobile - Include mobile tokens (default: true)
 */
async function sendNotificationToVendor(vendorId, payload, includeMobile = true) {
  try {
    const Vendor = require('../models/Vendor');
    const vendor = await Vendor.findById(vendorId);

    if (!vendor) {
      console.log(`[FCM] ❌ Vendor not found for notification: ${vendorId}`);
      return;
    }

    let tokens = [];
    if (vendor.fcmTokens && vendor.fcmTokens.length > 0) {
      tokens = [...tokens, ...vendor.fcmTokens];
    }
    if (includeMobile && vendor.fcmTokenMobile && vendor.fcmTokenMobile.length > 0) {
      tokens = [...tokens, ...vendor.fcmTokenMobile];
    }

    if (tokens.length === 0) {
      console.log(`[FCM] ⚠️ No FCM tokens found for vendor: ${vendorId}`);
      return;
    }

    console.log(`[FCM] 📤 Sending notification to vendor ${vendor.businessName || vendor.name} (${vendorId}) on ${tokens.length} devices`);

    const finalPayload = {
      ...payload,
      title: `🏢 [Partner] ${payload.title}`, // Add identification
      dataOnly: false // false = OS shows notification when killed/background + onMessage fires in foreground
    };

    await sendPushNotification(tokens, finalPayload);
  } catch (error) {
    console.error(`[FCM] ❌ Error sending notification to vendor ${vendorId}:`, error);
  }
}

/**
 * Send notification to a specific worker
 * @param {string} workerId - Worker's MongoDB _id
 * @param {Object} payload - Notification payload
 * @param {boolean} includeMobile - Include mobile tokens (default: true)
 */
async function sendNotificationToWorker(workerId, payload, includeMobile = true) {
  try {
    const Worker = require('../models/Worker');
    const worker = await Worker.findById(workerId);

    if (!worker) {
      console.log(`[FCM] ❌ Worker not found for notification: ${workerId}`);
      return;
    }

    let tokens = [];
    if (worker.fcmTokens && worker.fcmTokens.length > 0) {
      tokens = [...tokens, ...worker.fcmTokens];
    }
    if (includeMobile && worker.fcmTokenMobile && worker.fcmTokenMobile.length > 0) {
      tokens = [...tokens, ...worker.fcmTokenMobile];
    }

    if (tokens.length === 0) {
      console.log(`[FCM] ⚠️ No FCM tokens found for worker: ${workerId}`);
      return;
    }

    console.log(`[FCM] 📤 Sending notification to worker ${worker.name} (${workerId}) on ${tokens.length} devices`);

    const finalPayload = {
      ...payload,
      title: `👷 [Pro] ${payload.title}`, // Add identification
      dataOnly: false // Allow OS system notification + sound for workers
    };

    await sendPushNotification(tokens, finalPayload);
  } catch (error) {
    console.error(`[FCM] ❌ Error sending notification to worker ${workerId}:`, error);
  }
}

/**
 * Send notification to a specific admin
 * @param {string} adminId - Admin's MongoDB _id
 * @param {Object} payload - Notification payload
 * @param {boolean} includeMobile - Include mobile tokens (default: true)
 */
async function sendNotificationToAdmin(adminId, payload, includeMobile = true) {
  try {
    const User = require('../models/User'); // Use User model for admin too as they share collection or separate Admin model?

    let adminUser = null;
    try {
      const Admin = require('../models/Admin');
      adminUser = await Admin.findById(adminId);
    } catch (e) {
      // If Admin model doesn't exist, try User model with role check?
      // Or maybe adminId refers to a User document.
      const User = require('../models/User');
      adminUser = await User.findById(adminId);
    }

    if (!adminUser) {
      console.log(`Admin not found: ${adminId}`);
      return;
    }

    let tokens = [];
    if (adminUser.fcmTokens && adminUser.fcmTokens.length > 0) {
      tokens = [...tokens, ...adminUser.fcmTokens];
    }
    if (includeMobile && adminUser.fcmTokenMobile && adminUser.fcmTokenMobile.length > 0) {
      tokens = [...tokens, ...adminUser.fcmTokenMobile];
    }

    console.log(`[FCM] 📤 Sending notification to admin (${adminId}) on ${tokens.length} devices`);

    const finalPayload = {
      ...payload,
      title: `🛡️ [Admin] ${payload.title}` // Add identification
    };

    await sendPushNotification(tokens, finalPayload);
  } catch (error) {
    console.error(`[FCM] ❌ Error sending notification to admin ${adminId}:`, error);
  }
}

module.exports = {
  sendPushNotification,
  sendNotificationToUser,
  sendNotificationToVendor,
  sendNotificationToWorker,
  sendNotificationToAdmin
};
