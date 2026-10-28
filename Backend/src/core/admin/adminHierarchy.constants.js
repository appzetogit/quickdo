export const ADMIN_LEVELS = {
  PLATFORM_SUPERADMIN: 'platform_superadmin',
  FOOD_SUPERADMIN: 'food_superadmin',
  TAXI_SUPERADMIN: 'taxi_superadmin',
  SERVICE_PROVIDER_SUPERADMIN: 'sp_superadmin',
  SUBADMIN: 'subadmin'
};

export const ADMIN_MODULES = {
  FOOD: 'food',
  TAXI: 'taxi',
  QUICK_COMMERCE: 'quickCommerce',
  SERVICE_PROVIDER: 'serviceProvider'
};

// The module each per-service superadmin level owns. Adding a service means adding
// one row here rather than another hardcoded if-pair in adminHierarchy.service.js.
export const MODULE_SUPERADMIN_LEVELS = {
  [ADMIN_MODULES.FOOD]: ADMIN_LEVELS.FOOD_SUPERADMIN,
  [ADMIN_MODULES.TAXI]: ADMIN_LEVELS.TAXI_SUPERADMIN,
  [ADMIN_MODULES.SERVICE_PROVIDER]: ADMIN_LEVELS.SERVICE_PROVIDER_SUPERADMIN
};
