import { hasAdminPermission } from '../../../../core/admin/adminHierarchy.service.js';

export const FOOD_PERMISSION_RESOURCES = [
  // Core Access
  'dashboard',
  'subadmins',
  'pos',
  
  // Operations
  'orders',
  'restaurants',
  'foods',
  'categories',
  'zones',
  'delivery',
  'customers',
  'support',
  'dining',
  
  // Finance & Reports
  'wallet',
  'reports',
  'promotions',
  'referrals',
  
  // Settings
  'fee_settings',
  'settings',
  'cms'
];

/**
 * Returns a catalog list of all food permission resources.
 */
export function listFoodPermissionCatalog() {
  return FOOD_PERMISSION_RESOURCES;
}

/**
 * Checks if a food admin has permission.
 * Supports passing either string permission key e.g. "orders.read", or split args.
 */
export function hasFoodAdminPermission(admin, resourceOrPermission, action = '') {
  if (!admin) return false;
  
  if (resourceOrPermission.includes('.')) {
    const parts = resourceOrPermission.split('.');
    return hasAdminPermission(admin, parts[0], parts[1]);
  }
  
  return hasAdminPermission(admin, resourceOrPermission, action);
}

/**
 * Normalizes and extracts context for a food admin.
 */
export function getFoodAdminContext(admin) {
  if (!admin) return null;
  return {
    id: admin._id ? admin._id.toString() : admin.id,
    adminLevel: admin.adminLevel || 'subadmin',
    module: admin.module || 'food',
    permissions: admin.permissions || [],
    food_zone_ids: (admin.food_zone_ids || []).map(id => id.toString()),
    isActive: admin.isActive !== false
  };
}
