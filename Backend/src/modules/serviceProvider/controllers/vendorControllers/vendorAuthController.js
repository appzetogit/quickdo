const Vendor = require('../../models/Vendor');
const { generateOTP, hashOTP, storeOTP, verifyOTP, checkRateLimit } = require('../../utils/redisOtp.util');
const { generateTokenPair, verifyRefreshToken, generateVerificationToken, verifyVerificationToken } = require('../../utils/tokenService');
const { sendOTP: sendSMSOTP } = require('../../services/smsService');
const cloudinaryService = require('../../services/cloudinaryService');
const { USER_ROLES, VENDOR_STATUS } = require('../../utils/constants');
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
    console.log(`[FCM Auth] ✅ Saved ${isMobileReq ? 'mobile' : 'web'} token for Vendor ID: ${docId}`);
  } catch (err) {
    console.error('[FCM Auth] Error saving vendor token during auth:', err);
  }
};

/**
 * Send OTP for vendor registration/login
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

    // Check existing vendor status to prevent OTP if restricted
    const existingVendor = await Vendor.findOne({ phone });
    if (existingVendor) {
      if (existingVendor.approvalStatus === VENDOR_STATUS.PENDING) {
        return res.status(200).json({
          success: true,
          message: 'Your account is currently under review. Please wait for admin approval.',
          vendor: { adminApproval: 'pending' }
        });
      }
      if (existingVendor.approvalStatus === VENDOR_STATUS.REJECTED || existingVendor.approvalStatus === VENDOR_STATUS.SUSPENDED) {
        return res.status(403).json({ success: false, message: 'Account restricted.' });
      }
    }

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

    // Log OTP in development mode
    if (process.env.NODE_ENV === 'development' || process.env.USE_DEFAULT_OTP === 'true') {
      console.log(`[DEV] Vendor OTP for ${phone}: ${otp}`);
    }

    if (!smsResult.success) {
      console.warn(`[OTP] SMS failed for vendor ${phone}, but OTP stored`);
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
 * Verify OTP and Check Vendor Status (Unified Login/Signup Entry)
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

    // 2. Check if vendor exists
    const vendor = await Vendor.findOne({ phone });

    if (vendor) {
      // EXISTING VENDOR

      // Check status checks (Login Logic)
      if (vendor.approvalStatus === VENDOR_STATUS.REJECTED) {
        return res.status(403).json({ success: false, message: 'Account rejected.' });
      }
      if (vendor.approvalStatus === VENDOR_STATUS.SUSPENDED) {
        return res.status(403).json({ success: false, message: 'Account suspended.' });
      }
      if (!vendor.isActive) {
        return res.status(403).json({ success: false, message: 'Account deactivated.' });
      }

      // BLOCK PENDING VENDORS
      if (vendor.approvalStatus === VENDOR_STATUS.PENDING) {
        return res.status(200).json({
          success: true,
          message: 'Your account is currently under review. Please wait for admin approval.',
          vendor: { adminApproval: 'pending' }
        });
      }

      // SINGLE DEVICE PER PLATFORM: Update Session ID & Handle FCM token
      const loginSessionId = Date.now().toString();
      await Vendor.findByIdAndUpdate(vendor._id, { loginSessionId });
      await handleAuthFcmToken(Vendor, vendor._id, req);

      const tokens = generateTokenPair({
        userId: vendor._id,
        role: USER_ROLES.VENDOR,
        loginSessionId
      });

      return res.status(200).json({
        success: true,
        isNewUser: false,
        message: 'Login successful',
        vendor: {
          id: vendor._id,
          name: vendor.name,
          email: vendor.email,
          phone: vendor.phone,
          businessName: vendor.businessName,
          service: vendor.service,
          approvalStatus: vendor.approvalStatus
        },
        ...tokens
      });

    } else {
      // NEW VENDOR -> RETURN VERIFICATION TOKEN
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
 * Register vendor with Verification Token (Service/Category Removed)
 */
const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    // Ignore service validation error if present (since removed)
    const validErrors = errors.array().filter(e => e.path !== 'service');

    if (validErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validErrors
      });
    }

    // verificationToken handling
    const { name, email, verificationToken, aadhar, pan } = req.body;
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
    const existing = await Vendor.findOne({ $or: [{ phone }, { email }] });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Vendor already exists. Login.' });
    }

    // Upload documents
    let aadharUrl = req.body.aadharDocument || null;
    let aadharBackUrl = req.body.aadharBackDocument || null;
    let panUrl = req.body.panDocument || null;
    let otherUrls = req.body.otherDocuments || [];

    if (aadharUrl && aadharUrl.startsWith('data:')) {
      const uploadRes = await cloudinaryService.uploadFile(aadharUrl, { folder: 'vendors/documents' });
      if (uploadRes.success) aadharUrl = uploadRes.url;
    }
    if (aadharBackUrl && aadharBackUrl.startsWith('data:')) {
      const uploadRes = await cloudinaryService.uploadFile(aadharBackUrl, { folder: 'vendors/documents' });
      if (uploadRes.success) aadharBackUrl = uploadRes.url;
    }
    if (panUrl && panUrl.startsWith('data:')) {
      const uploadRes = await cloudinaryService.uploadFile(panUrl, { folder: 'vendors/documents' });
      if (uploadRes.success) panUrl = uploadRes.url;
    }
    // ... (otherDocs logic simplified for brevity, assume frontend sends valid array or backend helper used?
    // I'll keep the simplified logic here assuming loop is standard)
    if (otherUrls && otherUrls.length > 0) {
      const uploadedOthers = [];
      for (const doc of otherUrls) {
        if (doc && doc.startsWith('data:')) {
          const up = await cloudinaryService.uploadFile(doc, { folder: 'vendors/documents/others' });
          if (up.success) uploadedOthers.push(up.url);
        } else uploadedOthers.push(doc);
      }
      otherUrls = uploadedOthers;
    }

    const vendor = await Vendor.create({
      name, email, phone,
      service: [], // Default empty as requested
      aadhar: {
        number: aadhar,
        document: aadharUrl,
        backDocument: aadharBackUrl
      },
      pan: { number: pan, document: panUrl },
      otherDocuments: otherUrls,
      approvalStatus: VENDOR_STATUS.PENDING,
      isPhoneVerified: true
    });
    await handleAuthFcmToken(Vendor, vendor._id, req);

    // Notify Admins
    try {
      const { createNotification } = require('../notificationControllers/notificationController');
      const Admin = require('../../models/Admin');
      const admins = await Admin.find({ isActive: true }).select('_id');
      for (const admin of admins) {
        await createNotification({
          adminId: admin._id,
          type: 'vendor_approval_request',
          title: '👤 New Vendor Registration',
          message: `${vendor.name} (${vendor.phone}) has registered`,
          relatedId: vendor._id,
          relatedType: 'vendor',
          data: { vendorId: vendor._id, vendorName: vendor.name, phone: vendor.phone },
          pushData: { type: 'admin_alert', link: '/admin/vendors/all' }
        });
      }
    } catch (e) { console.error('Notify error', e); }

    res.status(201).json({
      success: true,
      message: 'Registration successful! Pending approval.',
      vendor: {
        id: vendor._id,
        name: vendor.name,
        email: vendor.email,
        phone: vendor.phone,
        approvalStatus: vendor.approvalStatus
      }
    });

  } catch (error) {
    console.error('Vendor registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed.'
    });
  }
};

/**
 * Login vendor with OTP (only if approved)
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

    // Find vendor
    const vendor = await Vendor.findOne({ phone });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found. Please sign up first.'
      });
    }

    // Check approval status
    if (vendor.approvalStatus === VENDOR_STATUS.PENDING) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval. Please wait for approval.'
      });
    }

    if (vendor.approvalStatus === VENDOR_STATUS.REJECTED) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been rejected. Please contact support.'
      });
    }

    if (vendor.approvalStatus === VENDOR_STATUS.SUSPENDED) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.'
      });
    }

    if (!vendor.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // SINGLE DEVICE PER PLATFORM: Update Session ID & Handle FCM token
    const loginSessionId = Date.now().toString();
    await Vendor.findByIdAndUpdate(vendor._id, { loginSessionId });
    await handleAuthFcmToken(Vendor, vendor._id, req);

    // Generate JWT tokens
    const tokens = generateTokenPair({
      userId: vendor._id,
      role: USER_ROLES.VENDOR,
      loginSessionId
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      vendor: {
        id: vendor._id,
        name: vendor.name,
        email: vendor.email,
        phone: vendor.phone,
        businessName: vendor.businessName,
        service: vendor.service
      },
      ...tokens
    });
  } catch (error) {
    console.error('Vendor login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
};

/**
 * Logout vendor
 */
const logout = async (req, res) => {
  try {
    const { platform = 'web' } = req.body;

    // Clear FCM tokens based on platform and reset Session ID
    if (req.user && req.user.id) {
      const updateQuery = platform === 'mobile'
        ? { $set: { fcmTokenMobile: [], loginSessionId: null } }
        : { $set: { fcmTokens: [], loginSessionId: null } };

      await Vendor.findByIdAndUpdate(req.user.id, updateQuery);
      console.log(`[AUTH] ✅ ${platform} session & tokens cleared for vendor: ${req.user.id}`);
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

    // Check if vendor exists
    const vendor = await Vendor.findById(decoded.userId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check status
    if (vendor.approvalStatus !== VENDOR_STATUS.APPROVED || !vendor.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is not approved or is inactive'
      });
    }

    // Verify Session ID — logout nulls it, a new login rotates it. Without this,
    // refresh would happily mint a fresh access token for a logged-out session.
    if (decoded.loginSessionId && vendor.loginSessionId !== decoded.loginSessionId) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.'
      });
    }

    // Legacy tokens carry no session id — mint one now so the new token is revocable
    if (!vendor.loginSessionId) {
      vendor.loginSessionId = Date.now().toString();
      await Vendor.findByIdAndUpdate(vendor._id, { loginSessionId: vendor.loginSessionId });
    }

    // Generate new token pair with same session ID
    const tokens = generateTokenPair({
      userId: vendor._id,
      role: USER_ROLES.VENDOR,
      loginSessionId: vendor.loginSessionId
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
