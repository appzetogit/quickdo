/**
 * Constants & Helpers for Food Admin/Subadmin Permission Hierarchy
 */

export const ADMIN_LEVELS = {
  PLATFORM_SUPERADMIN: 'platform_superadmin',
  FOOD_SUPERADMIN: 'food_superadmin',
  TAXI_SUPERADMIN: 'taxi_superadmin',
  SUBADMIN: 'subadmin'
};

export const ADMIN_MODULES = {
  FOOD: 'food',
  TAXI: 'taxi',
  QUICK_COMMERCE: 'quickCommerce'
};

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

export function buildPermissionKey(resource, action) {
  if (resource === '*' || action === '*') return '*';
  return `${resource}.${action}`;
}

export function parsePermissionKey(key) {
  if (key === '*') return { resource: '*', action: '*' };
  const parts = key.split('.');
  return { resource: parts[0] || '', action: parts[1] || '' };
}

export function expandLegacyPermissions(permissions = []) {
  if (!Array.isArray(permissions)) return [];
  const result = [];
  for (const p of permissions) {
    if (p === 'subadmins.manage') {
      result.push('subadmins.write', 'subadmins.read');
    } else {
      result.push(p);
    }
  }
  return [...new Set(result)];
}

export function resolveAdminLevel(profile) {
  if (!profile) return ADMIN_LEVELS.SUBADMIN;
  
  // If an explicit non-default adminLevel is set, use it.
  if (profile.adminLevel && profile.adminLevel !== ADMIN_LEVELS.SUBADMIN) {
    return profile.adminLevel;
  }

  // Fallback / legacy check
  if (profile.role === 'ADMIN') {
    if (profile.admin_type === 'superadmin') {
      if (profile.servicesAccess?.includes('food') && profile.servicesAccess?.length === 1) {
        return ADMIN_LEVELS.FOOD_SUPERADMIN;
      }
      return ADMIN_LEVELS.PLATFORM_SUPERADMIN;
    }
    
    // Legacy migration: If they have no parentAdminId, treat them as PLATFORM_SUPERADMIN.
    // Prior to the hierarchy feature, all admins were superadmins.
    if (!profile.parentAdminId) {
      return ADMIN_LEVELS.PLATFORM_SUPERADMIN;
    }
  }
  return ADMIN_LEVELS.SUBADMIN;
}

export function isPlatformSuperAdmin(profile) {
  return resolveAdminLevel(profile) === ADMIN_LEVELS.PLATFORM_SUPERADMIN;
}

export function isFoodSuperAdminLike(profile) {
  const level = resolveAdminLevel(profile);
  return level === ADMIN_LEVELS.PLATFORM_SUPERADMIN || 
         (level === ADMIN_LEVELS.FOOD_SUPERADMIN && profile.module === ADMIN_MODULES.FOOD);
}

export function hasFoodAdminPermission(profile, resource, action = '') {
  if (!profile) return false;
  if (isFoodSuperAdminLike(profile)) return true;

  const permissions = expandLegacyPermissions(profile.permissions || []);
  if (permissions.includes('*')) return true;

  if (!action) {
    return permissions.some(p => parsePermissionKey(p).resource === resource);
  }

  const keysToCheck = [buildPermissionKey(resource, action)];
  if (action === 'read') {
    keysToCheck.push(buildPermissionKey(resource, 'write'));
  }

  return keysToCheck.some(key => permissions.includes(key));
}

export const canReadFood = (profile, resource) => hasFoodAdminPermission(profile, resource, 'read');
export const canWriteFood = (profile, resource) => hasFoodAdminPermission(profile, resource, 'write');

export function getCreatableAdminTypes(profile) {
  if (!profile) return [];
  const level = resolveAdminLevel(profile);
  if (level === ADMIN_LEVELS.PLATFORM_SUPERADMIN) {
    return [
      { value: 'subadmin', label: 'Food Subadmin' },
      { value: 'food_superadmin', label: 'Food Superadmin' }
    ];
  }
  if (level === ADMIN_LEVELS.FOOD_SUPERADMIN) {
    return [
      { value: 'subadmin', label: 'Food Subadmin' }
    ];
  }
  if (level === ADMIN_LEVELS.SUBADMIN && hasFoodAdminPermission(profile, 'subadmins', 'write')) {
    return [
      { value: 'subadmin', label: 'Food Subadmin' }
    ];
  }
  return [];
}

// Map specific frontend paths to their corresponding resource keys
export const PATH_RESOURCE_RULES = {
  '/admin/food': 'dashboard',
  '/admin/food/point-of-sale': 'pos',
  '/admin/food/status-monitor': 'dashboard',
  
  '/admin/food/food-approval': 'foods',
  '/admin/food/foods': 'foods',
  '/admin/food/addons': 'foods',
  '/admin/food/global-pricing': 'foods',
  '/admin/food/categories': 'categories',
  
  '/admin/food/zone-setup': 'zones',
  '/admin/food/restaurants': 'restaurants',
  '/admin/food/restaurants/joining-request': 'restaurants',
  '/admin/food/restaurants/commission': 'restaurants',
  '/admin/food/restaurants/reviews': 'restaurants',
  '/admin/food/restaurants/complaints': 'restaurants',
  
  '/admin/food/orders/all': 'orders',
  '/admin/food/orders/scheduled': 'orders',
  '/admin/food/orders/pending': 'orders',
  '/admin/food/orders/accepted': 'orders',
  '/admin/food/orders/processing': 'orders',
  '/admin/food/orders/food-on-the-way': 'orders',
  '/admin/food/orders/delivered': 'orders',
  '/admin/food/orders/canceled': 'orders',
  '/admin/food/orders/restaurant-cancelled': 'orders',
  '/admin/food/orders/payment-failed': 'orders',
  '/admin/food/orders/refunded': 'orders',
  '/admin/food/orders/offline-payments': 'orders',
  '/admin/food/order-detect-delivery': 'delivery',
  '/admin/food/order-refunds/new': 'orders',
  
  '/admin/food/coupons': 'promotions',
  '/admin/food/referral-settings': 'referrals',
  
  '/admin/food/customers': 'customers',
  '/admin/food/support-tickets': 'support',
  
  '/admin/food/delivery-cash-limit': 'delivery',
  '/admin/food/fee-settings': 'fee_settings',
  '/admin/food/packaging-charges': 'fee_settings',
  '/admin/food/map-settings': 'settings',
  '/admin/food/cash-limit-settlement': 'delivery',
  '/admin/food/delivery-withdrawal': 'wallet',
  '/admin/food/delivery-boy-wallet': 'wallet',
  '/admin/food/delivery-emergency-help': 'delivery',
  '/admin/food/delivery-support-tickets': 'support',
  '/admin/food/delivery-partners': 'delivery',
  '/admin/food/delivery-partners/add': 'delivery',
  '/admin/food/delivery-partners/join-request': 'delivery',
  '/admin/food/delivery-partners/reviews': 'delivery',
  '/admin/food/delivery-partners/bonus': 'delivery',
  '/admin/food/delivery-partners/earning-addon': 'delivery',
  '/admin/food/delivery-partners/earning-addon-history': 'delivery',
  '/admin/food/delivery-partners/earnings': 'delivery',
  
  '/admin/food/contact-messages': 'support',
  '/admin/food/safety-emergency-reports': 'support',
  
  '/admin/food/transaction-report': 'reports',
  '/admin/food/order-report/regular': 'reports',
  '/admin/food/tax-report': 'reports',
  '/admin/food/restaurant-report': 'reports',
  '/admin/food/customer-report/feedback-experience': 'reports',
  
  '/admin/food/restaurant-withdraws': 'wallet',
  
  '/admin/food/hero-banner-management': 'cms',
  '/admin/food/promotional-banner': 'cms',
  '/admin/food/banners': 'cms',
  
  '/admin/food/dining-management': 'dining',
  '/admin/food/dining-list': 'dining',
  
  '/admin/food/broadcast-notification': 'cms',
  '/admin/food/business-setup': 'settings',
  
  '/admin/food/pages-social-media/about': 'cms',
  '/admin/food/pages-social-media/terms': 'cms',
  '/admin/food/pages-social-media/privacy': 'cms',
  '/admin/food/pages-social-media/refund': 'cms',
  '/admin/food/pages-social-media/shipping': 'cms',
  '/admin/food/pages-social-media/cancellation': 'cms',
  '/admin/food/pages-social-media/help-support': 'cms',

  '/admin/food/management/admins': 'subadmins',
  '/admin/food/management/admins/create': 'subadmins'
};

export function getRouteResource(pathname) {
  const cleanPath = pathname.replace(/\/edit\/[^/]+/, '').replace(/\/view\/[^/]+/, '');
  
  // Exact match
  if (PATH_RESOURCE_RULES[cleanPath]) {
    return PATH_RESOURCE_RULES[cleanPath];
  }
  
  // Prefix match
  for (const [route, resource] of Object.entries(PATH_RESOURCE_RULES)) {
    if (cleanPath.startsWith(route)) {
      return resource;
    }
  }
  return null;
}

export function filterFoodSidebarMenu(menu = [], profile) {
  if (!profile) return [];
  if (isFoodSuperAdminLike(profile)) return menu;

  return menu
    .map(item => {
      if (item.type === 'section') {
        const filteredItems = item.items.filter(subItem => {
          const resource = subItem.resource || getRouteResource(subItem.path);
          if (!resource) return true; // Keep items without resource limits
          return canReadFood(profile, resource);
        });

        if (filteredItems.length === 0) return null;
        return { ...item, items: filteredItems };
      }

      const resource = item.resource || getRouteResource(item.path);
      if (!resource) return item;
      return canReadFood(profile, resource) ? item : null;
    })
    .filter(Boolean);
}

export const parentCanAssignRead = (parentProfile, resource) => {
  return isFoodSuperAdminLike(parentProfile) || hasFoodAdminPermission(parentProfile, resource, 'read');
};

export const parentCanAssignWrite = (parentProfile, resource) => {
  return isFoodSuperAdminLike(parentProfile) || hasFoodAdminPermission(parentProfile, resource, 'write');
};

export function normalizeFoodAdminProfile(profile) {
  if (!profile) return null;
  return {
    id: profile._id || profile.id,
    name: profile.name || '',
    email: profile.email || '',
    role: profile.role || 'ADMIN',
    adminLevel: resolveAdminLevel(profile),
    module: profile.module || 'food',
    permissions: profile.permissions || [],
    food_zone_ids: profile.food_zone_ids || [],
    servicesAccess: profile.servicesAccess || []
  };
}
