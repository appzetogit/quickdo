import mongoose from 'mongoose';
import { ADMIN_LEVELS, ADMIN_MODULES, MODULE_SUPERADMIN_LEVELS } from './adminHierarchy.constants.js';
import { hasResourcePermission, assertPermissionsSubset, assertIdSubset } from './adminAccess.util.js';
import { FoodAdmin } from './admin.model.js';

/**
 * Resolves the admin level of a given admin document.
 * @param {Object} admin
 * @returns {string} One of ADMIN_LEVELS
 */
const isOrphanedSubadmin = (admin) =>
  Boolean(admin.module)
  && admin.admin_type === 'subadmin'
  && !(Array.isArray(admin.permissions) && admin.permissions.includes('*'));

export function resolveAdminLevel(admin) {
  if (!admin) return ADMIN_LEVELS.SUBADMIN;
  
  // If an explicit non-default adminLevel is set, use it.
  if (admin.adminLevel && admin.adminLevel !== ADMIN_LEVELS.SUBADMIN) {
    return admin.adminLevel;
  }

  // Fallback / legacy check
  if (admin.role === 'ADMIN') {
    if (admin.admin_type === 'superadmin') {
      if (admin.servicesAccess?.includes('food') && admin.servicesAccess?.length === 1) {
        return ADMIN_LEVELS.FOOD_SUPERADMIN;
      }
      // Same single-service rule for serviceProvider. Deliberately NOT generalised
      // over every module: a taxi-only superadmin currently falls through to
      // PLATFORM_SUPERADMIN, and changing that would silently demote live accounts.
      // (It does not leak into this module -- SP gates on the servicesAccess array
      // itself, see modules/serviceProvider/utils/serviceAccess.js.)
      if (admin.servicesAccess?.includes('serviceProvider') && admin.servicesAccess?.length === 1) {
        return ADMIN_LEVELS.SERVICE_PROVIDER_SUPERADMIN;
      }
      return ADMIN_LEVELS.PLATFORM_SUPERADMIN;
    }
    
    // Legacy migration: If they have no parentAdminId, treat them as PLATFORM_SUPERADMIN.
    // Prior to the hierarchy feature, all admins were superadmins.
    //
    // Except accounts the sub-admin screens made: those name a module and say
    // admin_type 'subadmin'. A cache bug saved some of them without a parent,
    // which made them owners; this keeps them sub-admins.
    if (!admin.parentAdminId && !isOrphanedSubadmin(admin)) {
      return ADMIN_LEVELS.PLATFORM_SUPERADMIN;
    }
  }
  return ADMIN_LEVELS.SUBADMIN;
}

/**
 * Resolves the module of an admin (for scoping subadmins).
 * @param {Object} admin
 * @returns {string|null} One of ADMIN_MODULES or null
 */
export function resolveAdminModule(admin) {
  if (!admin) return null;
  if (admin.module) return admin.module;
  
  const level = resolveAdminLevel(admin);
  // Table-driven so a new service is one row in MODULE_SUPERADMIN_LEVELS, not
  // another pair of hardcoded ifs here.
  for (const [module, moduleLevel] of Object.entries(MODULE_SUPERADMIN_LEVELS)) {
    if (level === moduleLevel) return module;
  }

  // Fall back to servicesAccess: an admin scoped to exactly one service belongs to
  // that service's module. Replaces the old food-vs-taxi-only pair, and gives the
  // same answer for both of them.
  const access = Array.isArray(admin.servicesAccess) ? admin.servicesAccess : [];
  const known = access.filter((s) => Object.values(ADMIN_MODULES).includes(s));
  if (known.length === 1) return known[0];

  return null;
}

export function isPlatformSuperAdmin(admin) {
  return resolveAdminLevel(admin) === ADMIN_LEVELS.PLATFORM_SUPERADMIN;
}

export function isModuleSuperAdmin(admin, module) {
  const level = resolveAdminLevel(admin);
  return Boolean(MODULE_SUPERADMIN_LEVELS[module]) && level === MODULE_SUPERADMIN_LEVELS[module];
}

export function isSuperAdminLike(admin) {
  const level = resolveAdminLevel(admin);
  return level === ADMIN_LEVELS.PLATFORM_SUPERADMIN ||
         Object.values(MODULE_SUPERADMIN_LEVELS).includes(level);
}

/**
 * Checks if admin has general servicesAccess to a module.
 * @param {Object} admin
 * @param {string} module
 * @returns {boolean}
 */
export function hasModuleAccess(admin, module) {
  if (!admin) return false;
  if (isPlatformSuperAdmin(admin)) return true;
  if (admin.module && admin.module !== module) return false;
  return admin.servicesAccess?.includes(module) || false;
}

/**
 * Validates permission against flat permissions array.
 */
export function hasAdminPermission(admin, resource, action = '') {
  if (!admin) return false;
  if (isPlatformSuperAdmin(admin)) return true;
  
  // A module superadmin has blanket permission inside its own module.
  for (const [module, moduleLevel] of Object.entries(MODULE_SUPERADMIN_LEVELS)) {
    if (resolveAdminLevel(admin) === moduleLevel && admin.module === module) return true;
  }

  return hasResourcePermission(admin.permissions || [], resource, action);
}

/**
 * Checks if parent admin is allowed to manage / create children under them.
 */
export function canManageAdmins(parentAdmin) {
  if (!parentAdmin) return false;
  if (isSuperAdminLike(parentAdmin)) return true;
  // Subadmins must have subadmins.write
  return hasAdminPermission(parentAdmin, 'subadmins', 'write');
}

/**
 * Gets levels that the current admin is allowed to create.
 */
export function getCreatableAdminLevels(admin) {
  if (!admin) return [];
  const level = resolveAdminLevel(admin);
  if (level === ADMIN_LEVELS.PLATFORM_SUPERADMIN) {
    return [...Object.values(MODULE_SUPERADMIN_LEVELS), ADMIN_LEVELS.SUBADMIN];
  }
  if (Object.values(MODULE_SUPERADMIN_LEVELS).includes(level)) {
    return [ADMIN_LEVELS.SUBADMIN];
  }
  if (level === ADMIN_LEVELS.SUBADMIN && hasAdminPermission(admin, 'subadmins', 'write')) {
    return [ADMIN_LEVELS.SUBADMIN];
  }
  return [];
}

/**
 * Assert that child settings are a valid subset of parent.
 */
export function assertCanCreateAdmin(parentAdmin, childData) {
  if (!canManageAdmins(parentAdmin)) {
    throw new Error('You do not have permission to manage subadmins.');
  }

  const allowedLevels = getCreatableAdminLevels(parentAdmin);
  if (!allowedLevels.includes(childData.adminLevel)) {
    throw new Error(`You are not authorized to create admins of level: ${childData.adminLevel}`);
  }

  // Scoping checks: Module must match or be subset of parent's servicesAccess
  const parentModule = resolveAdminModule(parentAdmin);
  if (parentModule && childData.module && childData.module !== parentModule) {
    throw new Error(`Cannot assign a different module. Expected module: ${parentModule}`);
  }

  // If subadmin: permissions and zones must be a subset of parent's permissions and zones
  if (childData.adminLevel === ADMIN_LEVELS.SUBADMIN) {
    if (!isSuperAdminLike(parentAdmin)) {
      // Check permissions subset
      const parentPerms = parentAdmin.permissions || [];
      if (!assertPermissionsSubset(parentPerms, childData.permissions || [])) {
        throw new Error('Cannot assign permissions exceeding your own scope.');
      }
      
      // Check zones subset
      if (parentModule === ADMIN_MODULES.FOOD) {
        const parentZones = parentAdmin.food_zone_ids || [];
        if (!assertIdSubset(parentZones, childData.food_zone_ids || [])) {
          throw new Error('Cannot assign zones exceeding your own scope.');
        }
      }
    }
  }
}

/**
 * Gets all descendant admin IDs in a manager's branch recursively.
 */
export async function getDescendantAdminIds(managerId) {
  const descendantIds = [];
  const queue = [managerId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = await FoodAdmin.find({ parentAdminId: currentId }).select('_id').lean();
    for (const child of children) {
      const childIdStr = child._id.toString();
      if (!descendantIds.includes(childIdStr)) {
        descendantIds.push(childIdStr);
        queue.push(child._id);
      }
    }
  }
  return descendantIds;
}

/**
 * Verifies if targetAdminId is a descendant of parentAdminId.
 */
export async function isDescendantOf(parentAdminId, targetAdminId) {
  let current = await FoodAdmin.findById(targetAdminId).select('parentAdminId').lean();
  while (current && current.parentAdminId) {
    if (current.parentAdminId.toString() === parentAdminId.toString()) {
      return true;
    }
    current = await FoodAdmin.findById(current.parentAdminId).select('parentAdminId').lean();
  }
  return false;
}

/**
 * Assert that manager can manage target.
 */
export async function assertCanManageTargetAdmin(managerAdmin, targetAdminId) {
  if (isPlatformSuperAdmin(managerAdmin)) {
    return true; // Platform superadmin can manage anyone
  }
  // Check if target is a descendant of the manager
  const isDescendant = await isDescendantOf(managerAdmin._id, targetAdminId);
  if (!isDescendant) {
    throw new Error('Access denied: target admin is not under your management hierarchy.');
  }
}

/**
 * Build descendant query filter for Listing/Search.
 */
export async function buildDescendantAdminQuery(managerAdmin) {
  if (isPlatformSuperAdmin(managerAdmin)) {
    return {};
  }
  const descendantIds = await getDescendantAdminIds(managerAdmin._id);
  // Must return descendantIds, or if none, return an empty array to match nothing except target branch
  return { _id: { $in: descendantIds } };
}

/**
 * Serializes admin context for returning in APIs / session tokens.
 */
export function serializeAdminContext(admin) {
  if (!admin) return null;
  const level = resolveAdminLevel(admin);
  const module = resolveAdminModule(admin);
  return {
    id: admin._id ? admin._id.toString() : admin.id,
    name: admin.name || '',
    email: admin.email || '',
    role: admin.role || 'ADMIN',
    adminLevel: level,
    module: module,
    parentAdminId: admin.parentAdminId ? admin.parentAdminId.toString() : null,
    admin_type: admin.admin_type || (level === ADMIN_LEVELS.SUBADMIN ? 'subadmin' : 'superadmin'),
    permissions: admin.permissions || [],
    servicesAccess: admin.servicesAccess || [],
    food_zone_ids: (admin.food_zone_ids || []).map(id => id.toString()),
    isActive: admin.isActive !== false
  };
}
