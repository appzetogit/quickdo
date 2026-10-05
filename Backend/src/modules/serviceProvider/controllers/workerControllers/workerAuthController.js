const Worker = require('../../models/Worker');
const { generateOTP, hashOTP, storeOTP, verifyOTP, checkRateLimit } = require('../../utils/redisOtp.util');
const { generateTokenPair, verifyRefreshToken, generateVerificationToken, verifyVerificationToken } = require('../../utils/tokenService');
const { sendOTP: sendSMSOTP } = require('../../services/smsService');
const cloudinaryService = require('../../services/cloudinaryService');
const { USER_ROLES, WORKER_STATUS } = require('../../utils/constants');
const { validationResult } = require('express-validator');

/**
 * Helper to save FCM token during auth (login/verifyLogin/register) if provided in req.body
 */
const handleAuthFcmToken = async (Model, docId, req) => {
  try {
    const rawToken = req.body.fcmToken || req.body.fcmTokenMobile || req.body.deviceToken || req.body.fcm_token || req.body.mobileToken || req.body.pushToken || (req.body.token !== 'verification-pending' ? req.body.token : null);
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) return;

    const token = rawToken.trim();
    if (token === 'verification-pending' || token === 'undefined' || token === 'null') return;

    const reqPlatform = (req.body.platform || '').toLowerCase();
    const isMobileReq = !!(req.body.fcmTokenMobile || req.body.mobileToken || req.body.isMobile === true) ||
      reqPlatform === 'mobile' || reqPlatform === 'android' || reqPlatform === 'ios' ||
      (req.headers && req.headers['user-agent'] && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS|Fios/i.test(req.headers['user-agent']));
    
    const targetField = isMobileReq ? 'fcmTokenMobile' : 'fcmTokens';

    // 1. Remove from both arrays to prevent duplicates (and clean up 'verification-pending')
    await Model.findByIdAndUpdate(docId, {
      $pull: { fcmTokens: { $in: [token, 'verification-pending', 'undefined', 'null'] }, fcmTokenMobile: { $in: [token, 'verification-pending', 'undefined', 'null'] } }
    });

    // 2. Add uniquely to target array
    await Model.findByIdAndUpdate(docId, {
      $addToSet: { [targetField]: token }
    });
    console.log(`[FCM Auth] ✅ Saved ${isMobileReq ? 'mobile' : 'web'} token for Worker ID: ${docId}`);
  } catch (err) {
    console.error('[FCM Auth] Error saving worker token during auth:', err);
  }
};

/**
 * Send OTP for worker registration/login
 */
const sendOTP = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { phone, email } = req.body;

    // 1. Rate limit check
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please try again after 10 minutes.'
      });
    }

    // 2. Generate OTP
    const otp = generateOTP(phone);
    const otpHash = hashOTP(otp);

    // 3. Store OTP (Redis primary, MongoDB fallback)
    await storeOTP(phone, otpHash);

    // 4. Send OTP via SMS
    const smsResult = await sendSMSOTP(phone, otp);

    // Log OTP
    if (process.env.NODE_ENV === 'development' || process.env.USE_DEFAULT_OTP === 'true') {
      console.log(`[DEV] Worker OTP for ${phone}: ${otp}`);
    }

    if (!smsResult.success) {
      console.warn(`[OTP] SMS failed for worker ${phone}, but OTP stored`);
    }

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      token: 'verification-pending'
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.'
    });
  }
};

/**
 * Verify OTP and Check Worker Status (Unified Login/Signup Entry)
 */
const verifyLogin = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    // 1. Verify OTP
    const verification = await verifyOTP(phone, otp);
    if (!verification.success) {
      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    // 2. Check if worker exists
    const worker = await Worker.findOne({ phone });

    if (worker) {
      // EXISTING WORKER
      if (!worker.isActive) {
        return res.status(403).json({ success: false, message: 'Account deactivated.' });
      }

      // SINGLE DEVICE PER PLATFORM: Update Session ID & Handle FCM token
      const loginSessionId = Date.now().toString();
      await Worker.findByIdAndUpdate(worker._id, { loginSessionId });
      await handleAuthFcmToken(Worker, worker._id, req);

      const tokens = generateTokenPair({
        userId: worker._id,
        role: USER_ROLES.WORKER,
        loginSessionId
      });

      return res.status(200).json({
        success: true,
        isNewUser: false,
        message: 'Login successful',
        worker: {
          id: worker._id,
          name: worker.name,
          email: worker.email,
          phone: worker.phone,
          status: worker.status,
          status: worker.status,
          serviceCategories: worker.serviceCategories || []
        },
        ...tokens
      });

    } else {
      // NEW WORKER
      const verificationToken = generateVerificationToken(phone);

      return res.status(200).json({
        success: true,
        isNewUser: true,
        message: 'OTP verified. Please complete registration.',
        verificationToken
      });
    }

  } catch (error) {
    console.error('Verify Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.'
    });
  }
};

/**
 * Register worker with Verification Token
 */
const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // verificationToken handling
    const { name, email, verificationToken, aadharNumber, aadharDocument, aadharBackDocument } = req.body;
    let phone = req.body.phone;

    if (verificationToken) {
      const verifiedPhone = verifyVerificationToken(verificationToken);
      if (!verifiedPhone) return res.status(400).json({ success: false, message: 'Invalid verification session.' });
      phone = verifiedPhone;
    } else {
      // Fallback OTP
      if (!req.body.otp) return res.status(400).json({ success: false, message: 'Verification required.' });
      const ver = await verifyOTP(phone, req.body.otp);
      if (!ver.success) return res.status(400).json({ success: false, message: ver.message });
    }

    // Check existing
    const queryConditions = [{ phone }];
    if (email) {
      queryConditions.push({ email });
    }
    const existingWorker = await Worker.findOne({ $or: queryConditions });
    if (existingWorker) {
      return res.status(400).json({
        success: false,
        message: 'Worker already exists. Please login.'
      });
    }

    // Upload Aadhar
    let aadharUrl = aadharDocument || null;
    let aadharBackUrl = aadharBackDocument || null;

    if (aadharUrl && aadharUrl.startsWith('data:')) {
      const uploadRes = await cloudinaryService.uploadFile(aadharUrl, { folder: 'workers/documents' });
      if (uploadRes.success) aadharUrl = uploadRes.url;
    }

    if (aadharBackUrl && aadharBackUrl.startsWith('data:')) {
      const uploadRes = await cloudinaryService.uploadFile(aadharBackUrl, { folder: 'workers/documents' });
      if (uploadRes.success) aadharBackUrl = uploadRes.url;
    }

    // Create worker
    const worker = await Worker.create({
      name, email, phone,
      isPhoneVerified: true,
      aadhar: {
        number: req.body.aadhar || aadharNumber,
        document: aadharUrl,
        backDocument: aadharBackUrl
      },
      status: WORKER_STATUS.OFFLINE
    });

    // Generate JWT tokens with initial session
    const loginSessionId = Date.now().toString();
    await Worker.findByIdAndUpdate(worker._id, { loginSessionId });
    await handleAuthFcmToken(Worker, worker._id, req);

    const tokens = generateTokenPair({
      userId: worker._id,
      role: USER_ROLES.WORKER,
      loginSessionId
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      worker: {
        id: worker._id,
        name: worker.name,
        email: worker.email,
        phone: worker.phone,
        status: worker.status
      },
      ...tokens
    });
  } catch (error) {
    console.error('Worker registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
};

/**
 * Login worker with OTP
 */
const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { phone, otp } = req.body;

    // Verify OTP
    const verification = await verifyOTP(phone, otp);
    if (!verification.success) {
      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    // Find worker
    const worker = await Worker.findOne({ phone });
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found. Please register first.'
      });
    }

    if (!worker.isActive) {
      return res.status(403).json({ success: false, message: 'Account deactivated.' });
    }
    // SINGLE DEVICE PER PLATFORM: Update Session ID & Handle FCM token
    const loginSessionId = Date.now().toString();
    await Worker.findByIdAndUpdate(worker._id, { loginSessionId });
    await handleAuthFcmToken(Worker, worker._id, req);

    const tokens = generateTokenPair({
      userId: worker._id,
      role: USER_ROLES.WORKER,
      loginSessionId
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      worker: {
        id: worker._id,
        name: worker.name,
        email: worker.email,
        phone: worker.phone,
        status: worker.status,
        serviceCategories: worker.serviceCategories || []
      },
      ...tokens
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

/**
 * Logout worker
 */
const logout = async (req, res) => {
  try {
    const { platform = 'web' } = req.body;

    // Clear FCM tokens based on platform and reset Session ID
    if (req.user && req.user.id) {
      const updateQuery = platform === 'mobile'
        ? { $set: { fcmTokenMobile: [], loginSessionId: null } }
        : { $set: { fcmTokens: [], loginSessionId: null } };

      await Worker.findByIdAndUpdate(req.user.id, updateQuery);
      console.log(`[AUTH] ✅ ${platform} session & tokens cleared for worker: ${req.user.id}`);
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

/**
 * Refresh Access Token
 */
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Check if worker exists
    const worker = await Worker.findById(decoded.userId);
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    // Check status
    if (!worker.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is not active'
      });
    }

    // Verify Session ID — logout nulls it, a new login rotates it. Without this,
    // refresh would happily mint a fresh access token for a logged-out session.
    if (decoded.loginSessionId && worker.loginSessionId !== decoded.loginSessionId) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.'
      });
    }

    // Legacy tokens carry no session id — mint one now so the new token is revocable
    if (!worker.loginSessionId) {
      worker.loginSessionId = Date.now().toString();
      await Worker.findByIdAndUpdate(worker._id, { loginSessionId: worker.loginSessionId });
    }

    // Generate new token pair
    const tokens = generateTokenPair({
      userId: worker._id,
      role: USER_ROLES.WORKER,
      loginSessionId: worker.loginSessionId
    });

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      ...tokens
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
};

module.exports = {
  sendOTP,
  verifyLogin,
  register,
  login,
  logout,
  refreshToken
};
