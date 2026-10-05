import mongoose from 'mongoose';
import { resolvePromoCeiling, tighten } from '../../../../core/finance/promoLimits.service.js';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { computeBill, normalizeTip, DEFAULT_PLATFORM_FEE_GST_RATE } from '../../shared/billing.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { ORDER_STATUSES_NOT_COUNTED_FOR_COUPONS } from './couponUsage.service.js';
import { FoodDeliverySurgeZone } from '../../admin/models/deliverySurgeZone.model.js';
import { FoodDeliveryCommissionRule } from '../../admin/models/deliveryCommissionRule.model.js';
import { resolveEarningSlabs, resolveIncentive, pickSlab, bandFee } from '../../../../core/finance/deliveryEarnings.service.js';
import { resolveDeliveryFormula, priceDelivery } from '../../../../core/finance/deliveryFormula.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { resolveDeliveryDistanceKm } from './deliveryDistance.service.js';
import { withMasterFees } from '../../../../core/finance/platformFees.service.js';
import {
    assertOrderQuantity,
    resolveOrderQuantityRules
} from '../../shared/orderQuantityRules.js';
import {
    computeFoodPackagingFee,
    normalizePackagingConfig,
    resolveItemPackagingAmount,
    PACKAGING_MODES
} from '../../shared/packagingCharge.js';
import { assertFoodAvailableNow } from '../../shared/itemAvailability.js';
import { resolveFreebieForOrder } from '../../shared/freebieOffer.service.js';
import { applyBogoToItems } from '../../shared/bogoOffer.service.js';
import { getOrderQuantityCeiling } from '../../shared/orderQuantityCeiling.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import { loadSellableAddons, normalizeRequestedAddonIds, resolveLineAddons } from '../../shared/orderAddons.js';

/**
 * Resolves order items against the restaurant's live menu and returns copies with
 * SERVER-authoritative prices/names. Never trust client-supplied prices: without this
 * a client could post price:1 for an expensive dish and be charged ₹1.
 * Also validates ownership, availability, variant, and quantity bounds.
 * @param {string|import('mongoose').Types.ObjectId} restaurantId
 * @param {Array<object>} items
 * @returns {Promise<Array<object>>}
 */
export async function resolveAuthoritativeItems(restaurantId, items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) throw new ValidationError('Order must contain at least one item');

  const ids = [...new Set(list.map((it) => String(it?.itemId || '')).filter(Boolean))]
    .filter((id) => mongoose.isValidObjectId(id));
  if (ids.length === 0) throw new ValidationError('Invalid order items');

  const menuItems = await FoodItem.find({ _id: { $in: ids }, restaurantId }).lean();
  const byId = new Map(menuItems.map((m) => [String(m._id), m]));

  // Admin-configurable platform cap, read once for the whole order rather than
  // per line -- it is the same value for every item and the map below is sync.
  const quantityCeiling = await getOrderQuantityCeiling();

  // Add-ons for every line, fetched in one query and validated per line below.
  // Loaded from the published records, so the price charged is the approved one
  // and never whatever the client sent.
  const requestedAddonsByLine = list.map((it) => normalizeRequestedAddonIds(it));
  const allAddonIds = [...new Set(requestedAddonsByLine.flat())];
  const addonsById = await loadSellableAddons(FoodAddon, restaurantId, allAddonIds);

  return list.map((it, index) => {
    const menu = byId.get(String(it?.itemId || ''));
    if (!menu) throw new ValidationError('One or more items are not available at this restaurant');
    if (menu.isActive === false || menu.isAvailable === false || menu.approvalStatus !== 'approved') {
      throw new ValidationError(`"${menu.name}" is currently unavailable`);
    }

    // Per-item serving window, e.g. breakfast only until 11:30. Checked against
    // the restaurant's wall clock, not the server's UTC one.
    assertFoodAvailableNow(menu);

    let price = Number(menu.price);
    let variantName = '';
    // A dish switched off variants keeps them stored but sells at its base
    // price. A variantId can still arrive -- a cart line added before the
    // toggle flipped -- and is ignored rather than refused, so a stale cart
    // gets charged the base price instead of failing at checkout. Rows written
    // before the flag existed have it undefined, which does NOT mean off:
    // for them, having variants means selling by variants, as it always did.
    const sellsByVariants = menu.variantsEnabled !== false;
    const chosenVariantId = sellsByVariants ? (it?.variantId || null) : null;
    if (chosenVariantId) {
      const variant = (menu.variants || []).find((v) => String(v._id) === String(chosenVariantId));
      if (!variant) throw new ValidationError(`Selected option for "${menu.name}" is not available`);
      /*
       * A size is billed at its own price, exactly as the menu shows it.
       *
       * This used to take variant.price less menu.discountPercent, on the
       * assumption that variant.price was pre-discount and discountPercent a
       * discount still to apply. Under formulation pricing neither is true:
       *
       *   variant.price    is ALREADY the charged figure -- the global run
       *                    writes base x (1 - discount) into it directly
       *   discountPercent  is the SAVING shown to the customer, which the run
       *                    stores as (struck - price) / struck
       *
       * So the saving came off twice. On a +20% markup the displayed saving is
       * 16.67%, and every size at Rainbow Restro was billed 16.67% under its
       * menu price: Mutton Masala Full reads Rs 486 and was billed Rs 404.98.
       * On a discount dish it would have discounted the size a second time.
       *
       * A plain dish was never affected -- it is billed menu.price directly,
       * above -- which is why only dishes sold by size came out wrong.
       */
      price = Number(variant.price);
      variantName = variant.name;
    }

    // Min/max set by the restaurant, with the platform ceiling as fallback.
    //
    // Checked AFTER the size is known, because a variant may carry limits of its
    // own: a family pack capped at two must not be judged by the dish-level cap
    // of ten. A variant that sets none inherits the dish's, so a dish without
    // per-size limits behaves exactly as it did before.
    const qty = assertOrderQuantity(
      it?.quantity,
      resolveOrderQuantityRules(menu, quantityCeiling, chosenVariantId),
      variantName ? `${menu.name} (${variantName})` : menu.name,
    );

    // Add-ons the dish actually offers, priced from the published record. The
    // chosen variant is passed too: an add-on may be attached to one size only,
    // and without this a variant-only add-on would be refused on the very
    // variant it belongs to.
    const { addons, addonsTotal } = resolveLineAddons(
      menu,
      requestedAddonsByLine[index],
      addonsById,
      chosenVariantId,
    );

    return {
      ...it,
      itemId: menu._id,
      name: menu.name,
      price,
      quantity: qty,
      variantName: variantName || it?.variantName || '',
      // Per-unit packaging charge, stamped from the DB item — never client input.
      foodPackagingCharge: resolveItemPackagingAmount(menu),
      // Read from the menu, never the request: a client that could send
      // this would waive its own delivery fee.
      freeDelivery: menu.freeDelivery === true,
      /*
       * Whether this line's price already contains GST. Undefined means the
       * dish never answered, and the restaurant's own setting decides -- which
       * is resolved below, where the restaurant document is in scope.
       */
      priceIncludesGst: typeof menu.priceIncludesGst === 'boolean'
        ? menu.priceIncludesGst
        : undefined,
      // Snapshotted per unit, same as the packaging charge above.
      addons,
      addonsTotal,
      // A combo carries its parts so the kitchen knows what to make. Read from
      // the menu item, never the request: a client that could name its own
      // components would be choosing what it gets for the combo price.
      isCombo: menu.isCombo === true,
      comboComponents: menu.isCombo === true
        ? (menu.comboComponents || []).map((c) => ({
            itemId: String(c.itemId || ''),
            variantId: c.variantId ? String(c.variantId) : '',
            quantity: Number(c.quantity) || 1,
            name: c.nameSnapshot || '',
            variantName: c.variantNameSnapshot || '',
            listUnitPrice: Number(c.listUnitPrice) || 0,
            allocatedLineTotal: Number(c.allocatedLineTotal) || 0,
          }))
        : [],
    };
  });
}

function extractCoords(addressLike) {
  const coords = addressLike?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return [Number(lng), Number(lat)];
}

/**
 * The address an order is going to, whatever shape the caller sent it in.
 *
 * Clients send one of two things. The web sends the whole address object; the
 * Flutter app sends `deliveryAddressId`, the id of one of the user's saved
 * addresses. Only the first was ever read, so every cart priced from the app
 * arrived here with no coordinates at all -- which silently charges the base
 * distance slab no matter how far the rider goes, and makes free-delivery-by-
 * radius impossible to qualify for. The bill simply looked cheap and the offer
 * simply never fired.
 *
 * The id is looked up against THIS user's own addresses, so it cannot be used
 * to price against someone else's location.
 */
async function resolveDeliveryAddress(userId, dto = {}) {
    const inline = dto?.address || dto?.deliveryAddress || null;
    if (extractCoords(inline)) return inline;

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return inline;

    const user = await FoodUser.findById(userId).select('addresses').lean();
    const addresses = Array.isArray(user?.addresses) ? user.addresses : [];
    if (!addresses.length) return inline;

    const wantedId = String(dto?.deliveryAddressId || inline?._id || inline?.id || '').trim();
    /*
     * The chosen address wins; failing that, the one the customer would be
     * offered by default. The cart summary sends no address at all, and quoting
     * it a flat base-slab fee that placement then contradicts is worse than
     * quoting the default address it is almost certainly going to.
     * This mirrors what quick commerce already does.
     */
    const saved =
        (wantedId && addresses.find((a) => String(a?._id) === wantedId))
        || addresses.find((a) => a?.isDefault)
        || addresses[0];
    if (!saved) return inline;

    // Merge rather than replace: a caller that sent a partial address plus an id
    // keeps whatever it sent, and only gains what it was missing.
    return { ...(inline || {}), ...saved };
}

function isPointInPolygon(lat, lng, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i]?.longitude);
    const yi = Number(polygon[i]?.latitude);
    const xj = Number(polygon[j]?.longitude);
    const yj = Number(polygon[j]?.latitude);
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

async function detectZoneIdFromAddress(addressLike) {
  const coords = extractCoords(addressLike);
  if (!coords) return null;
  const [lng, lat] = coords;
  const zones = await FoodZone.find({ isActive: true }).select('_id coordinates').lean();
  const matchedZone = (zones || []).find((zone) => isPointInPolygon(lat, lng, zone?.coordinates || []));
  return matchedZone?._id ? String(matchedZone._id) : null;
}

export async function resolveOrderZoneId(dto = {}, restaurant = null) {
  const detectedZoneId = await detectZoneIdFromAddress(dto?.address || dto?.deliveryAddress);
  if (detectedZoneId && mongoose.Types.ObjectId.isValid(detectedZoneId)) {
    return detectedZoneId;
  }
  if (dto?.zoneId && mongoose.Types.ObjectId.isValid(dto.zoneId)) {
    return String(dto.zoneId);
  }
  if (restaurant?.zoneId && mongoose.Types.ObjectId.isValid(restaurant.zoneId)) {
    return String(restaurant.zoneId);
  }
  return null;
}

/**
 * The earning band for a distance.
 *
 * The table now comes from Master > Delivery earnings when one is saved there,
 * and from this module's own `food_delivery_commission_rules` rows when it is
 * not -- so behaviour is unchanged until an admin sets one. The band-matching
 * fallbacks live in the engine (core/finance/deliveryEarnings.service.js) and
 * are the same ones this function used.
 *
 * `_id` is preserved on the returned band so the per-band admin delivery
 * commission in fee settings, which is keyed by it, still matches.
 */
async function resolveDistanceRule(distanceKm, zoneId) {
  if (!Number.isFinite(Number(distanceKm)) || Number(distanceKm) < 0) return null;
  const { slabs } = await resolveEarningSlabs({
    vertical: 'food',
    zoneId,
    loadLegacy: () => FoodDeliveryCommissionRule.find({ status: { $ne: false } }).lean(),
  });
  const band = pickSlab(slabs, distanceKm);
  if (!band) return null;
  return { ...band, _id: band.distanceRuleId || band._id || null };
}

export async function calculateOrderPricing(userId, dto) {
  const restaurant = await FoodRestaurant.findById(dto.restaurantId)
    .select("status zoneId location freeDeliveryRule priceIncludesGst serviceRadiusKm")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not available");

  /*
   * Resolve the delivery address before anything measures a distance.
   * Written back onto the dto so the zone lookup, the distance slab and the
   * free-delivery radius all judge the same address.
   */
  const resolvedAddress = await resolveDeliveryAddress(userId, dto);
  if (resolvedAddress) {
    dto = { ...dto, address: resolvedAddress, deliveryAddress: resolvedAddress };
  }

  // Resolve prices from the live menu — never trust client-supplied item prices.
  const resolvedItems = await resolveAuthoritativeItems(dto.restaurantId, dto.items);

  // Buy-one-get-one, applied BEFORE the subtotal below rather than as a discount
  // after it. A qualifying line is split into a paid half and a zero-priced half,
  // so the free units are simply absent from the sum -- which is what keeps
  // commission (taken on pricing.subtotal) off food the restaurant gave away, and
  // keeps the POS payload, which is sent price x quantity per line, agreeing with
  // what we charged.
  //
  // Server-side because the free units are earned by quantity, not chosen: a
  // client asking for a free dish gets what its own order actually qualifies for.
  const { items, bogo } = await applyBogoToItems(dto.restaurantId, resolvedItems);
  dto.items = items;

  // Add-ons are priced per unit, so they scale with quantity exactly as the item
  // price does. Left out of this sum they would be shown on the order and in the
  // kitchen but never charged. Add-ons and packaging ride along on a free
  // buy-one-get-one unit at their real values, so they are still counted here:
  // only the item price was given away.
  const subtotal = items.reduce(
    (sum, it) => sum
      + ((Number(it.price) || 0) + (Number(it.addonsTotal) || 0)) * (Number(it.quantity) || 1),
    0,
  );

  /*
   * How much of that subtotal is priced inclusive of GST.
   *
   * The answer is per dish, because a restaurant can price some items one way
   * and some the other. A dish that never answered inherits the restaurant's
   * setting, and a restaurant that never answered is exclusive -- which is what
   * every menu on the platform did before any of this existed.
   *
   * Add-ons follow the dish they are attached to: they are part of the same
   * line and the same listed price the customer agreed to.
   */
  const restaurantDefaultIncludesGst = restaurant?.priceIncludesGst === true;
  const lineIncludesGst = (it) =>
    typeof it?.priceIncludesGst === 'boolean'
      ? it.priceIncludesGst
      : restaurantDefaultIncludesGst;

  const gstInclusiveItemAmount = items.reduce(
    (sum, it) => lineIncludesGst(it)
      ? sum + ((Number(it.price) || 0) + (Number(it.addonsTotal) || 0)) * (Number(it.quantity) || 1)
      : sum,
    0,
  );

  // Spend-threshold reward, resolved AFTER the subtotal above and appended
  // without changing it. Order matters: counting the reward toward the amount
  // that earned it would let a zero-priced line push an order over a threshold
  // it never reached, and on a two-tier ladder that cascades.
  //
  // The subtotal it reads is already net of any buy-one-get-one units, which is
  // the same rule stated the other way round: the threshold is measured on what
  // the customer PAYS for, and a free second pizza is not paid for.
  //
  // Server-side because WHETHER a tier is earned is never chosen by the client
  // -- a client asking for a freebie its order hasn't reached gets nothing. But
  // reaching a tier only unlocks it; `dto.claimFreebie` is the customer's own
  // choice to actually take it (the app's Add button on the now-unlocked
  // reward), same as any other line they add to their own cart.
  const { line: freebieLine, tier: freebieTier, nextTier: freebieNextTier } =
    await resolveFreebieForOrder(dto.restaurantId, subtotal, Boolean(dto.claimFreebie));
  if (freebieLine) {
    items.push(freebieLine);
    dto.items = items;
  }

  const feeDoc = await FoodFeeSettings.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();
    
  /*
   * Resolved once, before pricing: the platform fee, the delivery formula, the
   * incentive and the surge are all scoped by zone and must agree on which
   * zone this order is in. Reused for surge further down.
   */
  const orderZoneId = await resolveOrderZoneId(dto, restaurant);

  // Master's platform fee and its GST rate when set (core/finance/platformFees),
  // this zone's own when one is set there.
  const feeSettings = await withMasterFees('food', feeDoc || {
    platformFee: 0,
    deliveryFeeComputationMode: 'distance_order_value',
    gstRate: 0,
    deliveryPartnerIncentiveRule: {
      isEnabled: false,
      minOrderAmount: 0,
      incentivePercent: 0,
    }
  }, { zoneId: orderZoneId });

  // The mode decides who keeps the packaging money, which in turn decides
  // whether an inclusive restaurant's GST setting reaches that line and whether
  // the payout ledger credits it to the restaurant.
  const { packagingFee, packagingMode } = computeFoodPackagingFee({
    items,
    config: normalizePackagingConfig(feeDoc),
  });
  const packagingBelongsToRestaurant = packagingMode === PACKAGING_MODES.RESTAURANT;
  const configuredPlatformFee = Number(feeSettings.platformFee);
  const platformFee = (!Number.isFinite(configuredPlatformFee) || configuredPlatformFee < 0)
    ? 0
    : Math.round(configuredPlatformFee * 100) / 100;

  /*
   * Master > Delivery earnings when a rule is saved there, this module's own
   * fee-settings rule when it is not -- so nothing changes until one is set.
   */
  const incentiveRule = await resolveIncentive({
    vertical: 'food',
    zoneId: orderZoneId,
    legacy: feeSettings.deliveryPartnerIncentiveRule || null,
  });

  const mode = String(feeSettings.deliveryFeeComputationMode || '');
  let deliveryFee = 0;
  let deliveryFeeBreakdown = null;
  let adminDeliveryCommissionPercent = 0;
  let adminDeliveryCommissionAmount = 0;
  let riderDeliveryEarningAfterAdminCommission = 0;
  let adminDeliveryCommissionEnabled = false;
  let deliveryPartnerIncentiveEnabled = Boolean(incentiveRule.isEnabled);
  let deliveryPartnerIncentivePercent = Math.round((Number(incentiveRule.incentivePercent || 0) * 100)) / 100;
  let deliveryPartnerIncentiveAmount = 0;
  let deliveryPartnerIncentiveEligible = false;
  // Hoisted: the free-delivery radius rule below is judged on the SAME road
  // distance the delivery slab was priced from. Re-measuring, or falling back to
  // a straight line here, would let a customer be charged a hill-road fee and
  // then assessed against a crow-flies radius. Null means never measured.
  let measuredDistanceKm = null;

  // Master > Delivery earnings formula, when one is saved: it prices every
  // order by distance whatever this module's own fee mode says, and pays the
  // rider its own figure (core/finance/deliveryFormula.js). Null = old table.
  const deliveryFormula = await resolveDeliveryFormula({ vertical: 'food', zoneId: orderZoneId });

  if (mode === 'distance_order_value' || deliveryFormula) {
    const restCoords = extractCoords(restaurant);
    const customerCoords = extractCoords(dto?.address || dto?.deliveryAddress);
    
    let distanceRule = null;
    let distanceKm = 0;
    let distanceSource = 'unknown';

    if (restCoords && customerCoords) {
      const [rLng, rLat] = restCoords;
      const [cLng, cLat] = customerCoords;
      // Road distance, not straight line. The rider follows the road, and in
      // hill terrain the two differ by a factor of two -- which put orders in
      // a cheaper slab than the trip they actually paid for.
      const measured = await resolveDeliveryDistanceKm(
        { lat: rLat, lng: rLng },
        { lat: cLat, lng: cLng },
      );
      distanceKm = measured.km;
      distanceSource = measured.source;
      measuredDistanceKm = measured.km;
      if (!deliveryFormula) distanceRule = await resolveDistanceRule(distanceKm, orderZoneId);
    } else {
      // Fallback: If coordinates are missing, assume base distance (0 km) to apply base delivery fee
      if (!deliveryFormula) distanceRule = await resolveDistanceRule(0, orderZoneId);
      /*
       * Worth shouting about. Every order from this restaurant is priced at the
       * nearest slab whatever the real trip, and free delivery can never apply
       * because an unmeasured distance does not qualify. Both are invisible from
       * the outside -- the bill simply looks cheap and the offer simply never
       * fires -- so the cause is recorded here.
       */
      if (!restCoords) {
        console.warn(
          `[pricing] Restaurant ${dto?.restaurantId} has no coordinates: `
          + 'charging the base distance slab, and free delivery cannot apply.',
        );
      }
    }
    
    if (deliveryFormula) {
        const priced = priceDelivery(deliveryFormula.formula, distanceKm);
        deliveryFee = priced.customerFee;
        // The rider's pay is set directly; no share of the fee, no commission.
        riderDeliveryEarningAfterAdminCommission = priced.riderPay;
        deliveryFeeBreakdown = {
          source: 'delivery_formula',
          formulaLevel: deliveryFormula.level,
          formulaSource: deliveryFormula.source,
          distanceKm: priced.distanceKm,
          distanceSource,
          appliedDeliveryFee: priced.customerFee,
          riderPay: priced.riderPay,
          platformKeeps: priced.platformKeeps,
          band: priced.band,
          orderValue: subtotal,
          // Read by order.service as the rider's base pay: already inside riderPay.
          basePayout: 0,
          adminDeliveryCommissionPercent: 0,
          adminDeliveryCommissionAmount: 0,
          riderDeliveryEarningAfterAdminCommission: priced.riderPay,
        };
    } else if (distanceRule) {
        const commissionRows = Array.isArray(feeSettings.distanceSlabAdminDeliveryCommission)
          ? feeSettings.distanceSlabAdminDeliveryCommission
          : [];
        const adminCommissionRow = commissionRows.find((r) => String(r.distanceRuleId) === String(distanceRule._id));
        const minDistance = Number(distanceRule.minDistance || 0);
        const isBaseSlab = minDistance <= 0;
        const userDeliveryFee = Math.round((Number(distanceRule.userDeliveryFee || 0) * 100)) / 100;
        const perKmRate = Number(distanceRule.commissionPerKm || 0);
        const fixedPayout = Math.round((Number(distanceRule.basePayout || 0) * 100)) / 100;

        /*
         * The band's fee plus its per-km charge for distance beyond the band's
         * start (core/finance/deliveryEarnings.service.js). With no extra rate
         * set this is exactly what it was: the flat customer fee where one
         * exists, otherwise the per-km rate over the whole trip.
         */
        const charged = bandFee(distanceRule, distanceKm);
        deliveryFee = charged.fee;

        adminDeliveryCommissionEnabled = adminCommissionRow?.isEnabled === true;
        adminDeliveryCommissionPercent = adminDeliveryCommissionEnabled
          ? Math.round((Number(adminCommissionRow?.adminDeliveryCommissionPercent || 0) * 100)) / 100
          : 0;
        adminDeliveryCommissionAmount = Math.round((deliveryFee * (adminDeliveryCommissionPercent / 100)) * 100) / 100;
        riderDeliveryEarningAfterAdminCommission = Math.round(Math.max(0, deliveryFee - adminDeliveryCommissionAmount) * 100) / 100;
        deliveryFeeBreakdown = {
          source: 'distance_slab',
          distanceKm: Math.round(Number(distanceKm || 0) * 100) / 100,
          // Recorded so a disputed fee can be traced to how it was measured.
          distanceSource,
          distanceRuleId: String(distanceRule._id),
          distanceRange: {
            minDistance,
            maxDistance: distanceRule.maxDistance == null ? null : Number(distanceRule.maxDistance)
          },
          orderValue: subtotal,
          appliedDeliveryFee: Number(deliveryFee || 0),
          feeComputation: isBaseSlab ? 'base_slab_commission_per_km_source' : 'commission_per_km_x_total_distance',
          userDeliveryFee,
          basePayout: fixedPayout,
          commissionPerKm: perKmRate,
          // Recorded so a long trip's bill can be read back: what the band
          // charges, and what the distance past it added.
          extraPerKm: Number(distanceRule.extraPerKm || 0),
          extraDistanceKm: charged.extraKm,
          extraDistanceAmount: charged.extra,
          adminDeliveryCommissionPercent,
          adminDeliveryCommissionAmount,
          riderDeliveryEarningAfterAdminCommission,
          feeSource: isBaseSlab ? 'distance_base_slab' : 'distance_non_base_slab'
        };
      }
  }

  /*
   * The restaurant's own delivery radius (shared/serviceRadius.js).
   *
   * Judged on the road distance the fee was priced from. When the fee did not
   * need a distance, it is measured here the same way, so the rule does not
   * depend on how delivery happens to be charged. Not thrown from here: the cart
   * quote has to come back so the app can show why, and createOrder refuses
   * the order on `serviceability.deliverable === false`.
   */
  let serviceability = {
    applies: false,
    deliverable: true,
    radiusKm: null,
    distanceKm: measuredDistanceKm,
    reason: '',
  };
  // Every restaurant with a map pin: its own radius, or the platform default
  // (resolveEffectiveServiceRadius). One without a pin cannot be measured, and
  // refusing it for that would stop it trading; the zone check below still holds.
  if (extractCoords(restaurant)) {
    const { resolveEffectiveServiceRadius, judgeServiceRadius } =
      await import('../../shared/serviceRadius.js');
    const { loadServiceRadiusSettings } =
      await import('../../restaurant/services/serviceRadius.service.js');
    const effective = resolveEffectiveServiceRadius({
      restaurantRadiusKm: restaurant.serviceRadiusKm,
      settings: await loadServiceRadiusSettings(),
    });

    if (measuredDistanceKm === null) {
      const restCoords = extractCoords(restaurant);
      const customerCoords = extractCoords(dto?.address || dto?.deliveryAddress);
      if (restCoords && customerCoords) {
        const measured = await resolveDeliveryDistanceKm(
          { lat: restCoords[1], lng: restCoords[0] },
          { lat: customerCoords[1], lng: customerCoords[0] },
        );
        if (measured.source !== 'unknown') measuredDistanceKm = measured.km;
      }
    }

    serviceability = judgeServiceRadius({
      radiusKm: effective.radiusKm,
      distanceKm: measuredDistanceKm,
      measured: measuredDistanceKm !== null,
    });
  }

  /*
   * The restaurant's zone. The radius above is optional and most restaurants
   * never set one, so without this nothing stopped an Indore restaurant taking
   * an order to Palampur (six such orders reached production on 15-21 Sep
   * 2026). Quick commerce has refused these since resolveServiceableZone; food
   * now does the same, on food's own zone map.
   *
   * An address with no saved location is let through, as quick commerce's
   * catalogue did before it: refusing it would block customers over data they
   * never entered, and the radius check still covers restaurants that set one.
   *
   * So is every address on a platform that has drawn no food zones yet: with
   * none, "outside every zone" would be every address, and a new site could
   * take no orders at all until someone found the zone screen.
   */
  if (
    serviceability.deliverable !== false
    && extractCoords(dto?.address || dto?.deliveryAddress)
    && (await FoodZone.exists({ isActive: true }))
  ) {
    const addressZoneId = await detectZoneIdFromAddress(dto?.address || dto?.deliveryAddress);
    const restaurantZoneId = restaurant?.zoneId ? String(restaurant.zoneId) : '';
    if (!addressZoneId) {
      serviceability = {
        ...serviceability,
        deliverable: false,
        code: 'OUTSIDE_ALL_ZONES',
        reason: "We don't deliver to this address yet.",
      };
    } else if (restaurantZoneId && restaurantZoneId !== addressZoneId) {
      serviceability = {
        ...serviceability,
        deliverable: false,
        code: 'OUTSIDE_RESTAURANT_ZONE',
        reason: "This restaurant doesn't deliver to your selected address. Please choose a restaurant near you.",
      };
    }
  }

  /**
   * Free-delivery dishes waive the fee, but only when the whole order is made of
   * them.
   *
   * Waiving as soon as any one such dish is present would make the flag a
   * loophole: add the cheapest free-delivery item to any basket and the delivery
   * is free on everything. Requiring all of them keeps the promise honest -- the
   * dish ships free, not everything it is ordered alongside.
   *
   * The rider is still paid: only what the customer is charged is waived, which
   * is why riderDeliveryEarningAfterAdminCommission is left untouched and the
   * platform absorbs the difference. That is also why this is admin-only.
   */
  /*
   * The spend-threshold reward is left out of the check. It was appended above
   * with no freeDelivery flag of its own, so an all-free-delivery cart that
   * earned a reward lost its free delivery: the customer was charged Rs 30 for
   * spending enough to get a gift. The reward is not something the customer
   * ordered, so it has no say in how the order ships.
   */
  const orderedMenuItems = (Array.isArray(items) ? items : []).filter((line) => !line?.isFreebie);
  const allItemsShipFree = orderedMenuItems.length > 0
    && orderedMenuItems.every((line) => line?.freeDelivery === true);

  /*
   * Platform-funded free delivery: close enough AND spending enough.
   *
   * Evaluated before the all-items waiver below so that whichever applies, the
   * fee is waived once and the breakdown records which rule did it. Both are
   * absorbed by the platform rather than the restaurant, and neither changes
   * what the rider is paid.
   */
  if (deliveryFee > 0 && !allItemsShipFree) {
    try {
      const { qualifiesForFreeDelivery, resolveEffectiveFreeDeliveryRule } =
        await import('../../shared/freeDeliveryRule.js');
      // A restaurant's own setting wins over the platform rule, including an
      // explicit opt-out. `source` is recorded so reconciliation can tell a
      // platform promotion from a per-restaurant one.
      const { rule, source: freeDeliverySource } = resolveEffectiveFreeDeliveryRule({
        restaurant: restaurant?.freeDeliveryRule,
        platform: feeSettings?.freeDeliveryRule,
      });
      if (qualifiesForFreeDelivery({ rule, distanceKm: measuredDistanceKm, subtotal })) {
        const waivedAmount = deliveryFee;
        deliveryFee = 0;
        deliveryFeeBreakdown = {
          ...(deliveryFeeBreakdown || {}),
          freeDeliveryApplied: true,
          freeDeliveryReason: 'distance_and_order_value',
          freeDeliverySource,
          freeDeliveryRule: {
            maxDistanceKm: rule.maxDistanceKm,
            minOrderAmount: rule.minOrderAmount,
            distanceKm: measuredDistanceKm,
          },
          // Kept so the order records what would have been charged, and so
          // reconciliation can see what the platform absorbed.
          waivedDeliveryFee: waivedAmount,
          appliedDeliveryFee: 0,
        };
      }
    } catch (err) {
      // A broken rule must never block an order; the fee simply stands.
      console.error('Free delivery rule evaluation failed:', err?.message || err);
    }
  }

  if (allItemsShipFree && deliveryFee > 0) {
    const waivedAmount = deliveryFee;
    deliveryFee = 0;
    deliveryFeeBreakdown = {
      ...(deliveryFeeBreakdown || {}),
      freeDeliveryApplied: true,
      // Kept so the order records what would have been charged, and so
      // reconciliation can see what the platform absorbed.
      waivedDeliveryFee: waivedAmount,
      appliedDeliveryFee: 0,
    };
  }

  const incentiveThreshold = Math.round((Number(incentiveRule.minOrderAmount || 0) * 100)) / 100;
  deliveryPartnerIncentiveEligible =
    deliveryPartnerIncentiveEnabled &&
    Number.isFinite(subtotal) &&
    subtotal >= incentiveThreshold &&
    deliveryPartnerIncentivePercent > 0;
  deliveryPartnerIncentiveAmount = deliveryPartnerIncentiveEligible
    ? Math.round((subtotal * (deliveryPartnerIncentivePercent / 100)) * 100) / 100
    : 0;

  const gstRate = Number(feeSettings.gstRate);
  const validGstRate = (!Number.isFinite(gstRate) || gstRate < 0) ? 0 : gstRate;

  let discount = 0;
  let appliedCoupon = null;
  /*
   * Who paid for the coupon, which decides what the GST is charged on
   * (shared/billing.js). Admin-created is the default and the fallback, and it
   * means the platform funded it -- matching how the money is actually settled
   * in foodTransaction.service.js, where an admin coupon comes off the
   * platform's profit and leaves the restaurant's payout whole.
   */
  let discountFundedByPlatform = false;
  // Why an entered coupon was not applied, in words the customer can act on.
  // The app used to say only "not applicable", so a first-order coupon tried
  // on an account with past orders looked like a broken coupon.
  let couponRejectedReason = null;
  const codeRaw = dto.couponCode
    ? String(dto.couponCode).trim().toUpperCase()
    : "";

  if (codeRaw) {
    const now = new Date();
    const offer = await FoodOffer.findOne({ couponCode: codeRaw }).lean();
    if (offer) {
      const statusOk = offer.status === "active";
      const startOk = !offer.startDate || now >= new Date(offer.startDate);
      const endOk = !offer.endDate || now < new Date(offer.endDate);
      const scopeOk =
        offer.restaurantScope !== "selected" ||
        String(offer.restaurantId || "") === String(dto.restaurantId || "");
      const minOk = subtotal >= (Number(offer.minOrderValue) || 0);

      /*
       * The same ceiling the claim applies (couponUsage.service.js). Checked
       * here too so a quote never shows a discount that placing the order would
       * then refuse -- the customer sees the coupon decline at the point they
       * enter it, not after they have committed.
       */
      const promoCeiling = await resolvePromoCeiling({ vertical: 'food' });
      const effectiveUsageLimit = tighten(offer.usageLimit, promoCeiling.total);
      const effectivePerUserLimit = tighten(offer.perUserLimit, promoCeiling.perUser);

      let usageOk = true;
      if (
        effectiveUsageLimit !== null &&
        Number(offer.usedCount || 0) >= effectiveUsageLimit
      ) {
        usageOk = false;
      }

      /*
       * Per-user and first-order limits count only orders that happened.
       *
       * Both used to count every order document the customer had, and an online
       * checkout abandoned at the payment sheet leaves one behind in
       * pending_payment for good. So one failed payment spent a first-order
       * coupon, and the FoodOfferUsage counter had already been bumped for it.
       * The customer's own orders are the record here: the ones paid for or
       * placed on cash, and not cancelled. That also forgives uses the old
       * counter took for attempts nobody paid for.
       *
       * The second branch of the $or covers orders saved before appliedCoupon
       * was stored, which carry only the code and the discount it gave.
       */
      const countedOrders = userId
        ? {
            userId: new mongoose.Types.ObjectId(userId),
            orderStatus: { $nin: ORDER_STATUSES_NOT_COUNTED_FOR_COUPONS },
          }
        : null;

      let perUserOk = true;
      if (countedOrders && effectivePerUserLimit !== null) {
        const used = await FoodOrder.countDocuments({
          ...countedOrders,
          $or: [
            { "pricing.appliedCoupon.code": codeRaw },
            { "pricing.couponCode": codeRaw, "pricing.discount": { $gt: 0 } },
          ],
        });
        if (used >= effectivePerUserLimit) {
          perUserOk = false;
        }
      }

      let firstOrderOk = true;
      if (
        countedOrders &&
        (offer.customerScope === "first-time" || offer.isFirstOrderOnly === true)
      ) {
        const previousOrders = await FoodOrder.countDocuments(countedOrders);
        if (previousOrders > 0) firstOrderOk = false;
      }

      const minOrder = Number(offer.minOrderValue) || 0;
      if (!statusOk || !endOk) couponRejectedReason = 'This coupon has expired.';
      else if (!startOk) couponRejectedReason = 'This coupon is not active yet.';
      else if (!scopeOk) couponRejectedReason = 'This coupon is not valid for this restaurant.';
      else if (!firstOrderOk) couponRejectedReason = 'This coupon is only for your first order.';
      else if (!minOk) couponRejectedReason = `Add items worth Rs ${Math.ceil(minOrder - subtotal)} more to use this coupon (minimum order Rs ${minOrder}).`;
      else if (!perUserOk) couponRejectedReason = 'You have already used this coupon the maximum number of times.';
      else if (!usageOk) couponRejectedReason = 'This coupon has reached its usage limit.';

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
        if (offer.discountType === "percentage") {
          const raw = subtotal * (Number(offer.discountValue) / 100);
          const capped = Number(offer.maxDiscount)
            ? Math.min(raw, Number(offer.maxDiscount))
            : raw;
          discount = Math.max(0, Math.min(subtotal, Math.floor(capped)));
        } else {
          discount = Math.max(
            0,
            Math.min(subtotal, Math.floor(Number(offer.discountValue) || 0)),
          );
        }
        appliedCoupon = { code: codeRaw, discount };
        discountFundedByPlatform = offer.createdByRole !== 'RESTAURANT';
      }
    } else {
      couponRejectedReason = 'This coupon code does not exist.';
    }
  }

  const zoneIdForSurge = orderZoneId;
  let surgeAmount = 0;
  if (zoneIdForSurge) {
    const surgeConfig = await FoodDeliverySurgeZone.findOne({ zoneId: zoneIdForSurge }).lean();
    if (surgeConfig?.isEnabled) {
      surgeAmount = Math.round((Number(surgeConfig.surgeAmount || 0) * 100)) / 100;
    }
  }

  /*
   * The bill, built in one place so the printed lines reconcile with the
   * printed total. See shared/billing.js for the shape and the two rules that
   * matter: paise everywhere with a single rounding at the end, and GST on the
   * food and the platform fee only -- never on the delivery fee or the tip,
   * which are the rider's money.
   */
  const bill = computeBill({
    itemAmount: subtotal,
    discountFundedByPlatform,
    packagingFee,
    deliveryFee,
    platformFee,
    surgeAmount,
    discount,
    tip: normalizeTip(dto?.tip ?? dto?.tipAmount),
    gstRate: validGstRate,
    /*
     * `Number(null)` and `Number('')` are both 0, and 0 is finite -- so an
     * admin who cleared this field, or a document holding an empty string,
     * would silently stop the platform fee being taxed at all. Absence has to
     * be tested before the number is.
     */
    platformFeeGstRate:
      feeSettings.platformFeeGstRate != null
      && feeSettings.platformFeeGstRate !== ''
      && Number.isFinite(Number(feeSettings.platformFeeGstRate))
        ? Number(feeSettings.platformFeeGstRate)
        : DEFAULT_PLATFORM_FEE_GST_RATE,
    pricesIncludeGst: restaurantDefaultIncludesGst,
    /*
     * The per-dish answer. A cart can mix the two, so the bill is told how much
     * of the food already contained its tax rather than a single yes/no.
     */
    gstInclusiveItemAmount,
    packagingBelongsToRestaurant,
  });

  // Kept under their existing names so every reader that predates the bill --
  // the app's summary, the order record, the POS payload -- keeps working.
  const tax = bill.gstOnItems;
  const total = bill.grandTotal;

  return {
    /**
     * The lines this pricing was computed from, including any freebie appended
     * above. Returned rather than mutated onto the caller's dto: createOrder
     * passes a spread copy here, so a mutation would be invisible to it and the
     * reward would be priced but never saved on the order.
     */
    items,
    pricing: {
      subtotal,
      tax,
      packagingFee,
      deliveryFee,
      deliveryFeeBreakdown,
      /*
       * How far the rider actually goes, road distance, restaurant to door.
       *
       * Its own field rather than dug out of deliveryFeeBreakdown: that object
       * only carries a distance when the fee came from a distance slab, so a
       * flat-fee platform or a free-delivery order had none, and the cart
       * cannot show a figure that appears and disappears with the pricing rule.
       *
       * Null, never 0, when it could not be measured -- one of the two
       * addresses has no coordinates. Zero is a real answer (the customer is at
       * the restaurant) and must not be how "unknown" is spelled.
       */
      distanceKm: measuredDistanceKm == null
        ? null
        : Math.round(Number(measuredDistanceKm) * 100) / 100,
      /*
       * Whether this restaurant delivers to this address at all, by its own
       * radius. `deliverable: false` carries the reason to show; order
       * placement refuses on it. `applies: false` when the restaurant has set
       * no radius.
       */
      serviceability,
      adminDeliveryCommissionEnabled,
      adminDeliveryCommissionPercent,
      adminDeliveryCommissionAmount,
      riderDeliveryEarningAfterAdminCommission,
      deliveryPartnerIncentiveEnabled,
      deliveryPartnerIncentivePercent,
      deliveryPartnerIncentiveAmount,
      deliveryPartnerIncentiveEligible,
      platformFee,
      surgeAmount,
      discount,
      /*
       * Carried on the pricing so the settled bill at order creation taxes the
       * same value the quote did, and so a past order can be read back and
       * explained. Orders priced before this existed have no such field, and
       * default to the old treatment -- which is what keeps the change forward
       * only.
       */
      discountFundedByPlatform,
      total,
      /*
       * The bill line by line, for a summary that shows its working. `tax` and
       * `total` above are the same numbers under their old names.
       */
      bill,
      /*
       * What restaurant commission is charged on: the food net of GST.
       *
       * Identical to `subtotal` for a restaurant that prices net, which is all
       * of them by default. For one whose prices include GST it is the smaller
       * figure, because the tax inside the price is collected for the
       * government and the restaurant never keeps it -- taking a commission
       * percentage of it would be taking a cut of tax.
       *
       * `subtotal` deliberately keeps its old meaning, the listed food total,
       * because free-delivery minimums and coupon thresholds are measured on
       * what the customer thinks they are spending.
       */
      commissionableAmount: bill.commissionBase,
      pricesIncludeGst: bill.pricesIncludeGst,
      gstInclusiveItemAmount: bill.gstInclusiveItemAmount,
      packagingMode: packagingMode || '',
      /*
       * The food and packaging lines the bill prints, net of the GST shown
       * beside them. `subtotal` and `packagingFee` above stay as listed, which
       * is what free-delivery minimums and coupon thresholds are measured on.
       */
      netItemAmount: bill.netItemAmount,
      netPackagingFee: bill.netPackagingFee,
      gstRate: bill.gstRate,
      platformFeeGst: bill.platformFeeGst,
      platformFeeGstRate: bill.platformFeeGstRate,
      tip: bill.tip,
      roundOff: bill.roundOff,
      totalBeforeTip: bill.totalBeforeTip,
      currency: "INR",
      couponCode: appliedCoupon?.code || codeRaw || null,
      appliedCoupon,
      couponRejectedReason: appliedCoupon ? null : couponRejectedReason,
      /**
       * The spend-threshold reward, for the cart and the order summary.
       *
       * `earned` is what this order qualified for; `next` is the nearest tier it
       * has not reached, so a cart can say "add Rs.40 more for a free Gulab
       * Jamun". Both come from the same resolution the order itself uses, so the
       * cart cannot promise something the order would not give.
       */
      /**
       * Buy-one-get-one, for the cart banner and the order summary.
       *
       * DISPLAY ONLY. The saving is already out of `subtotal` above -- the free
       * units were split onto zero-priced lines before it was summed -- so it is
       * deliberately absent from the `total` arithmetic. Subtracting it there
       * would take the same discount twice.
       */
      bogo: {
        totalFreeUnits: bogo.totalFreeUnits,
        savings: bogo.savings,
        lines: bogo.lines,
        /**
         * Lines one or more units short of another free one, so the cart can say
         * "add 1 more and get it free". Same resolution the split above used, so
         * the cart cannot promise a free unit the order would not grant.
         */
        next: bogo.next,
      },
      freebie: {
        earned: freebieTier
          ? {
              minOrderValue: freebieTier.minOrderValue,
              rewardType: freebieTier.rewardType,
              name: freebieTier.rewardName || '',
              // Whether this tap of calculate actually added the free line --
              // earning it only unlocks the Add button, see resolveFreebieForOrder.
              claimed: Boolean(freebieLine),
            }
          : null,
        next: freebieNextTier
          ? {
              minOrderValue: freebieNextTier.minOrderValue,
              amountAway: freebieNextTier.amountAway,
              rewardType: freebieNextTier.rewardType,
              name: freebieNextTier.rewardName || '',
            }
          : null,
      },
    },
  };
}
