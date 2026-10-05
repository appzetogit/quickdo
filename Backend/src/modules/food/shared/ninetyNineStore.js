import { getFoodDisplayPrice } from '../admin/services/foodVariant.service.js';

/**
 * The Rs 99 store rule, in one place.
 *
 * A dish is on the shelf when it is approved, priced at or under the cap, and
 * flagged. The flag used to be opt-in only -- the admin ticked it by hand -- so
 * a menu full of eligible dishes showed an empty shelf until someone went
 * through them one at a time. It is now set automatically at the moments a dish
 * becomes eligible, and stays under the admin's control afterwards: unticking a
 * dish keeps it off the shelf until its price crosses the cap again.
 *
 * Every write path that can make a dish eligible calls the same helper, so the
 * rule cannot drift between admin-created, restaurant-created and approved
 * items.
 *
 * THE CAP IS NOW CONFIGURABLE, so business can run the shelf at Rs 59 without a
 * deploy. It lives on the landing settings document; this module stays pure and
 * takes it as an argument. `ninetyNineStoreCap.js` does the (cached) reading.
 * Every function defaults to 99, which is what keeps behaviour identical for any
 * caller that has not been told about the setting.
 *
 * Two flags, not one, and the difference matters:
 *
 *   showIn99Store            -- is this dish on the shelf right now
 *   ninetyNineStoreExcluded  -- did an admin deliberately take it off
 *
 * Without the second, `false` would mean both "never been eligible" and "the
 * admin removed it", and a backfill after a cap rise could not tell them apart.
 * It would quietly undo curation every time the cap moved.
 */
export const NINETY_NINE_STORE_MAX_PRICE = 99;

/** A cap has to be a positive number; anything else falls back to the default. */
export const resolveNinetyNineCap = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : NINETY_NINE_STORE_MAX_PRICE;
};

const toPrice = (doc) => {
    const price = Number(getFoodDisplayPrice(doc || {}));
    return Number.isFinite(price) ? price : NaN;
};

/** Priced at or under the cap. NaN and non-positive prices never qualify. */
export const isWithin99Cap = (doc, cap = NINETY_NINE_STORE_MAX_PRICE) => {
    const limit = resolveNinetyNineCap(cap);
    const price = toPrice(doc);
    return Number.isFinite(price) && price > 0 && price <= limit;
};

/**
 * Should this dish be auto-flagged right now?
 *
 * Only when it is approved -- a pending dish flagged early would appear on the
 * shelf the moment approval landed, which is the same outcome, but a rejected
 * one must never carry the flag.
 */
export const shouldAutoMark99 = (doc, cap = NINETY_NINE_STORE_MAX_PRICE) =>
    doc?.approvalStatus === 'approved' && isWithin99Cap(doc, cap);

/**
 * Did an update move the dish INTO the cap?
 *
 * Deliberately a transition, not a state check. If it were "is it under 99
 * now", every save of an already-cheap dish would re-tick a flag the admin had
 * just cleared. Only crossing from above the cap to under it counts.
 *
 * Both sides are judged against the SAME cap. Judging `before` against the old
 * cap and `after` against a new one would make a cap change look like a price
 * change on every dish at once.
 */
export const crossedInto99Cap = (before, after, cap = NINETY_NINE_STORE_MAX_PRICE) =>
    !isWithin99Cap(before, cap) && isWithin99Cap(after, cap);

/**
 * Should a backfill put this dish on the shelf after the cap was raised?
 *
 * Same eligibility as auto-marking, minus anything an admin has deliberately
 * excluded. This is the only rule that consults the exclusion flag, because a
 * backfill is the only moment we act on dishes nobody just edited.
 */
export const shouldBackfillInto99Store = (doc, cap = NINETY_NINE_STORE_MAX_PRICE) =>
    doc?.ninetyNineStoreExcluded !== true
    && doc?.showIn99Store !== true
    && shouldAutoMark99(doc, cap);

/**
 * What a cap change means for the shelf.
 *
 * Raising it makes dishes newly eligible that nothing is going to touch, so the
 * shelf would otherwise fill in gradually as dishes happened to be saved -- which
 * reads as a bug from the admin's side. That case needs a backfill.
 *
 * Lowering it needs nothing at all: dishes above the new cap stop qualifying at
 * read time and leave the shelf on their own. Crucially we do NOT clear their
 * flags. Lowering the cap is a reversible experiment; clearing curation is not.
 * A fortnight at Rs 59 must not permanently destroy the Rs 60-99 selections
 * somebody built by hand.
 */
export const describeCapChange = (previousCap, nextCap) => {
    const before = resolveNinetyNineCap(previousCap);
    const after = resolveNinetyNineCap(nextCap);
    if (after > before) return { direction: 'raised', needsBackfill: true, before, after };
    if (after < before) return { direction: 'lowered', needsBackfill: false, before, after };
    return { direction: 'unchanged', needsBackfill: false, before, after };
};

export const __testables = { toPrice };
