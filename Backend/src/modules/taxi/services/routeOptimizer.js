const EARTH_RADIUS_METERS = 6371000;
const AVERAGE_SPEED_MPS = 8.33; // ~30 km/h in meters per second

/**
 * Calculates great-circle distance between two points on a sphere in meters.
 * Coordinates are [longitude, latitude].
 */
export const getHaversineDistance = (coords1, coords2) => {
  const [lng1, lat1] = coords1;
  const [lng2, lat2] = coords2;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

/**
 * Estimates duration in minutes for a given distance in meters.
 */
export const estimateTravelTimeMinutes = (distanceMeters) => {
  const seconds = distanceMeters / AVERAGE_SPEED_MPS;
  return Math.max(1, Math.round(seconds / 60));
};

/**
 * Helper to generate all permutations of an array.
 */
const permutate = (arr) => {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
    const subPerms = permutate(remaining);
    for (const sub of subPerms) {
      result.push([current].concat(sub));
    }
  }
  return result;
};

/**
 * Main route optimization function.
 * @param {Array} driverCoords [longitude, latitude]
 * @param {Array} rides Array of ride documents with pickup/drop locations and status
 * @param {Object} rules { maxDetourMeters, maxEtaIncreaseMinutes }
 */
export const findOptimalRouteSequence = (driverCoords, rides, rules = {}) => {
  const maxDetourMeters = Number(rules.maxDetourMeters || 5000);
  const maxEtaIncreaseMinutes = Number(rules.maxEtaIncreaseMinutes || 15);

  // 1. Identify remaining stops
  const stops = [];
  for (const ride of rides) {
    const isPickedUp = ride.status === 'picked_up' || ride.liveStatus === 'picked_up';

    if (!isPickedUp) {
      stops.push({
        type: 'pickup',
        rideId: String(ride._id),
        address: ride.pickupAddress,
        coordinates: ride.pickupLocation.coordinates,
        passengerName: ride.userId?.name || 'Passenger',
        otp: ride.otp,
      });
    }

    stops.push({
      type: 'drop',
      rideId: String(ride._id),
      address: ride.dropAddress,
      coordinates: ride.dropLocation.coordinates,
      passengerName: ride.userId?.name || 'Passenger',
      otp: ride.otp,
    });
  }

  if (stops.length === 0) {
    return [];
  }

  // 2. Generate all permutations
  const allPerms = permutate(stops);

  // 3. Filter valid sequences: Pickup must be before Drop for each rideId
  const validPerms = allPerms.filter((sequence) => {
    const seenPickups = new Set();
    for (const stop of sequence) {
      if (stop.type === 'pickup') {
        seenPickups.add(stop.rideId);
      } else if (stop.type === 'drop') {
        // If we have a pickup stop in the remaining set, we must see it first
        const hasPickup = stops.some(s => s.rideId === stop.rideId && s.type === 'pickup');
        if (hasPickup && !seenPickups.has(stop.rideId)) {
          return false;
        }
      }
    }
    return true;
  });

  let bestSequence = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  // 4. Evaluate each valid sequence against detour and ETA constraints
  for (const seq of validPerms) {
    let currentCoords = driverCoords;
    let totalDist = 0;
    const etaMapping = {}; // rideId -> cumulative minutes
    let timeAccumulator = 0;

    const stopETAMinutes = [];

    // Calculate path lengths
    for (const stop of seq) {
      const dist = getHaversineDistance(currentCoords, stop.coordinates);
      totalDist += dist;
      timeAccumulator += estimateTravelTimeMinutes(dist);

      stopETAMinutes.push({
        rideId: stop.rideId,
        type: stop.type,
        eta: timeAccumulator,
      });

      currentCoords = stop.coordinates;
    }

    // Validate detour thresholds for each ride
    let isValid = true;
    for (const ride of rides) {
      const rideIdStr = String(ride._id);
      const isPickedUp = ride.status === 'picked_up' || ride.liveStatus === 'picked_up';

      // Find direct distance
      const directDist = getHaversineDistance(ride.pickupLocation.coordinates, ride.dropLocation.coordinates);
      const directTime = estimateTravelTimeMinutes(directDist);

      // Find actual distance traveled in this sequence
      let rideDist = 0;
      let startTracking = isPickedUp; // if already inside car, we start tracking from start
      let segmentStartCoords = driverCoords;

      for (const stop of seq) {
        if (startTracking) {
          rideDist += getHaversineDistance(segmentStartCoords, stop.coordinates);
        }
        if (stop.rideId === rideIdStr) {
          if (stop.type === 'pickup') {
            startTracking = true;
            rideDist = 0; // reset to 0 to only measure distance from pickup
          } else if (stop.type === 'drop') {
            break;
          }
        }
        segmentStartCoords = stop.coordinates;
      }

      const detourMeters = rideDist - directDist;
      const actualRideTime = estimateTravelTimeMinutes(rideDist);
      const delayMinutes = actualRideTime - directTime;

      if (detourMeters > maxDetourMeters || delayMinutes > maxEtaIncreaseMinutes) {
        isValid = false;
        break;
      }
    }

    if (isValid && totalDist < bestDistance) {
      bestDistance = totalDist;
      // Populate ETA on stops
      let cumulativeTime = 0;
      let lastCoords = driverCoords;
      bestSequence = seq.map((stop) => {
        const stepDist = getHaversineDistance(lastCoords, stop.coordinates);
        cumulativeTime += estimateTravelTimeMinutes(stepDist);
        lastCoords = stop.coordinates;
        return {
          ...stop,
          etaMinutes: cumulativeTime,
          status: 'pending',
        };
      });
    }
  }

  // Fallback: If no sequence is within constraints, pick the absolute shortest distance sequence anyway
  if (!bestSequence && validPerms.length > 0) {
    let minFallbackDist = Number.POSITIVE_INFINITY;
    let fallbackSeq = null;

    for (const seq of validPerms) {
      let currentCoords = driverCoords;
      let totalDist = 0;
      for (const stop of seq) {
        totalDist += getHaversineDistance(currentCoords, stop.coordinates);
        currentCoords = stop.coordinates;
      }
      if (totalDist < minFallbackDist) {
        minFallbackDist = totalDist;
        fallbackSeq = seq;
      }
    }

    let cumulativeTime = 0;
    let lastCoords = driverCoords;
    bestSequence = fallbackSeq.map((stop) => {
      const stepDist = getHaversineDistance(lastCoords, stop.coordinates);
      cumulativeTime += estimateTravelTimeMinutes(stepDist);
      lastCoords = stop.coordinates;
      return {
        ...stop,
        etaMinutes: cumulativeTime,
        status: 'pending',
      };
    });
  }

  return bestSequence || [];
};
