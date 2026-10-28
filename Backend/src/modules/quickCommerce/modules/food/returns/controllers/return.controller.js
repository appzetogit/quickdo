import { sendResponse, sendError } from '../../../../utils/response.js';
import * as returnService from '../services/return.service.js';

/**
 * HTTP layer for quick-commerce returns.
 *
 * Thin on purpose: every rule lives in the services, so there is one place to read
 * and one place to change. Controllers pull the caller's identity off req.user and
 * never off the body — the whole flow moves money, and a userId taken from the
 * request would let anyone file a return against a stranger's order.
 */

const handle = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (err) {
        if (err?.name === 'ReturnError') return sendError(res, err.status || 400, err.message);
        return sendError(res, 500, err?.message || 'Something went wrong');
    }
};

const callerId = (req) => req.user?.userId || req.user?.id;

// ── Customer ───────────────────────────────────────────────────────────────────

export const getReturnableItemsController = handle(async (req, res) => {
    const data = await returnService.getReturnableItems({
        orderId: req.params.orderId,
        userId: callerId(req),
    });
    return sendResponse(res, 200, 'Returnable items', data);
});

export const requestReturnController = handle(async (req, res) => {
    const doc = await returnService.requestReturn({
        userId: callerId(req),
        orderId: req.params.orderId,
        lines: req.body?.items,
        reasonCode: req.body?.reasonCode,
        reasonNote: req.body?.reasonNote,
        images: req.body?.images,
    });
    return sendResponse(res, 201, 'Return requested', doc);
});

export const listMyReturnsController = handle(async (req, res) => {
    const data = await returnService.listUserReturns({
        userId: callerId(req),
        page: Number(req.query.page) || 1,
        limit: Math.min(Number(req.query.limit) || 20, 50),
    });
    return sendResponse(res, 200, 'Returns', data);
});

export const getMyReturnController = handle(async (req, res) => {
    const doc = await returnService.getReturnForUser({
        returnId: req.params.returnId,
        userId: callerId(req),
    });
    return sendResponse(res, 200, 'Return', doc);
});

export const cancelMyReturnController = handle(async (req, res) => {
    const doc = await returnService.cancelReturn({
        returnId: req.params.returnId,
        userId: callerId(req),
    });
    return sendResponse(res, 200, 'Return cancelled', doc);
});

// ── Admin ──────────────────────────────────────────────────────────────────────

export const listReturnsAdminController = handle(async (req, res) => {
    const data = await returnService.listAdminReturns({
        status: req.query.status,
        page: Number(req.query.page) || 1,
        limit: Math.min(Number(req.query.limit) || 20, 100),
    });
    return sendResponse(res, 200, 'Returns', data);
});

export const decideReturnAdminController = handle(async (req, res) => {
    const doc = await returnService.decideReturn({
        returnId: req.params.returnId,
        approve: req.body?.approve === true,
        note: req.body?.note || '',
        adminId: callerId(req),
    });
    return sendResponse(res, 200, doc.status === 'approved' ? 'Return approved' : 'Return rejected', doc);
});

export const schedulePickupAdminController = handle(async (req, res) => {
    const doc = await returnService.schedulePickup({
        returnId: req.params.returnId,
        scheduledFor: req.body?.scheduledFor,
        partnerId: req.body?.partnerId,
        adminId: callerId(req),
    });
    return sendResponse(res, 200, 'Pickup scheduled', doc);
});

export const inspectReturnAdminController = handle(async (req, res) => {
    const doc = await returnService.inspectReturn({
        returnId: req.params.returnId,
        conditions: req.body?.conditions || [],
        notes: req.body?.notes || '',
        inspectedBy: callerId(req),
    });
    return sendResponse(res, 200, 'Return inspected', doc);
});

export const refundReturnAdminController = handle(async (req, res) => {
    const doc = await returnService.refundReturn({
        returnId: req.params.returnId,
        adminId: callerId(req),
        refundTo: req.body?.refundTo,
    });
    return sendResponse(res, 200, 'Refund issued', doc);
});

// ── Delivery partner ───────────────────────────────────────────────────────────

export const markPickedUpController = handle(async (req, res) => {
    const doc = await returnService.markPickedUp({
        returnId: req.params.returnId,
        otp: req.body?.otp,
        partnerId: callerId(req),
    });
    return sendResponse(res, 200, 'Return collected', doc);
});
