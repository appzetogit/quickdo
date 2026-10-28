import { FoodItem } from '../../admin/models/food.model.js';

/**
 * Re-enable foods whose scheduled out-of-stock window has expired.
 * Manual off (no stockResumeAt) is left unchanged until the restaurant turns it back on.
 */
export async function restoreExpiredFoodAvailability(filter = {}) {
    const now = new Date();
    const result = await FoodItem.updateMany(
        {
            ...filter,
            isAvailable: false,
            stockResumeAt: { $ne: null, $lte: now },
            // A timer must not undo a count. An item that ran out while its
            // resume window was ticking would otherwise come back listed as
            // available with nothing on the shelf, and every customer who added
            // it would be refused at checkout by the stock reservation.
            // Untracked items (null) resume exactly as they did before.
            $or: [{ stockQty: null }, { stockQty: { $gt: 0 } }]
        },
        {
            $set: { isAvailable: true },
            $unset: { stockResumeAt: 1, stockOffMode: 1 }
        }
    );

    return result.modifiedCount || 0;
}
