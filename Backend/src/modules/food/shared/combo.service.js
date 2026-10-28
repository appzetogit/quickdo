/**
 * Combos, persisted.
 *
 * The design decision worth knowing before reading this file: a combo is stored
 * as an ordinary FoodItem, marked `isCombo` and carrying `comboComponents`. It is
 * NOT a separate collection.
 *
 * That is deliberate. A FoodItem already carries everything a combo needs to be
 * sold -- name, image, category, availability, approval state, packaging charge,
 * quantity limits, free delivery, the Rs 99 flag -- and everything downstream
 * already knows how to handle one. The menu serves it, the customer app renders
 * it, the cart adds it, order pricing prices it, the POS receives a line for it,
 * commission is taken on it. A parallel "combo" collection would have meant
 * teaching every one of those paths about a second kind of sellable thing, which
 * is a lot of new surface for something the customer thinks of as just a dish.
 *
 * The combo price is stored as both `price` and `basePrice`, and the component
 * total as `formulationStrikePrice` -- the struck-through "was" price, which is
 * genuinely what these dishes cost separately. The saving then renders on the
 * menu through the discount machinery that already exists, with no change to
 * the app. (The component total used to be the base, which the menu read as the
 * price to show -- see saveCombo.)
 *
 * The pure rules -- composition limits, price validation, the pro-rata split --
 * live in ./combo.js and are tested without a database.
 */
import mongoose from 'mongoose';
import { FoodItem } from '../admin/models/food.model.js';
import { ValidationError } from '../../../core/auth/errors.js';
import { getFoodDisplayPrice } from '../admin/services/foodVariant.service.js';
import { computeDiscountPercent } from './itemDiscountPricing.js';
import {
    MAX_COMBOS_PER_RESTAURANT,
    componentKey,
    normalizeComboComponents,
    validateComboComposition,
    computeComponentTotal,
    validateComboPrice,
    computeComboSaving,
    resolveComboAvailability,
    allocateComboPrice,
} from './combo.js';

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

/** The price of one specific thing: a named variant if given, else the dish. */
const unitPriceFor = (doc, variantId) => {
    if (variantId) {
        const variant = (doc.variants || []).find((v) => String(v._id) === String(variantId));
        if (!variant) return null;
        const price = Number(variant.price);
        return Number.isFinite(price) && price >= 0 ? price : null;
    }
    return Number(getFoodDisplayPrice(doc)) || 0;
};

/**
 * Load every dish a combo refers to and index it by component key.
 *
 * Scoped to the restaurant on purpose: a combo must never reach across outlets,
 * or one restaurant could price another's dishes into its own menu.
 *
 * A combo may not contain another combo. Nesting would make the pro-rata split
 * recursive and the kitchen ticket unreadable, and there is no case for it.
 *
 * A manual component (no itemId, just a typed name and price) never touches the
 * database here -- its price and availability are exactly what was typed, so it
 * is priced and marked available without a lookup.
 */
export async function resolveComboComponentContext(restaurantId, components = []) {
    const realComponents = components.filter((c) => c.itemId);
    const ids = [...new Set(realComponents.map((c) => String(c.itemId)))].filter(isObjectId);
    const docs = ids.length
        ? await FoodItem.find({ _id: { $in: ids }, restaurantId })
            .select('name price variants variantsEnabled isAvailable approvalStatus isCombo categoryId categoryName foodType image')
            .lean()
        : [];

    const docsById = new Map(docs.map((d) => [String(d._id), d]));
    const priceByKey = new Map();
    const stateByKey = new Map();

    for (const component of components) {
        const key = componentKey(component);
        if (!component.itemId) {
            priceByKey.set(key, Number(component.manualPrice) || 0);
            stateByKey.set(key, { name: component.manualName, isAvailable: true, approvalStatus: 'approved' });
            continue;
        }
        const doc = docsById.get(String(component.itemId));
        if (!doc) continue;
        if (doc.isCombo) {
            throw new ValidationError(`"${doc.name}" is itself a combo. A combo cannot contain another combo.`);
        }
        const unit = unitPriceFor(doc, component.variantId);
        if (unit === null) {
            throw new ValidationError(`That size is no longer available on "${doc.name}".`);
        }
        priceByKey.set(key, unit);
        stateByKey.set(key, {
            name: doc.name,
            isAvailable: doc.isAvailable !== false,
            approvalStatus: doc.approvalStatus,
        });
    }

    const missing = realComponents.filter((c) => !docsById.has(String(c.itemId)));
    if (missing.length) {
        throw new ValidationError('One of the chosen dishes is no longer on your menu. Remove it and try again.');
    }

    return { docsById, priceByKey, stateByKey };
}

/**
 * Turn a submitted combo into the numbers that get stored, or throw a message
 * fit to show the person who typed it.
 */
export async function buildComboPricing(restaurantId, rawComponents, comboPrice) {
    const components = normalizeComboComponents(rawComponents);

    const composition = validateComboComposition(components);
    if (!composition.ok) throw new ValidationError(composition.reason);

    const { priceByKey, stateByKey, docsById } = await resolveComboComponentContext(restaurantId, components);

    const componentTotal = computeComponentTotal(components, priceByKey);
    const priceCheck = validateComboPrice(comboPrice, componentTotal);
    if (!priceCheck.ok) throw new ValidationError(priceCheck.reason);

    const price = Math.round(Number(comboPrice) * 100) / 100;

    return {
        components,
        componentTotal,
        price,
        saving: computeComboSaving(componentTotal, price),
        allocation: allocateComboPrice(components, priceByKey, price),
        availability: resolveComboAvailability(components, stateByKey),
        docsById,
    };
}

/** Snapshot the component names onto the stored rows, so a kitchen ticket and an
 *  old order stay readable even after a dish is renamed or removed. A manual
 *  row has no doc to read a name from -- it snapshots the typed name instead. */
const stampComponentNames = (components, docsById, allocation) => {
    // Keyed by the allocation row's own `key`, not a re-derived componentKey:
    // the allocation row does not carry manualPrice, so recomputing the key from
    // it would collide every manual row with an empty one.
    const shareByKey = new Map(allocation.map((row) => [row.key, row]));
    return components.map((component) => {
        const doc = component.itemId ? docsById.get(String(component.itemId)) : null;
        const variant = doc && component.variantId
            ? (doc.variants || []).find((v) => String(v._id) === String(component.variantId))
            : null;
        const share = shareByKey.get(componentKey(component));
        return {
            itemId: component.itemId || null,
            variantId: component.variantId || null,
            quantity: component.quantity,
            nameSnapshot: doc?.name || component.manualName || '',
            variantNameSnapshot: variant?.name || '',
            listUnitPrice: share?.listUnitPrice ?? 0,
            allocatedLineTotal: share?.comboLineTotal ?? 0,
        };
    });
};

export async function listCombos(restaurantId) {
    if (!restaurantId) return [];
    return FoodItem.find({ restaurantId, isCombo: true })
        .sort({ createdAt: -1 })
        .lean();
}

export async function getCombo(restaurantId, comboId) {
    if (!isObjectId(comboId)) return null;
    return FoodItem.findOne({ _id: comboId, restaurantId, isCombo: true }).lean();
}

/**
 * Create or update a combo.
 *
 * `updatedByRole` decides the approval state, exactly as it does for an ordinary
 * dish: what an admin saves is live, what a restaurant saves waits for approval.
 * Combos are not a way around the approval queue.
 */
export async function saveCombo(restaurantId, payload = {}, { comboId = null, updatedByRole = 'RESTAURANT' } = {}) {
    if (!restaurantId) throw new ValidationError('Missing restaurant.');

    const name = String(payload.name || '').trim();
    if (!name) throw new ValidationError('Give the combo a name.');

    if (!comboId) {
        const existing = await FoodItem.countDocuments({ restaurantId, isCombo: true });
        if (existing >= MAX_COMBOS_PER_RESTAURANT) {
            throw new ValidationError(`You can have at most ${MAX_COMBOS_PER_RESTAURANT} combos. Delete one first.`);
        }
    }

    const built = await buildComboPricing(restaurantId, payload.components, payload.comboPrice);

    // Category: whatever was chosen, else inherit the first REAL component's --
    // a manual component has no category of its own to give. A fully manual
    // combo (no catalogue dish at all) falls through to payload.categoryId only.
    const firstRealComponent = built.components.find((c) => c.itemId);
    const firstDoc = firstRealComponent ? built.docsById.get(String(firstRealComponent.itemId)) : null;
    const categoryId = payload.categoryId && isObjectId(payload.categoryId)
        ? payload.categoryId
        : firstDoc?.categoryId || null;
    const categoryName = String(payload.categoryName || firstDoc?.categoryName || '').trim();

    // A combo containing any non-veg dish is non-veg. Marking it Veg because the
    // form defaulted that way would be a labelling error, not a display bug.
    const anyNonVeg = [...built.docsById.values()].some((d) => d.foodType === 'Non-Veg');

    const fields = {
        restaurantId,
        name,
        description: String(payload.description || '').trim(),
        image: String(payload.image || firstDoc?.image || '').trim(),
        categoryId,
        categoryName,
        foodType: anyNonVeg ? 'Non-Veg' : 'Veg',
        isCombo: true,
        comboComponents: stampComponentNames(built.components, built.docsById, built.allocation),
        /*
         * The combo price is the base, and the parts total is the struck figure.
         *
         * The parts total used to be stored as `basePrice`. But the menu derives
         * what it shows from the base (base x (1 - discount)), while the bill
         * charges `price` -- so a Rs 150 combo of Rs 200 of dishes was shown at
         * Rs 200 with nothing struck and billed Rs 150. Storing the parts total as
         * the strike shows "Rs 150, was Rs 200" and bills Rs 150. The adjustment
         * fields are zeroed: combos are kept out of global price runs (see
         * priceAdjustment.service), so nothing else ever moves these figures.
         */
        price: built.price,
        basePrice: built.price,
        formulationPrice: built.price,
        formulationStrikePrice: built.componentTotal,
        formulationPercent: 0,
        formulationMarkupPercent: 0,
        formulationDiscountPercent: 0,
        discountPercent: computeDiscountPercent(built.componentTotal, built.price),
        variantsEnabled: false,
        variants: [],
        isAvailable: payload.isAvailable === false ? false : built.availability.available,
        approvalStatus: updatedByRole === 'ADMIN' ? 'approved' : 'pending',
        requestedAt: new Date(),
    };
    if (updatedByRole === 'ADMIN') fields.approvedAt = new Date();

    const saved = comboId
        ? await FoodItem.findOneAndUpdate(
            { _id: comboId, restaurantId, isCombo: true },
            { $set: fields },
            { new: true, runValidators: true },
        ).lean()
        : (await FoodItem.create(fields)).toObject();

    if (!saved) throw new ValidationError('That combo no longer exists.');

    await invalidate();
    return { combo: saved, saving: built.saving, allocation: built.allocation };
}

export async function deleteCombo(restaurantId, comboId) {
    if (!isObjectId(comboId)) throw new ValidationError('Invalid combo id.');
    const result = await FoodItem.deleteOne({ _id: comboId, restaurantId, isCombo: true });
    if (!result.deletedCount) throw new ValidationError('That combo no longer exists.');
    await invalidate();
    return true;
}

/**
 * Take combos off the menu whose components have gone away, and put them back
 * when the components return.
 *
 * Called after a dish's availability changes. Without this, switching one dish
 * off would leave a combo on the menu promising it -- the customer orders, and
 * the kitchen cannot fulfil what was sold.
 *
 * Only touches combos, and only the availability flag, so a restaurant that has
 * deliberately switched a combo off keeps that decision: the flag is set to
 * false when blocked, and only restored when nothing is blocking it AND the
 * combo was not manually parked (tracked by comboAutoDisabled).
 */
export async function syncComboAvailability(restaurantId) {
    if (!restaurantId) return { checked: 0, changed: 0 };
    const combos = await FoodItem.find({ restaurantId, isCombo: true })
        .select('comboComponents isAvailable comboAutoDisabled')
        .lean();
    if (!combos.length) return { checked: 0, changed: 0 };

    let changed = 0;
    for (const combo of combos) {
        const components = (combo.comboComponents || []).map((c) => ({
            itemId: c.itemId ? String(c.itemId) : null,
            variantId: c.variantId ? String(c.variantId) : null,
            quantity: c.quantity,
            // Only meaningful for a manual row (itemId null); resolveComboComponentContext
            // never looks these up in the database, so re-reading the snapshot is enough.
            manualName: c.nameSnapshot || '',
            manualPrice: Number(c.listUnitPrice) || 0,
        }));
        if (!components.length) continue;

        let stateByKey;
        try {
            ({ stateByKey } = await resolveComboComponentContext(restaurantId, components));
        } catch {
            // A component was deleted outright. Treat that as blocking rather than
            // letting the combo stay sellable.
            stateByKey = new Map();
        }
        const { available } = resolveComboAvailability(components, stateByKey);

        if (!available && combo.isAvailable !== false) {
            await FoodItem.updateOne({ _id: combo._id }, { $set: { isAvailable: false, comboAutoDisabled: true } });
            changed += 1;
        } else if (available && combo.isAvailable === false && combo.comboAutoDisabled) {
            await FoodItem.updateOne({ _id: combo._id }, { $set: { isAvailable: true, comboAutoDisabled: false } });
            changed += 1;
        }
    }

    if (changed) await invalidate();
    return { checked: combos.length, changed };
}

/** Public menu responses are cached; a combo change has to clear them or the
 *  new price sits behind a five-minute stale read. */
async function invalidate() {
    try {
        const { invalidatePriceCaches } = await import('../../../middleware/cache.js');
        await invalidatePriceCaches();
    } catch (err) {
        console.error('Combo cache invalidation failed:', err?.message || err);
    }
}
