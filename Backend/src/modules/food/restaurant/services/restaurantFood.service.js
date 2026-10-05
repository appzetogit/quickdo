import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import {
    extractRawFoodVariants,
    getFoodDisplayPrice,
    hasFoodVariants,
    normalizeFoodVariantsInput
} from '../../admin/services/foodVariant.service.js';
import {
    backfillLegacyCategoryWorkflow,
    categoryAllowsFoodType,
    GLOBAL_CATEGORY_FILTER
} from '../../shared/categoryWorkflow.js';
import {
    assertOrderQuantityRange,
    normalizeOrderQuantityInput
} from '../../shared/orderQuantityRules.js';
import { normalizeItemPackagingChargeInput } from '../../shared/packagingCharge.js';

import { normalizeAvailabilityScheduleInput } from '../../shared/itemAvailability.js';
import { getOrderQuantityCeiling } from '../../shared/orderQuantityCeiling.js';
import { normalizeDiscountPricingInput } from '../../shared/itemDiscountPricing.js';
import { rebaseFormulationFields } from '../../shared/formulationPricing.js';
import { FoodAddon } from '../models/foodAddon.model.js';
import { assertVariantAddonsOwned, normalizeAddonIdsInput } from '../../shared/orderAddons.js';
import { normalizeSuggestedItemIdsInput } from '../../shared/suggestedItems.js';

import { resolveSeedOtherPriceForRestaurant } from '../../shared/otherPlatformSeed.service.js';
import { invalidateMenuCaches } from '../../../../middleware/cache.js';
const toStr = (v) => (v != null ? String(v).trim() : '');
const APPROVED_CATEGORY_FILTER = [
    { approvalStatus: 'approved' },
    { approvalStatus: { $exists: false }, isApproved: { $ne: false } }
];

const normalizeFoodType = (v) => {
    const t = String(v || '').trim();
    if (!t) return 'Non-Veg';
    if (t === 'Veg') return 'Veg';
    if (t === 'Non-Veg') return 'Non-Veg';
    if (t === 'Egg') return 'Non-Veg';
    return 'Non-Veg';
};

const normalizeRecommendedFlag = (value) =>
    value === true || value === 1 || String(value).trim().toLowerCase() === 'true';

/**
 * Resolve what the item costs, from base price and discount.
 *
 * `price` is always the selling price -- what a customer pays and what order
 * subtotals, commission and payouts are computed from. `basePrice` is the
 * pre-discount figure shown struck through beside it.
 *
 * With variants the discount is still a single item-level percentage, applied
 * to each variant's own price at selling time (see order-pricing.service.js).
 * The item's own price is the cheapest variant after discount, which is the
 * "from" price a menu listing shows.
 */
/**
 * Whether a dish is sold by its variants, resolved from the request.
 *
 * Callers that predate the toggle never send the flag; for them, having
 * variants means selling by variants -- exactly the behaviour they were built
 * against. A caller that does send it is taken at its word, which is what lets
 * the toggle switch a dish to its base price while the variants stay stored.
 */
const resolveVariantsEnabled = (body = {}, existing = null) => {
    if (body.variantsEnabled !== undefined) {
        return body.variantsEnabled === true || body.variantsEnabled === 'true';
    }
    if (existing && existing.variantsEnabled !== undefined && existing.variantsEnabled !== null) {
        return existing.variantsEnabled === true;
    }
    const touched = body.variants !== undefined || body.variations !== undefined;
    if (touched) {
        return normalizeFoodVariantsInput(extractRawFoodVariants(body)).length > 0;
    }
    return existing ? hasFoodVariants(existing) : false;
};

const getCreateFoodPricing = (body = {}) => {
    const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
    const variantsEnabled = resolveVariantsEnabled(body);

    if (variantsEnabled) {
        if (variants.length === 0) {
            throw new ValidationError('Add at least one variant, or switch variants off');
        }
        const from = getFoodDisplayPrice({ variants });
        return { price: from, basePrice: from, discountPercent: 0, variants, variantsEnabled: true };
    }

    let pricing;
    try {
        pricing = normalizeDiscountPricingInput(body, {});
    } catch (error) {
        throw new ValidationError(error.message);
    }
    if (!pricing) throw new ValidationError('Price is invalid');

    // Variants typed while the toggle is off are kept, not discarded: the whole
    // point of the toggle is that switching back on costs nothing.
    return {
        price: pricing.price,
        basePrice: pricing.basePrice,
        discountPercent: pricing.discountPercent,
        variants,
        variantsEnabled: false,
    };
};

const getUpdatedFoodPricing = (existing = {}, body = {}) => {
    const variantsTouched = body.variants !== undefined || body.variations !== undefined;
    const update = {};

    const variants = variantsTouched
        // `existing` lets the normalizer tell an untouched selling price from a
        // deliberate reprice, so an ordinary save cannot walk a size's base down.
        ? normalizeFoodVariantsInput(extractRawFoodVariants(body), { existing })
        : (existing.variants || []);
    if (variantsTouched) update.variants = variants;

    const variantsEnabled = resolveVariantsEnabled(body, existing);
    if (body.variantsEnabled !== undefined || variantsTouched) {
        update.variantsEnabled = variantsEnabled;
    }

    const applyPricing = (bodyPart) => {
        try {
            return normalizeDiscountPricingInput(bodyPart, existing);
        } catch (error) {
            throw new ValidationError(error.message);
        }
    };

    if (variantsEnabled) {
        if (variants.length === 0) {
            throw new ValidationError('Add at least one variant, or switch variants off');
        }
        /*
         * Selling by variants: the item's own figures mirror its cheapest size --
         * the "from" figure a listing shows. `price` is the cheapest CHARGED
         * price and `basePrice` the cheapest BASE, which differ on a discounted
         * dish. Both used to be the charged one, which wrote a discounted figure
         * into the dish's base on every save.
         *
         * The base price inputs are still ignored here rather than rejected, so a
         * form that sends everything it holds does not have to know which half
         * applies.
         */
        const bases = variants
            .map((v) => Number(v?.basePrice))
            .filter((n) => Number.isFinite(n) && n > 0);
        update.price = getFoodDisplayPrice({ variants });
        update.basePrice = bases.length ? Math.min(...bases) : update.price;
        update.discountPercent = 0;
        // The headline's struck figure follows its new cheapest base, for the
        // reason given below: a strike stored against the old base wins on the
        // menu and can end up at or under the price.
        const rebasedHeadline = rebaseFormulationFields(existing, update.basePrice);
        if (rebasedHeadline) update.formulationStrikePrice = rebasedHeadline.formulationStrikePrice;
        return update;
    }

    // Selling at the base price. Variants, if any, ride along in storage.
    const mentionsPrice = body.price !== undefined || body.basePrice !== undefined || body.discountPercent !== undefined;
    const mustReprice = mentionsPrice || body.variantsEnabled !== undefined || variantsTouched;
    if (!mustReprice) return update;

    const fallbackBase = existing.basePrice ?? existing.price;
    /*
     * `price` keeps its own name rather than being renamed to `basePrice` -- see
     * the note in normalizeDiscountPricingInput. A restaurant form that submits
     * only the selling price of a discounted dish was redefining the base as that
     * discounted figure, walking the base down on every save.
     */
    const pricing = applyPricing({
        ...(body.basePrice !== undefined
            ? { basePrice: body.basePrice }
            : body.price !== undefined
                ? { price: body.price }
                : { basePrice: fallbackBase }),
        discountPercent: body.discountPercent,
    });
    if (!pricing || pricing.basePrice === null || !(pricing.basePrice > 0)) {
        throw new ValidationError('Enter a base price, or switch variants on');
    }
    /*
     * The new base carries the dish's standing adjustment: the charged price,
     * the struck figure and the saving are all worked out again from it (see
     * rebaseFormulationFields). Setting only the price used to leave the
     * discount on the dish while charging the bare base -- shown 270, billed
     * 300 -- and left a strike from the old base that hid a hike entirely.
     */
    const rebased = rebaseFormulationFields(existing, pricing.basePrice);
    if (rebased) {
        Object.assign(update, rebased);
        return update;
    }
    update.price = pricing.price;
    update.basePrice = pricing.basePrice;
    update.discountPercent = pricing.discountPercent;
    return update;
};

const getRestaurantContext = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }

    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('pureVegRestaurant')
        .lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }

    return {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        pureVegRestaurant: restaurant.pureVegRestaurant === true
    };
};

const getAccessibleCategoryFilter = (context) => ({
    $or: [
        { restaurantId: context.restaurantId, $or: APPROVED_CATEGORY_FILTER },
        {
            $and: [
                { $or: GLOBAL_CATEGORY_FILTER },
                { $or: APPROVED_CATEGORY_FILTER }
            ]
        }
    ]
});

const resolveCategoryForRestaurant = async (context, body = {}) => {
    const categoryIdRaw = toStr(body.categoryId);
    const categoryNameRaw = toStr(body.categoryName);
    const foodType = normalizeFoodType(body.foodType);

    if (!categoryIdRaw && !categoryNameRaw) {
        return { categoryObjectId: undefined, categoryName: '' };
    }

    const baseFilter = {
        ...getAccessibleCategoryFilter(context),
        isActive: { $ne: false }
    };
    if (context.pureVegRestaurant) {
        baseFilter.foodTypeScope = 'Veg';
    }

    let category = null;
    if (categoryIdRaw) {
        if (!mongoose.Types.ObjectId.isValid(categoryIdRaw)) {
            throw new ValidationError('Invalid category id');
        }

        category = await FoodCategory.findOne({
            _id: new mongoose.Types.ObjectId(categoryIdRaw),
            ...baseFilter
        }).lean();
    } else {
        const exact = `^${String(categoryNameRaw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
        const matches = await FoodCategory.find({
            ...baseFilter,
            name: { $regex: exact, $options: 'i' }
        })
            .sort({ createdAt: -1 })
            .limit(2)
            .lean();
        if (matches.length > 1) {
            throw new ValidationError('Multiple categories share this name. Please choose a specific category.');
        }
        category = matches[0] || null;
    }

    if (!category?._id) {
        throw new ValidationError('Category not found for this restaurant');
    }

    await backfillLegacyCategoryWorkflow([category]);

    if (String(category.approvalStatus || '') !== 'approved') {
        throw new ValidationError('This category is awaiting admin approval');
    }
    if (context.pureVegRestaurant && String(category.foodTypeScope || '') !== 'Veg') {
        throw new ValidationError('Pure veg restaurants can only use veg categories');
    }
    if (!categoryAllowsFoodType(category.foodTypeScope, foodType)) {
        throw new ValidationError(`This ${category.foodTypeScope} category cannot accept ${foodType} food`);
    }

    return {
        categoryObjectId: category._id,
        categoryName: category.name || '',
        category
    };
};

export async function createRestaurantFood(restaurantId, body = {}) {
    const context = await getRestaurantContext(restaurantId);

    const name = toStr(body.name);
    if (!name) throw new ValidationError('Item name is required');
    if (name.length > 200) throw new ValidationError('Item name is too long');

    const { price, basePrice, discountPercent, variants, variantsEnabled } = getCreateFoodPricing(body);

    const description = toStr(body.description);
    const image = toStr(body.image);
    const isActive = body.isActive !== false && body.isAvailable !== false;
    const isAvailable = isActive;
    const isRecommended = normalizeRecommendedFlag(body.isRecommended);
    const foodType = normalizeFoodType(body.foodType);
    const preparationTime = toStr(body.preparationTime);
    const { categoryObjectId, categoryName } = await resolveCategoryForRestaurant(context, { ...body, foodType });

    const quantityLimits = normalizeOrderQuantityInput(body, { label: name, ceiling: await getOrderQuantityCeiling() }) || {};
    assertOrderQuantityRange(quantityLimits, { label: name });
    const packagingCharge = normalizeItemPackagingChargeInput(body.packagingCharge, { label: name });
    const availabilitySchedule = normalizeAvailabilityScheduleInput(body.availabilitySchedule);
    const addonUpdate = await normalizeAddonIdsInput(FoodAddon, restaurantId, body);
    const suggestedUpdate = await normalizeSuggestedItemIdsInput(FoodItem, restaurantId, body);
    await assertVariantAddonsOwned(FoodAddon, restaurantId, variants);
    // The struck-through comparison figure. Stored per item, and the only thing
    // a global price adjustment moves -- what we charge stays where the
    // restaurant set it.
    // otherPrice is deliberately NOT read here: the comparison figure is
    // admin-owned, and ignoring it (rather than erroring) keeps older
    // restaurant clients that still send the key working.

    /*
     * Start the comparison figure where this restaurant's other dishes sit.
     *
     * Global adjustments move the stored otherPrice only on dishes that exist
     * when they run, so a dish added later would fall back to the blanket
     * markup and advertise a smaller saving than everything beside it. Seeded
     * only when the caller supplied none -- an explicit figure always wins.
     */
    const seededOtherPrice = await resolveSeedOtherPriceForRestaurant(restaurantId, price);

    const doc = await FoodItem.create({
        restaurantId,
        ...(seededOtherPrice > 0 && { otherPrice: seededOtherPrice }),
        categoryId: categoryObjectId,
        categoryName: categoryName || '',
        name,
        description,
        price,
        basePrice,
        discountPercent,
        variants,
        variantsEnabled,
        image,
        foodType,
        isActive,
        isAvailable,
        isRecommended,
        preparationTime,
        ...quantityLimits,
        ...(packagingCharge ? { packagingCharge } : {}),
        ...(availabilitySchedule ? { availabilitySchedule } : {}),
        ...(addonUpdate || {}),
        ...(suggestedUpdate || {}),
        approvalStatus: 'pending',
        requestedAt: new Date()
    });

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'New Product Approval Request ðŸ”',
            body: `Restaurant has submitted a new item "${doc.name}" for approval.`,
            data: {
                type: 'approval_request',
                subType: 'food',
                id: String(doc._id)
            }
        });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to notify admins of new food approval request:', e);
    }

    return doc.toObject();
}

export async function updateRestaurantFood(restaurantId, foodId, body = {}) {
    const context = await getRestaurantContext(restaurantId);
    if (!foodId || !mongoose.Types.ObjectId.isValid(String(foodId))) {
        throw new ValidationError('Invalid food id');
    }

    const existing = await FoodItem.findOne({ _id: foodId, restaurantId }).lean();
    if (!existing) return null;

    /*
     * What the admin actually approves about a dish. A real change to one of
     * these re-opens approval; nothing else does.
     *
     * Listed rather than excluded, because most of what a save writes is
     * neither: the in-stock switch, the serving window, the "goes well with"
     * pairings and the highlight flag all belong to the restaurant, and the
     * formulation/comparison figures are bookkeeping the save recomputes from
     * the price -- formulationPrice alone counted as an edit on dishes the
     * backfill had not reached, which sent them for approval on every save.
     *
     * A new field that the admin should vet has to be added here.
     */
    const APPROVAL_WORTHY_KEYS = [
        'name', 'description', 'image', 'foodType', 'preparationTime',
        'categoryId', 'categoryName',
        'price', 'basePrice', 'discountPercent', 'priceIncludesGst',
        'variants', 'variantsEnabled',
        'packagingCharge', 'minOrderQuantity', 'maxOrderQuantity',
        'addonIds',
    ];

    const update = {};

    if (body.name !== undefined) {
        const name = toStr(body.name);
        if (!name) throw new ValidationError('Item name is required');
        if (name.length > 200) throw new ValidationError('Item name is too long');
        update.name = name;
    }
    if (body.description !== undefined) update.description = toStr(body.description);
    if (body.image !== undefined) update.image = toStr(body.image);
    Object.assign(update, getUpdatedFoodPricing(existing, body));
    if (body.isActive !== undefined || body.isAvailable !== undefined) {
        const nextIsActive = body.isActive !== undefined
            ? body.isActive !== false
            : body.isAvailable !== false;
        update.isActive = nextIsActive;
        update.isAvailable = nextIsActive;
    }
    if (body.isRecommended !== undefined) {
        update.isRecommended = normalizeRecommendedFlag(body.isRecommended);
    }
    if (body.preparationTime !== undefined) update.preparationTime = toStr(body.preparationTime);
    if (body.availabilitySchedule !== undefined) {
        update.availabilitySchedule = normalizeAvailabilityScheduleInput(body.availabilitySchedule);
    }

    const addonUpdate = await normalizeAddonIdsInput(FoodAddon, restaurantId, body);
    if (addonUpdate) update.addonIds = addonUpdate.addonIds;
    const suggestedUpdate = await normalizeSuggestedItemIdsInput(FoodItem, restaurantId, body, foodId);
    if (suggestedUpdate) update.suggestedItemIds = suggestedUpdate.suggestedItemIds;
    // otherPrice ignored on purpose -- admin-owned; see the create path.
    // Checked against the variants that will actually be stored, so a partial
    // update cannot slip in an add-on belonging to another restaurant.
    await assertVariantAddonsOwned(
        FoodAddon,
        restaurantId,
        update.variants !== undefined ? update.variants : existing.variants
    );

    const itemLabel = update.name || existing.name || 'This item';
    const quantityLimits = normalizeOrderQuantityInput(body, { label: itemLabel, ceiling: await getOrderQuantityCeiling() });
    if (quantityLimits) {
        // Check the values that will actually be stored, so a partial update
        // can't slip a max below the stored min.
        assertOrderQuantityRange(
            {
                minOrderQuantity: existing.minOrderQuantity,
                maxOrderQuantity: existing.maxOrderQuantity,
                ...quantityLimits
            },
            { label: itemLabel }
        );
        Object.assign(update, quantityLimits);
    }
    const packagingCharge = normalizeItemPackagingChargeInput(body.packagingCharge, { label: itemLabel });
    if (packagingCharge) update.packagingCharge = packagingCharge;

    // A priceIncludesGst sent from the restaurant panel is ignored: whether
    // prices include GST is the admin's to set, per restaurant.

    const targetFoodType = body.foodType !== undefined ? normalizeFoodType(body.foodType) : normalizeFoodType(existing.foodType);
    if (body.foodType !== undefined) update.foodType = targetFoodType;

    if (
        body.categoryId !== undefined ||
        body.categoryName !== undefined ||
        body.foodType !== undefined
    ) {
        const { categoryObjectId, categoryName } = await resolveCategoryForRestaurant(context, {
            categoryId: body.categoryId !== undefined ? body.categoryId : existing.categoryId,
            categoryName: body.categoryName !== undefined ? body.categoryName : existing.categoryName,
            foodType: targetFoodType
        });
        update.categoryId = categoryObjectId;
        update.categoryName = categoryName || '';
    }

    /*
     * Approval is re-opened by a real change to an approval-worthy field, not
     * by the mere presence of one in the payload.
     *
     * The item editor posts the whole dish on every save, so flipping the
     * in-stock switch there arrived as name + price + image + isAvailable and
     * counted as an edit: the dish went pending and vanished from the customer
     * menu, and switching it back on could not bring it back -- it stayed
     * pending until an admin approved it. That is the "the toggle does nothing"
     * report. The stock switch on the Inventory page, which posts isActive on
     * its own, was always fine.
     *
     * A value that only LOOKS changed (a re-serialised variant array, say) is
     * treated as changed, which is exactly today's behaviour -- this can only
     * ever spare an approval that was never warranted, never skip a real one.
     */
    const asComparable = (value) => {
        if (value === undefined || value === null) return null;
        if (value instanceof Date) return value.toISOString();
        if (mongoose.Types.ObjectId.isValid(value) && typeof value !== 'object') return String(value);
        if (typeof value === 'object') return JSON.stringify(value, (k, v) => (v && v._bsontype === 'ObjectId' ? String(v) : v));
        return value;
    };
    const changedApprovalKeys = APPROVAL_WORTHY_KEYS.filter(
        (key) => key in update && asComparable(update[key]) !== asComparable(existing[key]),
    );
    const shouldResubmitForApproval = changedApprovalKeys.length > 0;

    if (shouldResubmitForApproval) {
        update.approvalStatus = 'pending';
        update.requestedAt = new Date();
        update.rejectionReason = '';
        update.approvedAt = null;
        update.rejectedAt = null;
    }

    const updated = await FoodItem.findOneAndUpdate(
        { _id: foodId, restaurantId },
        { $set: update },
        { new: true }
    ).lean();

    if (updated && shouldResubmitForApproval) {
        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'Updated Product Approval Request',
                body: `Restaurant has updated and resubmitted "${updated.name}" for approval.`,
                data: {
                    type: 'approval_request',
                    subType: 'food',
                    id: String(updated._id)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of resubmitted food approval request:', e);
        }
    }

    // A dish going off the menu takes any combo containing it off too, and a dish
    // coming back restores those combos. Without this a combo would keep
    // advertising something the kitchen has just switched off, and the customer
    // would pay the combo price for food that cannot be made.
    if (updated && (body.isActive !== undefined || body.isAvailable !== undefined)) {
        try {
            const { syncComboAvailability } = await import('../../shared/combo.service.js');
            await syncComboAvailability(restaurantId);
        } catch (e) {
            console.error('Combo availability sync failed:', e?.message || e);
        }
    }

    /*
     * The public menu is cached for ten minutes and the cross-restaurant feed
     * for five. Writing without clearing them is why switching a dish off
     * looked like it did nothing: the write landed in Mongo instantly and the
     * app kept being served the dish, still orderable, until the cache aged
     * out. The same shape of bug already bit global price adjustments.
     *
     * Every field is cleared, not just availability, because price, name and
     * image are all in the same cached payload.
     */
    if (updated) await invalidateMenuCaches();

    return updated;
}
