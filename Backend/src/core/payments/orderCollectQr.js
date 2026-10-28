/**
 * Cash-on-delivery orders collected by dynamic UPI QR, for food and
 * quick-commerce alike (each passes its own models). The rider's app shows the
 * QR; Razorpay says when it is paid; nothing the app reports is trusted.
 *
 * The order's QR lives in `payment.qr` on its transaction (the source of truth)
 * and its order: { kind: 'upi_qr', qrId, upiString, imageUrl, amountPaise,
 * status, expiresAt, paymentId, previousQrIds }. kind 'payment_link' is the
 * older flow, still used when the account has no QR Codes feature.
 */
import { logger } from '../../utils/logger.js';
import {
    createUpiQr,
    fetchUpiQr,
    fetchUpiQrPayments,
    closeUpiQr,
    isQrPaid,
    isQrLive,
    toQrPaise,
} from './razorpayQr.js';

const rupees = (paise) => Math.round(Number(paise || 0)) / 100;

const conflict = (message) => {
    const e = new Error(message);
    e.statusCode = 409;
    return e;
};

/**
 * The QR to show for `amountDue`: the order's current one while it is live and
 * for the same amount, else a fresh one (the old one is closed first, so two
 * can never be payable at once).
 *
 * Returns { qrDoc, reused } -- or { paid: true, qrDoc } when the current QR was
 * already paid. Throws RazorpayQrError (unavailable) when the account cannot
 * make QR codes, for the caller to fall back to a payment link.
 */
export async function openOrderUpiQr({ kind, order, payment = {}, amountDue, name }) {
    const amountPaise = toQrPaise(amountDue);
    const current = payment?.qr || {};

    if (current.kind === 'upi_qr' && current.qrId) {
        const previous = await fetchUpiQr(current.qrId).catch(() => null);
        const previousAmount = Number(current.amountPaise || previous?.amountPaise || 0);
        if (previous && isQrPaid(previous, previousAmount)) {
            if (previousAmount >= amountPaise) {
                return { paid: true, qrDoc: { ...current, status: 'paid' } };
            }
            // The amount went up after the customer paid the old QR: they owe
            // the difference, not the whole amount again.
            throw conflict(
                `The customer already paid Rs ${rupees(previousAmount)} by UPI. Collect the remaining Rs ${rupees(amountPaise - previousAmount)} in cash.`,
            );
        }
        if (previous && previousAmount === amountPaise && isQrLive(previous)) {
            return { reused: true, qrDoc: current };
        }
        await closeUpiQr(current.qrId).catch((err) =>
            logger.warn(`[CollectQr] could not close old QR ${current.qrId}: ${err.message}`));
    }

    const qr = await createUpiQr({
        amountPaise,
        name,
        description: `Order ${order?.orderId || order?._id}`,
        notes: { kind, refId: String(order._id), orderId: order?.orderId || '' },
    });
    return {
        reused: false,
        qrDoc: {
            kind: 'upi_qr',
            qrId: qr.id,
            upiString: qr.upiString,
            imageUrl: qr.imageUrl,
            amountPaise,
            status: 'active',
            expiresAt: qr.closeBy,
            paymentId: '',
            paymentLinkId: '',
            shortUrl: '',
            previousQrIds: [...(current.previousQrIds || []), current.qrId].filter(Boolean).slice(-10),
        },
    };
}

/**
 * Razorpay's word on the order's current QR: { paid, status, paymentId }.
 * status is 'paid', 'expired' (closed unpaid -- show a new one) or 'active'.
 */
export async function readOrderUpiQr(qrDoc = {}) {
    const qr = await fetchUpiQr(qrDoc.qrId);
    if (isQrPaid(qr, qrDoc.amountPaise)) {
        const payments = await fetchUpiQrPayments(qrDoc.qrId).catch(() => []);
        const captured = payments.find((p) => p.status === 'captured') || payments[0];
        return { paid: true, status: 'paid', paymentId: captured?.id || '' };
    }
    return { paid: false, status: isQrLive(qr) ? 'active' : 'expired', paymentId: '' };
}

/**
 * Before an order switches to cash: close its QR so it can no longer be paid,
 * and refuse if it already was -- the customer must not pay twice.
 */
export async function closeOrderUpiQrForCash(qrDoc = {}) {
    if (qrDoc.kind !== 'upi_qr' || !qrDoc.qrId) return;
    await closeUpiQr(qrDoc.qrId).catch((err) =>
        logger.warn(`[CollectQr] could not close QR ${qrDoc.qrId} before cash: ${err.message}`));
    const state = await readOrderUpiQr(qrDoc).catch(() => null);
    if (state?.paid) {
        throw conflict('The customer has already paid by UPI. Do not collect cash.');
    }
}

/**
 * A payment landed on a QR the order no longer shows (replaced after the
 * amount changed, or closed for cash a moment too late). If the order is still
 * unpaid and it covers what is due, it is the order's payment; otherwise the
 * money is returned to the customer.
 *
 * Returns 'adopt' (caller marks the order paid from this QR), 'refunded' or
 * 'ignored'.
 */
export async function settleStaleQrCredit({ qrId, orderPaid, dueAmountPaise, refund }) {
    const payments = (await fetchUpiQrPayments(qrId)).filter((p) => p.status === 'captured');
    if (!payments.length) return 'ignored';
    const total = payments.reduce((sum, p) => sum + p.amountPaise, 0);
    if (!orderPaid && total >= Number(dueAmountPaise || 0) && payments.length === 1) return 'adopt';
    for (const p of payments) {
        try {
            await refund(p.id, rupees(p.amountPaise));
            logger.warn(`[CollectQr] refunded ${p.id} (Rs ${rupees(p.amountPaise)}) paid to replaced QR ${qrId}`);
        } catch (err) {
            logger.error(`[CollectQr] REFUND FAILED for ${p.id} on replaced QR ${qrId}: ${err.message}. Refund it from the Razorpay dashboard.`);
        }
    }
    return 'refunded';
}
