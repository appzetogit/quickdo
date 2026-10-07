/**
 * One permission model for every admin panel: Food, Quick Commerce, Taxi.
 *
 * Why this exists: each vertical grew its own permission list, and none of them
 * was enforced on the API. Food checked a permission on 9 of ~300 routes, quick
 * commerce admitted every platform admin as a superadmin, taxi checked only its
 * admin-management screen. A sub-admin therefore saw and changed everything --
 * the sidebar was the only thing that looked restricted, and it did not filter.
 *
 * The model:
 *   - servicesAccess  which panels the admin may open (food, quickCommerce, taxi)
 *   - permissions     'resource.read' / 'resource.write' strings, the same resource
 *                     names in every panel ("Orders" means food orders, grocery
 *                     orders and taxi rides alike)
 *
 * Superadmins are unaffected: the platform superadmin passes everything, a module
 * superadmin passes everything inside its own module. Only admins that resolve to
 * the `subadmin` level are checked, so no existing owner account can be locked out
 * by a mapping gap below.
 */
import { ADMIN_LEVELS } from './adminHierarchy.constants.js';
import { resolveAdminLevel, resolveAdminModule } from './adminHierarchy.service.js';

export const ADMIN_SERVICES = [
  { key: 'food', label: 'Food' },
  { key: 'quickCommerce', label: 'Quick Commerce' },
  { key: 'taxi', label: 'Taxi' },
];
export const ADMIN_SERVICE_KEYS = ADMIN_SERVICES.map((s) => s.key);

const ALL = ['food', 'quickCommerce', 'taxi'];
const STORES = ['food', 'quickCommerce'];

/**
 * What a sub-admin can be given. `services` decides which panels a resource is
 * offered for, so the form does not show "Point of sale" to a taxi-only admin.
 */
export const ADMIN_PERMISSION_CATALOG = [
  {
    group: 'Overview',
    resources: [
      { key: 'dashboard', label: 'Dashboard', hint: 'Home screen, live status and counts', services: ALL },
      { key: 'reports', label: 'Reports', hint: 'Transaction, order, tax and earnings reports', services: ALL },
    ],
  },
  {
    group: 'Operations',
    resources: [
      { key: 'orders', label: 'Orders & rides', hint: 'Orders, trips, bookings', services: ALL },
      { key: 'customers', label: 'Customers', hint: 'Customer accounts and carts', services: ALL },
      { key: 'restaurants', label: 'Restaurants & stores', hint: 'Sellers, joining requests, commission', services: STORES },
      { key: 'foods', label: 'Menu & products', hint: 'Items, add-ons, approvals, price adjustment', services: STORES },
      { key: 'categories', label: 'Categories', hint: 'Item categories', services: STORES },
      { key: 'delivery', label: 'Riders & drivers', hint: 'Join requests, documents, bonus, earnings', services: ALL },
      { key: 'fleet', label: 'Vehicles & fleet', hint: 'Vehicle types, rental packages', services: ['taxi'] },
      { key: 'zones', label: 'Zones & service areas', hint: 'Zones, service locations, airports', services: ALL },
      { key: 'support', label: 'Support & safety', hint: 'Tickets, complaints, SOS reports, chat', services: ALL },
      { key: 'pos', label: 'Point of sale', hint: 'Place orders from the panel', services: ['food'] },
    ],
  },
  {
    group: 'Money',
    resources: [
      { key: 'wallet', label: 'Wallets & payouts', hint: 'Withdrawals, wallets, balance adjustments', services: ALL },
      { key: 'fee_settings', label: 'Fees & pricing', hint: 'Delivery and platform fees, fares', services: ALL },
      { key: 'promotions', label: 'Offers & coupons', hint: 'Coupons, cashback, 99 store', services: ALL },
      { key: 'referrals', label: 'Referrals', hint: 'Referral rewards', services: ALL },
    ],
  },
  {
    /*
     * Master settings for the admin's own zones only (core/admin/zoneAdminSettings.js):
     * zone-level values, never the module-wide or all-modules ones.
     */
    group: 'Zone settings (their zones only)',
    resources: [
      { key: 'zone_earnings', label: 'Delivery earnings', hint: 'Delivery fee and rider pay, large-order incentive', services: ALL },
      { key: 'zone_incentives', label: 'Incentive ladders', hint: 'Daily order-count rewards for riders', services: ALL },
      { key: 'zone_orders', label: 'Cancellation & order hold', hint: 'Cancel window, hold before the restaurant sees it', services: STORES },
      { key: 'zone_fees', label: 'Platform fee & GST', hint: 'Platform fee on orders in their zones', services: STORES },
    ],
  },
  {
    group: 'Settings',
    resources: [
      { key: 'cms', label: 'Banners & pages', hint: 'Banners, broadcast notifications, legal pages', services: ALL },
      { key: 'settings', label: 'Business settings', hint: 'Business setup, maps key, integrations', services: ALL },
      { key: 'subadmins', label: 'Admin accounts', hint: 'Create and edit admins below them', services: ALL },
    ],
  },
];

export const ADMIN_RESOURCE_KEYS = ADMIN_PERMISSION_CATALOG.flatMap((g) => g.resources.map((r) => r.key));

/*
 * Permission strings from the older per-panel forms, mapped onto the shared
 * resources. Taxi's form stored 'x.view' and never enforced it, so its sub-admins
 * could in practice change those sections: they map to `write`, which keeps what
 * those accounts could already do instead of silently removing it on deploy.
 */
const LEGACY_ALIASES = {
  'subadmins.manage': ['subadmins.write'],
  'dashboard.view': ['dashboard.write'],
  'earnings.view': ['reports.write'],
  'reports.view': ['reports.write'],
  'chat.view': ['support.write'],
  'support.view': ['support.write'],
  'promotions.view': ['promotions.write'],
  'referrals.view': ['referrals.write'],
  'users.view': ['customers.write'],
  'wallet.view': ['wallet.write'],
  'drivers.view': ['delivery.write'],
  'service_locations.view': ['zones.write'],
  'zones.view': ['zones.write'],
  'airports.view': ['zones.write'],
  'geofencing.view': ['zones.write'],
  'vehicle_types.view': ['fleet.write'],
  'rental.view': ['fleet.write'],
  'set_prices.view': ['fee_settings.write'],
  'trips.view': ['orders.write'],
  'ongoing.view': ['orders.write'],
  'settings.view': ['settings.write'],
};

/** Normalised permission list: aliases expanded, write implies read, deduped. */
export function expandPermissions(permissions = []) {
  if (!Array.isArray(permissions)) return [];
  const out = new Set();
  for (const raw of permissions) {
    const p = String(raw || '').trim();
    if (!p) continue;
    if (p === '*') return ['*'];
    for (const key of LEGACY_ALIASES[p] || [p]) {
      out.add(key);
      if (key.endsWith('.write')) out.add(key.replace(/\.write$/, '.read'));
    }
  }
  return [...out].sort();
}

/** Keep only well-formed keys for known resources. What the form may save. */
export function sanitizePermissions(permissions = []) {
  const known = new Set(ADMIN_RESOURCE_KEYS);
  return expandPermissions(permissions).filter((p) => {
    if (p === '*') return false;
    const [resource, action] = p.split('.');
    return known.has(resource) && (action === 'read' || action === 'write');
  });
}

export function sanitizeServices(services = []) {
  if (!Array.isArray(services)) return [];
  return [...new Set(services.map((s) => String(s || '').trim()).filter((s) => ADMIN_SERVICE_KEYS.includes(s)))];
}

/**
 * Taxi signs its own admins up with role 'superadmin' / 'subadmin' rather than the
 * platform's 'ADMIN'. resolveAdminLevel only understands the platform spelling, so
 * a taxi-made owner account would otherwise read as a sub-admin here.
 */
export function effectiveAdminLevel(admin) {
  if (!admin) return ADMIN_LEVELS.SUBADMIN;
  const role = String(admin.role || '').trim().toLowerCase().replace(/[-_]/g, '');
  if (role === 'subadmin') return ADMIN_LEVELS.SUBADMIN;
  if (role === 'superadmin' && !admin.parentAdminId
      && (!admin.adminLevel || admin.adminLevel === ADMIN_LEVELS.SUBADMIN || admin.adminLevel === ADMIN_LEVELS.PLATFORM_SUPERADMIN)) {
    return ADMIN_LEVELS.PLATFORM_SUPERADMIN;
  }
  return resolveAdminLevel(admin);
}

export const isRestrictedAdmin = (admin) => effectiveAdminLevel(admin) === ADMIN_LEVELS.SUBADMIN;

/**
 * Panels a sub-admin may open. An account made before servicesAccess was set on
 * sub-admins has an empty list: it belonged to whichever panel created it, which
 * the permission spelling still tells us (taxi wrote 'x.view').
 */
export function effectiveServices(admin) {
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  const listed = sanitizeServices(admin?.servicesAccess);
  // Taxi's form wrote 'x.view' and no servicesAccess; loaded through the platform
  // model such an account shows the schema default ['food']. Neither the food nor
  // the shared form ever wrote '.view', so that spelling identifies taxi's.
  const taxiMade = perms.some((p) => /\.view$/.test(String(p)));
  if (taxiMade && (!listed.length || (listed.length === 1 && listed[0] === 'food'))) return ['taxi'];
  if (listed.length) return listed;
  const module = resolveAdminModule(admin);
  return module && ADMIN_SERVICE_KEYS.includes(module) ? [module] : ['food'];
}

/** The panels an API serves: one each. */
export function servicesForApi(api) {
  return [api];
}

/**
 * The single decision. `service` is the panel's API ('food' | 'quickCommerce' |
 * 'taxi'); `resource` is what the request touches, OPEN for shared lookups, or
 * null when the path is not mapped.
 */
export const OPEN = '__open__';

export function decideAdminAccess(admin, { service, resource, write, remove = false }) {
  if (!admin) return { allowed: false, reason: 'no_admin' };
  if (admin.isActive === false || admin.isDeleted === true) return { allowed: false, reason: 'inactive' };

  const level = effectiveAdminLevel(admin);
  if (level === ADMIN_LEVELS.PLATFORM_SUPERADMIN) return { allowed: true, reason: 'platform_superadmin' };
  // Before every other grant: delete access is withheld across the board, so
  // no section permission -- not even '*' -- lets an admin without it delete.
  if (remove && !canAdminDelete(admin)) return { allowed: false, reason: 'no_delete', resource };
  if (level !== ADMIN_LEVELS.SUBADMIN) {
    // A module superadmin owns its module outright. Which modules it may enter at
    // all is still requireServiceAccess's job, as before.
    return { allowed: true, reason: 'module_superadmin' };
  }

  const services = effectiveServices(admin);
  if (!servicesForApi(service).some((s) => services.includes(s))) {
    return { allowed: false, reason: 'no_service' };
  }

  if (resource === OPEN) return { allowed: true, reason: 'open' };
  if (!resource) {
    // Unmapped: reads are shared lookups screens lean on; an unmapped write is
    // refused, so a new route is closed to sub-admins until someone maps it.
    return write ? { allowed: false, reason: 'unmapped_write' } : { allowed: true, reason: 'unmapped_read' };
  }

  const perms = expandPermissions(admin.permissions);
  if (perms.includes('*')) return { allowed: true, reason: 'wildcard' };
  if (perms.includes(`${resource}.write`)) return { allowed: true, reason: 'write' };
  if (!write && perms.includes(`${resource}.read`)) return { allowed: true, reason: 'read' };
  return { allowed: false, reason: perms.includes(`${resource}.read`) ? 'read_only' : 'no_permission', resource };
}

/** Owners always can; anyone else unless delete access was switched off. */
export function canAdminDelete(admin) {
  if (!admin) return false;
  if (effectiveAdminLevel(admin) === ADMIN_LEVELS.PLATFORM_SUPERADMIN) return true;
  return admin.canDelete !== false;
}

/*
 * Which requests delete something. Mostly the DELETE verb, plus the few routes
 * that delete over POST/PATCH: bulk deletes, and approving an account-deletion
 * request (which removes the customer or driver). Restoring or rejecting one
 * does not delete anything and is left to the section's own permission.
 */
export function isDeleteRequest(method, path = '') {
  if (String(method || '').toUpperCase() === 'DELETE') return true;
  const p = String(path || '').split('?')[0];
  return /(^|\/)bulk-delete(\/|$)/.test(p) || /\/delete-requests\/[^/]+\/approve\/?$/.test(p);
}

const RESOURCE_LABELS = Object.fromEntries(
  ADMIN_PERMISSION_CATALOG.flatMap((g) => g.resources.map((r) => [r.key, r.label])),
);

export function denialMessage(decision) {
  const label = RESOURCE_LABELS[decision.resource] || 'this section';
  switch (decision.reason) {
    case 'inactive': return 'Your admin account has been deactivated';
    case 'no_service': return 'Your admin account does not have access to this panel';
    case 'read_only': return `You can view ${label} but not change it`;
    case 'no_delete': return 'You do not have delete access. Ask an owner to turn it on for your account';
    case 'unmapped_write': return 'Only a superadmin can make this change';
    default: return `You do not have access to ${label}`;
  }
}

/* ------------------------------------------------------------------ paths */

const rule = (pattern, resource, methods = null) => ({ pattern, resource, methods });

/*
 * Food and quick commerce share one admin API shape (quick commerce is a fork),
 * so one table serves both. Paths are relative to the admin router. First match
 * wins, so specific rules sit above the prefix they would otherwise fall under.
 */
const STORE_ADMIN_RULES = [
  // Lookups nearly every screen makes to fill a filter or a header. Reading them
  // grants nothing a sub-admin's own sections do not already show.
  rule(/^\/(sidebar-badges|global-search|notifications\/fssai-expired)(\/|$)/, OPEN, ['GET']),
  rule(/^\/(zones|categories|business-settings|map-settings|feature-settings|power-scanning|service-radius\/settings|restaurant-subscription-settings|fee-settings)(\/|$)/, OPEN, ['GET']),
  rule(/^\/restaurants\/?$/, OPEN, ['GET']),

  rule(/^\/(admin-management|sub-admins)(\/|$)/, 'subadmins'),
  rule(/^\/dashboard-stats(\/|$)/, 'dashboard'),

  rule(/^\/restaurants\/complaints(\/|$)/, 'support'),
  rule(/^\/(support-tickets|safety-emergency-reports|contact-messages|delivery\/support-tickets)(\/|$)/, 'support'),

  rule(/^\/(reports|feedback-experiences)(\/|$)/, 'reports'),

  rule(/^\/(withdrawals|delivery\/withdrawals|delivery\/wallets|restaurant-withdrawal-setting)(\/|$)/, 'wallet'),

  rule(/^\/(restaurants|service-radius|restaurant-commissions|commission-schedules|monetization-mode|restaurant-settings|restaurant-subscription-settings|restaurant-subscriptions)(\/|$)/, 'restaurants'),

  rule(/^\/categories(\/|$)/, 'categories'),
  rule(/^\/(foods|addons|item-extras|price-adjustments|stock)(\/|$)/, 'foods'),
  rule(/^\/(orders|order-detect-delivery|petpooja\/sync-logs|returns)(\/|$)/, 'orders'),
  rule(/^\/(offers|cashback-settings|store-99|ninety-nine-store|99-store)(\/|$)/, 'promotions'),
  rule(/^\/referral-settings(\/|$)/, 'referrals'),
  rule(/^\/(customers|users|user-carts)(\/|$)/, 'customers'),

  rule(/^\/(delivery|delivery-cash-limit|delivery-emergency-help|delivery-instructions|driver-registration-fields)(\/|$)/, 'delivery'),
  rule(/^\/zones(\/|$)/, 'zones'),
  rule(/^\/(fee-settings|packaging-charges)(\/|$)/, 'fee_settings'),
  rule(/^\/pos(\/|$)/, 'pos'),

  rule(/^\/(pages-social-media|notifications\/broadcast|notifications|restaurant-app-banners|banners|hero-banners|promotional-banners|landing)(\/|$)/, 'cms'),
  rule(/^\/(business-settings|map-settings|petpooja\/settings|feature-settings|power-scanning|service-radius\/settings|order-cancellation)(\/|$)/, 'settings'),
];

/* Taxi's admin API, relative to /v1/taxi. */
const TAXI_ADMIN_RULES = [
  rule(/^\/admin\/(status|countries|common|permissions|vehicle_preference|notification-channels|general-settings)(\/|$)/, OPEN, ['GET']),
  rule(/^\/admin\/(zones|service-locations|types\/vehicle-types\/list|types\/transport-types)(\/|$)/, OPEN, ['GET']),
  rule(/^\/admin\/upload-image(\/|$)/, OPEN),

  rule(/^\/admin\/(admin-management|roles)(\/|$)/, 'subadmins'),
  rule(/^\/admin\/dashboard(\/|$)/, 'dashboard'),
  rule(/^\/admin\/reports(\/|$)/, 'reports'),
  rule(/^\/admin\/(users|user-subscriptions)(\/|$)/, 'customers'),
  rule(/^\/admin\/wallet(\/|$)/, 'wallet'),
  rule(/^\/admin\/(drivers|driver-ratings|driver-subscriptions)(\/|$)/, 'delivery'),
  rule(/^\/admin\/(owner-management|types|preferences)(\/|$)/, 'fleet'),
  rule(/^\/admin\/(zones|service-locations|airports)(\/|$)/, 'zones'),
  rule(/^\/admin\/(trips|ride-requests|ongoing-rides)(\/|$)/, 'orders'),
  rule(/^\/admin\/(safety|chat|support)(\/|$)/, 'support'),
  rule(/^\/admin\/(referrals|referral)(\/|$)/, 'referrals'),
  rule(/^\/admin\/(promotions|promos?|coupons|banners)(\/|$)/, 'promotions'),
  rule(/^\/admin\/(landing-page|languages)(\/|$)/, 'cms'),
  // Broadcast pushes to every taxi user: the catalogue files these under cms.
  rule(/^\/admin\/(notifications|push-notifications)(\/|$)/, 'cms'),
  rule(/^\/admin\/payment-methods(\/|$)/, 'fee_settings'),
  rule(/^\/admin\/(integration-settings|common|general-settings|notification-channels)(\/|$)/, 'settings'),
  rule(/^\/on-boarding(\/|$)/, 'cms'),
];

function resolveFrom(rules, path, method) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '').split('?')[0];
  for (const r of rules) {
    if (r.methods && !r.methods.includes(m === 'HEAD' ? 'GET' : m)) continue;
    if (r.pattern.test(p)) return r.resource;
  }
  return null;
}

export const resolveStoreAdminResource = (path, method) => resolveFrom(STORE_ADMIN_RULES, path, method);
export const resolveTaxiAdminResource = (path, method) => resolveFrom(TAXI_ADMIN_RULES, path, method);

export const isWriteMethod = (method) => !['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
