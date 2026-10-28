const User = require('../../models/User');
const { generateTokenPair, verifyRefreshToken, generateVerificationToken, verifyVerificationToken } = require('../../utils/tokenService');
const { generateOTP, hashOTP, storeOTP, verifyOTP, checkRateLimit } = require('../../utils/redisOtp.util');
const { sendOTP: sendSMSOTP } = require('../../services/smsService');
const { sendOTPEmail, sendWelcomeEmail } = require('../../services/emailService');
const { USER_ROLES } = require('../../utils/constants');
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
    console.log(`[FCM Auth] ✅ Saved ${isMobileReq ? 'mobile' : 'web'} token for User ID: ${docId}`);
  } catch (err) {
    console.error('[FCM Auth] Error saving user token during auth:', err);
  }
};

/**
 * Send OTP for user registration/login
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

    // Log OTP in development mode only (NEVER in production)
    if (process.env.NODE_ENV === 'development' || process.env.USE_DEFAULT_OTP === 'true') {
      console.log(`[DEV] OTP for ${phone}: ${otp}`);
    }

    // 5. Email copy -- only to the address already on this phone's account.
    // The request's email used to be trusted as-is, so anyone could have the
    // code for a victim's phone mailed to themselves and sign in as them (the
    // OTP store is keyed by phone and shared by user, vendor and worker login).
    if (email) {
      const owner = await User.findOne({ phone }).select('email').lean();
      const onFile = String(owner?.email || '').trim().toLowerCase();
      if (onFile && onFile === String(email).trim().toLowerCase()) {
        await sendOTPEmail(onFile, otp, 'verification');
      }
    }

    // Check if SMS failed
    if (!smsResult.success) {
      console.warn(`[OTP] SMS failed for ${phone}, but OTP stored for manual entry`);
    }

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      token: 'verification-pending' // Required by frontend to allow login
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
 * Verify OTP and Check User Status (Unified Login/Signup Entry)
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

    // 2. Check if user exists
    const user = await User.findOne({ phone });

    if (user) {
      // EXISTING USER -> LOGIN
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been deactivated.'
        });
      }

      // SINGLE DEVICE PER PLATFORM: Update Session ID & Handle FCM token
      const loginSessionId = Date.now().toString();
      await User.findByIdAndUpdate(user._id, { loginSessionId });
      await handleAuthFcmToken(User, user._id, req);
      
      const tokens = generateTokenPair({
        userId: user._id,
        role: USER_ROLES.USER,
        loginSessionId
      });

      return res.status(200).json({
        success: true,
        isNewUser: false,
        message: 'Login successful',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          isPhoneVerified: user.isPhoneVerified,
          isEmailVerified: user.isEmailVerified
        },
        ...tokens
      });

    } else {
      // NEW USER -> RETURN VERIFICATION TOKEN
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
 * Register user with Verification Token (No OTP required again)
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

    const { name, email, verificationToken } = req.body;
    let phone = req.body.phone;

    // Verify token if provided (New Flow)
    if (verificationToken) {
      const verifiedPhone = verifyVerificationToken(verificationToken);
      if (!verifiedPhone) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired verification session. Please verify phone again.'
        });
      }
      phone = verifiedPhone; // Trust the token's phone number
    } else {
      // Fallback to legacy OTP flow (if needed, but discouraged)
      if (!req.body.otp) {
        return res.status(400).json({ success: false, message: 'Verification token or OTP required.' });
      }
      const verification = await verifyOTP(phone, req.body.otp);
      if (!verification.success) {
        return res.status(400).json({ success: false, message: verification.message });
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists. Please login.'
      });
    }

    // Create user
    const user = await User.create({
      name,
      email: email || null,
      phone,
      isPhoneVerified: true,
      isEmailVerified: email ? false : true
    });

    // Link to the customer's one platform identity (identity merge, phase 1).
    // Fire-and-forget by contract: linkSatellite never throws, and an unlinked
    // document is repaired by the backfill script.
    import('../../../../core/identity/identityLink.service.js')
      .then(({ linkSatellite }) => linkSatellite(User, user._id, { phone, name, email }))
      .catch((err) => console.warn(`[Identity] SP link skipped: ${err.message}`));

    // Send Welcome Email
    if (email) {
      sendWelcomeEmail(email, name).catch(err => console.error(err));
    }

    // Generate JWT tokens with session
    const loginSessionId = Date.now().toString();
    await User.findByIdAndUpdate(user._id, { loginSessionId });
    await handleAuthFcmToken(User, user._id, req);

    const tokens = generateTokenPair({
      userId: user._id,
      role: USER_ROLES.USER,
      loginSessionId
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isPhoneVerified: user.isPhoneVerified,
        isEmailVerified: user.isEmailVerified
      },
      ...tokens
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
};

/**
 * Login user with OTP
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

    // Verify OTP (checks Redis first, falls back to MongoDB)
    const verification = await verifyOTP(phone, otp);
    if (!verification.success) {
      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    // Find user
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please sign up first.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // SINGLE DEVICE PER PLATFORM: Update Session ID & Handle FCM token
    const loginSessionId = Date.now().toString();
    await User.findByIdAndUpdate(user._id, { loginSessionId });
    await handleAuthFcmToken(User, user._id, req);

    const tokens = generateTokenPair({
      userId: user._id,
      role: USER_ROLES.USER,
      loginSessionId
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isPhoneVerified: user.isPhoneVerified,
        isEmailVerified: user.isEmailVerified
      },
      ...tokens
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
};

/**
 * Logout user
 */
const logout = async (req, res) => {
  try {
    const { platform = 'web' } = req.body;

    // Clear FCM tokens based on platform and reset session
    if (req.user && req.user.id) {
      const updateQuery = platform === 'mobile'
        ? { $set: { fcmTokenMobile: [], loginSessionId: null } }
        : { $set: { fcmTokens: [], loginSessionId: null } };

      await User.findByIdAndUpdate(req.user.id, updateQuery);
      console.log(`[AUTH] ✅ ${platform} session & tokens cleared for user: ${req.user.id}`);
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

    // Check if user exists
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check status
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is not active'
      });
    }

    // Verify Session ID — logout nulls it, a new login rotates it. Without this,
    // refresh would happily mint a fresh access token for a logged-out session.
    if (decoded.loginSessionId && user.loginSessionId !== decoded.loginSessionId) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.'
      });
    }

    // Legacy tokens carry no session id — mint one now so the new token is revocable
    if (!user.loginSessionId) {
      user.loginSessionId = Date.now().toString();
      await User.findByIdAndUpdate(user._id, { loginSessionId: user.loginSessionId });
    }

    // Generate new token pair
    const tokens = generateTokenPair({
      userId: user._id,
      role: USER_ROLES.USER,
      loginSessionId: user.loginSessionId
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
