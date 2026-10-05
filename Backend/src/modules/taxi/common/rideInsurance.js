/**
 * Ride insurance: plans an admin offers, which a rider may add to a booking.
 *
 * Pure functions only, shared by the admin API, the quote and the booking, and
 * checked without a database in __checks__/rideInsurance.check.js.
 *
 * Money rules (applied in rideService / walletService):
 *   - The premium is fixed when the ride is booked and snapshotted on it.
 *   - It is charged only when the ride completes, so a cancelled ride never
 *     pays it.
 *   - It is the platform's (owed to the insurer): no driver commission is taken
 *     on it, no driver earns it, and a promo never discounts it.
 */
export const PREMIUM_TYPES = Object.freeze(['flat', 'percent']);
export const MAX_PREMIUM_PERCENT = 50;

const money = (value) => Math.round(Number(value) * 100) / 100;
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter(Boolean))];

/** Empty vehicle_type_ids / zone_ids means every vehicle / every zone. */
export const planApplies = (plan, { vehicleTypeId, zoneId } = {}) => {
  if (!plan || plan.active === false) return false;
  const vehicles = (plan.vehicle_type_ids || []).map(String);
  const zones = (plan.zone_ids || []).map(String);
  if (vehicles.length && !(vehicleTypeId && vehicles.includes(String(vehicleTypeId)))) return false;
  if (zones.length && !(zoneId && zones.includes(String(zoneId)))) return false;
  return true;
};

/** The premium for a ride whose fare (surge included, before any promo) is `fare`. Whole rupees. */
export const premiumFor = (plan, fare) => {
  if (!plan) return 0;
  const value = Math.max(0, Number(plan.premium_value) || 0);
  if (plan.premium_type === 'percent') {
    return Math.round((Math.max(0, Number(fare) || 0) * value) / 100);
  }
  return Math.round(value);
};

/** What the app shows for a plan, with its premium for this fare. */
export const describePlan = (plan, fare) => ({
  id: String(plan._id || plan.id),
  name: plan.name,
  description: plan.description || '',
  provider: plan.provider || '',
  cover_amount: Number(plan.cover_amount || 0),
  terms_url: plan.terms_url || '',
  premium_type: plan.premium_type,
  premium_value: Number(plan.premium_value || 0),
  premium: premiumFor(plan, fare),
});

export const availablePlans = (plans = [], { vehicleTypeId, zoneId, fare }) =>
  plans
    .filter((plan) => planApplies(plan, { vehicleTypeId, zoneId }))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .map((plan) => describePlan(plan, fare));

/** The frozen record a booked ride carries. */
export const insuranceSnapshot = (plan, fare) => ({
  plan_id: plan._id || plan.id,
  name: plan.name,
  provider: plan.provider || '',
  cover_amount: Number(plan.cover_amount || 0),
  premium_type: plan.premium_type,
  premium_value: Number(plan.premium_value || 0),
  premium: premiumFor(plan, fare),
});

/** Checks an admin's plan; returns it cleaned or throws with a message. */
export const normalizeInsurancePlan = (input = {}) => {
  const fail = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  };
  const name = String(input.name || '').trim();
  const premiumType = String(input.premium_type || 'flat').trim();
  const premiumValue = Number(input.premium_value);
  const cover = Number(input.cover_amount || 0);
  const vehicleIds = input.all_vehicles === true ? [] : ids(input.vehicle_type_ids);

  if (!name) fail('Plan name is required');
  if (!PREMIUM_TYPES.includes(premiumType)) fail('Premium type must be flat or percent');
  if (!(premiumValue > 0)) fail('Premium must be more than 0');
  if (premiumType === 'percent' && premiumValue > MAX_PREMIUM_PERCENT) fail(`Premium cannot be more than ${MAX_PREMIUM_PERCENT}% of the fare`);
  if (!(cover >= 0)) fail('Cover amount must be 0 or more');
  if (input.all_vehicles !== true && vehicleIds.length === 0) fail('Choose vehicles, or apply to all vehicles');

  return {
    name: name.slice(0, 80),
    description: String(input.description || '').trim().slice(0, 500),
    provider: String(input.provider || '').trim().slice(0, 80),
    terms_url: String(input.terms_url || '').trim().slice(0, 500),
    cover_amount: money(cover),
    premium_type: premiumType,
    premium_value: money(premiumValue),
    vehicle_type_ids: vehicleIds,
    zone_ids: ids(input.zone_ids),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
    active: input.active !== false,
  };
};
