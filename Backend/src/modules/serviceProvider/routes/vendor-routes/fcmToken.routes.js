/**
 * Vendor FCM Token Routes
 * Manages FCM tokens for push notifications
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { sendPushNotification } = require('../../services/firebaseAdmin');
const Vendor = require('../../models/Vendor');
const User = require('../../models/User');
const Worker = require('../../models/Worker');

const MAX_TOKENS = 10; // Maximum tokens per platform

const isMobilePlatform = (platform, req, body = {}) => {
  if (body.fcmTokenMobile || body.mobileToken || body.isMobile === true) {
    return true;
  }
  const p = platform ? String(platform).toLowerCase().trim() : '';
  if (p === 'mobile' || p === 'android' || p === 'ios') return true;

  const ua = req && req.headers ? (req.headers['user-agent'] || '') : '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS|Fios/i.test(ua);
  const isWebView = !!(body.isWebView || (ua && /wv|FB_IAB|FB4A|Instagram|Flutter/i.test(ua)));

  if (isMobileUA || isWebView) return true;
  return false;
};

/**
 * @route   POST /api/vendors/fcm-tokens/save
 * @desc    Save FCM token for vendor
 * @access  Private (Vendor)
 */
router.post(['/', '/save', '/update', '/save-token'], authenticate, async (req, res) => {
  try {
    const rawToken = req.body.fcmToken || req.body.fcmTokenMobile || req.body.deviceToken || req.body.fcm_token || req.body.mobileToken || req.body.pushToken || (req.body.token !== 'verification-pending' ? req.body.token : null);
    const token = rawToken ? String(rawToken).trim() : null;
    const platform = req.body.platform || 'web';
    const vendorId = req.user._id;

    if (!token || token === 'verification-pending' || token === 'undefined' || token === 'null') {
      return res.status(400).json({ success: false, error: 'Valid FCM token is required' });
    }

    const isMobile = isMobilePlatform(platform, req, req.body);

    // 1. Remove from both arrays to prevent duplicates (and clean up 'verification-pending')
    await Vendor.findByIdAndUpdate(vendorId, {
      $pull: { fcmTokens: { $in: [token, 'verification-pending', 'undefined', 'null'] }, fcmTokenMobile: { $in: [token, 'verification-pending', 'undefined', 'null'] } }
    });

    // 2. Add uniquely to target array
    const targetField = isMobile ? 'fcmTokenMobile' : 'fcmTokens';
    const vendor = await Vendor.findByIdAndUpdate(vendorId, {
      $addToSet: { [targetField]: token }
    }, { new: true });

    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    // Remove this token from User and Worker collections to prevent cross-account notifications
    // COMMENTED OUT to allow testing on same device
    /*
    try {
      await User.updateMany(
        { $or: [{ fcmTokens: token }, { fcmTokenMobile: token }] },
        { $pull: { fcmTokens: token, fcmTokenMobile: token } }
      );

      await Worker.updateMany(
        { $or: [{ fcmTokens: token }, { fcmTokenMobile: token }] },
        { $pull: { fcmTokens: token, fcmTokenMobile: token } }
      );
    } catch (cleanupError) {
      console.error('Error removing token from other collections:', cleanupError);
    }
    */

    res.json({ success: true, message: 'FCM token saved successfully' });
  } catch (error) {
    console.error('Error saving FCM token:', error);
    res.status(500).json({ success: false, error: 'Failed to save FCM token' });
  }
});

/**
 * @route   DELETE /api/vendors/fcm-tokens/remove
 * @desc    Remove FCM token for vendor
 * @access  Private (Vendor)
 */
router.delete(['/', '/remove', '/delete'], authenticate, async (req, res) => {
  try {
    const token = req.body.token || req.body.fcmToken || req.body.fcmTokenMobile || req.body.fcm_token || req.body.deviceToken;
    const platform = req.body.platform || 'web';
    const vendorId = req.user._id;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    // Remove token based on platform
    const isMobile = isMobilePlatform(platform, req, req.body);
    if (isMobile && vendor.fcmTokenMobile) {
      vendor.fcmTokenMobile = vendor.fcmTokenMobile.filter(t => t !== token);
    } else if (vendor.fcmTokens) {
      vendor.fcmTokens = vendor.fcmTokens.filter(t => t !== token);
    }

    await vendor.save();

    res.json({ success: true, message: 'FCM token removed successfully' });
  } catch (error) {
    console.error('Error removing FCM token:', error);
    res.status(500).json({ success: false, error: 'Failed to remove FCM token' });
  }
});

/**
 * @route   DELETE /api/vendors/fcm-tokens/remove-all
 * @desc    Remove ALL FCM tokens for a specific platform (called during logout)
 * @access  Private (Vendor)
 */
router.delete('/remove-all', authenticate, async (req, res) => {
  try {
    const vendorId = req.user._id;
    const { platform = 'web' } = req.body;

    // Clear only the specified platform's tokens
    const updateQuery = isMobilePlatform(platform, req, req.body)
      ? { $set: { fcmTokenMobile: [] } }
      : { $set: { fcmTokens: [] } };

    const vendor = await Vendor.findByIdAndUpdate(vendorId, updateQuery, { new: true });

    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    console.log(`[FCM] ✅ All ${platform} tokens removed for vendor: ${vendorId}`);
    res.json({ success: true, message: `All ${platform} FCM tokens removed successfully` });
  } catch (error) {
    console.error('Error removing FCM tokens:', error);
    res.status(500).json({ success: false, error: 'Failed to remove FCM tokens' });
  }
});

/**
 * @route   POST /api/vendors/fcm-tokens/test
 * @desc    Send test notification to vendor (development only)
 * @access  Private (Vendor)
 */
router.post('/test', authenticate, async (req, res) => {
  try {
    const vendorId = req.user._id;
    const vendor = await Vendor.findById(vendorId);

    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    const tokens = [...(vendor.fcmTokens || []), ...(vendor.fcmTokenMobile || [])];
    const uniqueTokens = [...new Set(tokens)];

    if (uniqueTokens.length === 0) {
      return res.json({ success: false, error: 'No FCM tokens found for vendor' });
    }

    const response = await sendPushNotification(vendor, {
      notificationId: 'test-notification',
      title: '🔔 Test Notification',
      body: 'This is a test notification for vendor!',
      data: {
        type: 'test',
        link: '/vendor/dashboard'
      }
    });

    res.json({
      success: true,
      message: 'Test notification sent',
      successCount: response.successCount,
      failureCount: response.failureCount
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
