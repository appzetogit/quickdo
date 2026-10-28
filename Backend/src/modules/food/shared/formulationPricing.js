/**
 * The formulation price: one adjustable figure, always derived from the
 * restaurant's own base price.
 *
 * Every global price adjustment before this measured its percentage from the
 * result of the last one. That is what made repeats compound -- an admin ran
 * +20% on Eggitarion twice and a Rs 100 dish reached Rs 216, advertising 54%
 * off a price nobody had ever charged -- and it is what let a decrease
 * overwrite the restaurant's base price and cut again from the reduced figure
 * on the next run.
 *
 * Measuring from a fixed origin removes the whole class of bug. There is no
 * accumulated state, because:
 *
 *   basePrice          what the restaurant typed. A global run never writes it.
 *   formulationPercent the ONE active adjustment. Replaced, never added to.
 *   adjusted           basePrice x (1 + formulationPercent / 100)
 *
 * and what the customer sees follows from those two figures alone:
 *
 *   pays   = min(basePrice, adjusted)   <- this is the formulation price
 *   struck = max(basePrice, adjusted),  when it exceeds what is paid
 *
 * which gives both directions from one rule:
 *
 *   +20% on Rs 200 -> pays 200, struck 240   (17% off)
 *   -20% on Rs 200 -> pays 160, struck 200   (20% off)
 *
 * The FORMULATION PRICE IS WHAT THE CUSTOMER PAYS. An increase never moves it;
 * only a decrease does. An increase raises the struck-through comparison and
 * nothing else, so a +20% run on a Rs 200 dish still reports a formulation
 * price of Rs 200 -- reporting 240 there reads as a price rise, which is the
 * opposite of what the run did.
 *
 * Running +20% five times still strikes Rs 240; switching to -10% afterwards
 * charges Rs 180 measured from Rs 200, not from a stale Rs 240.
 *
 * An increase deliberately does not change what anyone pays. That is the
 * client's written specification -- "20% -> 240 crossed out -> 200 paid" -- and
 * it is why an increase is safe to re-run and safe to apply platform-wide.
 */

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/**
 * A single adjustment may not wipe out more than 90% of a price or more than
 * quadruple it. These are the bounds the adjuster already enforced; they live
 * here now because the percent is stored on the item and can arrive from a
 * backfill or a restaurant inheriting one, not only from the admin form.
 */
export const MIN_FORMULATION_PERCENT = -90;
export const MAX_FORMULATION_PERCENT = 300;

/** Below this a result is treated as unpriced rather than written as zero. */
export const MIN_RESULT_PRICE = 0.01;

/**
 * The stored percent, clamped and defaulted.
 *
 * Absent means 0 -- every row that predates this field, and every dish no
 * adjustment has reached. 0 makes formulationPrice equal basePrice, which is
 * the untouched state.
 */
export function normalizeFormulationPercent(value) {
    const percent = toFiniteNumber(value);
    if (percent === null) return 0;
    return Math.min(Math.max(round2(percent), MIN_FORMULATION_PERCENT), MAX_FORMULATION_PERCENT);
}

/**
 * The one piece of arithmetic in the system.
 *
 * Null for an unpriced dish, so callers can leave such a row alone instead of
 * writing a zero the schema would later reject.
 */
export function computeFormulationPrice(basePrice, formulationPercent) {
    const base = toFiniteNumber(basePrice);
    if (base === null || base <= 0) return null;

    const percent = normalizeFormulationPercent(formulationPercent);
    return Math.max(MIN_RESULT_PRICE, round2(base * (1 + percent / 100)));
}

/**
 * Everything derived from one dish's two stored figures.
 *
 * Legacy rows are handled here rather than at each call site: a row with no
 * basePrice falls back to its selling price, which is what an undiscounted item
 * means, and a row with no percent reads as 0.
 *
 * `strikePrice` is null when there is nothing honest to strike through, so a
 * client can render it unconditionally instead of deciding for itself -- the
 * same contract resolveItemDisplayPricing already offers.
 */
/**
 * The markup a dish carries, from the split fields or a legacy signed percent.
 *
 * Rows written before the split store one signed number: positive was a markup,
 * negative a discount. Reading them through here means the migration is a
 * tidy-up rather than a gate.
 */
function resolveMarkupPercent(item, legacyPercent) {
    const stored = toFiniteNumber(item?.formulationMarkupPercent);
    if (stored !== null) return Math.min(Math.max(round2(stored), 0), MAX_FORMULATION_PERCENT);
    return legacyPercent > 0 ? Math.min(legacyPercent, MAX_FORMULATION_PERCENT) : 0;
}

/** The discount a dish carries. See resolveMarkupPercent. */
function resolveDiscountPercent(item, legacyPercent) {
    const stored = toFiniteNumber(item?.formulationDiscountPercent);
    if (stored !== null) return Math.min(Math.max(round2(stored), 0), -MIN_FORMULATION_PERCENT);
    return legacyPercent < 0 ? Math.min(-legacyPercent, -MIN_FORMULATION_PERCENT) : 0;
}

export function resolveFormulationPricing(item = {}) {
    const storedBase = toFiniteNumber(item?.basePrice);
    const storedPrice = toFiniteNumber(item?.price) ?? 0;
    const hasOwnBase = storedBase !== null && storedBase > 0;

    /*
     * A row that has never been migrated carries its adjustment in the gap
     * between basePrice and price, not in a percent. Deriving purely from the
     * base would then RAISE it -- a dish at Rs 40 off Rs 50 would start
     * charging Rs 50 the moment this shipped, on every menu at once.
     *
     * So the percent is inferred for those rows, which reproduces exactly what
     * they display today, and the migration becomes a tidy-up rather than a
     * gate the deploy has to wait behind. An explicitly stored percent always
     * wins, including a stored 0, which is why the check is for the field's
     * presence rather than its truthiness.
     */
    const isSet = (v) => v !== null && v !== undefined && v !== '';
    const hasStoredPercent = isSet(item?.formulationPercent)
        || isSet(item?.formulationMarkupPercent)
        || isSet(item?.formulationDiscountPercent);

    /*
     * Only a markdown is ever inferred. A stored price ABOVE the base is bad
     * data -- "was Rs 30, now Rs 50" -- not an increase, and reading it as one
     * would halve the dish. Those rows adopt their own price as the base, which
     * is what an unadjusted item means and what they already rendered as.
     */
    const inferable = !hasStoredPercent && hasOwnBase && storedBase > storedPrice && storedPrice > 0;

    const basePrice = hasOwnBase && (hasStoredPercent || inferable) ? storedBase : storedPrice;

    const formulationPercent = hasStoredPercent
        ? normalizeFormulationPercent(item.formulationPercent)
        : (inferable ? inferFormulationPercent(basePrice, storedPrice) : 0);

    /*
     * Two accumulators, not one, because they do different jobs.
     *
     *   markup   raises the struck-through comparison. Nobody pays more.
     *   discount lowers what is actually charged.
     *
     * They were a single signed percent, which meant a decrease could not do
     * its job while an increase stood: a platform sitting at +10% took a -10%
     * run and simply cancelled back to zero, leaving the price exactly where it
     * was. The decrease looked broken because the increase was consuming it.
     *
     * Split, each direction accumulates its own total against the SAME base, so
     * a dish can be struck at 220 and sold at 180 at once, and neither run
     * interferes with the other.
     */
    const markupPercent = resolveMarkupPercent(item, formulationPercent);
    const discountPercent = resolveDiscountPercent(item, formulationPercent);

    const base = round2(basePrice);
    const price = Math.max(MIN_RESULT_PRICE, round2(base * (1 - discountPercent / 100)));

    /*
     * The struck-through figure is whatever the LAST run set it to.
     *
     *   an increase sets it from the markup: base x (1 + markup/100)
     *   a decrease sets it to the price the dish was selling for a moment
     *   before the cut, so the customer sees what it just dropped from
     *
     * Stored rather than derived, because "the price before the cut" is not
     * recoverable from the base and the totals -- after two decreases the dish
     * has been at three different prices and only the run knows which one came
     * immediately before.
     *
     * Absent means no run has set one, which covers every row written before
     * this and every dish only ever increased. Then the markup figure applies,
     * falling back to the base itself so a legacy row that carries its discount
     * in the price/base gap still strikes through something.
     */
    const storedStrike = toFiniteNumber(item?.formulationStrikePrice);
    const strike = storedStrike !== null && storedStrike > 0
        ? round2(storedStrike)
        : Math.max(round2(base * (1 + markupPercent / 100)), base);
    const hasStrike = strike > price;

    return {
        basePrice: round2(basePrice),
        formulationPercent,
        // The two accumulators, under names that cannot be mistaken for the
        // saving a customer reads. `discountPercent` below is that saving, and
        // every client already consumes it under that name.
        markupPercent,
        discountAccumulatorPercent: round2(discountPercent),
        /*
         * The formulation price is WHAT THE CUSTOMER PAYS, so an increase can
         * never move it -- only a decrease can.
         *
         * It used to be the raw adjusted figure, which meant a +10% run showed
         * a formulation price of 220 on a dish still charging 200. That reads
         * as a price rise in the admin panel and in the app, when an increase
         * deliberately changes nothing anyone pays: it moves the struck-through
         * comparison and nothing else.
         *
         * On a decrease the two coincide -- the adjusted figure IS what is
         * charged -- so this is the same number either way, just never above
         * the base.
         */
        formulationPrice: round2(price),
        price: round2(Math.max(price, 0)),
        strikePrice: hasStrike ? round2(strike) : null,
        // The saving a customer reads off the two figures on screen, which is
        // not the discount accumulator: a dish struck at 220 and sold at 180 is
        // advertised as 18% off, though the decrease that set it was 10%.
        discountPercent: hasStrike ? round2(((strike - price) / strike) * 100) : 0,
        savings: hasStrike ? round2(strike - price) : 0,
    };
}

/**
 * The fields to persist for a dish, given a base price and a percent.
 *
 * `price` is materialised rather than derived on read because it is the
 * authoritative selling figure everything else already reads: order subtotals,
 * commission, payouts, the 99-store cap. Keeping its name and meaning is what
 * lets this change land without touching any of that code.
 *
 * `discountPercent` is materialised for the same reason -- clients and the
 * seller app read it directly. Nothing else writes it any more: both item forms
 * hardcoded it to 0, so the formulation is now its only author.
 */
export function formulationFieldsFor(basePrice, formulationPercent) {
    const base = toFiniteNumber(basePrice);
    if (base === null || base <= 0) return null;

    const derived = resolveFormulationPricing({ basePrice: base, formulationPercent });
    return {
        basePrice: derived.basePrice,
        formulationPercent: derived.formulationPercent,
        formulationMarkupPercent: derived.markupPercent,
        formulationDiscountPercent: derived.discountAccumulatorPercent,
        // Equal to `price` by definition now -- see resolveFormulationPricing.
        // Both are stored because the admin panel edits against one and every
        // order path reads the other, and a single source keeps them identical.
        formulationPrice: derived.formulationPrice,
        price: derived.price,
        discountPercent: derived.discountPercent,
    };
}

/**
 * The same derivation for one variant.
 *
 * Variants carry their own base and share the item's percent -- a global run
 * adjusts a dish, not a size. Without a base of its own a variant's current
 * price is adopted as one, which is exactly what an unadjusted variant means.
 */
export function formulationFieldsForVariant(variant = {}, formulationPercent) {
    const storedBase = toFiniteNumber(variant?.basePrice);
    const storedPrice = toFiniteNumber(variant?.price) ?? 0;
    const base = storedBase !== null && storedBase > 0 ? storedBase : storedPrice;
    if (!(base > 0)) return null;

    const formulationPrice = computeFormulationPrice(base, formulationPercent);
    return {
        basePrice: round2(base),
        price: Math.min(round2(base), formulationPrice),
    };
}

/**
 * The percent implied by a base price and a price already being charged.
 *
 * Only for the migration, which has to land existing dishes on the new fields
 * without moving what any customer is paying mid-flight. Not part of the
 * forward path: a run sets the percent, it is never inferred from prices.
 */
export function inferFormulationPercent(basePrice, price) {
    const base = toFiniteNumber(basePrice);
    const selling = toFiniteNumber(price);
    if (base === null || base <= 0 || selling === null || selling <= 0) return 0;
    return normalizeFormulationPercent(((selling - base) / base) * 100);
}

/**
 * A dish's adjustment, carried onto a new base price.
 *
 * Used when a restaurant or an admin edits a dish's base. The base is theirs to
 * set; the markup and discount are the platform's and are not on the form, so
 * they are kept, and every figure derived from the base is worked out again:
 *
 *   price   new base x (1 - discount)        what the customer is charged
 *   strike  unchanged base -> the stored strike, as it was
 *           a decrease ran last -> the new base, what the dish is cut FROM
 *           a markup stands     -> new base x (1 + markup)
 *           neither             -> none; the menu falls back to the base
 *
 * The strike is the part that used to be missed. It is stored, and the stored
 * figure wins on the menu, so a Rs 200 dish struck at 240 under a +20% hike,
 * re-priced to Rs 300, kept striking 240 -- below its own price -- and the hike
 * simply vanished from that dish. And the charged price was left at the bare new
 * base while the menu re-applied the discount to it, so a discounted dish was
 * shown at one price and billed at another until someone noticed.
 *
 * Null for an unpriced base, so the caller can leave the row alone.
 */
export function rebaseFormulationFields(existing = {}, newBasePrice) {
    const base = toFiniteNumber(newBasePrice);
    if (base === null || base <= 0) return null;

    const current = resolveFormulationPricing(existing);
    const markup = current.markupPercent;
    const discount = current.discountAccumulatorPercent;
    const newBase = round2(base);
    const price = Math.max(MIN_RESULT_PRICE, round2(newBase * (1 - discount / 100)));

    const storedStrike = toFiniteNumber(existing?.formulationStrikePrice);
    const hasStoredStrike = storedStrike !== null && storedStrike > 0;
    const baseUnchanged = Math.abs(newBase - current.basePrice) < 0.005;
    // A decrease records the price it cut from, which sits at or below the base;
    // an increase records base x (1 + markup), which sits above it. The same
    // test resolveStandingAdjustment uses to tell the two apart.
    const decreaseRanLast = hasStoredStrike && storedStrike <= current.basePrice + 0.005 && discount > 0;

    let strike = null;
    if (hasStoredStrike && baseUnchanged) strike = round2(storedStrike);
    else if (decreaseRanLast) strike = newBase;
    else if (markup > 0) strike = round2(newBase * (1 + markup / 100));

    // The saving the customer reads, off the strike the menu will actually show.
    const shownStrike = strike ?? Math.max(round2(newBase * (1 + markup / 100)), newBase);
    const saving = shownStrike > price ? round2(((shownStrike - price) / shownStrike) * 100) : 0;

    return {
        basePrice: newBase,
        price,
        formulationPrice: price,
        formulationMarkupPercent: markup,
        formulationDiscountPercent: discount,
        // The signed field older readers still consult; a markup wins when both
        // stand, as elsewhere.
        formulationPercent: markup > 0 ? markup : -discount,
        formulationStrikePrice: strike,
        discountPercent: saving,
    };
}
