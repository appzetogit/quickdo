import mongoose from 'mongoose';
import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Add-ons chosen for one order line.
 *
 * Add-ons are a restaurant-wide pool, and a dish opts into the ones that make
 * sense for it via `addonIds`. Four things have to hold before one can be
 * charged, and the client is trusted for none of them:
 *
 *   1. the add-on belongs to the restaurant the order is with;
 *   2. it is approved, available, not deleted, and has a published version;
 *   3. THIS dish actually offers it;
 *   4. the price comes from the published record, never from the request.
 *
 * (4) is the one with money in it. Without it a crafted request could add a
 * ₹0 "Extra Cheese", or attach an add-on from a different restaurant.
 *
 * Priced per unit of the item: two burgers with extra cheese is two lots of it.
 */

const toId = (value) => String(value || '').trim();

/** Most of one add-on on one unit of a dish ("Ketchup x2" is 2). */
export const MAX_ADDON_QUANTITY = 10;

/**
 * Add-on ids a client asked for on one line, validated in shape.
 *
 * An id repeated N times means N of that add-on (the app sends "Ketchup x2" as
 * the id twice), as does an entry `{ addonId, quantity: N }`. Each is capped at
 * MAX_ADDON_QUANTITY. Returned with the repeats, in first-asked order.
 */
export function normalizeRequestedAddonIds(rawLine = {}) {
    const raw = rawLine.addonIds ?? rawLine.addons ?? [];
    const list = Array.isArray(raw) ? raw : [raw];

    const counts = new Map();
    for (const entry of list) {
        const isObject = entry && typeof entry === 'object';
        const id = isObject ? toId(entry.addonId ?? entry.id ?? entry._id) : toId(entry);
        if (!id) continue;
        const qty = isObject && Number.isFinite(Number(entry.quantity)) ? Math.floor(Number(entry.quantity)) : 1;
        if (qty < 1) continue;
        counts.set(id, Math.min(MAX_ADDON_QUANTITY, (counts.get(id) || 0) + qty));
    }

    const invalid = [...counts.keys()].filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalid.length) throw new ValidationError('One or more selected add-ons are not valid');

    return [...counts].flatMap(([id, qty]) => Array(qty).fill(id));
}

/**
 * Normalize the add-on list a menu-item form submitted, and refuse ids that do
 * not belong to this restaurant -- otherwise a dish could offer another shop's
 * add-on, which the order path would then reject at checkout with a confusing
 * message rather than at the point it was configured.
 *
 * Approval state is deliberately NOT required here: a restaurant may attach an
 * add-on that is still awaiting admin approval, and the order path filters on
 * approval at the moment of sale.
 *
 * Returns undefined when the caller sent nothing, so a partial update leaves the
 * stored list alone.
 */
/**
 * Refuse variant add-ons that are not this restaurant's.
 *
 * Same rule as the item-level list: catching it here means the restaurant is
 * told while configuring the dish, rather than a customer hitting a confusing
 * rejection at checkout.
 */
export async function assertVariantAddonsOwned(FoodAddon, restaurantId, variants = []) {
    // Both shapes are read even though the normaliser keeps them in sync: a
    // caller that bypasses it must not be able to smuggle a pairing through.
    const ids = [...new Set(
        (variants || []).flatMap((v) => [
            ...(v?.addonIds || []).map((id) => String(id)),
            ...(v?.addons || []).map((pair) => String(pair?.addonId ?? '')),
        ]).filter(Boolean)
    )];
    if (ids.length === 0) return;

    const owned = await FoodAddon.find({
        _id: { $in: ids.map((v) => new mongoose.Types.ObjectId(v)) },
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        isDeleted: { $ne: true },
    }).select('_id').lean();

    if ((owned || []).length !== ids.length) {
        throw new ValidationError('One or more add-ons selected for a variant do not belong to this restaurant');
    }
}

export async function normalizeAddonIdsInput(FoodAddon, restaurantId, body = {}) {
    if (body?.addonIds === undefined) return undefined;

    const raw = Array.isArray(body.addonIds) ? body.addonIds : [body.addonIds];
    const ids = [...new Set(raw.map((v) => (v && typeof v === 'object' ? toId(v._id ?? v.id) : toId(v))).filter(Boolean))];
    if (ids.length === 0) return { addonIds: [] };

    if (ids.some((v) => !mongoose.Types.ObjectId.isValid(v))) {
        throw new ValidationError('One or more selected add-ons are not valid');
    }

    const owned = await FoodAddon.find({
        _id: { $in: ids.map((v) => new mongoose.Types.ObjectId(v)) },
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        isDeleted: { $ne: true },
    }).select('_id').lean();

    if ((owned || []).length !== ids.length) {
        throw new ValidationError('One or more selected add-ons do not belong to this restaurant');
    }

    return { addonIds: owned.map((d) => d._id) };
}

/**
 * The add-ons a line may offer, given the variant chosen.
 *
 * The item's own list applies to every variant -- an add-on that is valid for
 * the whole dish is set once, not repeated per size -- and the chosen variant
 * contributes any extras specific to it. So "extra cheese" can be attached to
 * Large alone while "extra napkins" stays on the item.
 *
 * With no variant selected, only the item's list applies. That is deliberate:
 * a variant-only add-on should not become orderable by omitting the variant.
 */
export function resolveAllowedAddonIds(menuItem, variantId = null) {
    const allowed = new Set((menuItem?.addonIds || []).map((id) => String(id)));

    if (variantId) {
        const variant = (menuItem?.variants || []).find(
            (v) => String(v?._id) === String(variantId)
        );
        for (const id of variant?.addonIds || []) allowed.add(String(id));
    }

    return allowed;
}

/**
 * Turn requested ids into priced, snapshotted add-ons for a line.
 *
 * @param {object} menuItem   the dish from the database (needs name, addonIds)
 * @param {string[]} requestedIds
 * @param {Map<string, object>} addonsById  published add-on docs for this restaurant
 * @param {string|null} variantId  the chosen variant, whose own add-ons also apply
 * @returns {{ addons: Array<{addonId: any, name: string, price: number}>, addonsTotal: number }}
 */
/**
 * Price overrides the chosen variant defines for its add-ons.
 *
 * The price of an add-on is really the price of a pairing -- extra cheese on a
 * large burger is more cheese than on a small one -- so a variant may carry its
 * own figure per add-on. Absent or null means the add-on's published price.
 *
 * Only the chosen variant's overrides apply: an item-level add-on picked with
 * no variant, or with a variant that says nothing about it, is charged at the
 * add-on's own price, exactly as before this existed.
 */
export function resolveVariantAddonPriceOverrides(menuItem, variantId = null) {
    const overrides = new Map();
    if (!variantId) return overrides;

    const variant = (menuItem?.variants || []).find(
        (v) => String(v?._id) === String(variantId)
    );
    for (const pair of variant?.addons || []) {
        const id = String(pair?.addonId ?? '');
        const price = Number(pair?.price);
        if (id && pair?.price !== null && pair?.price !== undefined && Number.isFinite(price) && price >= 0) {
            overrides.set(id, Math.round(price * 100) / 100);
        }
    }
    return overrides;
}

export function resolveLineAddons(menuItem, requestedIds = [], addonsById = new Map(), variantId = null) {
    if (!requestedIds.length) return { addons: [], addonsTotal: 0 };

    const label = menuItem?.name || 'This item';
    const allowed = resolveAllowedAddonIds(menuItem, variantId);
    const priceOverrides = resolveVariantAddonPriceOverrides(menuItem, variantId);

    // "Ketchup x2" arrives as the id twice: one entry with quantity 2.
    const quantities = new Map();
    for (const id of requestedIds) quantities.set(String(id), (quantities.get(String(id)) || 0) + 1);

    const addons = [...quantities].map(([id, quantity]) => {
        const doc = addonsById.get(String(id));
        // Same message whether the add-on is unknown, belongs to another
        // restaurant, or is withdrawn: the customer can act on it either way, and
        // it does not narrate the catalogue to someone probing ids.
        if (!doc) throw new ValidationError(`A selected add-on is no longer available for "${label}"`);

        if (!allowed.has(String(id))) {
            throw new ValidationError(`"${doc.name}" cannot be added to "${label}"`);
        }

        // The pairing's price wins over the add-on's own: it is what the
        // restaurant set for this size, and what the menu advertised.
        const override = priceOverrides.get(String(id));
        return {
            addonId: doc._id,
            name: doc.name,
            price: override !== undefined ? override : (Number(doc.price) || 0),
            quantity,
        };
    });

    const addonsTotal = Math.round(addons.reduce((sum, a) => sum + a.price * (a.quantity || 1), 0) * 100) / 100;
    return { addons, addonsTotal };
}

/**
 * Load the add-ons a restaurant may currently sell, keyed by id.
 *
 * Published values only -- `draft` is what the restaurant is editing and what
 * admin has not approved, so charging from it would sell an unapproved price.
 */
export async function loadSellableAddons(FoodAddon, restaurantId, ids = []) {
    if (!ids.length) return new Map();

    const docs = await FoodAddon.find({
        _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) },
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        isDeleted: { $ne: true },
        approvalStatus: 'approved',
        isAvailable: true,
        published: { $ne: null },
    })
        .select('_id published')
        .lean();

    return new Map(
        (docs || [])
            .filter((d) => d?.published)
            .map((d) => [String(d._id), {
                _id: d._id,
                name: d.published.name || '',
                price: Number(d.published.price) || 0,
            }])
    );
}
