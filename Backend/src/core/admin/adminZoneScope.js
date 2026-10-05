import mongoose from 'mongoose';
import { effectiveAdminLevel } from './adminAccessPolicy.js';
import { ADMIN_LEVELS } from './adminHierarchy.constants.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';

/**
 * Zones a sub-admin is limited to, per vertical (admin accounts form, "Zones").
 *
 *   food           -> admin.food_zone_ids  (food_zones)
 *   quickCommerce  -> admin.qc_zone_ids    (qc_zones; medical uses the same)
 *
 * An empty list means every zone. For a limited sub-admin this middleware puts
 * the list on req.query.scopeZoneIds, which the dashboard, store list and order
 * list of that vertical apply; a zoneId outside the list matches nothing.
 * Taxi has its own scoping by service location.
 */
const FIELD = { food: 'food_zone_ids', quickCommerce: 'qc_zone_ids' };
const NOTHING = '000000000000000000000000';

export const adminZoneIds = (admin, vertical) =>
  (Array.isArray(admin?.[FIELD[vertical]]) ? admin[FIELD[vertical]] : []).map(String).filter((id) => mongoose.Types.ObjectId.isValid(id));

export function adminZoneScope(vertical) {
  return async (req, _res, next) => {
    try {
      const admin = await loadAdminCached(req.user?.userId || req.user?.id);
      if (!admin || effectiveAdminLevel(admin) !== ADMIN_LEVELS.SUBADMIN) return next();
      const zones = adminZoneIds(admin, vertical);
      if (!zones.length) return next();
      req.query.scopeZoneIds = zones;
      const asked = String(req.query.zoneId || '').trim();
      if (asked && asked !== 'global' && !zones.includes(asked)) req.query.zoneId = NOTHING;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Mongo match for a zoneId field: the asked zone, else the admin's zones, else null (no limit). */
export function zoneMatchFrom(query = {}) {
  const asked = String(query.zoneId || '').trim();
  if (asked && mongoose.Types.ObjectId.isValid(asked)) return new mongoose.Types.ObjectId(asked);
  const scope = Array.isArray(query.scopeZoneIds) ? query.scopeZoneIds : [];
  if (scope.length) return { $in: scope.map((id) => new mongoose.Types.ObjectId(String(id))) };
  return null;
}
