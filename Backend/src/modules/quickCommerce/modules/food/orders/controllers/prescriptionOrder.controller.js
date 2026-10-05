import { sendResponse } from '../../../../utils/response.js';
import {
    approvePrescriptionBill,
    createPrescriptionOrder,
    declinePrescriptionBill,
    fillPrescriptionOrder,
    submitPrescriptionBill,
    dispatchPrescriptionOrder,
} from '../services/prescriptionOrder.service.js';

/** Customer: place an order from a photographed prescription. */
export async function createPrescriptionOrderController(req, res, next) {
    try {
        const order = await createPrescriptionOrder(req.user?.userId, req.body || {});
        return sendResponse(res, 201, 'Prescription sent to the pharmacy', { order });
    } catch (err) {
        next(err);
    }
}

/** Pharmacist: enter what will be dispensed, which prices the order. */
export async function fillPrescriptionOrderController(req, res, next) {
    try {
        const order = await fillPrescriptionOrder(
            req.params.orderId,
            req.user?.userId,
            req.body || {},
        );
        return sendResponse(res, 200, 'Order priced', { order });
    } catch (err) {
        next(err);
    }
}

/** Pharmacist: upload the paper bill and its total, which prices the order. */
export async function submitPrescriptionBillController(req, res, next) {
    try {
        const order = await submitPrescriptionBill(
            req.params.orderId,
            req.user?.userId,
            req.body || {},
        );
        return sendResponse(res, 200, 'Bill sent to the customer', { order });
    } catch (err) {
        next(err);
    }
}

/**
 * Customer: accept the bill.
 *
 * Returns `payment` when they are paying online -- the Razorpay order to open
 * the sheet with -- and null for cash on delivery, where there is nothing to
 * pay now. The approval itself is only stamped once that payment verifies.
 */
export async function approvePrescriptionBillController(req, res, next) {
    try {
        const result = await approvePrescriptionBill(
            req.params.orderId,
            req.user?.userId,
            req.body || {},
        );
        return sendResponse(res, 200, 'Bill approved', result);
    } catch (err) {
        next(err);
    }
}

/** Customer: refuse the bill, which cancels the order. */
export async function declinePrescriptionBillController(req, res, next) {
    try {
        const order = await declinePrescriptionBill(
            req.params.orderId,
            req.user?.userId,
            req.body || {},
        );
        return sendResponse(res, 200, 'Bill declined and order cancelled', { order });
    } catch (err) {
        next(err);
    }
}

/** Pharmacy: photograph the sealed packet and hand it to the partner. */
export async function dispatchPrescriptionOrderController(req, res, next) {
    try {
        const order = await dispatchPrescriptionOrder(
            req.params.orderId,
            req.user?.restaurantId || req.user?.userId,
            req.body || {},
        );
        return sendResponse(res, 200, 'Packet recorded and ready for pickup', { order });
    } catch (err) {
        next(err);
    }
}
