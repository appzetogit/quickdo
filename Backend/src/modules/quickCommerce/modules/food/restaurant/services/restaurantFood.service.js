import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { normalizeFoodImages } from '../../admin/services/foodImages.util.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import {
    extractRawFoodVariants,
    getFoodDisplayOtherPrice,
    getFoodDisplayPrice,
    hasFoodVariants,
    normalizeFoodVariantsInput
} from '../../admin/services/foodVariant.service.js';
import {
    backfillLegacyCategoryWorkflow,
    categoryAllowsFoodType,
    GLOBAL_CATEGORY_FILTER
} from '../../shared/categoryWorkflow.js';

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

const getCreateFoodPricing = (body = {}) => {
    const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
    if (variants.length > 0) {
        return {
            price: getFoodDisplayPrice({ variants }),
            otherPrice: getFoodDisplayOtherPrice({ variants }),
            variants
        };
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new ValidationError('Price is invalid');
    const otherPrice = Number(body.otherPrice);
    return {
        price,
        otherPrice: Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0,
        variants: []
    };
};

const getUpdatedFoodPricing = (existing = {}, body = {}) => {
    const variantsTouched = body.variants !== undefined || body.variations !== undefined;
    const existingHasVariants = hasFoodVariants(existing);
    const update = {};

    if (variantsTouched) {
        // Stock the form did not send is kept (foodVariant.service carryVariantStock).
        const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body), { existing: existing.variants });
        update.variants = variants;

        if (variants.length > 0) {
            update.price = getFoodDisplayPrice({ variants });
            update.otherPrice = getFoodDisplayOtherPrice({ variants });
            return update;
        }

        const nextBasePrice = body.price !== undefined ? Number(body.price) : Number(existingHasVariants ? NaN : existing.price);
        if (!Number.isFinite(nextBasePrice) || nextBasePrice < 0) {
            throw new ValidationError('Base price is required when variants are removed');
        }
        update.price = nextBasePrice;
        if (body.otherPrice !== undefined) {
            const otherPrice = Number(body.otherPrice);
            update.otherPrice = Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0;
        } else {
            update.otherPrice = 0;
        }
        return update;
    }

    if (body.price !== undefined) {
        if (existingHasVariants) {
            throw new ValidationError('Update variants instead of base price for foods with variants');
        }
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0) throw new ValidationError('Price is invalid');
        update.price = price;
    }

    if (body.otherPrice !== undefined) {
        if (existingHasVariants) {
            throw new ValidationError('Update variants instead of base other price for foods with variants');
        }
        const otherPrice = Number(body.otherPrice);
        update.otherPrice = Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0;
    }

    return update;
};

const STOCK_OFF_MODES = new Set(['manual', 'specific-time', 'next-business-day', 'custom-date-time']);

const parseStockResumeAt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
};

/**
 * Reads a stock-style number off the request.
 *
 * Returns undefined when the field was not sent (leave it alone) and null when
 * it was sent empty (stop tracking). Those are different intents and collapsing
 * them would either wipe a seller's count on an unrelated edit, or make an
 * unlimited item impossible to go back to.
 */
const parseStockNumber = (value, { min = 0 } = {}) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num < min) {
        throw new ValidationError('Stock values must be whole numbers of zero or more');
    }
    return Math.floor(num);
};

/**
 * Grocery catalog fields, which a restaurant menu never needed.
 *
 * Same undefined/null split as the stock fields: not sent means leave alone,
 * sent empty means clear.
 */
const buildCatalogUpdate = (body = {}) => {
    const update = {};

    if (body.brand !== undefined) update.brand = toStr(body.brand);
    if (body.packSize !== undefined) update.packSize = toStr(body.packSize);
    if (body.sku !== undefined) update.sku = toStr(body.sku);
    if (body.barcode !== undefined) update.barcode = toStr(body.barcode);

    if (body.expiryDate !== undefined) {
        if (body.expiryDate === null || body.expiryDate === '') {
            update.expiryDate = null;
        } else {
            const expiry = new Date(body.expiryDate);
            // An unparseable date becomes Invalid Date, which Mongoose casts to
            // null -- so the seller would be told the save worked and the expiry
            // would simply have vanished. Reject it instead.
            if (Number.isNaN(expiry.getTime())) throw new ValidationError('Expiry date is invalid');
            update.expiryDate = expiry;
        }
    }

    if (body.mrp !== undefined) {
        if (body.mrp === null || body.mrp === '') {
            update.mrp = null;
        } else {
            const mrp = Number(body.mrp);
            if (!Number.isFinite(mrp) || mrp < 0) throw new ValidationError('MRP is invalid');
            update.mrp = mrp;
        }
    }

    if (body.gstRate !== undefined) {
        if (body.gstRate === null || body.gstRate === '') {
            update.gstRate = null;
        } else {
            const rate = Number(body.gstRate);
            if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
                throw new ValidationError('GST rate must be between 0 and 100');
            }
            update.gstRate = rate;
        }
    }

    return update;
};

/** Selling above the printed maximum retail price is illegal, so it is refused outright. */
const assertPriceWithinMrp = (price, mrp, variants = []) => {
    // Each pack size (500 g, 1 kg) carries its own printed MRP as its otherPrice.
    for (const v of Array.isArray(variants) ? variants : []) {
        const variantMrp = Number(v?.otherPrice);
        if (Number.isFinite(variantMrp) && variantMrp > 0 && Number(v?.price) > variantMrp) {
            throw new ValidationError(`${v?.name || 'A size'}: price cannot be above its MRP of ${variantMrp}`);
        }
    }
    if (!Number.isFinite(Number(mrp)) || Number(mrp) <= 0) return;
    const highest = Math.max(
        Number(price) || 0,
        ...(Array.isArray(variants) ? variants.map((v) => Number(v?.price) || 0) : []),
    );
    if (highest > Number(mrp)) {
        throw new ValidationError(`Price cannot be above the MRP of ${mrp}`);
    }
};

const buildAvailabilityUpdate = (body = {}) => {
    const update = {};
    const unset = {};

    const stockQty = parseStockNumber(body.stockQty);
    if (stockQty !== undefined) {
        update.stockQty = stockQty;
        // A restock has to bring the item back: it went dark automatically when
        // it hit zero, so leaving it hidden would make the count meaningless.
        if (stockQty !== null && stockQty > 0 && body.isAvailable === undefined) {
            update.isAvailable = true;
            unset.stockOffMode = 1;
            unset.stockResumeAt = 1;
        }
        if (stockQty === 0) update.isAvailable = false;
    }

    const lowStockThreshold = parseStockNumber(body.lowStockThreshold);
    if (lowStockThreshold !== undefined) update.lowStockThreshold = lowStockThreshold;

    const maxQtyPerOrder = parseStockNumber(body.maxQtyPerOrder, { min: 1 });
    if (maxQtyPerOrder !== undefined) update.maxQtyPerOrder = maxQtyPerOrder;

    if (body.isAvailable !== undefined) {
        update.isAvailable = body.isAvailable !== false;
        if (body.isAvailable !== false) {
            unset.stockResumeAt = 1;
            unset.stockOffMode = 1;
        }
    }

    if (body.stockResumeAt !== undefined) {
        const resumeAt = parseStockResumeAt(body.stockResumeAt);
        if (resumeAt) {
            update.stockResumeAt = resumeAt;
        } else {
            unset.stockResumeAt = 1;
        }
    }

    if (body.stockOffMode !== undefined) {
        const mode = String(body.stockOffMode || '').trim();
        if (mode && STOCK_OFF_MODES.has(mode)) {
            update.stockOffMode = mode;
        } else {
            unset.stockOffMode = 1;
        }
    }

    return { update, unset };
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

/**
 * Sets stock on many products at once.
 *
 * A seller taking a delivery counts thirty things in one go. Making them open
 * thirty screens is how inventory stops being maintained, and stock nobody
 * maintains is worse than no stock tracking at all -- it is wrong with
 * confidence.
 *
 * Per-item results rather than all-or-nothing: one unknown id in a long list
 * should not throw away thirty correct counts.
 *
 * ponytail: a loop of updates, not bulkWrite. Fine for a seller's catalogue;
 * revisit if someone starts pushing thousands of rows at once.
 */
export async function updateRestaurantFoodStock(restaurantId, entries = []) {
    const context = await getRestaurantContext(restaurantId);

    if (!Array.isArray(entries) || entries.length === 0) {
        throw new ValidationError('No stock updates provided');
    }
    if (entries.length > 500) {
        throw new ValidationError('Please send at most 500 stock updates at a time');
    }

    const updated = [];
    const failed = [];

    for (const entry of entries) {
        const foodId = toStr(entry?.itemId ?? entry?.id ?? entry?._id);
        if (!foodId || !mongoose.Types.ObjectId.isValid(foodId)) {
            failed.push({ itemId: foodId, reason: 'Invalid item id' });
            continue;
        }

        try {
            const { update, unset } = buildAvailabilityUpdate({
                stockQty: entry?.stockQty,
                lowStockThreshold: entry?.lowStockThreshold,
                maxQtyPerOrder: entry?.maxQtyPerOrder,
                ...(entry?.isAvailable !== undefined ? { isAvailable: entry.isAvailable } : {})
            });

            if (Object.keys(update).length === 0 && Object.keys(unset).length === 0) {
                failed.push({ itemId: foodId, reason: 'Nothing to update' });
                continue;
            }

            const doc = await FoodItem.findOneAndUpdate(
                { _id: new mongoose.Types.ObjectId(foodId), restaurantId: context.restaurantId },
                {
                    ...(Object.keys(update).length ? { $set: update } : {}),
                    ...(Object.keys(unset).length ? { $unset: unset } : {})
                },
                { new: true }
            )
                .select('_id name stockQty lowStockThreshold maxQtyPerOrder isAvailable')
                .lean();

            if (!doc) {
                failed.push({ itemId: foodId, reason: 'Item not found for this seller' });
                continue;
            }
            updated.push(doc);
        } catch (err) {
            failed.push({ itemId: foodId, reason: err?.message || 'Update failed' });
        }
    }

    return { updated, failed, updatedCount: updated.length, failedCount: failed.length };
}

/** Products at or below their own low-stock mark, so the seller knows what to reorder. */
export async function listLowStockFoods(restaurantId) {
    const context = await getRestaurantContext(restaurantId);

    const items = await FoodItem.find({
        restaurantId: context.restaurantId,
        stockQty: { $ne: null },
        lowStockThreshold: { $ne: null }
    })
        .select('_id name brand packSize image stockQty lowStockThreshold isAvailable')
        .lean();

    // Compared in code rather than in the query: Mongo cannot compare two fields
    // of the same document in a plain find, and a seller's catalogue is small
    // enough that filtering here is cheaper than an aggregation pipeline.
    const low = items.filter((item) => Number(item.stockQty) <= Number(item.lowStockThreshold));
    low.sort((a, b) => Number(a.stockQty) - Number(b.stockQty));

    return { items: low, total: low.length };
}

export async function createRestaurantFood(restaurantId, body = {}) {
    const context = await getRestaurantContext(restaurantId);

    const name = toStr(body.name);
    if (!name) throw new ValidationError('Item name is required');
    if (name.length > 200) throw new ValidationError('Item name is too long');

    const { price, otherPrice, variants } = getCreateFoodPricing(body);
    const catalogFields = buildCatalogUpdate(body);
    assertPriceWithinMrp(price, catalogFields.mrp, variants);

    const description = toStr(body.description);
    const isAvailable = body.isAvailable !== false;
    const foodType = normalizeFoodType(body.foodType);
    const preparationTime = toStr(body.preparationTime);
    const { categoryObjectId, categoryName } = await resolveCategoryForRestaurant(context, { ...body, foodType });

    const doc = await FoodItem.create({
        restaurantId,
        categoryId: categoryObjectId,
        categoryName: categoryName || '',
        name,
        description,
        price,
        otherPrice,
        variants,
        // Same normaliser the admin service uses, so a dish gets the same
        // image/images relationship regardless of which panel created it.
        ...(normalizeFoodImages(body) ?? { image: '', images: [] }),
        foodType,
        isAvailable,
        // Undefined leaves the schema default (null = untracked), so a seller
        // who never enters a count keeps the old always-in-stock behaviour.
        stockQty: parseStockNumber(body.stockQty) ?? undefined,
        lowStockThreshold: parseStockNumber(body.lowStockThreshold) ?? undefined,
        maxQtyPerOrder: parseStockNumber(body.maxQtyPerOrder, { min: 1 }) ?? undefined,
        ...catalogFields,
        isRecommended: body.isRecommended === true,
        preparationTime,
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

    const update = {};

    if (body.name !== undefined) {
        const name = toStr(body.name);
        if (!name) throw new ValidationError('Item name is required');
        if (name.length > 200) throw new ValidationError('Item name is too long');
        update.name = name;
    }
    if (body.description !== undefined) update.description = toStr(body.description);
    const nextImages = normalizeFoodImages(body, existing);
    if (nextImages) {
        update.images = nextImages.images;
        update.image = nextImages.image;
    }
    Object.assign(update, getUpdatedFoodPricing(existing, body));
    const catalogUpdate = buildCatalogUpdate(body);
    Object.assign(update, catalogUpdate);
    // Checked against whichever MRP and price end up on the document, so an edit
    // to either one alone cannot leave the item priced above its MRP.
    assertPriceWithinMrp(
        update.price ?? existing.price,
        'mrp' in catalogUpdate ? catalogUpdate.mrp : existing.mrp,
        update.variants ?? existing.variants,
    );
    const availabilityUpdate = buildAvailabilityUpdate(body);
    Object.assign(update, availabilityUpdate.update);
    if (body.preparationTime !== undefined) update.preparationTime = toStr(body.preparationTime);
    if (body.isRecommended !== undefined) update.isRecommended = body.isRecommended === true;

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

    const CRITICAL_APPROVAL_FIELDS = [
        // `images` alongside `image`: adding or reordering photos changes what
        // customers are shown, so it goes back through approval for the same
        // reason a changed primary image always did.
        'name', 'description', 'image', 'images', 'price', 'variants',
        'foodType', 'categoryId', 'categoryName', 'preparationTime'
    ];
    const shouldResubmitForApproval = Object.keys(update).some(key => CRITICAL_APPROVAL_FIELDS.includes(key));

    if (shouldResubmitForApproval) {
        update.approvalStatus = 'pending';
        update.requestedAt = new Date();
        update.rejectionReason = '';
        update.approvedAt = null;
        update.rejectedAt = null;
    }

    const updated = await FoodItem.findOneAndUpdate(
        { _id: foodId, restaurantId },
        {
            ...(Object.keys(update).length ? { $set: update } : {}),
            ...(Object.keys(availabilityUpdate.unset).length ? { $unset: availabilityUpdate.unset } : {})
        },
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

    return updated;
}

/**
 * Removes one of the seller's own products.
 *
 * Deleting was admin-only, so the delete button in the seller panel had no
 * route behind it and failed silently.
 *
 * The restaurantId is part of the query rather than checked afterwards: a
 * seller must not be able to delete another store's product by guessing an id,
 * and a filter the database enforces cannot be forgotten by a later edit.
 */
export async function deleteRestaurantFood(restaurantId, foodId) {
    const context = await getRestaurantContext(restaurantId);

    if (!foodId || !mongoose.Types.ObjectId.isValid(foodId)) {
        throw new ValidationError('Invalid product id');
    }

    const deleted = await FoodItem.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(foodId),
        restaurantId: context.restaurantId,
    })
        .select('_id name image')
        .lean();

    if (!deleted) return null;

    // The menu is cached per store; without this the product keeps appearing to
    // shoppers until the cache expires.
    try {
        const { invalidateCache } = await import('../../../../middleware/cache.js');
        await invalidateCache(`restaurant_menu:${context.restaurantId}`);
        await invalidateCache('search_products:*');
    } catch (err) {
        console.error('Failed to invalidate cache after product delete:', err);
    }

    return { id: String(deleted._id), name: deleted.name };
}
