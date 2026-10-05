import { FoodDeliveryPartner } from '../../food/delivery/models/deliveryPartner.model.js';

/**
 * Resolves a food delivery-partner identity to its unified taxi Driver.
 *
 * One person, two documents: a driver who signs in through the delivery app
 * gets a food-issued token (role DELIVERY_PARTNER, sub = partner id), but every
 * /taxi route and the dispatch socket room key off the taxi Driver id. Without
 * this translation the delivery app is refused by /taxi/* and never joins
 * driver:<id>, so no ride can ever reach it.
 *
 * Returns the original payload untouched for any other role, and for a partner
 * that has not been linked by the unification backfill — those are rejected
 * exactly as they were before, rather than silently gaining taxi access.
 */
export const resolveUnifiedDriverIdentity = async (payload) => {
  if (String(payload?.role || '').toUpperCase() !== 'DELIVERY_PARTNER') {
    return payload;
  }

  const partnerId = payload.sub || payload.userId || payload.id;
  if (!partnerId) return payload;

  const partner = await FoodDeliveryPartner.findById(partnerId)
    .select('driverId status')
    .lean();

  if (!partner?.driverId) return payload;
  // A rider the food admin rejected must not ride on as a taxi driver through
  // this bridge: the taxi Driver record keeps approve=true on its own.
  if (partner.status !== 'approved') return payload;

  return { ...payload, sub: String(partner.driverId), role: 'driver' };
};
