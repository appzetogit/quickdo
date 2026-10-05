import { FoodFreebieOffer } from '../admin/models/freebieOffer.model.js';
import {
    buildFreebieLine,
    describeNextFreebieTier,
    resolveFreebieTier,
} from './freebieRewards.js';

/**
 * Resolve a restaurant's spend-threshold reward for an order.
 *
 * Kept out of the pricing service so the same resolution serves the order path,
 * the cart preview and the menu nudge -- three callers that must agree, because
 * a customer who is promised a freebie in the cart and does not receive it on
 * the order has been lied to by the same system twice.
 */

/** The ladder configured for a restaurant, or an empty one. */
export async function getFreebieOffer(restaurantId) {
    if (!restaurantId) return null;
    return FoodFreebieOffer.findOne({ restaurantId }).lean();
}

/**
 * What this order earns, and what the next tier would take.
 *
 * @param {string} restaurantId
 * @param {number} subtotal  paid item subtotal, excluding fees and any freebie
 * @param {boolean} [claimed]  the customer tapped Add on the earned reward.
 *   `tier`/`nextTier` are always resolved (they drive the progress banner
 *   whether or not anything has been claimed yet); `line` -- the actual free
 *   order line -- is only ever built when this is true, so simply crossing
 *   the threshold never adds anything to the order by itself.
 * @returns {{ line: object|null, tier: object|null, nextTier: object|null }}
 */
export async function resolveFreebieForOrder(restaurantId, subtotal, claimed = false) {
    const empty = { line: null, tier: null, nextTier: null };

    const offer = await getFreebieOffer(restaurantId);
    if (!offer || offer.isActive === false) return empty;

    const tiers = offer.tiers || [];
    const nextTierRaw = describeNextFreebieTier(tiers, subtotal);
    const tier = resolveFreebieTier(tiers, subtotal);

    // Name the next reward too, so the client can say WHAT is coming rather than
    // only that something is.
    const nextTier = nextTierRaw
        ? { ...nextTierRaw, rewardName: (await loadReward(restaurantId, nextTierRaw))?.name || '' }
        : null;

    if (!tier) return { ...empty, nextTier };

    // Resolved either way: the app needs the reward's name to show "Free Cold
    // Drink unlocked!" the instant the threshold is crossed, not only after
    // it's been claimed.
    const reward = await loadReward(restaurantId, tier);
    const earnedTier = { ...tier, rewardName: reward?.name || '' };
    if (!claimed) return { line: null, tier: earnedTier, nextTier };

    return { line: buildFreebieLine(tier, reward), tier: earnedTier, nextTier };
}

/**
 * Look up the item or add-on a tier gives away.
 *
 * Scoped to the restaurant and to sellable records: a reward pointing at a
 * withdrawn dish, another shop's item, or an unapproved add-on resolves to null,
 * and the caller drops the freebie rather than failing the order. The lookups
 * are lazy imports because this module is pulled into the pricing path, which
 * both the food and quick-commerce stacks load.
 */
async function loadReward(restaurantId, tier) {
    if (!tier) return null;

    if (tier.rewardType === 'manual') {
        // No catalogue row to look up -- whatever the admin typed IS the
        // reward. No id: buildFreebieLine's line has nothing to link back to
        // a FoodItem/FoodAddon for this type.
        const name = String(tier.rewardName || '').trim();
        return name ? { _id: null, name } : null;
    }

    if (tier.rewardType === 'addon') {
        if (!tier.rewardAddonId) return null;
        // Not wrapped in a catch: a bad path here would make every add-on reward
        // silently resolve to nothing, which looks exactly like a restaurant
        // having configured one badly.
        const { FoodAddon } = await import('../restaurant/models/foodAddon.model.js');

        const doc = await FoodAddon.findOne({
            _id: tier.rewardAddonId,
            restaurantId,
            isDeleted: { $ne: true },
        }).lean();
        if (!doc) return null;

        // Published values only -- `draft` is what admin has not approved yet.
        const name = doc.published?.name || doc.name || '';
        return name ? { _id: doc._id, name } : null;
    }

    if (!tier.rewardItemId) return null;
    const { FoodItem } = await import('../admin/models/food.model.js');
    const doc = await FoodItem.findOne({
        _id: tier.rewardItemId,
        restaurantId,
        isActive: { $ne: false },
        isAvailable: { $ne: false },
    })
        .select('_id name')
        .lean();

    return doc?.name ? { _id: doc._id, name: doc.name } : null;
}

/**
 * Save a ladder from either panel.
 *
 * Upserts on restaurantId, which is unique, so the two panels editing the same
 * restaurant cannot create rival documents.
 */
export async function saveFreebieOffer(restaurantId, { tiers, isActive, updatedByRole }) {
    const update = { updatedByRole: updatedByRole || 'RESTAURANT' };
    if (tiers !== undefined) update.tiers = tiers;
    if (isActive !== undefined) update.isActive = isActive !== false;

    return FoodFreebieOffer.findOneAndUpdate(
        { restaurantId },
        { $set: update, $setOnInsert: { restaurantId } },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();
}
