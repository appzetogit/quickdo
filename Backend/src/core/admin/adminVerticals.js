import { ADMIN_LEVELS } from './adminHierarchy.constants.js';
import { effectiveAdminLevel, effectiveServices, expandPermissions } from './adminAccessPolicy.js';
import { resolveAdminModule } from './adminHierarchy.service.js';

/**
 * Which verticals an admin may see on the cross-vertical Master screens
 * (dashboard, reports, tax, insights, subscriptions, broadcasts).
 *
 * decideAdminAccess answers "may this admin use this vertical's own API", and lets
 * a module superadmin through for every service (requireServiceAccess is what
 * keeps it inside its module there). A screen that reads every vertical at once
 * has no such outer gate, so this applies both rules in one place:
 *
 *   platform superadmin   every vertical
 *   module superadmin     its own module, plus any vertical its servicesAccess names
 *                         (requireServiceAccess would let it into those anyway)
 *   sub-admin             the panels it was given (effectiveServices, plus
 *                         serviceProvider when listed), and only if it holds
 *                         `${resource}.read` (or .write when `write`)
 */
export const VERTICALS = ['food', 'quickCommerce', 'taxi', 'serviceProvider'];

export const VERTICAL_LABELS = {
    food: 'Food',
    quickCommerce: 'Quick Commerce',
    taxi: 'Taxi',
    serviceProvider: 'Services',
};

export function adminVerticals(admin, { resource = 'dashboard', write = false } = {}) {
    if (!admin || admin.isActive === false || admin.isDeleted === true) return [];
    const level = effectiveAdminLevel(admin);
    if (level === ADMIN_LEVELS.PLATFORM_SUPERADMIN) return [...VERTICALS];

    const listed = Array.isArray(admin.servicesAccess)
        ? admin.servicesAccess.map(String).filter((v) => VERTICALS.includes(v))
        : [];

    if (level !== ADMIN_LEVELS.SUBADMIN) {
        const own = new Set(listed);
        const module = resolveAdminModule(admin);
        if (module && VERTICALS.includes(module)) own.add(module);
        return VERTICALS.filter((v) => own.has(v));
    }

    const perms = expandPermissions(admin.permissions);
    const allowed = perms.includes('*')
        || perms.includes(`${resource}.write`)
        || (!write && perms.includes(`${resource}.read`));
    if (!allowed) return [];
    const services = new Set(effectiveServices(admin));
    if (listed.includes('serviceProvider')) services.add('serviceProvider');
    return VERTICALS.filter((v) => services.has(v));
}

/**
 * The verticals a request asks for, narrowed to what the admin may see.
 * `requested` is one vertical key, a comma list, 'all' or empty.
 */
export function pickVerticals(admin, requested, opts) {
    const allowed = adminVerticals(admin, opts);
    const want = String(requested || '').trim();
    if (!want || want === 'all') return allowed;
    const asked = want.split(',').map((s) => s.trim()).filter(Boolean);
    return allowed.filter((v) => asked.includes(v));
}
