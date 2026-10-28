import { sendResponse, sendError } from '../../../../utils/response.js';
import {
    listPendingFoodApprovals,
    approveFoodItem,
    rejectFoodItem
} from '../services/foodApproval.service.js';

export async function getPendingFoodApprovals(req, res, next) {
    try {
        const data = await listPendingFoodApprovals(req.query || {});
        return sendResponse(res, 200, 'Pending food approvals fetched successfully', data);
    } catch (error) {
        next(error);
    }
}

export async function approveFoodItemController(req, res, next) {
    try {
        /*
         * The admin's choice, sent with the approval. Absent means "leave the
         * dish untouched", which is what every approval did before this and is
         * the safer default: applying a discount nobody asked for is worse than
         * not applying one they did.
         */
        const applyGlobalPricing = req.body?.applyGlobalPricing === true
            || String(req.body?.applyGlobalPricing || '').toLowerCase() === 'true';
        const updated = await approveFoodItem(req.params.id, { applyGlobalPricing });
        if (!updated) return sendError(res, 404, 'Food item not found or not pending');
        return sendResponse(res, 200, 'Food item approved successfully', { food: updated });
    } catch (error) {
        next(error);
    }
}

export async function rejectFoodItemController(req, res, next) {
    try {
        const updated = await rejectFoodItem(req.params.id, req.body?.reason);
        if (!updated) return sendError(res, 404, 'Food item not found or not pending');
        return sendResponse(res, 200, 'Food item rejected successfully', { food: updated });
    } catch (error) {
        next(error);
    }
}

/**
 * What the approval screen shows beside the choice.
 *
 * Without this the admin is asked to decide blind: "apply the global pricing"
 * means nothing until you can see it is 20% up and 10% down, and what the dish
 * would cost either way.
 */
export async function getStandingAdjustmentController(req, res, next) {
    try {
        const { resolveStandingAdjustment } = await import('../services/priceAdjustment.service.js');
        const { formulationFieldsFor, resolveFormulationPricing } = await import('../../shared/formulationPricing.js');
        const { FoodItem } = await import('../models/food.model.js');

        const food = await FoodItem.findById(req.params.id)
            .select('name price basePrice restaurantId formulationPercent formulationMarkupPercent formulationDiscountPercent formulationStrikePrice')
            .lean();
        if (!food?._id) return sendError(res, 404, 'Food item not found');

        const standing = await resolveStandingAdjustment(food.restaurantId);
        const base = Number(food.basePrice) > 0 ? Number(food.basePrice) : Number(food.price);
        const applied = formulationFieldsFor(base, -standing.discountPercent);
        // The strike approval will write -- the base after a decrease, the markup
        // figure otherwise -- so the preview is the dish as it will go live.
        const strike = standing.lastDirection === 'decrease' && standing.discountPercent > 0
            ? base
            : Math.round(base * (1 + standing.markupPercent / 100) * 100) / 100;
        /*
         * "As it stands" is the dish's own pricing, not its bare base. An edited
         * dish already carries the adjustment it had, and approving it untouched
         * keeps that; showing the base here told the admin it would drop.
         */
        const asItStands = resolveFormulationPricing(food);

        return sendResponse(res, 200, 'Standing adjustment', {
            standing,
            preview: {
                untouched: { pays: asItStands.price, cutout: asItStands.strikePrice },
                applied: {
                    pays: applied ? applied.price : base,
                    cutout: strike > (applied ? applied.price : base) ? strike : null,
                },
            },
        });
    } catch (error) {
        next(error);
    }
}
