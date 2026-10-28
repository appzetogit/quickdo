/**
 * Admin > Food List's thumbs-up: put one dish on the Rs 99 store, or take it off.
 *
 * Writes both flags the store reads, so the dish follows the admin's choice
 * whichever rule lists the shelf: `showIn99Store` (ticked) and
 * `ninetyNineStoreExcluded` (taken off by hand). The edit form writes the same
 * pair when its "Show in the Rs 99 store" box is ticked or cleared.
 */
import mongoose from 'mongoose';
import { FoodItem } from '../models/food.model.js';
import { getFoodDisplayPrice } from './foodVariant.service.js';
import { getNinetyNineCap } from '../../shared/ninetyNineStoreCap.js';
import { invalidateCache } from '../../../../middleware/cache.js';

const fail = (statusCode, message) => {
    const e = new Error(message);
    e.statusCode = statusCode;
    return e;
};

export async function setFoodInNinetyNineStore(foodId, inStore) {
    if (!mongoose.Types.ObjectId.isValid(String(foodId || ''))) throw fail(400, 'Invalid food id');
    const on = inStore === true || inStore === 'true';
    const food = await FoodItem.findById(foodId).lean();
    if (!food) throw fail(404, 'Food not found');

    if (on) {
        // The store only lists dishes at or under its price point; ticking one
        // above it would look done and show nothing in the app.
        const cap = await getNinetyNineCap();
        const price = Number(getFoodDisplayPrice(food));
        if (!(price > 0) || price > cap) {
            throw fail(400, `${food.name} sells at Rs ${price}; the store only lists dishes up to Rs ${cap}.`);
        }
    }

    await FoodItem.updateOne(
        { _id: food._id },
        { $set: { showIn99Store: on, ninetyNineStoreExcluded: !on } },
    );
    // The app's store reads the cached public dish feed.
    await invalidateCache('public_foods:*').catch(() => {});
    return { id: String(food._id), name: food.name, inStore: on };
}

export const setFoodInNinetyNineStoreController = async (req, res, next) => {
    try {
        const result = await setFoodInNinetyNineStore(req.params.id, req.body?.inStore);
        return res.status(200).json({
            success: true,
            message: result.inStore ? `${result.name} added to the store` : `${result.name} removed from the store`,
            data: result,
        });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        next(error);
    }
};
