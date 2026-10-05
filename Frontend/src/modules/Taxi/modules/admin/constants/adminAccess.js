export const ADMIN_PERMISSION_GROUPS = [
  {
    title: 'Core Access',
    items: [
      { key: 'dashboard.view', label: 'Dashboard' },
      { key: 'earnings.view', label: 'Admin Earnings' },
      { key: 'chat.view', label: 'Chat' },
      { key: 'promotions.view', label: 'Promotions' },
      { key: 'subadmins.manage', label: 'Subadmins' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { key: 'trips.view', label: 'Trip Requests' },
      { key: 'deliveries.view', label: 'Delivery Requests' },
      { key: 'ongoing.view', label: 'Ongoing Requests' },
      { key: 'drivers.view', label: 'Drivers' },
      { key: 'users.view', label: 'Customers' },
      { key: 'wallet.view', label: 'Wallet' },
      { key: 'owners.view', label: 'Owners' },
      { key: 'support.view', label: 'Support' },
      { key: 'reports.view', label: 'Reports' },
      { key: 'referrals.view', label: 'Referrals' },
    ],
  },
  {
    title: 'Pricing Scope',
    items: [
      { key: 'service_locations.view', label: 'Service Locations' },
      { key: 'zones.view', label: 'Zones' },
      { key: 'airports.view', label: 'Airports' },
      { key: 'service_stores.view', label: 'Service Stores' },
      { key: 'vehicle_types.view', label: 'Vehicle Types' },
      { key: 'set_prices.view', label: 'Set Prices' },
      { key: 'goods_types.view', label: 'Goods Types' },
      { key: 'rental.view', label: 'Rental Modules' },
      { key: 'bus_service.view', label: 'Bus Service' },
      { key: 'pooling.view', label: 'Pooling' },
      { key: 'geofencing.view', label: 'Geofencing' },
    ],
  },
];

export const ALL_ADMIN_PERMISSIONS = ADMIN_PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.key));

/*
 * Taxi's menu keys, mapped onto the permissions every admin panel shares (see
 * Backend core/admin/adminAccessPolicy.js). Accounts are managed in one place
 * now, so a sub-admin given "Riders & drivers" there must see Drivers here.
 */
const SHARED_RESOURCE = {
  'dashboard.view': 'dashboard',
  'earnings.view': 'reports',
  'reports.view': 'reports',
  'chat.view': 'support',
  'support.view': 'support',
  'promotions.view': 'promotions',
  'referrals.view': 'referrals',
  'subadmins.manage': 'subadmins',
  'users.view': 'customers',
  'wallet.view': 'wallet',
  'drivers.view': 'delivery',
  'owners.view': 'fleet',
  'service_locations.view': 'zones',
  'zones.view': 'zones',
  'airports.view': 'zones',
  'geofencing.view': 'zones',
  'service_stores.view': 'fleet',
  'vehicle_types.view': 'fleet',
  'rental.view': 'fleet',
  'goods_types.view': 'fleet',
  'bus_service.view': 'fleet',
  'pooling.view': 'fleet',
  'set_prices.view': 'fee_settings',
  'trips.view': 'orders',
  'deliveries.view': 'orders',
  'ongoing.view': 'orders',
  'settings.view': 'settings',
};

/** The access record the admin panels fetch from /platform/admins/me, if present. */
const readSharedAccess = () => {
  try {
    const raw = localStorage.getItem('admin_access');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const hasAdminPermission = (adminInfo = {}, permission) => {
  const shared = readSharedAccess();
  if (shared) {
    if (shared.isSuperAdmin !== false) return true;
    const perms = Array.isArray(shared.permissions) ? shared.permissions : [];
    if (perms.includes('*')) return true;
    const resource = SHARED_RESOURCE[permission];
    if (resource && (perms.includes(`${resource}.read`) || perms.includes(`${resource}.write`))) return true;
    return perms.includes(permission);
  }
  // Signed in but the access record has not arrived (or failed): show nothing
  // rather than guessing "superadmin" from the login profile, which is how a
  // taxi-only sub-admin ended up seeing every menu.
  try {
    if (localStorage.getItem('admin_accessToken')) return false;
  } catch {
    /* fall through to the profile */
  }

  const type = String(adminInfo?.admin_type || adminInfo?.role || '').toLowerCase();
  
  const isSuper = 
    adminInfo?.adminLevel === 'platform_superadmin' || 
    adminInfo?.adminLevel === 'food_superadmin' || 
    adminInfo?.adminLevel === 'taxi_superadmin' || 
    type === 'superadmin' || 
    (!adminInfo?.parentAdminId && (adminInfo?.role === 'ADMIN' || adminInfo?.role === 'superadmin' || !adminInfo?.admin_type));

  const permissions = Array.isArray(adminInfo?.permissions) ? adminInfo.permissions : [];

  if (isSuper || permissions.includes('*')) {
    return true;
  }

  return permissions.includes(permission);
};
