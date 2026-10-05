const { USER_ROLES } = require('../utils/constants');

/**
 * Role-based authorization middleware
 */
const isUser = (req, res, next) => {
  if (req.userRole !== USER_ROLES.USER) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. User role required.'
    });
  }
  next();
};

const isVendor = (req, res, next) => {
  if (req.userRole !== USER_ROLES.VENDOR) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Vendor role required.'
    });
  }
  next();
};

const isWorker = (req, res, next) => {
  if (req.userRole !== USER_ROLES.WORKER) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Worker role required.'
    });
  }
  next();
};

const isAdmin = (req, res, next) => {
  if (req.userRole !== USER_ROLES.ADMIN && req.userRole !== 'super_admin' && req.userRole !== 'admin' && req.userRole !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin role required.'
    });
  }
  next();
};

const isAdminOrVendor = (req, res, next) => {
  if (req.userRole !== USER_ROLES.ADMIN && req.userRole !== 'super_admin' && req.userRole !== USER_ROLES.VENDOR) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Vendor role required.'
    });
  }
  next();
};

/**
 * Super Admin only middleware
 * Checks if admin user has super_admin role in database
 */
const isSuperAdmin = async (req, res, next) => {
  try {
    const adminRoles = [USER_ROLES.ADMIN, 'super_admin', 'admin', 'ADMIN'];
    if (!adminRoles.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    // Role lives on the Admin document, not the JWT — always re-check against the DB
    const Admin = require('../models/Admin');
    const admin = await Admin.findById(req.user.id)
      .select('role admin_type adminLevel canDelete')
      .lean();

    // Recognise the PLATFORM's notion of a super-admin, not one exact spelling.
    //
    // The three modules each name the role differently -- food/master issues `ADMIN`
    // with adminLevel `platform_superadmin`, taxi uses `super-admin`, and this module
    // used to require literally `super_admin`. Since an account carries a single role
    // string, every existing platform super-admin was rejected here with
    // "Super Admin role required" -- and because cityManagement.routes.js applies this
    // check path-lessly across the whole /admin mount, that meant the entire
    // service-provider panel, not one endpoint.
    //
    // This does NOT widen who is authorised: reaching this module at all already
    // requires servicesAccess to include 'serviceProvider' (see utils/serviceAccess.js
    // and the auth middleware). A subadmin is still refused -- admin_type 'subadmin'
    // and a non-super role do not satisfy anything below.
    const SUPER_ROLES = new Set(['super_admin', 'super-admin', 'superadmin']);
    const role = String(admin?.role || '').trim().toLowerCase();
    const isSuper =
      Boolean(admin) &&
      (SUPER_ROLES.has(role) ||
        admin.adminLevel === 'platform_superadmin' ||
        admin.adminLevel === 'sp_superadmin' ||
        (admin.admin_type === 'superadmin' && role !== 'subadmin'));

    if (!isSuper) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin role required.'
      });
    }

    // The platform-wide delete switch (core/admin/adminAccessPolicy.js). Owners
    // always keep it; a superadmin of this module can have it turned off.
    if (req.method === 'DELETE' && admin.adminLevel !== 'platform_superadmin' && admin.canDelete === false) {
      return res.status(403).json({
        success: false,
        message: 'You do not have delete access. Ask an owner to turn it on for your account'
      });
    }

    next();
  } catch (error) {
    console.error('Super admin check error:', error);
    res.status(500).json({ success: false, message: 'Authorization check failed' });
  }
};

module.exports = {
  isUser,
  isVendor,
  isWorker,
  isAdmin,
  isAdminOrVendor,
  isSuperAdmin
};

