import { FoodItem } from '../admin/models/food.model.js';
import { collectOtherPriceRatios } from './otherPlatformPricing.js';

/**
 * The most a seeded comparison may claim.
 *
 * A seed copies what the rest of the platform is already advertising, which
 * only helps while that is sane. It was not: the live median sits at 2.28x and
 * the worst dish struck Rs 289 against Rs 73, a claimed 75% saving, from an
 * increase applied repeatedly and compounding each time. Copying that onto
 * every new restaurant would spread it.
 *
 * 1.5 -- a third off -- is the most a seeded figure will claim without someone
 * deciding it deliberately. A real per-dish figure an admin or an adjustment
 * set is untouched by this; the cap applies only where a number is being
 * INVENTED for a dish that has none.
 */
const MAX_SEED_RATIO = Number(process.env.MAX_SEED_COMPARISON_RATIO) || 1.5;

/**
 * The comparison figure a dish should be created with, read from its siblings.
 *
 * A global price adjustment moves the stored otherPrice on the dishes that
 * exist when it runs. Anything added later carries nothing and falls back to
 * the blanket markup, so it advertises a smaller saving than every dish beside
 * it -- 20% next to neighbours at 30% or 70%. This closes that gap at the one
 * moment it can be closed cheaply: creation.
 *
 * The restaurant's own dishes are consulted FIRST. Comparison figures are set
 * per restaurant by adjustments that are often scoped to one restaurant, so a
 * platform-wide median would import another menu's history over a menu that
 * has one of its own.
 *
 * A restaurant that has just onboarded has no history to protect, and that was
 * the hole: its very first dishes found no siblings, seeded nothing, and fell
 * back to the blanket markup -- so a brand-new restaurant advertised a smaller
 * saving than every established one, and no past platform-wide adjustment
 * reached it at all. For that case only, the median widens to the platform.
 *
 * Never throws: failing to seed a comparison figure must not fail a dish save.
 * The blanket markup then applies, which is exactly today's behaviour.
 */
export async function resolveSeedOtherPriceForRestaurant(restaurantId, price) {
    const selling = Number(price);
    if (!Number.isFinite(selling) || selling <= 0) return 0;

    const ratio = await resolveSeedRatioForRestaurant(restaurantId);
    if (!(ratio > 1)) return 0;

    const seeded = Math.round(selling * ratio * 100) / 100;
    return seeded > selling ? seeded : 0;
}

/**
 * The same answer as a ratio rather than a price, for callers writing many
 * dishes at once.
 *
 * A bulk menu upload creates a whole restaurant's dishes in one bulkWrite, and
 * looking the median up per dish would be one query per row. Resolved once, the
 * ratio multiplies each row's own price inside the write.
 *
 * Returns 0 when there is nothing to go on, which callers must read as "leave
 * otherPrice alone" -- the blanket markup then applies, as it always did.
 */
export async function resolveSeedRatioForRestaurant(restaurantId) {
    try {
        if (restaurantId) {
            // A sample, not the whole menu: the median of the most recent fifty
            // is the same answer as the median of five hundred, for a fraction
            // of the read. Newest first, so a menu that has drifted reflects
            // where it is now rather than where it started.
            const siblings = await FoodItem.find({
                restaurantId,
                otherPrice: { $gt: 0 },
            })
                .select('price otherPrice')
                .sort({ createdAt: -1 })
                .limit(50)
                .lean();

            const own = medianRatio(collectOtherPriceRatios(siblings));
            if (own > 1) return own;
        }

        /*
         * Nothing on this menu carries a figure yet -- a restaurant on its first
         * dishes -- so nothing is seeded.
         *
         * This used to widen to a platform-wide median, on the reasoning that a
         * new shop should start where everyone else already is. It meant a
         * restaurant that had just onboarded had a comparison price invented for
         * it from other people's menus: a dish typed at Rs 200 went live struck
         * through at Rs 290, advertising a saving its owner had never offered
         * and could not explain. No adjustment had been applied to that
         * restaurant; the platform simply decided on its behalf.
         *
         * A restaurant's own dishes still seed each other above -- that is its
         * own pricing, carried forward. What another kitchen charges is not.
         */
        return 0;
    } catch (err) {
        console.error('Other-platform seed lookup failed:', err?.message || err);
        return 0;
    }
}

/**
 * Median of the usable ratios, or 0.
 *
 * resolveSeedOtherPrice already computes this, but only ever hands back a
 * price. Sharing the median itself is what lets one lookup serve a whole
 * upload, and keeps both callers on the same statistic.
 */
function medianRatio(ratios) {
    const usable = (Array.isArray(ratios) ? ratios : [])
        .map((r) => Number(r))
        .filter((r) => Number.isFinite(r) && r > 1)
        .sort((a, b) => a - b);
    if (!usable.length) return 0;
    const mid = Math.floor(usable.length / 2);
    const median = usable.length % 2 ? usable[mid] : (usable[mid - 1] + usable[mid]) / 2;
    // Capped, not discarded: a distorted neighbourhood should still seed
    // something, just not the distortion. See MAX_SEED_RATIO.
    return Math.min(median, MAX_SEED_RATIO);
}
