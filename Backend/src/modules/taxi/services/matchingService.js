import { ApiError } from '../../../utils/ApiError.js';
import { config } from '../../../config/env.js';
import { normalizePoint } from '../../../utils/geo.js';
import { DISPATCH_TOP_DRIVERS } from '../constants/index.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { Driver } from '../driver/models/Driver.js';
import { Zone } from '../driver/models/Zone.js';
import { getDriverIdsBlockedByUpcomingScheduledRides } from './rideService.js';
import { compareInBackground } from '../../../core/finance/eligibilityShadow.js';

const EARTH_RADIUS_METERS = 6371000;

const normalizeVehicleKey = (value = '') => String(value || '').trim().toLowerCase();

const normalizeVehicleKeys = (vehicles = []) => {
  const keys = vehicles.flatMap((vehicle) => [
    vehicle?.name,
    vehicle?.vehicle_type,
    vehicle?.icon_types,
    String(vehicle?.name || '').replace(/\s+/g, '_'),
    String(vehicle?.icon_types || '').replace(/\s+/g, '_'),
  ]);

  return [...new Set(keys.map(normalizeVehicleKey).filter(Boolean))];
};

const normalizeVehicleTypeIds = (vehicleTypeIds = [], vehicleTypeId = null) => {
  const values = Array.isArray(vehicleTypeIds) ? vehicleTypeIds : [vehicleTypeIds];

  if (vehicleTypeId) {
    values.push(vehicleTypeId);
  }

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
};

export const buildDriverMatchFilters = ({ zoneId, vehicleTypeId, vehicleTypeIds, vehicleTypeKeys, transportType, serviceType }) => {
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const normalizedVehicleTypeKeys = Array.isArray(vehicleTypeKeys)
    ? [...new Set(vehicleTypeKeys.map(normalizeVehicleKey).filter(Boolean))]
    : [];
  const vehicleTypeClauses = [
    ...(normalizedVehicleTypeIds.length ? [{ vehicleTypeId: { $in: normalizedVehicleTypeIds } }] : []),
    ...(normalizedVehicleTypeKeys.length
      ? [
          { vehicleType: { $in: normalizedVehicleTypeKeys } },
          { vehicleIconType: { $in: normalizedVehicleTypeKeys } },
        ]
      : []),
  ];
  const vehicleTypeFilter =
    vehicleTypeClauses.length > 1
      ? { $or: vehicleTypeClauses }
      : vehicleTypeClauses[0] || {};

  let transportFilter = {};
  // A parcel goes to whoever holds the parcel capability (filtered below),
  // whatever they first registered for: a delivery rider who carries bike
  // parcels is registered for delivery, not taxi.
  const isParcelJob = String(serviceType || '').trim().toLowerCase() === 'parcel';
  if (transportType && !isParcelJob) {
    if (transportType === 'taxi') {
      transportFilter = { registerFor: { $in: ['taxi', 'both', 'all'] } };
    } else if (transportType === 'delivery') {
      transportFilter = { registerFor: { $in: ['delivery', 'both', 'all'] } };
    } else if (transportType === 'intercity' || transportType === 'outstation') {
      transportFilter = {
        $or: [
          { registerFor: { $in: ['intercity', 'outstation', 'all'] } },
          {
            registerFor: { $in: ['taxi', 'both', 'all'] },
            serviceCategories: { $in: ['outstation', 'Outstation', 'intercity', 'Intercity'] }
          }
        ]
      };
    } else {
      transportFilter = { registerFor: { $in: [transportType, 'both', 'all'] } };
    }
  }

  const baseFilters = {
    isOnline: true,
    'wallet.isBlocked': { $ne: true },
    // Only approved, live accounts. A driver an admin suspended stayed online
    // and kept receiving rides (the REST routes refused them; this did not).
    approve: { $ne: false },
    deletedAt: null,
    isOnRide: false,
    ...(zoneId ? { zoneId } : {}),
  };

  // Driver unification: honor the work-mode toggle and the cross-service busy-lock, so a driver
  // set to "deliveries only" — or already out on a food order — is never offered a ride.
  // Flag-gated; legacy behavior is untouched while UNIFIED_DISPATCH_ENABLED is off.
  if (config.unifiedDispatchEnabled) {
    baseFilters.workMode = { $in: ['all', 'taxi'] };
    // A parcel is not a passenger. Asking for the taxi capability on a
    // parcel job matched the wrong people in both directions: a
    // parcel-only driver got nothing, and a passenger driver got boxes.
    baseFilters.serviceCapabilities =
      String(serviceType || '').trim().toLowerCase() === 'parcel' ? 'parcel' : 'taxi';
    baseFilters.activeAssignment = null;
  }

  const andClauses = [];

  if (Object.keys(vehicleTypeFilter).length > 0) {
    andClauses.push(vehicleTypeFilter);
  }
  
  if (Object.keys(transportFilter).length > 0) {
    andClauses.push(transportFilter);
  }

  if (andClauses.length > 1) {
    return { ...baseFilters, $and: andClauses };
  } else if (andClauses.length === 1) {
    return { ...baseFilters, ...andClauses[0] };
  }

  return baseFilters;
};

/**
 * Whether [lng, lat] lies inside a GeoJSON Polygon / MultiPolygon (outer rings;
 * ray casting). Used to keep ride requests with drivers who are physically in
 * the pickup's zone, not merely registered to it.
 */
export const pointInZoneGeometry = (point, geometry) => {
  const [x, y] = Array.isArray(point) ? point.map(Number) : [NaN, NaN];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !geometry) return false;
  const polygons = geometry.type === 'MultiPolygon'
    ? geometry.coordinates
    : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
  return polygons.some((rings) => {
    const ring = Array.isArray(rings?.[0]) ? rings[0] : [];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i].map(Number);
      const [xj, yj] = ring[j].map(Number);
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
};

export const findZoneByPickup = async (pickupCoords) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');

  // Zones are authoritative for dispatch, so every pickup must belong to one polygon.
  return Zone.findOne({
    geometry: {
      $geoIntersects: {
        $geometry: {
          type: 'Point',
          coordinates,
        },
      },
    },
  });
};

/**
 * A city ride starts and ends inside one service zone (client rule 2026-09-30):
 * the drop, and every stop, must lie in the pickup's zone. Throws a 400 the app
 * shows as-is. Intercity trips and outstation parcels are meant to leave the
 * zone and are not checked. Skipped while no zone exists, so a server not yet
 * set up keeps working.
 */
export const assertTripInsidePickupZone = async ({ pickupCoords, dropCoords, stops = [] }) => {
  if ((await Zone.estimatedDocumentCount()) === 0) return null;
  const zone = await findZoneByPickup(pickupCoords);
  if (!zone) {
    throw new ApiError(400, 'Rides are not available at this pickup location yet. Please choose a pickup inside our service area.');
  }
  const zoneName = zone.name ? ` (${zone.name})` : '';
  const drop = normalizePoint(dropCoords, 'dropCoords');
  if (!pointInZoneGeometry(drop, zone.geometry)) {
    throw new ApiError(400, `This drop location is outside your pickup's service area${zoneName}. Please choose a drop inside the same area.`);
  }
  for (const stop of Array.isArray(stops) ? stops : []) {
    const point = stop?.coordinates || stop?.location?.coordinates || (stop && stop.lat != null && (stop.lng ?? stop.lon) != null ? [stop.lng ?? stop.lon, stop.lat] : stop);
    let coords;
    try { coords = normalizePoint(point, 'stop'); } catch { continue; }
    if (!pointInZoneGeometry(coords, zone.geometry)) {
      throw new ApiError(400, `A stop on this trip is outside your pickup's service area${zoneName}. Please keep every stop inside the same area.`);
    }
  }
  return zone;
};

const toLocalMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;
  const originLatRadians = (originLat * Math.PI) / 180;
  const metersPerDegreeLat = (Math.PI * EARTH_RADIUS_METERS) / 180;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(originLatRadians);

  return {
    x: (targetLng - originLng) * metersPerDegreeLng,
    y: (targetLat - originLat) * metersPerDegreeLat,
  };
};

const getDistanceToSegmentMeters = (origin, segmentStart, segmentEnd) => {
  const start = toLocalMeters(origin, segmentStart);
  const end = toLocalMeters(origin, segmentEnd);
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = (segmentX * segmentX) + (segmentY * segmentY);

  if (segmentLengthSquared <= 0) {
    return Math.hypot(start.x, start.y);
  }

  const projection = Math.max(
    0,
    Math.min(1, -((start.x * segmentX) + (start.y * segmentY)) / segmentLengthSquared),
  );
  const closestX = start.x + (projection * segmentX);
  const closestY = start.y + (projection * segmentY);

  return Math.hypot(closestX, closestY);
};

const getZoneBoundaryCapMeters = (zone, pickupCoords) => {
  const ring = Array.isArray(zone?.geometry?.coordinates?.[0]) ? zone.geometry.coordinates[0] : [];

  if (ring.length < 3) {
    return null;
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const segmentStart = normalizePoint(ring[index], `zone.geometry.coordinates[0][${index}]`);
    const segmentEnd = normalizePoint(ring[index + 1], `zone.geometry.coordinates[0][${index + 1}]`);
    const distanceMeters = getDistanceToSegmentMeters(pickupCoords, segmentStart, segmentEnd);

    if (Number.isFinite(distanceMeters) && distanceMeters < shortestDistance) {
      shortestDistance = distanceMeters;
    }
  }

  return Number.isFinite(shortestDistance) ? Math.max(0, Math.round(shortestDistance)) : null;
};

const getDistanceBetweenMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;

  const dLat = ((targetLat - originLat) * Math.PI) / 180;
  const dLng = ((targetLng - originLng) * Math.PI) / 180;
  const lat1 = (originLat * Math.PI) / 180;
  const lat2 = (targetLat * Math.PI) / 180;

  const a =
    (Math.sin(dLat / 2) ** 2) +
    (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2));

  return Math.round(2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const buildGeoNearFilter = (field, coordinates, maxDistance) => ({
  [field]: {
    $near: {
      $geometry: {
        type: 'Point',
        coordinates,
      },
      $maxDistance: maxDistance,
    },
  },
});

const getDispatchAnchorCoordinates = (driver = {}) => {
  const routeCoordinates = Array.isArray(driver?.routeBooking?.anchorLocation?.coordinates)
    ? driver.routeBooking.anchorLocation.coordinates
    : [];

  if (driver?.routeBooking?.enabled && routeCoordinates.length === 2) {
    return routeCoordinates;
  }

  return Array.isArray(driver?.location?.coordinates) ? driver.location.coordinates : [];
};

const sortDriversByDispatchAnchorDistance = (drivers = [], pickupCoords) =>
  [...drivers]
    .map((driver) => {
      const anchorCoordinates = getDispatchAnchorCoordinates(driver);
      return {
        driver,
        distanceMeters:
          anchorCoordinates.length === 2
            ? getDistanceBetweenMeters(pickupCoords, anchorCoordinates)
            : Number.POSITIVE_INFINITY,
      };
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .map(({ driver }) => driver);

const findDriversForZone = async ({
  zoneId,
  coordinates,
  effectiveMaxDistance,
  limit,
  normalizedVehicleTypeIds,
  vehicleTypeKeys,
  transportType,
  serviceType,
}) => {
  const commonFilters = buildDriverMatchFilters({
    zoneId,
    vehicleTypeIds: normalizedVehicleTypeIds,
    vehicleTypeKeys,
    transportType,
    serviceType,
  });
  const selectedFields =
    'name phone socketId vehicleTypeId vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel rating location zoneId isOnline isOnRide routeBooking';

  const [liveLocationDrivers, routeBookingDrivers] = await Promise.all([
    Driver.find({
      ...commonFilters,
      'routeBooking.enabled': { $ne: true },
      ...buildGeoNearFilter('location', coordinates, effectiveMaxDistance),
    })
      .limit(limit)
      .select(selectedFields),
    Driver.find({
      ...commonFilters,
      'routeBooking.enabled': true,
      'routeBooking.anchorLocation': { $ne: null },
      'routeBooking.anchorLocation.coordinates.1': { $exists: true },
      ...buildGeoNearFilter('routeBooking.anchorLocation', coordinates, effectiveMaxDistance),
    })
      .limit(limit)
      .select(selectedFields),
  ]);

  return sortDriversByDispatchAnchorDistance(
    [...liveLocationDrivers, ...routeBookingDrivers].filter(
      (driver, index, items) => items.findIndex((item) => String(item._id) === String(driver._id)) === index,
    ),
    coordinates,
  ).slice(0, limit);
};

export const matchDrivers = async (pickupCoords, options = {}) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');
  const {
    maxDistance = 3000,
    limit = DISPATCH_TOP_DRIVERS,
    vehicleTypeId,
    vehicleTypeIds,
    transportType,
    serviceType,
  } = options;
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const allowedVehicles = normalizedVehicleTypeIds.length
    ? await Vehicle.find({ _id: { $in: normalizedVehicleTypeIds } }).select('name vehicle_type icon_types').lean()
    : [];
  const vehicleTypeKeys = normalizeVehicleKeys(allowedVehicles);

  const zone = await findZoneByPickup(coordinates);
  const zoneBoundaryCapMeters = zone ? getZoneBoundaryCapMeters(zone, coordinates) : null;
  const effectiveMaxDistance = Math.max(1, Math.round(maxDistance));

  let drivers = await findDriversForZone({
    zoneId: zone?._id || null,
    coordinates,
    effectiveMaxDistance:
      zoneBoundaryCapMeters && zoneBoundaryCapMeters < effectiveMaxDistance
        ? zoneBoundaryCapMeters
        : effectiveMaxDistance,
    limit,
    normalizedVehicleTypeIds,
    vehicleTypeKeys,
    transportType,
    serviceType,
  });

  const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
    drivers.map((driver) => String(driver?._id || '')),
  );
  drivers = drivers.filter((driver) => !blockedDriverIds.has(String(driver?._id || '')));

  /*
   * Nobody found inside the zone-boundary radius. Widen the radius -- never the
   * zone.
   *
   * The first search caps its radius at the distance to the nearest zone
   * boundary, a geometric way of not reaching past the zone edge. That cap can
   * be small for a pickup near the edge and exclude drivers who are genuinely
   * in the zone but further in, which is what this retry is for.
   *
   * It used to pass `zoneId: null` as well, which dropped the zone filter
   * outright and matched drivers in a NEIGHBOURING zone as long as they were
   * within maxDistance of the pickup. That is the cross-zone dispatch that was
   * reported. The zone is kept now, so this only relaxes the distance.
   */
  if (drivers.length === 0 && zone?._id) {
    drivers = await findDriversForZone({
      zoneId: zone._id,
      coordinates,
      effectiveMaxDistance,
      limit,
      normalizedVehicleTypeIds,
      vehicleTypeKeys,
      transportType,
      serviceType,
    });

    const fallbackBlockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
      drivers.map((driver) => String(driver?._id || '')),
    );
    drivers = drivers.filter((driver) => !fallbackBlockedDriverIds.has(String(driver?._id || '')));
  }

  // Development Fallback: If still no matching drivers are found, make a dummy/existing driver online
  // and place them at the pickup location with matching vehicle configuration.
  // ponytail: guarded off in production so a real driver is never hijacked/teleported.
  // Opt in for local/dev by setting ENABLE_DEV_DRIVER_FALLBACK=true.
  const devFallbackEnabled =
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_DEV_DRIVER_FALLBACK === 'true';
  if (drivers.length === 0 && devFallbackEnabled) {
    console.log('[matchDrivers] No matching drivers found. Triggering development fallback...');
    const fallbackDriver = await Driver.findOne({});
    if (fallbackDriver) {
      fallbackDriver.isOnline = true;
      fallbackDriver.isOnRide = false;
      fallbackDriver.approve = true;
      fallbackDriver.status = 'approved';
      fallbackDriver.active = true;
      fallbackDriver.location = {
        type: 'Point',
        coordinates,
      };
      
      const targetVehicleTypeId = vehicleTypeId || (vehicleTypeIds && vehicleTypeIds[0]) || null;
      if (targetVehicleTypeId) {
        fallbackDriver.vehicleTypeId = targetVehicleTypeId;
        const vehicle = await Vehicle.findById(targetVehicleTypeId).lean();
        if (vehicle) {
          const allowedVehicleTypes = ['bike', 'auto', 'car'];
          let mappedVehicleType = 'car';
          const rawType = (vehicle.icon_types || vehicle.icon || '').toLowerCase();
          if (allowedVehicleTypes.includes(rawType)) {
            mappedVehicleType = rawType;
          } else {
            const nameLower = (vehicle.name || '').toLowerCase();
            if (nameLower.includes('bike') || nameLower.includes('motorcycle')) {
              mappedVehicleType = 'bike';
            } else if (nameLower.includes('auto') || nameLower.includes('rickshaw')) {
              mappedVehicleType = 'auto';
            }
          }
          fallbackDriver.vehicleType = mappedVehicleType;
          fallbackDriver.vehicleIconType = vehicle.icon_types || vehicle.icon || 'car';
        }
      }
      
      fallbackDriver.zoneId = zone?._id || null;
      if (fallbackDriver.wallet) {
        fallbackDriver.wallet.isBlocked = false;
        fallbackDriver.wallet.amount = Math.max(fallbackDriver.wallet.amount || 0, 1000);
      }
      await fallbackDriver.save();
      console.log(`[matchDrivers Fallback] Made driver ${fallbackDriver.name} online at coordinates ${coordinates}`);

      // Query again to get this driver
      drivers = await findDriversForZone({
        zoneId: null,
        coordinates,
        effectiveMaxDistance,
        limit,
        normalizedVehicleTypeIds,
        vehicleTypeKeys,
        transportType,
        serviceType,
      });

      const fallbackBlockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
        drivers.map((driver) => String(driver?._id || '')),
      );
      drivers = drivers.filter((driver) => !fallbackBlockedDriverIds.has(String(driver?._id || '')));
    }
  }

  /*
   * Only drivers standing inside the pickup's zone right now. The queries above
   * match on the driver's registered zone and a radius around the pickup, and a
   * radius is a circle: near a boundary it reaches into the next zone, and a
   * driver registered here but parked across the line was offered the ride.
   */
  if (zone?.geometry) {
    drivers = drivers.filter((driver) => pointInZoneGeometry(driver?.location?.coordinates, zone.geometry));
  }

  /*
   * Measure the master eligibility engine against this selection. Decides nothing.
   *
   * Taxi is the vertical with the most to learn from this. The filter above checks
   * `wallet.isBlocked` -- a cached flag, refreshed only when something happens to
   * touch the wallet -- and no cash figure at all, so a driver holding Rs 1,900
   * collected on food and grocery runs is offered rides all day. The real gate
   * runs later, in ensureDriverWalletCanAcceptRide at ACCEPT, which is too late to
   * keep them out of the candidate set.
   *
   * Expect WOULD_BLOCK lines here that are genuine holes being closed rather than
   * regressions. Read them before enforcing: switching a cash ceiling on for a
   * fleet that has never had one can stop drivers earning on the day it ships.
   *
   * A ride collects no platform cash at dispatch time, so exposure is 0 -- this
   * measures the ceiling they are ALREADY at, not one this ride would push them to.
   */
  compareInBackground({
    vertical: 'taxi',
    candidates: drivers.map((d) => ({ partnerId: d?._id, distanceKm: d?.distanceMeters ? d.distanceMeters / 1000 : undefined })),
    legacyEligible: drivers.map((d) => ({ partnerId: d?._id })),
    jobId: zone?._id || null,
    jobCashExposure: 0,
  });

  return {
    zone,
    drivers,
    searchRadiusMeters: effectiveMaxDistance,
    zoneBoundaryCapMeters,
  };
};
