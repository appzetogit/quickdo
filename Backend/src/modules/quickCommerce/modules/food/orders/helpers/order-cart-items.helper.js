import mongoose from 'mongoose';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

function toObjectIds(ids = []) {
  return [...new Set(ids)]
    .map((id) => String(id || '').trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

const hasRate = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
function lineGstRate(variant, foodDoc) {
  if (variant && hasRate(variant.gstRate)) return Number(variant.gstRate);
  if (hasRate(foodDoc?.gstRate)) return Number(foodDoc.gstRate);
  return null;
}

function resolveFoodItemPrice(foodDoc, rawItem) {
  const variantId = String(rawItem?.variantId || '').trim();
  const variants = Array.isArray(foodDoc?.variants) ? foodDoc.variants : [];

  if (variantId) {
    const variant = variants.find((entry) => String(entry?._id) === variantId);
    if (!variant) {
      throw new ValidationError(`${foodDoc.name} is no longer available in the selected size`);
    }
    const price = Number(variant.price) || 0;
    const otherPrice = Number(variant.otherPrice) || 0;
    return {
      price,
      otherPrice: otherPrice > price ? otherPrice : 0,
      variantId,
      variantName: String(variant.name || rawItem?.variantName || '').trim(),
      variantPrice: price,
    };
  }

  if (variants.length > 0) {
    throw new ValidationError(`Please select a size for ${foodDoc.name}`);
  }

  const price = Number(foodDoc.price) || 0;
  const otherPrice = Number(foodDoc.otherPrice) || 0;
  return {
    price,
    otherPrice: otherPrice > price ? otherPrice : 0,
    variantId: '',
    variantName: '',
    variantPrice: price,
  };
}

export async function resolveOrderCartItems(restaurantId, rawItems = []) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) throw new ValidationError('At least one item required');

  const rId = new mongoose.Types.ObjectId(String(restaurantId));
  const itemIds = toObjectIds(items.map((item) => item.itemId || item.id));

  const [foodDocs, addonDocs] = await Promise.all([
    itemIds.length
      ? FoodItem.find({
          restaurantId: rId,
          _id: { $in: itemIds },
          approvalStatus: 'approved',
        }).lean()
      : [],
    itemIds.length
      ? FoodAddon.find({
          restaurantId: rId,
          _id: { $in: itemIds },
          isDeleted: { $ne: true },
          approvalStatus: 'approved',
          isAvailable: true,
          published: { $ne: null },
        })
          .select('_id published')
          .lean()
      : [],
  ]);

  const foodById = new Map(foodDocs.map((doc) => [String(doc._id), doc]));
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));

  // Add-ons attached to a line, rather than sent as their own line item.
  //
  // These were dropped entirely: resolveFoodItemPrice only ever looked at
  // variants, so a customer who picked "Extra Cheese" was shown a total
  // including it and then billed without it, with nothing recorded on the
  // order. The restaurant absorbed the difference.
  //
  // Looked up across the whole restaurant, not just the ids in the cart, since
  // an attached add-on's id never appears in items[].itemId.
  const restaurantAddons = await FoodAddon.find({
    restaurantId: rId,
    isDeleted: { $ne: true },
    approvalStatus: 'approved',
  }).lean();

  const attachableById = new Map();
  const attachableByName = new Map();
  for (const doc of restaurantAddons) {
    const published = doc?.published;
    if (!published?.name) continue;
    const entry = {
      addonId: String(doc._id),
      name: String(published.name).trim(),
      price: Number(published.price) || 0,
    };
    attachableById.set(entry.addonId, entry);
    attachableByName.set(entry.name.toLowerCase(), entry);
  }

  /**
   * Resolves whatever the client attached to a line into priced add-ons.
   *
   * Accepts ids or names, and objects or bare strings, because the shipped
   * apps send names while a corrected client sends ids — matching both means
   * live orders are billed correctly today without waiting on an app release.
   * Anything unrecognised is ignored rather than guessed at: charging for an
   * add-on we cannot identify is worse than omitting it.
   */
  const resolveAttachedAddons = (raw) => {
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const out = [];
    for (const entry of raw) {
      const key = String(
        (entry && typeof entry === 'object' ? entry.addonId ?? entry.id ?? entry.name : entry) ?? '',
      ).trim();
      if (!key) continue;
      const match = attachableById.get(key) || attachableByName.get(key.toLowerCase());
      if (match) out.push({ ...match });
    }
    return out;
  };

  const resolved = [];

  for (const rawItem of items) {
    const itemId = String(rawItem?.itemId || rawItem?.id || '').trim();
    const quantity = Math.max(1, Number(rawItem?.quantity) || 1);

    if (!itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
      throw new ValidationError('One or more cart items are invalid');
    }

    const foodDoc = foodById.get(itemId);
    if (foodDoc) {
      if (foodDoc.isAvailable === false) {
        throw new ValidationError(`${foodDoc.name} is currently unavailable`);
      }

      // Cheap pre-checks so the customer is told at checkout rather than after
      // the reservation fails. Stock is still claimed atomically at order
      // creation -- this read is a courtesy, not the guard.
      const cap = Number(foodDoc.maxQtyPerOrder);
      if (Number.isFinite(cap) && cap > 0 && quantity > cap) {
        throw new ValidationError(`You can order at most ${cap} of ${foodDoc.name}`);
      }

      const pricing = resolveFoodItemPrice(foodDoc, rawItem);
      const variant = pricing.variantId
        ? (foodDoc.variants || []).find((v) => String(v?._id) === pricing.variantId)
        : null;

      // A chosen size counts its own stock when it tracks one; otherwise the
      // product's. Matches what inventory.service.js claims at order creation.
      const sizeTracked = variant && variant.stockQty !== null && variant.stockQty !== undefined;
      const onHand = sizeTracked ? variant.stockQty : foodDoc.stockQty;
      const label = variant ? `${foodDoc.name} (${variant.name})` : foodDoc.name;
      if (onHand !== null && onHand !== undefined && Number(onHand) < quantity) {
        throw new ValidationError(
          Number(onHand) > 0
            ? `Only ${Number(onHand)} left of ${label}. Please reduce the quantity.`
            : `${label} just went out of stock`,
        );
      }
      const addons = resolveAttachedAddons(rawItem?.addons);
      const addonsTotal = addons.reduce((sum, a) => sum + a.price, 0);

      resolved.push({
        itemId,
        name: String(foodDoc.name || rawItem?.name || 'Item').trim(),
        ...pricing,
        // The unit price the customer pays, add-ons included, so subtotal and
        // every total derived from it match what the app displayed.
        price: pricing.price + addonsTotal,
        addons,
        quantity,
        // Carried onto the line so tax is computed per product rather than at
        // one rate for the whole basket: the chosen size's own rate, else the
        // product's. null defers to the order-wide rate.
        gstRate: lineGstRate(variant, foodDoc),
        brand: String(foodDoc.brand || ''),
        packSize: String(foodDoc.packSize || ''),
        // Snapshotted so category reporting survives a rename or a delete.
        categoryId: foodDoc.categoryId || null,
        categoryName: String(foodDoc.categoryName || ''),
        isVeg: String(foodDoc.foodType || '').toLowerCase() === 'veg',
        image: String(foodDoc.image || rawItem?.image || ''),
        notes: String(rawItem?.notes || ''),
      });
      continue;
    }

    const addonDoc = addonById.get(itemId);
    if (addonDoc?.published) {
      const published = addonDoc.published;
      const price = Number(published.price) || 0;
      resolved.push({
        itemId,
        name: String(published.name || rawItem?.name || 'Add-on').trim(),
        price,
        otherPrice: 0,
        variantId: '',
        variantName: '',
        variantPrice: price,
        quantity,
        isVeg: published.foodType !== 'non-veg',
        image: String(published.image || rawItem?.image || ''),
        notes: String(rawItem?.notes || ''),
      });
      continue;
    }

    // An id that exists but belongs to somebody else is a mixed-seller cart,
    // not a missing product. Both used to say "no longer available", which sent
    // the customer looking for a stock problem that was never there.
    //
    // An order carries one restaurantId, one delivery fee and one rider, so a
    // basket spanning two sellers cannot be placed as it stands.
    // ponytail: reject and say so. Splitting into an order per seller is the
    // real answer, and it is a much bigger change -- separate fees, separate
    // dispatch, separate cancellation and refund per part.
    const foreign = await FoodItem.findById(itemId).select('name restaurantId').lean();
    if (foreign?._id && String(foreign.restaurantId) !== String(rId)) {
      throw new ValidationError(
        `${foreign.name} is sold by a different seller. Please order from one seller at a time.`,
      );
    }

    throw new ValidationError(
      `${String(rawItem?.name || 'An item')} is no longer available from this seller`,
    );
  }

  return resolved;
}
