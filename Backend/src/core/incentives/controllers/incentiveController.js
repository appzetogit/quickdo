import { DriverIncentiveRule } from '../models/driverIncentiveRule.model.js';
import {
    getCurrentIncentiveForFoodPartner,
    getCurrentIncentiveForDriver,
    tiersOfRule,
} from '../services/incentiveService.js';
import { validateIncentiveRuleUpsertDto } from '../validators/incentiveRule.validator.js';
import { sendResponse, sendError } from '../../../utils/response.js';

/** GET /food/delivery/incentives/current — rider-facing. */
export async function getCurrentIncentiveController(req, res, next) {
    try {
        const data = await getCurrentIncentiveForFoodPartner(req.user?.userId);
        return sendResponse(res, 200, 'Incentive progress fetched', data);
    } catch (error) {
        next(error);
    }
}

/**
 * GET /taxi/drivers/incentives/ladder/current — same card, for a taxi
 * driver, including one with no linked food/QC partner at all (the food
 * route above has no id to start from for them).
 */
export async function getCurrentDriverIncentiveController(req, res, next) {
    try {
        const data = await getCurrentIncentiveForDriver(req.auth?.sub);
        return sendResponse(res, 200, 'Incentive progress fetched', data);
    } catch (error) {
        next(error);
    }
}

/** GET /food/admin/incentive-rules — the master-panel "Delivery Incentives" list. */
export async function listIncentiveRulesController(req, res, next) {
    try {
        const active = await DriverIncentiveRule.find({ isActive: true }).sort({ segment: 1 }).lean();
        const recent = await DriverIncentiveRule.find({}).sort({ createdAt: -1 }).limit(20).lean();
        // Rules saved before tiers existed are shown as their one-rung ladder.
        const withTiers = (r) => ({ ...r, tiers: tiersOfRule(r) });
        return sendResponse(res, 200, 'Incentive rules fetched', { active: active.map(withTiers), recent: recent.map(withTiers) });
    } catch (error) {
        next(error);
    }
}

/**
 * PUT /food/admin/incentive-rules — sets the active rule for one segment.
 * Deactivates whatever was active for that segment first, so a segment never
 * has two rules answering "what's current" at once; the previous rule is
 * kept, not deleted, as history.
 */
export async function upsertIncentiveRuleController(req, res, next) {
    try {
        const body = validateIncentiveRuleUpsertDto(req.body || {});
        // One live ladder per segment, zone, vehicle type AND window: daily
        // and weekly are independent ladders for the same (zone, vehicleType)
        // rather than alternatives, so saving one must never deactivate the
        // other.
        await DriverIncentiveRule.updateMany(
            {
                segment: body.segment,
                zoneId: body.zoneId,
                vehicleTypeId: body.vehicleTypeId,
                windowType: body.windowType,
                isActive: true,
                // A dated (limited-time) ladder runs on top of the permanent one
                // and replaces only another dated one; the permanent ladder takes
                // over again when it ends.
                ...(body.startsAt || body.endsAt
                    ? { $or: [{ startsAt: { $ne: null } }, { endsAt: { $ne: null } }] }
                    : { startsAt: null, endsAt: null }),
            },
            { $set: { isActive: false } },
        );
        const created = await DriverIncentiveRule.create({ ...body, createdByAdminId: req.user?._id || null });
        return sendResponse(res, 201, 'Incentive rule saved', created);
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /food/admin/incentive-rules/:id -- turns a rule off, keeping it in the
 * history. With ?permanent=1 the rule is removed from the list altogether
 * (turning it off first if it was live). Credits already paid under it are
 * untouched: they are the riders' earnings record, not part of the rule.
 * Either way this is a DELETE, so sub-admins without delete access are refused.
 */
export async function deactivateIncentiveRuleController(req, res, next) {
    try {
        const permanent = ['1', 'true'].includes(String(req.query?.permanent || '').toLowerCase());
        if (permanent) {
            const removed = await DriverIncentiveRule.findByIdAndDelete(req.params.id);
            if (!removed) return sendError(res, 404, 'Incentive rule not found');
            return sendResponse(res, 200, 'Incentive rule deleted', { _id: removed._id, wasActive: removed.isActive });
        }
        const updated = await DriverIncentiveRule.findByIdAndUpdate(
            req.params.id,
            { $set: { isActive: false } },
            { new: true },
        );
        if (!updated) return sendError(res, 404, 'Incentive rule not found');
        return sendResponse(res, 200, 'Incentive rule deactivated', updated);
    } catch (error) {
        next(error);
    }
}
