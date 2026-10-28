/**
 * Razorpay `qr_code.credited`: money landed on a dynamic UPI QR a driver or
 * rider showed (core/payments/razorpayQr.js). The QR's notes say what it was
 * for -- { kind: 'taxi_ride' | 'food_order' | 'qc_order', refId }.
 *
 * Nothing in the event body is taken as proof of payment: each case re-reads
 * the QR from Razorpay through the same sync the driver's app polls, so the
 * webhook only makes the confirmation arrive sooner.
 *
 *   - the QR the ride/order is showing now: sync it (marks it paid);
 *   - a QR it showed before and replaced: the order's payment if it is still
 *     unpaid and the money covers it, otherwise refunded;
 *   - a cancelled ride/order: refunded.
 */
import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { closeUpiQr, fetchUpiQr } from './razorpayQr.js';
import { settleStaleQrCredit } from './orderCollectQr.js';

const refundWith = (helperPath) => async (paymentId, amount) => {
    const helper = await import(helperPath);
    const result = await helper.initiateRazorpayRefund(paymentId, amount);
    if (result && result.success === false) throw new Error(result.error || 'refund failed');
    return result;
};
const FOOD_REFUND = refundWith('../../modules/food/orders/helpers/razorpay.helper.js');
const QC_REFUND = refundWith('../../modules/quickCommerce/modules/food/orders/helpers/razorpay.helper.js');

const ORDER_VERTICALS = {
    food_order: {
        models: async () => ({
            Order: (await import('../../modules/food/orders/models/order.model.js')).FoodOrder,
            Transaction: (await import('../../modules/food/orders/models/foodTransaction.model.js')).FoodTransaction,
        }),
        sync: async () => (await import('../../modules/food/orders/services/order-payment.service.js')).syncRazorpayQrPayment,
        refund: FOOD_REFUND,
    },
    qc_order: {
        models: async () => ({
            Order: (await import('../../modules/quickCommerce/modules/food/orders/models/order.model.js')).FoodOrder,
            Transaction: (await import('../../modules/quickCommerce/modules/food/orders/models/foodTransaction.model.js')).FoodTransaction,
        }),
        sync: async () => (await import('../../modules/quickCommerce/modules/food/orders/services/order-payment.service.js')).syncRazorpayQrPayment,
        refund: QC_REFUND,
    },
};

async function creditOrder(kind, qrId, refId) {
    const vertical = ORDER_VERTICALS[kind];
    const { Order, Transaction } = await vertical.models();
    const order = await Order.findById(refId);
    if (!order) {
        logger.error(`[QrWebhook] ${kind} ${refId} not found for QR ${qrId}; refund it from the Razorpay dashboard if it was paid`);
        return 'missing';
    }
    const tx = await Transaction.findOne({ orderId: order._id }).lean();
    const payment = tx?.payment || order.payment?.toObject?.() || order.payment || {};
    const qr = payment.qr || {};
    const cancelled = String(order.orderStatus || '').startsWith('cancelled');

    if (!cancelled && qr.qrId === qrId) {
        await (await vertical.sync())(order);
        return 'synced';
    }

    const isOurs = qr.qrId === qrId || (qr.previousQrIds || []).includes(qrId);
    if (!isOurs && !cancelled) {
        logger.error(`[QrWebhook] QR ${qrId} is not one ${kind} ${refId} showed; left alone`);
        return 'ignored';
    }

    const orderPaid = cancelled || String(payment.status || '').toLowerCase() === 'paid';
    const dueAmountPaise = Math.round(Number(payment.amountDue ?? order.pricing?.total ?? 0) * 100);
    const outcome = await settleStaleQrCredit({ qrId, orderPaid, dueAmountPaise, refund: vertical.refund });
    if (outcome !== 'adopt') return outcome;

    // The customer paid the replaced QR before the new one: that is the payment.
    const paidQr = await fetchUpiQr(qrId);
    if (qr.kind === 'upi_qr' && qr.qrId && qr.qrId !== qrId) {
        await closeUpiQr(qr.qrId).catch(() => {});
    }
    const adopted = {
        kind: 'upi_qr',
        qrId,
        upiString: paidQr.upiString,
        imageUrl: paidQr.imageUrl,
        amountPaise: paidQr.amountPaise,
        status: 'active',
        expiresAt: paidQr.closeBy,
        previousQrIds: [...(qr.previousQrIds || []), qr.qrId].filter((id) => id && id !== qrId).slice(-10),
    };
    const $set = { 'payment.method': 'razorpay_qr', 'payment.status': 'pending_qr', 'payment.qr': adopted };
    await Transaction.updateOne({ orderId: order._id }, { $set: { ...$set, paymentMethod: 'razorpay_qr' } });
    await Order.updateOne({ _id: order._id }, { $set });
    await (await vertical.sync())(await Order.findById(order._id));
    logger.warn(`[QrWebhook] ${kind} ${refId} paid on replaced QR ${qrId}; taken as its payment`);
    return 'adopted';
}

async function creditRide(qrId, refId) {
    const { Ride } = await import('../../modules/taxi/user/models/Ride.js');
    const ride = await Ride.findById(refId);
    if (!ride) {
        logger.error(`[QrWebhook] ride ${refId} not found for QR ${qrId}; refund it from the Razorpay dashboard if it was paid`);
        return 'missing';
    }
    const collection = ride.driverPaymentCollection || {};
    const cancelled = String(ride.status || ride.liveStatus || '').toLowerCase().startsWith('cancel');
    const { refreshDriverPaymentCollection } = await import('../../modules/taxi/driver/controllers/driverController.js');

    if (!cancelled && collection.providerId === qrId) {
        await refreshDriverPaymentCollection(ride);
        return 'synced';
    }

    const isOurs = collection.providerId === qrId || (collection.previousProviderIds || []).includes(qrId);
    if (!isOurs && !cancelled) {
        logger.error(`[QrWebhook] QR ${qrId} is not one ride ${refId} showed; left alone`);
        return 'ignored';
    }

    const ridePaid = cancelled || ['paid', 'captured', 'completed'].includes(String(collection.status || '').toLowerCase());
    const outcome = await settleStaleQrCredit({
        qrId,
        orderPaid: ridePaid,
        dueAmountPaise: Math.round(Number(ride.fare || 0) * 100),
        refund: FOOD_REFUND,
    });
    if (outcome !== 'adopt') return outcome;

    const paidQr = await fetchUpiQr(qrId);
    if (collection.providerMode === 'razorpay_qr' && collection.providerId && collection.providerId !== qrId) {
        await closeUpiQr(collection.providerId).catch(() => {});
    }
    ride.driverPaymentCollection = {
        ...(collection.toObject?.() || collection),
        provider: 'razorpay',
        providerId: qrId,
        providerMode: 'razorpay_qr',
        status: 'active',
        amount: paidQr.amountPaise / 100,
        linkUrl: paidQr.imageUrl,
        upiString: paidQr.upiString,
        previousProviderIds: [...(collection.previousProviderIds || []), collection.providerId]
            .filter((id) => id && id !== qrId)
            .slice(-10),
        updatedAt: new Date(),
    };
    await ride.save();
    await refreshDriverPaymentCollection(ride);
    logger.warn(`[QrWebhook] ride ${refId} paid on replaced QR ${qrId}; taken as its payment`);
    return 'adopted';
}

export async function handleQrCodeCredited(payload = {}) {
    const qr = payload?.qr_code?.entity || {};
    const qrId = String(qr.id || '');
    const kind = String(qr.notes?.kind || '');
    const refId = String(qr.notes?.refId || '');
    if (!qrId || !mongoose.Types.ObjectId.isValid(refId)) {
        logger.warn(`[QrWebhook] qr_code.credited without a known ride/order (${qrId || 'no id'}); left alone`);
        return 'ignored';
    }
    if (kind === 'taxi_ride') return creditRide(qrId, refId);
    if (ORDER_VERTICALS[kind]) return creditOrder(kind, qrId, refId);
    logger.warn(`[QrWebhook] qr_code.credited for unknown kind '${kind}' (${qrId}); left alone`);
    return 'ignored';
}
