/**
 * The struck-through "what you'd pay elsewhere" figure shown beside our price.
 *
 * Derived from the selling price by a single admin-set markup rather than typed
 * per dish. That is what makes it track a global price adjustment: raise every
 * menu price by 10% and this rises with them automatically, because it is not
 * a stored number that can fall out of step -- it is computed from the price
 * being shown at the moment it is shown.
 *
 * It is deliberately NOT the same thing as `basePrice`. basePrice is our own
 * pre-discount price and belongs to the restaurant; this is a comparison figure
 * the platform sets across the whole menu. A dish can carry both, in which case
 * the higher one is the honest thing to strike through -- see
 * resolveComparisonPrice.
 */

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/** A markup beyond this is not a comparison, it is a fiction. */
export const MAX_MARKUP_PERCENT = 300;

export const DEFAULT_OTHER_PLATFORM_SETTINGS = Object.freeze({
    isEnabled: false,
    markupPercent: 0,
    label: 'Other platforms',
});

/**
 * Read the admin setting off a fee-settings document.
 *
 * Absent means off, which is what every deployment that predates this is.
 */
export function normalizeOtherPlatformSettings(source = {}) {
    const raw = source?.otherPlatformPrice || {};
    const markup = toFiniteNumber(raw.markupPercent) ?? 0;

    return {
        isEnabled: raw.isEnabled === true,
        markupPercent: Math.min(Math.max(markup, 0), MAX_MARKUP_PERCENT),
        label: String(raw.label || DEFAULT_OTHER_PLATFORM_SETTINGS.label).trim()
            || DEFAULT_OTHER_PLATFORM_SETTINGS.label,
    };
}

/** Validate what the admin form submitted. Returns undefined if it said nothing. */
export function normalizeOtherPlatformInput(body = {}) {
    if (body?.otherPlatformPrice === undefined) return undefined;

    const raw = body.otherPlatformPrice || {};
    const markup = toFiniteNumber(raw.markupPercent);

    if (raw.isEnabled === true && (markup === null || markup <= 0)) {
        throw new Error('Set a markup above 0 to show an other-platform price');
    }
    if (markup !== null && (markup < 0 || markup > MAX_MARKUP_PERCENT)) {
        throw new Error(`Markup must be between 0 and ${MAX_MARKUP_PERCENT} percent`);
    }

    return {
        otherPlatformPrice: {
            isEnabled: raw.isEnabled === true,
            markupPercent: markup === null ? 0 : round2(markup),
            label: String(raw.label || DEFAULT_OTHER_PLATFORM_SETTINGS.label).trim()
                || DEFAULT_OTHER_PLATFORM_SETTINGS.label,
        },
    };
}

/**
 * The other-platform price for one item.
 *
 * Precedence: the figure stored on the item wins. It is what a restaurant typed
 * for that dish, and it is what a global price adjustment moves -- so it must
 * not be overridden by a blanket markup that would silently undo the
 * adjustment the admin just ran.
 *
 * The markup below is only a fallback, for items where nobody has set a figure.
 * Without it, switching the comparison on would appear to do nothing until
 * every dish had been edited by hand.
 *
 * Null when there is nothing honest to strike through -- no stored figure, no
 * markup, or a result at or below what we charge.
 */
export function resolveItemOtherPlatformPrice(item = {}, settings = {}) {
    const price = toFiniteNumber(item?.price);
    if (price === null || price <= 0) return null;

    const stored = toFiniteNumber(item?.otherPrice);
    if (stored !== null && stored > 0) {
        return stored > price ? round2(stored) : null;
    }

    return computeOtherPlatformPrice(price, settings);
}

/**
 * A markup-derived comparison, used only when an item carries no figure of its
 * own. See resolveItemOtherPlatformPrice for precedence.
 */
export function computeOtherPlatformPrice(price, settings = {}) {
    const selling = toFiniteNumber(price);
    if (selling === null || selling <= 0) return null;

    const { isEnabled, markupPercent } = normalizeOtherPlatformSettings({
        otherPlatformPrice: settings,
    });
    if (!isEnabled || markupPercent <= 0) return null;

    const marked = round2(selling * (1 + markupPercent / 100));
    return marked > selling ? marked : null;
}

/**
 * The single figure to strike through beside the selling price.
 *
 * A dish may have both its own pre-discount price and a platform-wide
 * comparison price. Showing two struck-through numbers is noise, and showing
 * the smaller one understates the saving, so the larger wins. Whichever is
 * chosen is labelled, because "₹100" struck through means something different
 * depending on whether it is our old price or someone else's.
 */
export function resolveComparisonPrice({ price, basePrice = null, otherPlatformPrice = null, label = '' } = {}) {
    const selling = toFiniteNumber(price) ?? 0;
    const own = toFiniteNumber(basePrice);
    const other = toFiniteNumber(otherPlatformPrice);

    const candidates = [];
    if (own !== null && own > selling) candidates.push({ amount: round2(own), source: 'basePrice', label: '' });
    if (other !== null && other > selling) {
        candidates.push({ amount: round2(other), source: 'otherPlatform', label: label || DEFAULT_OTHER_PLATFORM_SETTINGS.label });
    }

    if (candidates.length === 0) {
        return { strikePrice: null, strikeSource: null, strikeLabel: '', savings: 0, savingsPercent: 0 };
    }

    const best = candidates.reduce((hi, c) => (c.amount > hi.amount ? c : hi));
    const savings = round2(best.amount - selling);

    return {
        strikePrice: best.amount,
        strikeSource: best.source,
        strikeLabel: best.label,
        savings,
        savingsPercent: best.amount > 0 ? Math.round((savings / best.amount) * 100) : 0,
    };
}


/**
 * The per-item comparison figure an item form submitted.
 *
 * Not validated against the selling price: a restaurant may legitimately type a
 * rival's price that is currently lower than theirs, and refusing the save would
 * be nonsense. The display layer simply strikes nothing through in that case.
 *
 * Returns undefined when the body does not mention it, so a partial update
 * leaves the stored figure alone. An explicit 0 clears it.
 */
export function normalizeItemOtherPriceInput(body = {}) {
    if (body?.otherPrice === undefined) return undefined;

    if (body.otherPrice === null || body.otherPrice === '') {
        return { otherPrice: 0 };
    }

    const value = toFiniteNumber(body.otherPrice);
    if (value === null || value < 0) {
        throw new Error('Other platform price must be a number of 0 or more');
    }

    return { otherPrice: round2(value) };
}

/**
 * The comparison figure a newly created dish should start with.
 *
 * Global price adjustments move the STORED otherPrice, and only on dishes that
 * exist when the run happens. So a menu accumulates its comparison figures by
 * history: on one live restaurant every dish sits at exactly 1.3068x its price,
 * on another the ratios run 1.60, 1.21, 1.21 and 1.07 depending on which
 * adjustments each dish was around for.
 *
 * A dish added afterwards carries nothing, so it falls back to the blanket
 * markup -- 20% where its neighbours are at 30% or 70% -- and shows a visibly
 * smaller saving than everything around it. That is the bug this fixes.
 *
 * The median of its siblings is used rather than the mean, because these ratios
 * cluster tightly with the odd outlier (the 2.11 above) and a mean would let one
 * oddity drag every future dish with it.
 *
 * Returns 0 when there is nothing honest to seed -- no priced siblings, or a
 * result that would not exceed the price and so would strike nothing through.
 * The blanket markup then applies as before, which is the correct fallback for
 * a restaurant that has never been adjusted.
 */
export function resolveSeedOtherPrice({ price, siblingRatios = [] } = {}) {
    const selling = toFiniteNumber(price);
    if (selling === null || selling <= 0) return 0;

    const ratios = (Array.isArray(siblingRatios) ? siblingRatios : [])
        .map((r) => toFiniteNumber(r))
        .filter((r) => r !== null && r > 1)
        .sort((a, b) => a - b);

    if (!ratios.length) return 0;

    const mid = Math.floor(ratios.length / 2);
    const median = ratios.length % 2
        ? ratios[mid]
        : (ratios[mid - 1] + ratios[mid]) / 2;

    const seeded = round2(selling * median);
    return seeded > selling ? seeded : 0;
}

/** otherPrice / price for each sibling that carries a usable pair. */
export function collectOtherPriceRatios(items = []) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const price = toFiniteNumber(item?.price);
            const other = toFiniteNumber(item?.otherPrice);
            if (price === null || price <= 0 || other === null || other <= price) return null;
            return other / price;
        })
        .filter((r) => r !== null);
}
