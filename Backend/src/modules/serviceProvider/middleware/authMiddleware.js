const { verifyAccessToken } = require('../utils/tokenService');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Worker = require('../models/Worker');
const Admin = require('../models/Admin');
const { USER_ROLES } = require('../utils/constants');
const { hasServiceProviderAccess } = require('../utils/serviceAccess');
const { resolveSharedCustomer } = require('../utils/identityBridge');

// Limited token for vendors that are not approved yet. See vendorAuthController.
const ONBOARDING_SCOPE = 'onboarding';
// Statuses an onboarding token keeps working for. Suspended is not one of them.
const ONBOARDING_VENDOR_STATUSES = ['pending', 'rejected', 'approved'];

/**
 * Marks a route as reachable with a vendor onboarding token. Put it BEFORE
 * authenticate. Full tokens are unaffected.
 */
const allowOnboardingToken = (req, _res, next) => {
  req.spAllowOnboardingToken = true;
  next();
};

/**
 * Authentication middleware - verifies JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login.'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = verifyAccessToken(token);
      // console.log('Decoded Token:', decoded); // Debug
    } catch (error) {
      console.error('Token verification failed:', error.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token. Please login again.'
      });
    }

    // Get user based on role
    let user;
    // console.log('Role from token:', decoded.role); // Debug
    switch (decoded.role) {
      case USER_ROLES.USER:
        user = await User.findById(decoded.userId).select('-password').lean();
        // A customer signed in through the super app carries a MASTER-issued
        // token, so decoded.userId names a document in the shared `users`
        // collection rather than `sp_users`. Bridge it (and provision on first
        // use) so one login serves food, taxi and services. An SP-native token
        // resolved above and never reaches this. See utils/identityBridge.js.
        if (!user) {
          user = await resolveSharedCustomer(decoded.userId);
          // The rest of the request must act as the SP user, not the master
          // one: every SP document -- bookings, cart, wallet -- is keyed by
          // sp_users._id, and the socket rooms the server emits to are
          // `user_<spUserId>`.
          if (user) {
            decoded.userId = user._id.toString();
            // Master tokens carry no loginSessionId, so the session check below
            // is skipped for them by design; do not inherit the SP user's.
          }
        }
        break;
      case USER_ROLES.VENDOR:
        user = await Vendor.findById(decoded.userId).select('-password').lean();
        if (decoded.scope === ONBOARDING_SCOPE) {
          // An onboarding token (issued to pending and rejected vendors so they can
          // complete the verification checklist) opens only the routes marked with
          // allowOnboardingToken, whatever the vendor's status is now. Everything
          // else needs a full token, which sign-in (or a refresh) issues once the
          // vendor is approved.
          if (!req.spAllowOnboardingToken) {
            return res.status(403).json({
              success: false,
              code: 'ONBOARDING_ONLY',
              message: 'Your vendor account is pending approval. Only onboarding is available until it is approved.'
            });
          }
          if (user && !ONBOARDING_VENDOR_STATUSES.includes(String(user.approvalStatus || ''))) {
            return res.status(403).json({
              success: false,
              message: 'Your vendor account is suspended. Please contact support.'
            });
          }
        } else if (user && user.approvalStatus !== 'approved') {
          return res.status(403).json({
            success: false,
            message: 'Your vendor account is pending approval or has been rejected.'
          });
        }
        break;
      case USER_ROLES.WORKER:
        user = await Worker.findById(decoded.userId).select('-password').lean();
        break;
      case USER_ROLES.ADMIN:
      case 'super_admin':
      case 'admin':
      case 'ADMIN':
        user = await Admin.findById(decoded.userId).select('-password').lean();
        // `admins` is shared with the food and taxi modules, and their tokens are
        // signed with the same secret, so a food/taxi admin token verifies here.
        // Gate on service scope, not just on the token being valid.
        if (user && !hasServiceProviderAccess(user)) {
          return res.status(403).json({
            success: false,
            message: 'This account does not have Service Provider access.'
          });
        }
        break;
      default:
        console.error('Role mismatch in middleware:', decoded.role);
        return res.status(401).json({
          success: false,
          message: 'Invalid user role.'
        });
    }

    if (!user) {
      console.error('User not found for ID:', decoded.userId);
      return res.status(401).json({
        success: false,
        message: 'User not found. Please login again.'
      });
    }

    // Blocked, rejected or suspended accounts are refused on every request.
    // Nothing here checked it, and blocking did not rotate the session, so a
    // blocked customer or suspended worker kept full access for the token's
    // 7-day life. (Pending workers still get in: they finish onboarding here.)
    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: 'This account has been blocked. Please contact support.' });
    }
    if (decoded.role === USER_ROLES.WORKER && ['rejected', 'suspended'].includes(String(user.approvalStatus || ''))) {
      return res.status(403).json({ success: false, message: `Your worker account is ${user.approvalStatus}. Please contact support.` });
    }

    // SESSION INVALIDATION: logout sets loginSessionId to null and a new login
    // rotates it, so any token carrying a stale session id is dead. Tokens minted
    // before this shipped have no loginSessionId and are skipped until they expire.
    if (decoded.loginSessionId && user.loginSessionId !== decoded.loginSessionId) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.'
      });
    }

    // Attach user to request
    // NOTE: .lean() removes the virtual .id getter — restore it manually
    req.user = { ...user, id: user._id.toString() };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.tokenScope = decoded.scope || 'full';

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error. Please try again.'
    });
  }
};

module.exports = { authenticate, allowOnboardingToken, ONBOARDING_SCOPE };

