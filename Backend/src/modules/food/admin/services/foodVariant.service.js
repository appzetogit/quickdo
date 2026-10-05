import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';

const toTrimmedString = (value) => (value == null ? '' : String(value).trim());

export const extractRawFoodVariants = (value = {}) => {
    if (Array.isArray(value?.variants)) return value.variants;
    if (Array.isArray(value?.variations)) return value.variations;
    return [];
};

export const normalizeFoodVariantsInput = (value = [], options = {}) => {
    const {
        allowEmpty = true,
        priceLabel = 'Variant price',
        existing = null
    } = options;

    /*
     * The dish as stored, so a size's base can be told apart from its price.
     *
     * Every editing form shows and posts back the SELLING price -- the figure a
     * customer pays. On a dish carrying a platform discount that is lower than
     * the base, so treating it as the base walks the base down on every save:
     * Margherita Pizza sat at bases 120/270/390 with 10% off, the portal showed
     * 108/243/351, and saving wrote those back as the new bases.
     */
    const dishDiscount = Math.min(Math.max(Number(existing?.formulationDiscountPercent) || 0, 0), 99.99);
    const priorById = new Map(
        (Array.isArray(existing?.variants) ? existing.variants : [])
            .filter((v) => v?._id)
            .map((v) => [String(v._id), v])
    );

    /** The base a submitted size should end up with. */
    const resolveVariantBase = (entry, price) => {
        const explicit = Number(entry?.basePrice);
        const prior = priorById.get(String(entry?._id || entry?.id || ''));

        if (Number.isFinite(explicit) && explicit > 0) {
            /*
             * An explicit base is trusted -- unless it is the prior CHARGED price.
             *
             * That combination is the signature of a stale form, not an edit. A
             * panel that was still displaying the post-adjustment figure in its
             * base box posts that figure back as the base, and taking it at face
             * value writes the discount into the base permanently: Margherita
             * Pizza's Small went from a base of 120 to 108, which is 120 less the
             * 10% that was standing at the time. The next such save would take it
             * to 97.20.
             *
             * A restaurant genuinely retyping the base to the current selling
             * price is indistinguishable from this, and loses -- their base stays
             * put. That is the safe direction: a base that failed to change can be
             * changed again, a base that silently absorbed a discount cannot be
             * recovered.
             */
            const priorBase = Number(prior?.basePrice);
            const priorPrice = Number(prior?.price);
            const looksStale = prior
                && Number.isFinite(priorPrice) && Math.abs(priorPrice - explicit) < 0.01
                && Number.isFinite(priorBase) && priorBase > 0
                && Math.abs(priorBase - priorPrice) >= 0.01;
            if (!looksStale) return Math.round(explicit * 100) / 100;
            return Math.round(priorBase * 100) / 100;
        }
        if (prior) {
            const priorBase = Number(prior.basePrice);
            const priorPrice = Number(prior.price);
            // The selling price came back unchanged, so nothing was repriced and
            // the stored base still stands. This is the ordinary save -- renaming
            // a size, editing add-ons -- and it must not touch the base.
            if (Number.isFinite(priorPrice) && Math.abs(priorPrice - price) < 0.01) {
                return Number.isFinite(priorBase) && priorBase > 0
                    ? Math.round(priorBase * 100) / 100
                    : price;
            }
        }

        // Genuinely repriced, or a size that did not exist before: the number
        // typed is what a customer should pay, so solve for the base that
        // produces it under the discount the dish already carries.
        if (dishDiscount > 0) return Math.round((price / (1 - dishDiscount / 100)) * 100) / 100;
        return price;
    };

    if (value == null || value === '') {
        if (allowEmpty) return [];
        throw new ValidationError('At least one variant is required');
    }

    if (!Array.isArray(value)) {
        throw new ValidationError('Variants must be an array');
    }

    const normalized = value
        .map((entry = {}) => {
            const name = toTrimmedString(entry?.name);
            if (!name) {
                throw new ValidationError('Each variant must have a name');
            }

            const price = Number(entry?.price);
            if (!Number.isFinite(price) || price <= 0) {
                throw new ValidationError(`${priceLabel} must be greater than 0`);
            }

            const variant = {
                name,
                price
            };

            /*
             * Carry the formulation fields through a save instead of dropping them.
             *
             * This built a fresh object per size, so every admin or restaurant save
             * replaced the variants array and silently discarded basePrice -- and
             * the next global run, finding no base, adopted the already-adjusted
             * price as the new one. On a marked-down size that walks the base
             * downwards on every save, which is the same ratchet that hit the dish
             * itself when a selling price was written into its base.
             *
             * Only copied when the caller actually sent them. A genuinely new size
             * carries neither, and the run settles both.
             */
            /*
             * Always recorded, never guessed from the selling price -- see
             * resolveVariantBase. A size without a base is one the app cannot show
             * the dish's markup on: paneer chila carried 20% with both sizes at
             * basePrice null, so neither could be given a struck figure and the
             * customer app fell back to adding the DISH's flat saving to each,
             * right on Half and wrong on Full.
             */
            variant.basePrice = resolveVariantBase(entry, price);

            /*
             * And the charged price is derived back from that base, never just
             * carried through from the form.
             *
             * Otherwise the two can disagree: a size whose base is preserved at
             * 120 while its price is whatever the form happened to post is a dish
             * that no longer satisfies price = base less the discount, and the
             * next global run would move it somewhere neither figure predicts.
             *
             * On an undiscounted dish this is exactly the number that was typed.
             */
            if (dishDiscount > 0) {
                variant.price = Math.round(variant.basePrice * (1 - dishDiscount / 100) * 100) / 100;
            }
            const incomingStrike = Number(entry?.formulationStrikePrice ?? entry?.strikePrice);
            if (Number.isFinite(incomingStrike) && incomingStrike > 0) {
                variant.formulationStrikePrice = Math.round(incomingStrike * 100) / 100;
            } else {
                /*
                 * Neither panel sends a size's strike back, so without this every
                 * save dropped it -- Margherita's three sizes all lost theirs on a
                 * restaurant edit. On a discount dish that is survivable, because a
                 * customer is then shown the base as the struck figure. On a markup
                 * dish it is not: the base IS the charged price there, so with the
                 * strike gone nothing is struck and the increase vanishes from the
                 * app until the next global run.
                 *
                 * Same rule the run itself uses, applied at save time:
                 *   base unchanged  keep the strike the run decided; nothing about
                 *                   this size was repriced
                 *   base changed    re-derive it from the dish's standing markup,
                 *                   measured against the NEW base
                 *   no markup       leave it unset; customers fall back to the base
                 */
                const prior = priorById.get(String(entry?._id || entry?.id || ''));
                const priorBase = Number(prior?.basePrice);
                const priorStrike = Number(prior?.formulationStrikePrice);
                const dishMarkup = Math.max(Number(existing?.formulationMarkupPercent) || 0, 0);
                const baseUnchanged = Boolean(prior)
                    && Number.isFinite(priorBase)
                    && Math.abs(priorBase - variant.basePrice) < 0.01;
                if (baseUnchanged && Number.isFinite(priorStrike) && priorStrike > 0) {
                    variant.formulationStrikePrice = Math.round(priorStrike * 100) / 100;
                } else if (dishMarkup > 0) {
                    variant.formulationStrikePrice =
                        Math.round(variant.basePrice * (1 + dishMarkup / 100) * 100) / 100;
                }
            }

            // Optional per-size quantity limits. Absent or blank means "not set",
            // which is different from zero: the dish's own limit then applies.
            // Send null explicitly to clear one.
            if (entry?.minOrderQuantity !== undefined) {
                const raw = entry.minOrderQuantity;
                if (raw === null || raw === '') variant.minOrderQuantity = null;
                else {
                    const min = Math.floor(Number(raw));
                    // 0 means "no minimum for this size", the same thing 0 already
                    // means for the maximum. Ordering still requires at least one:
                    // resolveOrderQuantityRules turns a stored 0 into an effective 1.
                    if (!Number.isFinite(min) || min < 0) {
                        throw new ValidationError(`Minimum quantity for "${name}" cannot be negative. Use 0 for no minimum.`);
                    }
                    variant.minOrderQuantity = min;
                }
            }
            if (entry?.maxOrderQuantity !== undefined) {
                const raw = entry.maxOrderQuantity;
                if (raw === null || raw === '') variant.maxOrderQuantity = null;
                else {
                    const max = Math.floor(Number(raw));
                    // 0 keeps the meaning it has everywhere else here: no cap of
                    // its own, so the platform ceiling applies.
                    if (!Number.isFinite(max) || max < 0) {
                        throw new ValidationError(`Maximum quantity for "${name}" must be 0 or more`);
                    }
                    variant.maxOrderQuantity = max;
                }
            }
            if (
                variant.minOrderQuantity != null
                && variant.maxOrderQuantity != null
                && variant.maxOrderQuantity > 0
                && variant.maxOrderQuantity < variant.minOrderQuantity
            ) {
                throw new ValidationError(`Maximum quantity for "${name}" cannot be below its minimum`);
            }

            // Per-variant add-ons, each pairing optionally carrying its own price
            // for this size. Two accepted shapes:
            //   addons:   [{ addonId, price }]  -- price null means "the add-on's own"
            //   addonIds: [id, ...]             -- older callers; every price null
            // Only carried when the caller sent one of the keys, so a form that
            // does not know about them leaves the stored pairings alone rather
            // than clearing them. addonIds is always rewritten from the pairings,
            // so the two can never disagree about which add-ons are allowed.
            if (entry?.addons !== undefined || entry?.addonIds !== undefined) {
                const rawPairs = entry?.addons !== undefined
                    ? (Array.isArray(entry.addons) ? entry.addons : [entry.addons])
                    : (Array.isArray(entry.addonIds) ? entry.addonIds : [entry.addonIds])
                        .map((v) => ({ addonId: v, price: null }));

                const seen = new Set();
                const pairs = [];
                for (const pair of rawPairs) {
                    const rawId = pair && typeof pair === 'object'
                        ? (pair.addonId ?? pair._id ?? pair.id ?? '')
                        : pair;
                    const id = String(
                        rawId && typeof rawId === 'object' ? (rawId._id ?? rawId.id ?? '') : (rawId ?? '')
                    ).trim();
                    if (!id) continue;
                    if (!mongoose.Types.ObjectId.isValid(id)) {
                        throw new ValidationError(`One or more add-ons selected for "${name}" are not valid`);
                    }
                    if (seen.has(id)) continue;
                    seen.add(id);

                    let pairPrice = null;
                    const rawPrice = pair && typeof pair === 'object' ? pair.price : undefined;
                    if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
                        pairPrice = Number(rawPrice);
                        if (!Number.isFinite(pairPrice) || pairPrice < 0) {
                            throw new ValidationError(`Add-on price for "${name}" must be a number of 0 or more`);
                        }
                        pairPrice = Math.round(pairPrice * 100) / 100;
                    }

                    pairs.push({ addonId: new mongoose.Types.ObjectId(id), price: pairPrice });
                }

                variant.addons = pairs;
                variant.addonIds = pairs.map((pair) => pair.addonId);
            }

            const variantId = entry?._id || entry?.id;
            if (variantId && mongoose.Types.ObjectId.isValid(String(variantId))) {
                variant._id = new mongoose.Types.ObjectId(String(variantId));
            }

            return variant;
        })
        .filter(Boolean);

    if (!allowEmpty && normalized.length === 0) {
        throw new ValidationError('At least one variant is required');
    }

    return normalized;
};

/**
 * @param {object} [options]
 * @param {boolean} [options.strikeAsBase]  emit the run's struck figure as
 *   `basePrice`. Customer-facing callers only -- see the note on the field.
 */
export const serializeFoodVariants = (value = [], { strikeAsBase = false } = {}) =>
    (Array.isArray(value) ? value : [])
        .map((entry = {}) => {
            const name = toTrimmedString(entry?.name);
            const price = Number(entry?.price);
            if (!name || !Number.isFinite(price) || price <= 0) return null;

            const variantId = entry?._id || entry?.id;

            const realBase = Number.isFinite(Number(entry?.basePrice)) && Number(entry?.basePrice) > 0
                ? Number(entry.basePrice)
                : price;
            const runStrike = Number(entry?.formulationStrikePrice);
            /*
             * `strikeAsBase` decides which number `basePrice` carries, and the
             * split is deliberate.
             *
             * Customer-facing (true): the run's struck figure, so an increase is
             * visible on a dish sold by size. Mirrors what the dish itself already
             * does -- `display.strikePrice ?? display.basePrice` in publicFoods and
             * restaurantMenu.
             *
             * Admin and approval (false): the real base, never the strike. The
             * admin form loads this field and saves it straight back, so sending a
             * strike here would write it into basePrice and ratchet the base
             * UPWARDS on every save -- the same failure as a selling price being
             * written into the base, in the other direction.
             */
            const shownBase = strikeAsBase && Number.isFinite(runStrike) && runStrike > realBase
                ? runStrike
                : realBase;

            return {
                id: variantId ? String(variantId) : '',
                _id: variantId ? String(variantId) : '',
                name,
                price,
                basePrice: shownBase,
                // Always the run's own figure, unconflated, for clients that would
                // rather read it directly than infer one.
                strikePrice: Number.isFinite(runStrike) && runStrike > 0 ? runStrike : null,
                /*
                 * The same struck figure again, as `otherPrice` -- customers only,
                 * and only when there is something to strike.
                 *
                 * For app builds that predate reading a size's basePrice. Those
                 * builds know two sources for a size's "was" price: otherPrice
                 * first, then a guess that adds the DISH's rupee saving to the
                 * size. That guess is a flat amount, right only for the size whose
                 * price matches the dish's: with Margherita at -10% an old build
                 * struck Medium at 255 instead of 270 and Large at 363 instead of
                 * 390. Given the real figure here, it never reaches the guess.
                 *
                 * Newer builds take the larger of otherPrice and basePrice, which
                 * are the same number, so nothing changes for them. Sizes have no
                 * stored otherPrice of their own, so this overwrites nothing a
                 * restaurant set.
                 */
                ...(strikeAsBase
                    ? { otherPrice: shownBase > price ? shownBase : null }
                    : {}),
                // null means this size sets none of its own; the dish's applies.
                minOrderQuantity: entry?.minOrderQuantity ?? null,
                maxOrderQuantity: entry?.maxOrderQuantity ?? null,
                addonIds: (entry?.addonIds || []).map((v) => String(v?._id ?? v?.id ?? v)).filter(Boolean),
                addons: (entry?.addons || []).map((pair) => ({
                    addonId: String(pair?.addonId ?? ''),
                    price: pair?.price ?? null,
                })).filter((pair) => pair.addonId)
            };
        })
        .filter(Boolean);

export const hasFoodVariants = (value = {}) => serializeFoodVariants(value?.variants || value?.variations || []).length > 0;

/**
 * Is this dish actually SOLD by its variants right now?
 *
 * The toggle beats the array: variants switched off stay stored (so switching
 * back on costs nothing) but must not drive pricing or show a size picker.
 * Rows written before the flag have it undefined, which is NOT off -- for
 * them, having variants means selling by variants, as it always did.
 */
export const sellsByVariants = (value = {}) =>
    value?.variantsEnabled !== false && hasFoodVariants(value);

export const getFoodDisplayPrice = (value = {}) => {
    const variants = serializeFoodVariants(value?.variants || value?.variations || []);
    // A doc with variants switched off prices from its own price field; only a
    // bare {variants} shape (the write paths computing a "from" figure) or a
    // doc actually selling by variants reads the array.
    if (value?.variantsEnabled === false) {
        const own = Number(value?.price);
        if (Number.isFinite(own) && own > 0) return own;
    }
    if (variants.length > 0) {
        return Math.min(...variants.map((entry) => Number(entry.price) || 0));
    }

    const price = Number(value?.price);
    return Number.isFinite(price) ? price : 0;
};
