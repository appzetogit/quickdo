/**
 * How long until a food order arrives.
 *
 * The apps used to show "Calculating…" for the whole delivery because nothing
 * ever calculated. This is that number, and it is worked out on every read
 * rather than stored: the only input that moves is the rider, so a stored
 * figure would be stale the moment they did.
 *
 * Deliberately modest about its own accuracy. There is no routing call here --
 * a straight line with a detour factor, at a flat city speed. That is honest
 * to within a few minutes on a 3 km delivery, costs nothing, and cannot fail.
 * `source` says which kind of answer this is so the apps can word it: `live`
 * is measured from the rider's real position, `estimate` is from the
 * restaurant before anyone has picked it up.
 *
 * Before pickup the customer is waiting for BOTH legs -- the rider still has
 * to reach the restaurant -- so both are counted. Showing only the leg to the
 * restaurant is how an order "arriving in 4 minutes" turns up in twenty.
 */

/** Roads wander; a straight line is always short. */
const ROAD_FACTOR = 1.3;

/** City average, including lights and turns. */
const CITY_SPEED_KMPH = 20;

/** What a restaurant takes to cook, when nothing better is known. */
const DEFAULT_PREP_MINUTES = 15;

const EARTH_RADIUS_KM = 6371;

const FINISHED_STATUSES = new Set([
  'delivered',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
]);

/** After these, the rider is carrying the food and heads for the customer. */
const CARRYING_STATUSES = new Set(['picked_up', 'reached_drop']);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * A `{lat, lng}` from any of the shapes an order carries one in: GeoJSON
 * `[lng, lat]`, `{latitude, longitude}`, or a plain `{lat, lng}`.
 */
export const readPoint = (source) => {
  if (!source) return null;

  const pair = Array.isArray(source)
    ? source
    : Array.isArray(source.coordinates)
      ? source.coordinates
      : null;

  if (pair && pair.length >= 2) {
    // GeoJSON is [longitude, latitude] -- the other way round from everywhere
    // else, and the usual cause of a delivery measured to the wrong continent.
    const lng = toNumber(pair[0]);
    const lat = toNumber(pair[1]);
    if (lat === null || lng === null) return null;
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
  }

  const lat = toNumber(source.lat ?? source.latitude);
  const lng = toNumber(source.lng ?? source.lon ?? source.longitude);
  if (lat === null || lng === null) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
};

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Crow-flies kilometres between two points, or null if either is missing. */
export const straightLineKm = (from, to) => {
  const a = readPoint(from);
  const b = readPoint(to);
  if (!a || !b) return null;

  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** The same distance with a detour factor, rounded the way it is reported. */
export const roadKm = (from, to) => {
  const straight = straightLineKm(from, to);
  if (straight === null) return null;
  return Math.round(straight * ROAD_FACTOR * 100) / 100;
};

/** Minutes for [km] at city speed. Never 0 -- an arriving rider is "1 min". */
const minutesFor = (km) => Math.max(1, Math.ceil((km / CITY_SPEED_KMPH) * 60));

const restaurantPoint = (order) => {
  const restaurant = order?.restaurantId;
  if (!restaurant || typeof restaurant !== 'object') return null;
  return (
    readPoint(restaurant.location) ||
    readPoint(restaurant.address?.location) ||
    readPoint(restaurant)
  );
};

const customerPoint = (order) =>
  readPoint(order?.deliveryAddress?.location) || readPoint(order?.deliveryAddress);

const riderPoint = (order) =>
  readPoint(order?.lastRiderLocation) ||
  readPoint(order?.deliveryState?.currentLocation) ||
  readPoint(order?.dispatch?.lastLocation);

/**
 * `{source, target, minutes, distanceKm, tripDistanceKm}` for [order].
 *
 * `source` is one of:
 *   `live`        measured from where the rider actually is;
 *   `estimate`    no rider yet, so prep time plus the trip;
 *   `completed`   delivered or cancelled, nothing to wait for;
 *   `unavailable` not enough pinned locations to say anything honest.
 *
 * `target` is who the `minutes` are until the rider reaches -- `restaurant`
 * while they are still collecting, `customer` once they are carrying. The
 * minutes are always until the FOOD arrives either way.
 *
 * `tripDistanceKm` is the restaurant-to-customer leg on its own, which is what
 * a rider judges an offer by.
 */
export const buildOrderEta = (order, { prepMinutes = DEFAULT_PREP_MINUTES } = {}) => {
  const nothing = {
    source: 'unavailable',
    target: null,
    minutes: null,
    distanceKm: null,
    tripDistanceKm: null,
  };

  if (!order) return nothing;

  const status = String(order.orderStatus || '').toLowerCase();
  const restaurant = restaurantPoint(order);
  const customer = customerPoint(order);
  const tripDistanceKm = roadKm(restaurant, customer);

  if (FINISHED_STATUSES.has(status)) {
    return {
      source: 'completed',
      target: null,
      minutes: null,
      distanceKm: null,
      tripDistanceKm,
    };
  }

  if (!customer) return nothing;

  const rider = riderPoint(order);

  if (rider) {
    if (CARRYING_STATUSES.has(status)) {
      const distanceKm = roadKm(rider, customer);
      if (distanceKm === null) return nothing;
      return {
        source: 'live',
        target: 'customer',
        minutes: minutesFor(distanceKm),
        distanceKm,
        tripDistanceKm,
      };
    }

    // Still collecting. The distance reported is the leg they are on, but the
    // minutes cover both legs, because that is what the customer is waiting.
    const legToRestaurant = roadKm(rider, restaurant);
    if (legToRestaurant !== null) {
      return {
        source: 'live',
        target: 'restaurant',
        minutes: minutesFor(legToRestaurant + (tripDistanceKm ?? 0)),
        distanceKm: legToRestaurant,
        tripDistanceKm,
      };
    }
  }

  if (tripDistanceKm === null) return nothing;

  // Nobody assigned yet: the food still has to be cooked, then carried.
  return {
    source: 'estimate',
    target: 'customer',
    minutes: Math.max(1, Math.round(prepMinutes) + minutesFor(tripDistanceKm)),
    distanceKm: tripDistanceKm,
    tripDistanceKm,
  };
};
