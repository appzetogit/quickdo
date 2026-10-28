/**
 * Dish/product-level order quantity limits (minOrderQuantity / maxOrderQuantity)
 * for the admin food editor, shared by Food and quick commerce: each hands in
 * its own item model.
 *
 * Validated with the restaurant form's own rules (orderQuantityRules.js) against
 * the platform ceiling from fee settings. 0 means "no minimum" / "no cap".
 */
import mongoose from 'mongoose';
import { ValidationError } from '../../../core/auth/errors.js';
import { normalizeOrderQuantityInput, assertOrderQuantityRange } from './orderQuantityRules.js';
import { getOrderQuantityCeiling } from './orderQuantityCeiling.js';

export const createFoodQuantityLimits = (Model) => ({
    /** The list rows, each with its stored limits. One query for the page. */
    async withFoodQuantityLimits(foods = []) {
        const ids = foods.map((f) => f?._id || f?.id).filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
        if (!ids.length) return foods;
        const rows = await Model.find({ _id: { $in: ids } }).select('minOrderQuantity maxOrderQuantity').lean();
        const byId = new Map(rows.map((r) => [String(r._id), r]));
        return foods.map((f) => {
            const r = byId.get(String(f?._id || f?.id));
            return r ? { ...f, minOrderQuantity: r.minOrderQuantity ?? 1, maxOrderQuantity: r.maxOrderQuantity ?? 0 } : f;
        });
    },

    /**
     * Checks the limits a create/update sends, before anything is written, so an
     * invalid pair never leaves a half-saved item. Returns the values to store,
     * or undefined when the request sent neither field.
     */
    async prepareFoodQuantityLimits(body = {}, { foodId = null } = {}) {
        const label = String(body.name || '').trim() || 'This item';
        const limits = normalizeOrderQuantityInput(body, { label, ceiling: await getOrderQuantityCeiling() });
        if (!limits) return undefined;
        let existing = {};
        if (foodId) {
            existing = (await Model.findById(foodId).select('minOrderQuantity maxOrderQuantity').lean()) || {};
        }
        assertOrderQuantityRange({ ...existing, ...limits }, { label });
        return limits;
    },

    async saveFoodQuantityLimits(foodId, limits) {
        if (!limits || !mongoose.Types.ObjectId.isValid(String(foodId))) return;
        const result = await Model.updateOne({ _id: foodId }, { $set: limits });
        if (!result.matchedCount) throw new ValidationError('Item not found');
    },
});
