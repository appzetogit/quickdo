import { Driver } from '../models/Driver.js';
import { config, env } from '../../../../config/env.js';

/**
 * Unified driver candidate selection for dispatch (Phase 3).
 *
 * Returns online, FREE (no activeAssignment), capable drivers near a point whose current work
 * mode accepts the given service. This is the single filter both the taxi and food dispatchers
 * use once UNIFIED_DISPATCH_ENABLED is on — the busy-lock (activeAssignment) is what guarantees
 * a driver on a ride is never offered a delivery and vice-versa.
 *
 * Called by food and quick-commerce dispatch (core/dispatch/unifiedDispatch.js) when the flag
 * is on; taxi matching applies the same filter inside its own query (matchingService).
 *
 * @param {'taxi'|'delivery'|'quickCommerce'} service  'delivery' is food
 * @param {[number,number]} coordinates  [lng, lat]
 * @param {object} opts { maxDistanceMeters, vehicleTypeIds, limit }
 */
export const findEligibleUnifiedDrivers = async (service, coordinates, opts = {}) => {
  const { maxDistanceMeters = 8000, vehicleTypeIds = null, limit = 20 } = opts;
  // workMode 'all' accepts everything. The one "Delivery" toggle covers food AND grocery, so a
  // grocery job is open to 'delivery' too; 'quickCommerce' is the retired grocery-only mode,
  // still honoured for drivers who stored it.
  const workModes = service === 'quickCommerce' ? ['all', 'delivery', 'quickCommerce'] : ['all', service];

  const match = {
    isOnline: true,
    serviceCapabilities: service,        // array-contains match
    workMode: { $in: workModes },
    activeAssignment: null,              // free only — the mutual-exclusion gate
    isOnRide: { $ne: true },             // belt and braces for rides taken before the lock existed
    approve: true,
    deletedAt: null,
  };

  if (service === 'taxi' && Array.isArray(vehicleTypeIds) && vehicleTypeIds.length) {
    match.vehicleTypeId = { $in: vehicleTypeIds };
  }

  return Driver.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates },
        distanceField: 'distanceMeters',
        maxDistance: maxDistanceMeters,
        spherical: true,
        // The Driver schema has TWO 2dsphere indexes (location, routeBooking.anchorLocation),
        // so $geoNear must be told which one to use or Mongo errors out.
        key: 'location',
        query: match,
      },
    },
    { $limit: limit },
  ]);
};

/** Whether the unified dispatch path is active. Both dispatchers check this before switching. */
export const isUnifiedDispatchEnabled = () => Boolean(config.unifiedDispatchEnabled || env.unifiedDispatchEnabled);
