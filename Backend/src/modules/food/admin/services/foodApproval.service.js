import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../models/food.model.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { syncMenuItemApprovalStatus } from '../../restaurant/services/restaurantMenu.service.js';
import { getFoodDisplayPrice, serializeFoodVariants } from './foodVariant.service.js';

const toRestaurantDisplayId = (mongoId) => {
    const s = String(mongoId || '');
    return s.length >= 5 ? s.slice(-5) : s;
};

export async function listPendingFoodApprovals(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 200, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { approvalStatus: 'pending' };
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(String(query.restaurantId))) {
        filter.restaurantId = query.restaurantId;
    }
    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().slice(0, 80);
        filter.$or = [
            { name: { $regex: term, $options: 'i' } },
            { categoryName: { $regex: term, $options: 'i' } }
        ];
    }

    const foodList = await FoodItem.find(filter)
        .sort({ requestedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('restaurantId categoryName name price variants image foodType approvalStatus requestedAt createdAt')
        .lean();

    const addonList = await FoodAddon.find({ approvalStatus: 'pending' })
        .sort({ requestedAt: -1, createdAt: -1 })
        .limit(limit)
        .select('restaurantId draft isAvailable requestedAt createdAt')
        .lean();

    const restaurantIds = Array.from(new Set([
        ...foodList.map((f) => String(f.restaurantId)),
        ...addonList.map((a) => String(a.restaurantId))
    ].filter(Boolean)));

    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } }).select('restaurantName').lean()
        : [];
    const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));

    const foodRequests = foodList.map((f) => ({
        _id: f._id,
        id: f._id,
        entityType: 'food',
        type: 'food',
        restaurantName: restaurantMap.get(String(f.restaurantId)) || 'Unknown Restaurant',
        restaurantId: toRestaurantDisplayId(f.restaurantId),
        category: f.categoryName || '',
        itemName: f.name,
        foodType: f.foodType || 'Non-Veg',
        sectionName: f.categoryName || '',
        subsectionName: '',
        approvalStatus: f.approvalStatus || 'pending',
        price: getFoodDisplayPrice(f),
        variants: serializeFoodVariants(f.variants),
        image: f.image || '',
        images: f.image ? [f.image] : [],
        requestedAt: f.requestedAt || f.createdAt,
        isActionable: (f.approvalStatus || 'pending') === 'pending'
    }));

    const addonRequests = addonList.map((a) => ({
        _id: a._id,
        id: a._id,
        entityType: 'addon',
        type: 'addon',
        restaurantName: restaurantMap.get(String(a.restaurantId)) || 'Unknown Restaurant',
        restaurantId: toRestaurantDisplayId(a.restaurantId),
        category: 'Add-on',
        itemName: a.draft?.name || 'Unnamed Add-on',
        foodType: 'Add-on',
        sectionName: 'Add-on',
        subsectionName: '',
        approvalStatus: 'pending',
        price: a.draft?.price ?? 0,
        image: a.draft?.image || (a.draft?.images && a.draft.images[0]) || '',
        images: a.draft?.images || (a.draft?.image ? [a.draft.image] : []),
        requestedAt: a.requestedAt || a.createdAt,
        isActionable: true,
        description: a.draft?.description || ''
    }));

    const allRequests = [...foodRequests, ...addonRequests].sort((a, b) => 
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );

    return { requests: allRequests, page, limit, total: allRequests.length };
}

/**
 * Approve a dish, and decide whether it joins the menu's standing adjustment.
 *
 * A dish arriving for approval carries no adjustment: it was created after
 * every run that shaped the menu around it. Approved as-is it goes live at its
 * bare base price beside dishes the platform has marked 20% up and 10% down --
 * visibly cheaper or dearer than its neighbours for no reason a customer could
 * name. Approving it INTO the adjustment was equally wrong as a silent default:
 * a restaurant that has just repriced a dish would find the platform's old
 * discount applied to the new figure without being asked.
 *
 * So it is a choice at the moment of approval, and the default is to leave the
 * dish untouched -- the conservative reading, and what every approval did
 * before this existed.
 *
 * @param {string} id
 * @param {object} [options]
 * @param {boolean} [options.applyGlobalPricing=false]
 *   true  -> inherit the markup and discount totals standing over this menu
 *   false -> approve at the base price, adjustment-free
 */
export async function approveFoodItem(id, options = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid food id');
    }
    const applyGlobalPricing = options?.applyGlobalPricing === true;

    const updated = await FoodItem.findOneAndUpdate(
        { _id: id, approvalStatus: 'pending' },
        { $set: { approvalStatus: 'approved', approvedAt: new Date(), rejectedAt: null, rejectionReason: '' } },
        { new: true }
    ).lean();
    if (updated?.restaurantId) {
        /*
         * Applied before the 99-store check below, which reads the dish's
         * price: a dish approved into a 30% discount may land under the cap
         * when its base price did not, and the shelf should reflect what the
         * customer will actually pay.
         */
        if (applyGlobalPricing) {
            try {
                const { resolveStandingAdjustment } = await import('./priceAdjustment.service.js');
                const { formulationFieldsFor } = await import('../../shared/formulationPricing.js');
                const standing = await resolveStandingAdjustment(updated.restaurantId, {
                    // This dish is already flagged approved by now; counting
                    // it among its own neighbours makes it inherit its own
                    // zeroes on a menu where it is the first one through.
                    excludeItemId: updated._id,
                });

                const base = Number(updated.basePrice) > 0
                    ? Number(updated.basePrice)
                    : Number(updated.price);

                if (base > 0 && (standing.markupPercent > 0 || standing.discountPercent > 0)) {
                    const fields = formulationFieldsFor(base, -standing.discountPercent);
                    if (fields) {
                        const next = {
                            basePrice: fields.basePrice,
                            price: fields.price,
                            formulationPrice: fields.price,
                            formulationDiscountPercent: standing.discountPercent,
                            formulationMarkupPercent: standing.markupPercent,
                            // The signed field older readers still consult; a
                            // markup wins when both stand, as elsewhere.
                            formulationPercent: standing.markupPercent > 0
                                ? standing.markupPercent
                                : -standing.discountPercent,
                        };
                        /*
                         * The struck figure, chosen the way a run would have
                         * chosen it for this dish.
                         *
                         * A decrease strikes the price the dish was selling for
                         * before the cut. This dish was never cut -- it is
                         * being approved straight into the total -- so the
                         * figure it is discounted FROM is its own base price.
                         * Recording that puts it exactly where its neighbours
                         * are, which is the point of inheriting at all.
                         *
                         * With no discount standing there is nothing it dropped
                         * from, so the markup figure applies instead and no
                         * strike is stored.
                         */
                        const struckFromBase = standing.lastDirection === 'decrease'
                            && standing.discountPercent > 0;
                        const markupStrike = (b) =>
                            Math.round(b * (1 + standing.markupPercent / 100) * 100) / 100;
                        const strike = struckFromBase ? fields.basePrice : markupStrike(base);
                        /*
                         * Written in both directions, never left as it was.
                         *
                         * It used to be written only after a decrease. A dish a
                         * restaurant had re-priced then kept the strike from its
                         * OLD base -- and the stored strike is what the menu
                         * shows -- so a Rs 200 dish struck at 240 under a +20%
                         * hike, re-priced to Rs 300 and approved into the same
                         * hike, went on striking 240: below its own price, so the
                         * hike showed nowhere. A new dish had no stored strike and
                         * derived 360, which is why only edits broke.
                         */
                        next.formulationStrikePrice = struckFromBase
                            ? fields.basePrice
                            : (standing.markupPercent > 0 ? strike : null);
                        next.discountPercent = strike > next.price
                            ? Math.round(((strike - next.price) / strike) * 10000) / 100
                            : 0;

                        /*
                         * Every size joins the adjustment, not only the headline.
                         * Sizes carry their own base and strike and are what is
                         * actually billed; approving only the dish's own figures
                         * left each size at full price beside a headline that
                         * advertised the discount.
                         */
                        if (Array.isArray(updated.variants) && updated.variants.length > 0) {
                            next.variants = updated.variants.map((v) => {
                                const vBase = Number(v?.basePrice) > 0 ? Number(v.basePrice) : Number(v?.price);
                                if (!(vBase > 0)) return v;
                                const roundedBase = Math.round(vBase * 100) / 100;
                                return {
                                    ...v,
                                    basePrice: roundedBase,
                                    price: Math.max(0.01, Math.round(vBase * (1 - standing.discountPercent / 100) * 100) / 100),
                                    formulationStrikePrice: struckFromBase
                                        ? roundedBase
                                        : (standing.markupPercent > 0 ? markupStrike(vBase) : null),
                                };
                            });
                        }

                        await FoodItem.updateOne({ _id: updated._id }, { $set: next });
                        Object.assign(updated, next);
                    }
                }
            } catch (err) {
                /*
                 * Logged, not thrown. The dish is already approved at this
                 * point; failing here would leave it live and the admin staring
                 * at an error, unsure whether the approval landed.
                 */
                console.error('Failed to apply the standing adjustment on approval:', err);
            }
        }

        // Single DB update; makes user-facing menu reflect approval immediately.
        await syncMenuItemApprovalStatus(updated.restaurantId, updated._id, 'approved', '');

        // Rs 99 store: a dish becoming approved at or under the cap goes on the
        // shelf without anyone ticking it. This is the path every restaurant-
        // created dish takes, and every restaurant price change re-enters it
        // (a price edit sends the dish back to pending), so it covers both.
        try {
            const { shouldAutoMark99 } = await import('../../shared/ninetyNineStore.js');
            const { getNinetyNineCap } = await import('../../shared/ninetyNineStoreCap.js');
            const cap = await getNinetyNineCap();
            // An admin who removed this dish from the shelf keeps that decision
            // through re-approval; only a price crossing the cap undoes it.
            if (shouldAutoMark99(updated, cap)
                && updated.showIn99Store !== true
                && updated.ninetyNineStoreExcluded !== true) {
                await FoodItem.updateOne({ _id: updated._id }, { $set: { showIn99Store: true } });
                updated.showIn99Store = true;
            }
        } catch (err) {
            console.error('Rs 99 auto-mark failed after approval:', err);
        }
        
        try {
            // Broad on purpose: this changes what public_foods and the menu serve.
            // The previous key, restaurant_menu:<id>, could never match --
            // keys are prefix:METHOD:url -- so this cache was never cleared.
            const { invalidatePriceCaches } = await import('../../../../middleware/cache.js');
            await invalidatePriceCaches();
        } catch (cacheErr) {
            console.error('Failed to invalidate cache after food approval:', cacheErr);
        }

        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                {
                    title: 'Dish Approved! 🍲',
                    body: `Your dish "${updated.name}" has been approved and is now visible to customers.`,
                    image: updated.image || 'https://i.ibb.co/5GzXz7r/Quick Drop-Brand-Image.png',
                    data: {
                        type: 'food_approved',
                        foodId: String(updated._id),
                        restaurantId: String(updated.restaurantId)
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send food approval notification:', e);
        }
    }
    return updated;
}

export async function rejectFoodItem(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid food id');
    }
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (!r) throw new ValidationError('Rejection reason is required');
    if (r.length > 500) throw new ValidationError('Rejection reason is too long');

    const updated = await FoodItem.findOneAndUpdate(
        { _id: id, approvalStatus: 'pending' },
        { $set: { approvalStatus: 'rejected', rejectedAt: new Date(), rejectionReason: r, approvedAt: null } },
        { new: true }
    ).lean();
    if (updated?.restaurantId) {
        await syncMenuItemApprovalStatus(updated.restaurantId, updated._id, 'rejected', r);
        
        try {
            // Broad on purpose: this changes what public_foods and the menu serve.
            // The previous key, restaurant_menu:<id>, could never match --
            // keys are prefix:METHOD:url -- so this cache was never cleared.
            const { invalidatePriceCaches } = await import('../../../../middleware/cache.js');
            await invalidatePriceCaches();
        } catch (cacheErr) {
            console.error('Failed to invalidate cache after food rejection:', cacheErr);
        }

        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                {
                    title: 'Dish Rejected ❌',
                    body: `Your dish "${updated.name}" was rejected. Reason: ${r}`,
                    image: updated.image || 'https://i.ibb.co/5GzXz7r/Quick Drop-Brand-Image.png',
                    data: {
                        type: 'food_rejected',
                        foodId: String(updated._id),
                        restaurantId: String(updated.restaurantId),
                        reason: r
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send food rejection notification:', e);
        }
    }
    return updated;
}


