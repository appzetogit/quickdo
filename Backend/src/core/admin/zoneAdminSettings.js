import mongoose from 'mongoose';
import { sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { effectiveAdminLevel, effectiveServices, expandPermissions, canAdminDelete } from './adminAccessPolicy.js';
import { ADMIN_LEVELS } from './adminHierarchy.constants.js';

/**
 * Zone sub-admins in Master: a sub-admin runs their own zones' settings.
 *
 * A sub-admin (Master > Admin accounts) is limited to zones per module:
 *   food_zone_ids   Food zones
 *   qc_zone_ids     Quick and Medical zones
 *   taxi_zone_ids   Taxi zones
 * An empty list for a module they can open means every zone of that module.
 *
 * With the "Zone settings" permissions they may change Master settings -- but
 * only at ZONE level and only for their zones. Module-wide and all-modules
 * values stay head office's: they can read them, never change them. Owners and
 * superadmins are untouched by any of this.
 *
 * Enforced here, on the server, so it holds whatever the page shows.
 */

/** Which permission covers which setting. A key not listed is head office only. */
export const ZONE_SETTING_RESOURCE = Object.freeze({
    'earnings.formula': 'zone_earnings',
    'earnings.incentive': 'zone_earnings',
    'orders.cancelAfterAccept': 'zone_orders',
    'orders.cancelWindowMinutes': 'zone_orders',
    'orders.cancelStopWhenPreparing': 'zone_orders',
    'orders.holdSeconds': 'zone_orders',
    'fees.platformFee': 'zone_fees',
    'fees.platformFeeGstRate': 'zone_fees',
});
export const LADDER_RESOURCE = 'zone_incentives';

/** Which zone list covers which module (the settings' module names). */
const MODULE_ZONE_FIELD = Object.freeze({
    food: 'food_zone_ids',
    quickCommerce: 'qc_zone_ids',
    medical: 'qc_zone_ids',
    taxi: 'taxi_zone_ids',
});

const ids = (list) => (Array.isArray(list) ? list : []).map(String).filter((id) => mongoose.Types.ObjectId.isValid(id));

/**
 * Who is asking, as far as zone settings are concerned.
 * @returns {Promise<{restricted:boolean, admin:object|null, can:(resource:string, mode?:'read'|'write')=>boolean,
 *   zoneAllowed:(zoneId:string)=>Promise<boolean>, zoneIdsFor:(module:string)=>Promise<string[]|null>}>}
 */
export async function zoneAdminContext(req) {
    const id = req.user?.userId || req.user?.id;
    const admin = id ? await loadAdminCached(id) : null;
    const restricted = Boolean(admin) && effectiveAdminLevel(admin) === ADMIN_LEVELS.SUBADMIN;
    if (!restricted) {
        return {
            restricted: false,
            admin,
            can: () => true,
            zoneAllowed: async () => true,
            zoneIdsFor: async () => null,
        };
    }
    const perms = expandPermissions(admin.permissions);
    const services = effectiveServices(admin);
    const can = (resource, mode = 'write') => perms.includes('*') || perms.includes(`${resource}.${mode}`)
        || (mode === 'read' && perms.includes(`${resource}.write`));

    /** This admin's zones in a module; null = every zone of it; [] = none (no access). */
    const zoneIdsFor = async (module) => {
        const field = MODULE_ZONE_FIELD[module];
        if (!field) return [];
        const panelOpen = module === 'medical'
            ? services.includes('medical') || services.includes('quickCommerce')
            : services.includes(module);
        if (!panelOpen) return [];
        const own = ids(admin[field]);
        return own.length ? own : null;
    };

    const zoneAllowed = async (zoneId) => {
        const z = String(zoneId || '');
        if (!mongoose.Types.ObjectId.isValid(z)) return false;
        const { listZonesFor } = await import('../appServices/appServices.service.js');
        for (const module of Object.keys(MODULE_ZONE_FIELD)) {
            // eslint-disable-next-line no-await-in-loop
            const mine = await zoneIdsFor(module);
            if (mine === null) {
                // Every zone of this module: check the zone really is one of its zones.
                // eslint-disable-next-line no-await-in-loop
                const all = (await listZonesFor(module)) || [];
                if (all.some((zone) => zone.id === z)) return true;
            } else if (mine.includes(z)) {
                return true;
            }
        }
        return false;
    };

    return { restricted: true, admin, can, zoneAllowed, zoneIdsFor };
}

/**
 * The guard on /v1/platform/settings. Reads are open to every admin (they show
 * the page). A sub-admin may write only a zone-level value, for a zone of
 * theirs, of a setting their permissions cover. Ladder routes check their own
 * rules in their handlers (the zone is on the rule, not in the URL).
 */
export const zoneSettingsWriteGuard = async (req, res, next) => {
    try {
        const method = String(req.method || '').toUpperCase();
        if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();
        const ctx = await zoneAdminContext(req);
        if (!ctx.restricted) return next();
        req.zoneAdmin = ctx;

        const path = String(req.path || '');
        if (path.startsWith('/incentive-rules')) return next();

        const key = decodeURIComponent(path.replace(/^\//, ''));
        const resource = ZONE_SETTING_RESOURCE[key];
        if (method !== 'PUT' || !resource) {
            return sendError(res, 403, 'Only a superadmin can change this setting');
        }
        if (!ctx.can(resource, 'write')) {
            return sendError(res, 403, 'You do not have permission to change this setting for your zones');
        }
        const { level, scopeId } = req.body || {};
        if (level !== 'zone') {
            return sendError(res, 403, 'You can change this only for your own zones. Pick a zone first.');
        }
        if (!(await ctx.zoneAllowed(scopeId))) {
            return sendError(res, 403, 'That zone is not one of yours');
        }
        return next();
    } catch (err) {
        return next(err);
    }
};

/** For ladder deletes: a zone sub-admin also needs delete access. */
export const canDeleteLadder = (ctx) => !ctx.restricted || canAdminDelete(ctx.admin);
