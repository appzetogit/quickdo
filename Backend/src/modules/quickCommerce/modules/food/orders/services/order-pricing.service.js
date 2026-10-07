import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { resolveEarningSlabs } from '../../../../../../core/finance/deliveryEarnings.service.js';
import { resolveDeliveryFormula, priceDelivery } from '../../../../../../core/finance/deliveryFormula.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
  calculateDistanceKm,
  normalizeDeliveryAddress,
  normalizeRestaurantLocation,
  parseGeoPoint,
} from '../../shared/geo.utils.js';
import { fetchDrivingRoute } from '../utils/googleMaps.js';
import { attachOutletTimingsToRestaurants } from '../../restaurant/services/outletTimings.service.js';
import { getRestaurantAvailabilityStatus } from '../../restaurant/helpers/restaurantAvailability.helper.js';
import { resolveOrderCartItems } from '../helpers/order-cart-items.helper.js';
import { AVG_SPEED_KMPH, PACKING_MINUTES } from './order.helpers.js';
import { withMasterFees } from '../../../../../../core/finance/platformFees.service.js';
import { findZoneForPoint, readAddressPoint, ZONE_VERTICALS } from '../../shared/zoneServiceability.js';
import { isLegacyPharmacy } from '../../shared/storeType.js';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Fixed 18% GST on delivery fee (separate from item GST in fee settings). */
export const DELIVERY_FEE_GST_RATE = 0.18;

export function computeDeliveryFeeGst(deliveryFee) {
  const base = Math.max(0, Number(deliveryFee) || 0);
  if (base <= 0) return 0;
  return round2(base * DELIVERY_FEE_GST_RATE);
}

const applyDeliveryModePricing = (pricing, deliveryMode, quickSurcharge = 0) => {
  const surcharge = Math.max(0, Number(quickSurcharge) || 0);
  const mode = deliveryMode === 'quick' ? 'quick' : 'basic';
  if (mode !== 'quick' || surcharge <= 0) {
    return {
      ...pricing,
      deliveryMode: mode,
      quickDeliveryFee: 0,
    };
  }
  const platformFee = round2((Number(pricing.platformFee) || 0) + surcharge);
  const total = round2((Number(pricing.total) || 0) + surcharge);
  return {
    ...pricing,
    platformFee,
    total,
    deliveryMode: mode,
    quickDeliveryFee: surcharge,
  };
};

export async function loadRestaurantForOrdering(restaurantId) {
  if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
    throw new ValidationError('Restaurant not found');
  }

  const doc = await FoodRestaurant.findById(restaurantId)
    .select(
      // autoAcceptOrders is read at order creation to decide whether the order
      // waits for a seller. Left out of this projection it is always undefined,
      // so the flag silently does nothing however it is set.
      // storeType: legacy pharmacies are refused below.
      'status restaurantName zoneId location city state area isAcceptingOrders autoAcceptOrders outsideHoursOverride openingTime closingTime openDays deliveryTimings isActive storeType',
    )
    .lean();

  if (!doc) throw new ValidationError('Restaurant not found');
  if (doc.status !== 'approved') throw new ValidationError('Restaurant not available');
  // A legacy pharmacy (the Medical vertical was removed) takes no orders, even
  // from an app that still had it on screen.
  if (isLegacyPharmacy(doc.storeType)) {
    throw new ValidationError('This store is not taking orders right now.');
  }

  const [withTimings] = await attachOutletTimingsToRestaurants([doc], {
    useDefaults: false,
  });
  if (withTimings?.location) {
    withTimings.location = normalizeRestaurantLocation(withTimings.location);
  }
  return withTimings;
}

export function assertRestaurantOpenForOrdering(restaurant, at = new Date()) {
  const availability = getRestaurantAvailabilityStatus(restaurant, at);
  if (availability.isOpen) return availability;

  if (availability.reason === 'not-accepting-orders') {
    throw new ValidationError('Restaurant is currently offline. Please try again later.');
  }

  throw new ValidationError('Restaurant is currently closed. Please try again later.');
}

/**
 * Single source of truth for restaurant ↔ customer trip distance.
 * Prefer Google driving/road km (matches delivery partner Rest→User UI);
 * fall back to Haversine when Directions is unavailable.
 */
export async function getDeliveryDistanceKm(restaurant, deliveryAddress) {
  const straightLineKm = calculateDistanceKm(restaurant, deliveryAddress);

  const restaurantPoint = parseGeoPoint(restaurant);
  const customerPoint = parseGeoPoint(deliveryAddress);
  if (!restaurantPoint || !customerPoint) {
    return straightLineKm;
  }

  try {
    const route = await fetchDrivingRoute(
      { lat: restaurantPoint.lat, lng: restaurantPoint.lng },
      { lat: customerPoint.lat, lng: customerPoint.lng },
    );
    if (route?.distanceKm != null && Number.isFinite(Number(route.distanceKm))) {
      return Number(route.distanceKm);
    }
  } catch {
    // Fall through to Haversine.
  }

  return straightLineKm;
}

// Single money-rounding rule (2 decimals) so preview and charged totals always match.

function resolveBaseDeliveryFee(feeSettings = {}) {
  const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
    ? feeSettings.deliveryFeeRanges
    : [];
  const rangeFees = ranges
    .map((range) => Number(range?.fee))
    .filter((fee) => Number.isFinite(fee) && fee >= 0);

  const flat = Number(feeSettings.deliveryFee);
  const hasPositiveFlat = Number.isFinite(flat) && flat > 0;

  if (rangeFees.length > 0) {
    const minRangeFee = Math.min(...rangeFees);
    return hasPositiveFlat ? flat : minRangeFee;
  }

  return Number.isFinite(flat) && flat >= 0 ? flat : 0;
}

/**
 * What a band adds for distance beyond its own start.
 *
 * Band matching sends anything past the final band to the widest one, so
 * without this a 45km order is charged the last band's flat fee -- identical to
 * a trip at its edge -- and the rider is paid from that same figure. 0 leaves
 * the band flat, which is every band that does not set it.
 */
const extraOf = (range, distanceKm) => {
  const rate = Number(range?.extraPerKm || 0);
  if (!(rate > 0)) return 0;
  const over = Math.max(0, Number(distanceKm || 0) - Number(range?.min || 0));
  return Math.round(rate * over * 100) / 100;
};

function matchFeeRange(ranges, distanceKm, pickValue) {
  if (!Array.isArray(ranges) || ranges.length === 0 || !Number.isFinite(distanceKm)) {
    return null;
  }

  const sorted = [...ranges].sort((a, b) => Number(a.min) - Number(b.min));
  for (let i = 0; i < sorted.length; i += 1) {
    const range = sorted[i] || {};
    const min = Number(range.min);
    const max = Number(range.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;

    const isLast = i === sorted.length - 1;
    const inRange = isLast
      ? distanceKm >= min && distanceKm <= max
      : distanceKm >= min && distanceKm < max;

    if (inRange) {
      const value = pickValue(range);
      return Number.isFinite(value) ? value : null;
    }
  }

  return null;
}

/**
 * The Master earning table in this module's own band shape.
 *
 * Quick commerce pays `deliveryBoyBasePay` OR `deliveryBoyPerKm` per band and
 * charges `fee`; the engine stores the same three figures under the names food
 * uses. Only the names are translated -- which of the two a rider is actually
 * paid stays this module's rule (basePay wins, see calculateRiderEarning), so
 * moving the table here does not move the formula with it.
 */
const asQcRanges = (slabs) =>
  (Array.isArray(slabs) ? slabs : []).map((b) => ({
    min: Number(b.minDistance || 0),
    // This module's bands are closed ranges; an open-ended engine band becomes
    // the largest band rather than one with no ceiling, which matchFeeRange
    // would never match.
    max: b.maxDistance == null ? Number.MAX_SAFE_INTEGER : Number(b.maxDistance),
    fee: Number(b.userDeliveryFee || 0),
    deliveryBoyPerKm: Number(b.commissionPerKm || 0),
    deliveryBoyBasePay: Number(b.basePayout || 0),
    extraPerKm: Number(b.extraPerKm || 0),
  }));

/**
 * @param {object} [opts]
 * @param {string} [opts.zoneId] scopes the earning table to a city when set
 *
 * The one place every quick-commerce earning path reads its bands from, which is
 * why the Master table is overlaid HERE: order pricing and order creation
 * both pick it up without each being rewired.
 */
/**
 * The zone an order to this address falls in -- the same answer order creation
 * stores (order.service.js resolveServiceableZone), else the store's own zone --
 * so a quote and the placed order read the same zone-level settings.
 */
async function zoneIdForPricing(restaurant, deliveryAddress) {
  try {
    const point = readAddressPoint(deliveryAddress);
    if (point) {
      const zone = await findZoneForPoint(point.lat, point.lng, ZONE_VERTICALS.QUICK);
      if (zone?._id) return String(zone._id);
    }
  } catch {
    /* fall back to the store's zone */
  }
  return restaurant?.zoneId ? String(restaurant.zoneId) : undefined;
}

export async function loadActiveFeeSettings({ zoneId, vertical = 'quickCommerce' } = {}) {
  const feeDoc = await FoodFeeSettings.findOne({ isActive: { $ne: false } })
    .sort({ createdAt: -1 })
    .lean();

  // Master's platform fee when set (core/finance/platformFees).
  // Fees are the Quick Commerce setting; a zone's own fee still applies.
  const settings = await withMasterFees('quickCommerce', feeDoc || {
    deliveryFee: 0,
    deliveryFeeRanges: [],
    platformFee: 0,
    gstRate: 0,
  }, { zoneId });

  // Master > Delivery earnings formula, when one is saved: it prices the fee
  // and the rider's pay from here on (resolveUserDeliveryFee, calculateRiderEarning).
  const deliveryFormula = await resolveDeliveryFormula({ vertical, zoneId });
  if (deliveryFormula) return { ...settings, deliveryFormula };

  // Master > Delivery earnings when a table is saved there; this module's own
  // bands when it is not, so nothing changes until an admin sets one.
  const { slabs, level } = await resolveEarningSlabs({
    vertical: 'quickCommerce',
    zoneId,
    loadLegacy: async () => [],
  });
  if (level && level !== 'legacy' && slabs.length) {
    return { ...settings, deliveryFeeRanges: asQcRanges(slabs) };
  }
  return settings;
}

/**
 * The delivery promise quoted at checkout: packing, then the ride.
 *
 * Same speed and packing constants the live countdown uses, so a customer is
 * not quoted one number before ordering and shown a different one after.
 */
export function estimateDeliveryPromiseMinutes(distanceKm) {
  // Number(null) is 0, so an unknown distance would otherwise quote the packing
  // time alone -- a confident promise built on a distance nobody measured.
  if (distanceKm === null || distanceKm === undefined || distanceKm === '') return null;
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) return null;
  return Math.ceil(PACKING_MINUTES + (km / AVG_SPEED_KMPH) * 60);
}

/**
 * GST across a basket whose lines can sit in different slabs.
 *
 * Groceries are taxed per product — flour at 0, biscuits at 18 — so charging
 * one rate on the whole basket is wrong in both directions depending on what
 * the customer bought. A line with no rate of its own falls back to the
 * order-wide rate, which makes this identical to the old single-rate maths for
 * any basket of items that predate per-product slabs.
 *
 * The discount reduces every line in proportion to its share of the basket,
 * because a basket-level coupon is not attributable to any one product --
 * UNLESS the platform funded it, in which case it reduces no line at all.
 *
 * A platform-funded coupon leaves the seller paid in full: the customer pays
 * part and the platform pays the rest, so the supply is still worth the whole
 * basket and the tax is due on that. Only a seller's own discount comes out of
 * the taxable value. Reducing the base for a platform coupon under-collects
 * GST on every order that used one.
 */
export function computeItemsTax(
  items = [],
  { subtotal = 0, discount = 0, fallbackRate = 0, discountFundedByPlatform = false } = {},
) {
  if (!(subtotal > 0)) return 0;

  const taxableShare = discountFundedByPlatform === true
    ? 1
    : Math.max(0, subtotal - discount) / subtotal;
  let tax = 0;

  for (const item of items) {
    // null and undefined mean "no slab of its own" and must reach the fallback.
    // Number(null) is 0, so testing the coerced value would silently make every
    // untagged item tax-free.
    const own = item?.gstRate;
    const hasOwnRate = own !== null && own !== undefined && Number.isFinite(Number(own));
    const rate = hasOwnRate ? Number(own) : Number(fallbackRate) || 0;
    if (!(rate > 0)) continue;

    const lineValue = (Number(item?.price) || 0) * (Number(item?.quantity) || 1);
    tax += lineValue * taxableShare * (rate / 100);
  }

  // To the paisa, like every other figure on the bill. Whole-rupee rounding charged
  // oil at 105 and 5% a GST of 5 instead of 5.25, and three bottles 16 instead of
  // 15.75 -- while a return refunds GST line by line in paise, so the two never
  // agreed. Still summed before rounding, so a long basket gains no per-line error.
  return round2(tax);
}

/**
 * GST on the platform fee. Charged at the rate Master > Platform fee & GST sets
 * (withMasterFees puts it on the settings as platformFeeGstRate); absent means
 * not charged, which is how Quick Commerce always worked before one was set.
 * A separate line, never folded into `tax`: `tax` is the goods' GST, and returns
 * and seller figures read it as such.
 */
export function platformFeeGstFor(feeSettings = {}, platformFee = 0) {
  const r = Number(feeSettings?.platformFeeGstRate);
  const platformFeeGstRate = feeSettings?.platformFeeGstRate != null && Number.isFinite(r) && r > 0 ? r : 0;
  const platformFeeGst = round2((Number(platformFee) || 0) * (platformFeeGstRate / 100));
  return { platformFeeGstRate, platformFeeGst };
}

export function resolveUserDeliveryFee(feeSettings = {}, { subtotal = 0, distanceKm = null } = {}) {
  if (feeSettings.deliveryFormula) {
    // An unmeasured trip is charged the base fee, as the band table did.
    const measured = Number.isFinite(distanceKm);
    const priced = priceDelivery(feeSettings.deliveryFormula.formula, measured ? distanceKm : 0);
    return {
      deliveryFee: priced.customerFee,
      distanceKm: measured ? Number(distanceKm.toFixed(2)) : null,
      source: 'delivery_formula',
    };
  }

  const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
    ? feeSettings.deliveryFeeRanges
    : [];

  if (ranges.length > 0 && Number.isFinite(distanceKm)) {
    const matchedFee = matchFeeRange(ranges, distanceKm, (range) => Number(range.fee) + extraOf(range, distanceKm));
    if (Number.isFinite(matchedFee)) {
      return {
        deliveryFee: matchedFee,
        distanceKm: Number(distanceKm.toFixed(2)),
        source: 'distance',
      };
    }
  }

  const fallbackFee = resolveBaseDeliveryFee(feeSettings);
  return {
    deliveryFee: fallbackFee,
    distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
    source: Number.isFinite(distanceKm) ? 'default_unmatched_range' : 'default',
  };
}

export function calculateRiderEarning(feeSettings = {}, distanceKm) {
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (feeSettings.deliveryFormula) return priceDelivery(feeSettings.deliveryFormula.formula, distance).riderPay;

  const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
    ? feeSettings.deliveryFeeRanges
    : [];
  if (ranges.length === 0) return 0;

  // basePay and perKm are mutually exclusive (the admin UI enforces this too):
  // a flat basePay wins, otherwise pay per km of the actual trip.
  const payFor = (range) => {
    const basePay = Number(range?.deliveryBoyBasePay || 0);
    const perKm = Number(range?.deliveryBoyPerKm || 0);
    const extra = extraOf(range, distance);

    if (basePay > 0) return basePay + extra;
    if (perKm > 0) return distance * perKm + extra;
    return extra;
  };

  const matched = matchFeeRange(ranges, distance, payFor);
  // A matched band is authoritative — including an explicit 0.
  if (matched != null && Number.isFinite(matched)) return Math.round(matched);

  // No band covers this distance. The customer is still charged (resolveUserDeliveryFee
  // falls back to the base fee), so paying the rider 0 here would mean unpaid work on a
  // real delivery whenever the bands don't span the dispatch radius. Fall back to the
  // widest configured band instead of silently zeroing the payout.
  const widest = [...ranges].sort(
    (a, b) => Number(a?.max ?? 0) - Number(b?.max ?? 0),
  )[ranges.length - 1];
  const fallback = payFor(widest);
  return Number.isFinite(fallback) ? Math.round(fallback) : 0;
}

/**
 * The address the trip should be priced against.
 *
 * Order creation passes a full `deliveryAddress`, but the checkout preview only
 * ever sends `deliveryAddressId`, and the cart summary sends neither — nothing
 * resolved either, so `distanceKm` came out null on every preview and the
 * distance bands were skipped entirely in favour of the flat fallback fee. The
 * customer saw one delivery charge at checkout and was billed another on
 * placing the order.
 *
 * An explicitly chosen address wins even when it has no coordinates: pricing a
 * different address than the one the customer picked would be worse than
 * falling back to the flat fee.
 */
async function resolveDeliveryAddress(userId, dto) {
  if (parseGeoPoint(dto.deliveryAddress)) return dto.deliveryAddress;
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    return dto.deliveryAddress;
  }

  const user = await FoodUser.findById(userId).select('addresses').lean();
  const addresses = Array.isArray(user?.addresses) ? user.addresses : [];
  if (addresses.length === 0) return dto.deliveryAddress;

  const wantedId = String(dto.deliveryAddressId || '').trim();
  const chosen =
    (wantedId && addresses.find((entry) => String(entry?._id) === wantedId)) ||
    addresses.find((entry) => entry?.isDefault) ||
    addresses[0];

  return chosen || dto.deliveryAddress;
}

/**
 * Whether a coupon applies to a basket, and for how much. Lifted out of
 * calculateOrderPricing so a multi-store checkout (plan §5.1) can test ONE
 * coupon against the whole basket and then share the discount between the
 * stores, instead of each store testing it on its own part.
 *
 * `restaurantIds` are the stores the basket is from: a coupon scoped to
 * selected stores applies when any of them is selected, and `eligibleSubtotal`
 * (when given) is the value of the in-scope part.
 */
export async function evaluateCoupon(userId, couponCode, { subtotal = 0, restaurantIds = [], eligibleSubtotal } = {}) {
  let discount = 0;
  let discountFundedByPlatform = false;
  let appliedCoupon = null;
  let offerScope = null;
  const codeRaw = couponCode ? String(couponCode).trim().toUpperCase() : "";
  if (codeRaw) {
    const now = new Date();
    const offer = await FoodOffer.findOne({ couponCode: codeRaw }).lean();
    if (offer) {
      const offerEnd = offer.endDate ? new Date(offer.endDate) : null;
      if (offerEnd && offerEnd.getHours() === 0 && offerEnd.getMinutes() === 0) {
        offerEnd.setHours(23, 59, 59, 999);
      }
      const endOk = !offerEnd || now <= offerEnd;
      const startOk = !offer.startDate || now >= new Date(offer.startDate);
      const statusOk = offer.status === "active" && offer.showInCart !== false;
      const selectedRestaurantIds = Array.isArray(offer.restaurantIds) && offer.restaurantIds.length > 0
        ? offer.restaurantIds
        : [offer.restaurantId].filter(Boolean);
      const scopeOk =
        offer.restaurantScope !== "selected" ||
        selectedRestaurantIds.some((id) => restaurantIds.some((r) => String(id) === String(r || "")));
      if (offer.restaurantScope === "selected") offerScope = selectedRestaurantIds.map(String);
      const minOk = subtotal >= (Number(offer.minOrderValue) || 0);
      let usageOk = true;
      if (
        Number(offer.usageLimit) > 0 &&
        Number(offer.usedCount || 0) >= Number(offer.usageLimit)
      ) {
        usageOk = false;
      }

      let perUserOk = true;
      if (userId && mongoose.Types.ObjectId.isValid(userId) && Number(offer.perUserLimit) > 0) {
        const usage = await FoodOfferUsage.findOne({
          offerId: offer._id,
          userId: new mongoose.Types.ObjectId(userId),
        }).lean();
        if (usage && Number(usage.count) >= Number(offer.perUserLimit)) {
          perUserOk = false;
        }
      }

      let firstOrderOk = true;
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        if (offer.customerScope === "first-time") {
          const c = await FoodOrder.countDocuments({
            userId: new mongoose.Types.ObjectId(userId),
          });
          firstOrderOk = c === 0;
        }
        if (offer.isFirstOrderOnly === true) {
          const c2 = await FoodOrder.countDocuments({
            userId: new mongoose.Types.ObjectId(userId),
          });
          if (c2 > 0) firstOrderOk = false;
        }
      }

      const allowed =
        statusOk &&
        startOk &&
        endOk &&
        scopeOk &&
        minOk &&
        usageOk &&
        perUserOk &&
        firstOrderOk;

      if (allowed) {
        const base = Number.isFinite(Number(eligibleSubtotal)) ? Number(eligibleSubtotal) : subtotal;
        if (offer.discountType === "percentage") {
          const raw = base * (Number(offer.discountValue) / 100);
          const capped = Number(offer.maxDiscount)
            ? Math.min(raw, Number(offer.maxDiscount))
            : raw;
          discount = Math.max(0, Math.min(base, Math.floor(capped)));
        } else {
          discount = Math.max(
            0,
            Math.min(base, Math.floor(Number(offer.discountValue) || 0)),
          );
        }
        appliedCoupon = { code: codeRaw, discount };
        discountFundedByPlatform = offer.createdByRole !== 'RESTAURANT';
      }
    }
  }

  return { discount, discountFundedByPlatform, appliedCoupon, codeRaw, offerScope };
}

export async function calculateOrderPricing(userId, dto, options = {}) {
  const at = options.at instanceof Date ? options.at : new Date();
  const restaurant =
    options.restaurant || (await loadRestaurantForOrdering(dto.restaurantId));

  if (!options.skipAvailabilityCheck) {
    assertRestaurantOpenForOrdering(restaurant, at);
  }

  const deliveryAddress = normalizeDeliveryAddress(
    await resolveDeliveryAddress(userId, dto),
  );

  const resolvedItems = await resolveOrderCartItems(dto.restaurantId, dto.items);
  const items = resolvedItems.map((item) => ({
    ...item,
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 1,
  }));
  const subtotal = round2(
    items.reduce(
      (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1),
      0,
    ),
  );

  // Any zone-level setting for the zone this address is in applies.
  const feeSettings = await loadActiveFeeSettings({
    vertical: 'quickCommerce',
    zoneId: await zoneIdForPricing(restaurant, deliveryAddress),
  });

  const packagingFee = 0;
  const overrides = options.overrides || null;
  // Self-pickup (plan §5.2): the customer collects, so there is no delivery fee.
  const isPickup = String(options.fulfilmentType || dto.fulfilmentType || '').toLowerCase() === 'pickup';
  const naturalPlatformFee = Number(feeSettings.platformFee || 0);
  const platformFee = overrides && overrides.platformFee != null
    ? round2(Math.max(0, Number(overrides.platformFee) || 0))
    : naturalPlatformFee;

  let distanceKm = await getDeliveryDistanceKm(restaurant, deliveryAddress);
  const straightLineKm = calculateDistanceKm(restaurant, deliveryAddress);

  const deliveryFeeResult = resolveUserDeliveryFee(feeSettings, { subtotal, distanceKm });
  const naturalDeliveryFee = isPickup ? 0 : round2(deliveryFeeResult.deliveryFee);
  const deliveryFee = isPickup
    ? 0
    : overrides && overrides.deliveryFee != null
      ? round2(Math.max(0, Number(overrides.deliveryFee) || 0))
      : naturalDeliveryFee;
  distanceKm = deliveryFeeResult.distanceKm ?? distanceKm;

  /*
   * Who paid for the coupon, which decides what GST is charged on. Admin is the
   * default and the fallback, matching how the money actually settles: an admin
   * coupon comes off the platform and leaves the seller's payout whole.
   *
   * A multi-store checkout passes the coupon's share for this store in
   * options.overrides instead (core/orders/proRata.js); it was tested once
   * against the whole basket.
   */
  let discount = 0;
  let discountFundedByPlatform = false;
  let appliedCoupon = null;
  let codeRaw = dto.couponCode ? String(dto.couponCode).trim().toUpperCase() : "";
  if (overrides) {
    discount = round2(Math.min(subtotal, Math.max(0, Number(overrides.discount) || 0)));
    discountFundedByPlatform = overrides.discountFundedByPlatform === true;
    codeRaw = overrides.couponCode ? String(overrides.couponCode).trim().toUpperCase() : "";
    appliedCoupon = codeRaw && discount > 0 ? { code: codeRaw, discount } : null;
  } else if (codeRaw) {
    ({ discount, discountFundedByPlatform, appliedCoupon } = await evaluateCoupon(userId, codeRaw, {
      subtotal,
      restaurantIds: [dto.restaurantId],
    }));
  }

  // GST is charged on the full item value before any coupon, whoever funded it
  // (same rule as food, shared/billing.js). Recorded so a return refunds the
  // same tax it charged.
  const gstFallbackRate = Number(feeSettings.gstRate || 0);
  const gstOnPreDiscountValue = Number(discount) > 0;
  const tax = computeItemsTax(items, {
    discountFundedByPlatform: gstOnPreDiscountValue,
    subtotal,
    discount,
    fallbackRate: gstFallbackRate,
  });

  const deliveryFeeGst = computeDeliveryFeeGst(deliveryFee);
  // GST on the platform fee, at Master's rate when one is set (not charged otherwise).
  const { platformFeeGstRate, platformFeeGst } = platformFeeGstFor(feeSettings, platformFee);

  // Loyalty points redeemed (core/loyalty): paid by the platform, after GST,
  // like a wallet. Already capped to the admin's share of the item value.
  const loyaltyDiscount = round2(Math.max(0, Number(overrides?.loyaltyDiscount ?? options.loyaltyDiscount) || 0));
  const loyaltyPoints = Math.max(0, Math.round(Number(overrides?.loyaltyPoints ?? options.loyaltyPoints) || 0));

  const payableBeforeRounding = round2(
    Math.max(
      0,
      subtotal + packagingFee + deliveryFee + deliveryFeeGst + platformFee + platformFeeGst + tax - discount - loyaltyDiscount,
    ),
  );
  // Charged to the rupee, like Food: 336.80 -> 337 with a +0.20 round-off line.
  const total = Math.round(payableBeforeRounding);
  const roundOff = round2(total - payableBeforeRounding);

  const basePricing = {
    subtotal,
    tax,
    // The rate lines with no slab of their own were taxed at. Recorded because the fee
    // settings can change after the order, and a return has to refund such a line at
    // the rate it was actually charged.
    gstFallbackRate,
    packagingFee,
    deliveryFee,
    deliveryFeeGst,
    platformFee,
    platformFeeGst,
    platformFeeGstRate,
    discount,
    /*
     * Carried so the saved order records which base its GST was charged on, and
     * so a return refunds the same tax it charged. Absent on orders placed
     * before this existed, which read back as the older treatment.
     */
    discountFundedByPlatform,
    // Which base the GST above was charged on; a return refunds on the same one.
    gstOnPreDiscountValue,
    roundOff,
    total,
    currency: "INR",
    fulfilmentType: isPickup ? 'pickup' : 'delivery',
    loyaltyDiscount,
    loyaltyPoints,
    // Before any multi-store split: what this store alone would have charged.
    naturalDeliveryFee,
    naturalPlatformFee,
    couponCode: appliedCoupon?.code || codeRaw || null,
    appliedCoupon,
    distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
    roadDistanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
    straightLineDistanceKm: Number.isFinite(straightLineKm)
      ? Number(straightLineKm.toFixed(2))
      : null,
    deliveryFeeBreakdown: deliveryFeeResult.breakdown || null,
    // Shown before the customer commits, which is the whole point of a
    // quick-commerce promise: it is a reason to order, not a status to check
    // afterwards. Packing plus the ride, from the same numbers the live
    // countdown uses, so the quote and the tracking screen agree.
    deliveryPromiseMinutes: estimateDeliveryPromiseMinutes(distanceKm),
  };

  const pricing = applyDeliveryModePricing(
    basePricing,
    isPickup || overrides ? 'basic' : dto.deliveryMode,
    Number(feeSettings.quickDeliveryFee) || 0,
  );

  // Compared like with like. The shipped app sends each line's price WITHOUT its
  // add-ons, while resolved.price has them folded in, so every line carrying an add-on
  // was reported as "price changed" on every checkout. The line's own price is the
  // comparison; a client that sends the add-on-inclusive figure is accepted too, so a
  // corrected app does not start seeing the notice the other way round. Matched on the
  // size as well, since two sizes of one product are two lines with the same itemId.
  const priceChanges = (Array.isArray(dto.items) ? dto.items : [])
    .map((rawItem) => {
      const itemId = String(rawItem?.itemId || rawItem?.id || '').trim();
      const variantId = String(rawItem?.variantId || '').trim();
      const resolved =
        items.find((entry) => String(entry.itemId) === itemId && String(entry.variantId || '') === variantId) ||
        items.find((entry) => String(entry.itemId) === itemId);
      if (!resolved) return null;

      const previousPrice = Number(rawItem?.price);
      const withAddons = Number(resolved.price) || 0;
      const addonsTotal = (Array.isArray(resolved.addons) ? resolved.addons : [])
        .reduce((sum, addon) => sum + (Number(addon?.price) || 0), 0);
      const ownPrice = round2(withAddons - addonsTotal);
      if (!Number.isFinite(previousPrice)) return null;
      if (previousPrice === ownPrice || previousPrice === withAddons) return null;

      return {
        itemId,
        name: resolved.name,
        previousPrice,
        price: ownPrice,
      };
    })
    .filter(Boolean);

  return {
    items,
    priceChanges,
    pricing: {
      ...pricing,
      deliveryFeeBreakdown: {
        source: deliveryFeeResult.source,
        distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
        deliveryFee,
        message: Number.isFinite(distanceKm)
          ? `Distance: ${Number(distanceKm).toFixed(1)} km`
          : null,
      },
    },
  };
}
