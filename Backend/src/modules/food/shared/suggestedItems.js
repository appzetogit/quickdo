import mongoose from 'mongoose';
import { ValidationError } from '../../../core/auth/errors.js';

/**
 * "Goes well with": the dishes a restaurant pairs with this one, shown to the
 * customer beside it and in the cart.
 *
 * The cart used to guess from words in the dish name ("coffee" is a drink,
 * "fries" a side) and fell back to the whole menu when nothing matched, so a
 * customer buying a pizza was shown every item the restaurant sells. Pairings
 * are now chosen by the restaurant or the admin.
 */
export const MAX_SUGGESTED_ITEMS = 10;

const toId = (v) => {
    if (v && typeof v === 'object') v = v._id ?? v.id;
    const s = v == null ? '' : String(v).trim();
    return s;
};

/**
 * Validates a `suggestedItemIds` sent on a dish save.
 *
 * Returns undefined when the key was not sent, so a partial update leaves the
 * stored pairings alone. Otherwise every id must be a dish of the same
 * restaurant; the dish itself and duplicates are dropped, and at most
 * MAX_SUGGESTED_ITEMS are kept, in the order given.
 */
export async function normalizeSuggestedItemIdsInput(FoodItem, restaurantId, body = {}, selfId = null) {
    if (body?.suggestedItemIds === undefined) return undefined;

    const raw = Array.isArray(body.suggestedItemIds) ? body.suggestedItemIds : [body.suggestedItemIds];
    const self = selfId ? String(selfId) : '';
    const ids = [...new Set(raw.map(toId).filter((v) => v && v !== self))];
    if (ids.length === 0) return { suggestedItemIds: [] };
    if (ids.length > MAX_SUGGESTED_ITEMS) {
        throw new ValidationError(`Pick at most ${MAX_SUGGESTED_ITEMS} items that go well with this dish`);
    }
    if (ids.some((v) => !mongoose.Types.ObjectId.isValid(v))) {
        throw new ValidationError('One or more suggested items are not valid');
    }

    const owned = await FoodItem.find({
        _id: { $in: ids.map((v) => new mongoose.Types.ObjectId(v)) },
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
    }).select('_id').lean();
    if ((owned || []).length !== ids.length) {
        throw new ValidationError('One or more suggested items do not belong to this restaurant');
    }

    // The order the restaurant picked them in is the order they are shown.
    return { suggestedItemIds: ids.map((v) => new mongoose.Types.ObjectId(v)) };
}

/**
 * Each dish's pairings as the customer sees them, keyed by dish id.
 *
 * Pairings work both ways: when Burger lists Fries, Fries also shows Burger,
 * so a restaurant links a pair once, not from each side. A dish's own picks
 * come first, then the dishes that picked it. Only ids among `foods` are kept,
 * which also drops pairings to a dish since deleted or taken off the menu.
 */
export function buildSuggestionMap(foods = []) {
    const present = new Set((foods || []).map((f) => String(f?._id || '')).filter(Boolean));
    const own = new Map();
    const reverse = new Map();
    for (const food of foods || []) {
        const id = String(food?._id || '');
        if (!id) continue;
        const picks = (food.suggestedItemIds || []).map(String).filter((s) => s !== id && present.has(s));
        own.set(id, picks);
        for (const pick of picks) {
            if (!reverse.has(pick)) reverse.set(pick, []);
            reverse.get(pick).push(id);
        }
    }
    const result = new Map();
    for (const id of present) {
        result.set(id, [...new Set([...(own.get(id) || []), ...(reverse.get(id) || [])])]);
    }
    return result;
}
