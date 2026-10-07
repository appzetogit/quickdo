import crypto from 'crypto';
import { razorpayWebhookSecret } from '../../settings/platformProfile.service.js';
import mongoose from 'mongoose';
import { notifyRestaurantNewOrder } from '../../../modules/food/orders/services/order.helpers.js';
import { countCouponUseOnPayment } from '../../../modules/food/orders/services/couponUsage.service.js';
import { capturedAmountMatches } from '../capturedAmount.js';
import { safeSignatureEqual } from '../../../utils/safeCompare.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { WebhookEvent } from '../models/webhookEvent.model.js';
import { refundGatewayPayment, applyGatewayRefundEvent } from '../refund.service.js';
import { recordFailedFinancialOperation } from '../../finance/deadLetter.js';


/**
 * ✅ NEW: Centralized Razorpay Webhook Handler (Core Layer)
 * Manages atomic updates for order payments and refunds across all modules.
 */
/**
 * Which vertical's order collection this provider event belongs to.
 *
 * There is ONE Razorpay account and one webhook secret, but the platform kept TWO
 * handlers -- master's, reading food_orders, and the quick-commerce fork's, reading
 * qc_orders. Razorpay accepts one URL per event, so whichever handler was not
 * configured simply never ran, and that vertical's orders reconciled only when the
 * customer's app happened to call /verify. Close the app after paying and the money
 * was stranded.
 *
 * So the handler resolves the collection instead of assuming it. Food is tried first
 * because it is the larger table and the common case; a miss costs one indexed
 * lookup. Returning the MODEL rather than a name keeps every query below identical
 * for both verticals -- the alternative is a branch per query, which is how the two
 * handlers drifted apart in the first place.
 */
const ORDER_SOURCES = [
    {
        vertical: 'food',
        load: async () => (await import('../../../modules/food/orders/models/order.model.js')).FoodOrder,
        ledger: async () => import('../../../modules/food/orders/services/foodTransaction.service.js'),
    },
    {
        vertical: 'quickCommerce',
        load: async () => (await import('../../../modules/quickCommerce/modules/food/orders/models/order.model.js')).FoodOrder,
        /*
         * Quick commerce keeps its own transaction service over its own
         * qc_transactions collection. Using food's here would look up a QC order id
         * in food_transactions, find nothing, and report success -- the ledger row
         * for a captured payment would silently never be written.
         */
        ledger: async () => import('../../../modules/quickCommerce/modules/food/orders/services/foodTransaction.service.js'),
    },
];

const resolveOrderSource = async (filter) => {
    for (const source of ORDER_SOURCES) {
        try {
            const Model = await source.load();
            const hit = await Model.findOne(filter).select('_id').lean();
            if (hit) return { Model, vertical: source.vertical, ledger: source.ledger };
        } catch (err) {
            // One vertical being unloadable must not stop the other reconciling.
            logger.error(`Webhook: could not search ${source.vertical} orders: ${err.message}`);
        }
    }
    return null;
};

/**
 * The key one delivery is deduplicated on. Razorpay sends the same
 * `x-razorpay-event-id` with every redelivery of an event; without it (an older
 * dashboard setting, a hand-replayed request) the signed body itself is the
 * identity -- a retry resends byte-identical JSON.
 */
const eventKeyFor = (req) => {
    const header = String(req.headers?.['x-razorpay-event-id'] || '').trim();
    if (header) return `razorpay:${header}`;
    return `razorpay:body:${crypto.createHash('sha256').update(req.rawBody).digest('hex')}`;
};

/** How long one handler may own an event before another delivery may take it over. */
const EVENT_LOCK_MS = 2 * 60 * 1000;

/**
 * Claim one delivery (P0-5). Returns 'claimed' when this request must process it,
 * or 'duplicate' when it was already processed or another request is processing it.
 *
 * The state checks below were the only protection before, and they are not enough
 * on their own: each branch of the handler guards ITS write, but a redelivered
 * refund event, or two deliveries racing through the captured branch, still ran
 * every side effect twice (ledger sync, coupon count, restaurant push).
 */
const claimEvent = async (key, event) => {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + EVENT_LOCK_MS);
    try {
        await WebhookEvent.create({ _id: key, event, status: 'processing', lockedUntil });
        return 'claimed';
    } catch (err) {
        if (err?.code !== 11000) throw err;
    }
    // Seen before. Take it over only if the earlier attempt failed or went silent.
    const taken = await WebhookEvent.findOneAndUpdate(
        {
            _id: key,
            $or: [
                { status: 'failed' },
                { status: 'processing', lockedUntil: { $lt: now } },
            ],
        },
        { $set: { status: 'processing', lockedUntil }, $inc: { attempts: 1 } },
        { new: true },
    );
    return taken ? 'claimed' : 'duplicate';
};

const finishEvent = (key, status, error) =>
    WebhookEvent.updateOne(
        { _id: key },
        {
            $set: {
                status,
                lockedUntil: null,
                ...(status === 'processed' ? { processedAt: new Date() } : {}),
                ...(error ? { lastError: String(error.message || error).slice(0, 500) } : {}),
            },
        },
    ).catch((err) => logger.error(`Webhook: could not mark event ${key} ${status}: ${err.message}`));

export const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = razorpayWebhookSecret();

    // 1. Verify Signature using raw body buffer
    if (!signature || !secret || !req.rawBody) {
        logger.warn('Razorpay Webhook: Missing signature or rawBody buffer.');
        return res.status(400).send('Invalid signature');
    }

    const expected = crypto
        .createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

    // Constant-time, via the shared util. A plain compare short-circuits on the first
    // differing byte, so response timing reveals how many leading characters matched --
    // and this signature is the ONLY thing standing between a stranger and "this order
    // is paid". The quick-commerce fork already used this util; the inline copy that
    // stood here is gone with it.
    if (!safeSignatureEqual(expected, String(signature))) {
        logger.warn('Razorpay Webhook: Signature verification failed.');
        return res.status(400).send('Invalid signature');
    }

    const { event, payload } = req.body || {};
    logger.info(`Razorpay Webhook Received: ${event}`);

    // 2. One delivery of one event is processed once (P0-5). Both public mounts
    // (/v1/payments/webhook and /v1/qc/payments/webhook) run this same handler, so
    // the claim covers whichever URL Razorpay is configured with -- and both.
    const eventKey = eventKeyFor(req);
    let claim;
    try {
        claim = await claimEvent(eventKey, event);
    } catch (err) {
        logger.error(`Razorpay Webhook: could not record event ${eventKey}: ${err.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
    if (claim === 'duplicate') {
        logger.info(`Razorpay Webhook: duplicate delivery ${eventKey} (${event}) ignored`);
        return res.status(200).json({ status: 'ok', duplicate: true });
    }

    try {
        await processRazorpayEvent(event, payload || {});
        await finishEvent(eventKey, 'processed');
        return res.status(200).json({ status: 'ok' });
    } catch (err) {
        // Released as failed so Razorpay's retry (triggered by this 500) runs it again.
        await finishEvent(eventKey, 'failed', err);
        logger.error(`Razorpay Webhook Logic Error: ${err.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

/**
 * Everything an accepted, first-time event does. Returns normally when the event
 * is handled or deliberately ignored; throws only when a retry could help.
 */
const processRazorpayEvent = async (event, payload) => {
    // A plain block: the body keeps the indentation it had inside the handler's try,
    // so the history of each branch stays readable.
    {
        // --- 🟢 Handle Payment Captured (Success) ---
        if (event === 'payment.captured') {
            const paymentObj = payload.payment.entity;
            const rzOrderId = paymentObj.order_id;
            const rzPaymentId = paymentObj.id;

            /*
             * Cross-check the captured amount against the order total before marking paid.
             *
             * The signature proves the event came from Razorpay; it says nothing about
             * WHICH amount was captured. Without this, a capture of any size marked the
             * order paid -- a Rs 1 payment against a Rs 900 order cleared it, and the
             * restaurant was dispatched an order nobody had paid for.
             *
             * The quick-commerce fork has carried this check since it was written; the
             * food handler never got it, which is the fork's cost in one bug. Ported
             * verbatim so the two behave identically until they become one handler.
             *
             * Mismatch is NOT an error to Razorpay -- returning non-200 makes the provider
             * retry an event that will never succeed. The order is marked failed and the
             * event acknowledged, leaving a loud log line for reconciliation.
             */
            const source = await resolveOrderSource({ "payment.razorpay.orderId": rzOrderId });
            if (!source) {
                logger.warn(`Webhook [payment.captured]: no order in any vertical for RZ-Order: ${rzOrderId}`);
                return;
            }
            const { Model: OrderModel, vertical, ledger } = source;

            const existingOrder = await OrderModel.findOne({ "payment.razorpay.orderId": rzOrderId })
                .select('pricing payment orderStatus orderId')
                .lean();

            /*
             * A capture must never bring a dead order back. Razorpay re-sends
             * webhooks, and a late payment can land on an order that was
             * cancelled (or cancelled and refunded) while the customer sat on
             * the payment sheet. This used to set it paid and back to 'created',
             * so a refunded customer got the food anyway.
             *   - the capture this order already recorded: a repeat, ignore it;
             *   - a new capture on a cancelled/refunded order: refund it.
             */
            if (existingOrder) {
                const status = String(existingOrder.orderStatus || '');
                const payStatus = String(existingOrder.payment?.status || '').toLowerCase();
                const recorded = String(existingOrder.payment?.razorpay?.paymentId || '');
                const dead = status.startsWith('cancelled') || payStatus === 'refunded';
                if (recorded === rzPaymentId && (payStatus === 'paid' || payStatus === 'refunded')) {
                    return;
                }
                if (dead) {
                    try {
                        const amount = Number(paymentObj.amount || 0) / 100;
                        // Keyed on the payment: a redelivered late capture refunds once.
                        const refund = await refundGatewayPayment({
                            vertical,
                            gatewayPaymentId: rzPaymentId,
                            amount,
                            idempotencyKey: 'late_capture:' + rzPaymentId,
                            orderId: existingOrder._id,
                            orderRef: existingOrder.orderId,
                            reason: 'Payment captured after the order was cancelled',
                            source: 'late_capture',
                        });
                        if (!refund.success && !refund.inProgress) throw new Error(refund.error || 'gateway refund failed');
                        logger.warn(`Webhook [payment.captured]: late capture ${rzPaymentId} on ${status} order ${existingOrder._id} -- refunded (${refund?.refundId || 'no id'})`);
                        if (payStatus !== 'refunded') {
                            await OrderModel.updateOne(
                                { _id: existingOrder._id, "payment.status": { $ne: 'paid' } },
                                { $set: {
                                    "payment.status": 'refunded',
                                    "payment.razorpay.paymentId": rzPaymentId,
                                    "payment.refund": { status: refund?.success ? 'processed' : 'failed', amount, refundId: refund?.refundId || '', processedAt: new Date() },
                                } },
                            );
                        }
                    } catch (refundErr) {
                        logger.error(`Webhook [payment.captured]: LATE CAPTURE NOT REFUNDED ${rzPaymentId} on order ${existingOrder._id}: ${refundErr.message}. Refund manually.`);
                    }
                    return;
                }
            }
            if (existingOrder) {
                const verdict = capturedAmountMatches(paymentObj.amount, existingOrder.pricing?.total);
                if (!verdict.matches) {
                    logger.error(
                        `Webhook [payment.captured]: AMOUNT MISMATCH (${verdict.reason}) for RZ-Order ${rzOrderId} — paid ${verdict.capturedPaise} paise, expected ${verdict.expectedPaise} paise. Order NOT marked paid.`,
                    );
                    // Guarded: never downgrade an order that some other path already paid.
                    if (String(existingOrder.payment?.status || '').toLowerCase() !== 'paid') {
                        await OrderModel.updateOne(
                            { _id: existingOrder._id, "payment.status": { $ne: 'paid' } },
                            { $set: { "payment.status": 'failed', "payment.razorpay.paymentId": rzPaymentId } },
                        );
                    }
                    return;
                }
            }

            // Atomic update to mark as paid if not already. Winning this update means the
            // client-driven /verify hasn't run yet, so we must ALSO advance the order out of
            // pending_payment and notify the restaurant — otherwise a captured order is stranded.
            const order = await OrderModel.findOneAndUpdate(
                {
                    "payment.razorpay.orderId": rzOrderId,
                    "payment.status": { $nin: ['paid', 'refunded'] },
                    // Only an order still waiting for its money is advanced.
                    orderStatus: 'pending_payment',
                },
                {
                    $set: {
                        "payment.status": 'paid',
                        "payment.razorpay.paymentId": rzPaymentId,
                        "orderStatus": 'created'
                    },
                    $push: {
                        statusHistory: {
                            at: new Date(),
                            byRole: 'SYSTEM',
                            from: 'pending_payment',
                            to: 'created',
                            note: 'Payment captured via webhook'
                        }
                    }
                },
                { new: true }
            );

            if (order) {
                // ✅ UPDATED: Wrapped in try-catch to prevent secondary failures from breaking the webhook response
                try {
                    const transactionService = await ledger();
                    await transactionService.updateTransactionStatus(order._id, 'captured', {
                        status: 'captured',
                        razorpayPaymentId: rzPaymentId,
                        note: 'Payment status synced via Webhook (payment.captured)'
                    });
                } catch (ledgerErr) {
                    logger.error(`Webhook Ledger Error (Order ${order.orderId}): ${ledgerErr.message}`);
                }
                /*
                 * These two are food's own follow-ups and stay scoped to it.
                 *
                 * The quick-commerce handler never ran them, so applying them to QC
                 * orders here would not be "unifying" -- it would be adding coupon
                 * accounting and restaurant pushes to a vertical that has never had
                 * them, inside a change whose purpose is that no vertical's
                 * behaviour moves. QC's equivalents belong in a deliberate change of
                 * their own.
                 */
                if (vertical === 'food') {
                    // The order is paid, so its coupon now counts as used. Idempotent
                    // against /verify, which may arrive before or after this.
                    await countCouponUseOnPayment(order);
                    try {
                        await notifyRestaurantNewOrder(order);
                    } catch (notifyErr) {
                        logger.error(`Webhook Restaurant Notify Error (Order ${order.orderId}): ${notifyErr.message}`);
                    }
                }
                logger.info(`Webhook [payment.captured]: Synced ${vertical} order ${order.orderId} (Status=paid)`);
            } else {
                // ✅ ADDED: Log warn if order not found but payment was captured
                logger.warn(`Webhook [payment.captured]: Order not found or already paid for RZ-Order: ${rzOrderId}`);
            }
        }

        // --- Refund events: processed (money returned) / failed (nothing moved) ---
        if (event === 'refund.processed' || event === 'refund.failed' || event === 'refund.created') {
            const refundObj = payload.refund?.entity || {};
            const rzPaymentId = refundObj.payment_id;
            const rzRefundId = refundObj.id;
            const refundAmount = Number(refundObj.amount || 0) / 100; // to major unit

            // 1. The platform's own refund row (every vertical, admin refunds page).
            const { refund: refundRow } = await applyGatewayRefundEvent(event, refundObj);

            if (event === 'refund.created') return;

            if (event === 'refund.failed') {
                logger.error(
                    `Webhook [refund.failed]: Razorpay could not refund ${rzRefundId} (payment ${rzPaymentId}, ${refundAmount}). `
                    + `Reason: ${refundObj.error_description || 'not given'}. Needs a retry or a manual refund.`,
                );
                await recordFailedFinancialOperation({
                    operation: 'gateway_refund_failed',
                    vertical: refundRow?.vertical || '',
                    entityType: 'user',
                    entityId: refundRow?.userId ? String(refundRow.userId) : '',
                    amount: refundAmount,
                    orderId: refundRow?.orderRef || (refundRow?.orderId ? String(refundRow.orderId) : ''),
                    paymentId: rzPaymentId,
                    payload: { gatewayRefundId: rzRefundId, refundRowId: refundRow?._id ? String(refundRow._id) : '' },
                    error: new Error(refundObj.error_description || 'refund.failed'),
                });
            }

            // 2. The order the refund belongs to (food / quick commerce). Service
            // bookings keep their refund state on the booking and the refund row.
            if (refundRow?.vertical === 'serviceProvider' || refundRow?.vertical === 'taxi') return;
            const refundSource = await resolveOrderSource({ "payment.razorpay.paymentId": rzPaymentId });
            if (!refundSource) {
                logger.warn(`Webhook [${event}]: no order in any vertical for RZ-Payment: ${rzPaymentId}`);
                return;
            }

            if (event === 'refund.failed') {
                await refundSource.Model.updateOne(
                    { "payment.razorpay.paymentId": rzPaymentId, "payment.refund.status": { $ne: 'processed' } },
                    { $set: { "payment.refund.status": 'failed', "payment.refund.refundId": rzRefundId } },
                );
                return;
            }

            const order = await refundSource.Model.findOneAndUpdate(
                {
                    "payment.razorpay.paymentId": rzPaymentId,
                    "payment.refund.status": { $ne: 'processed' }
                },
                {
                    $set: {
                        "payment.status": 'refunded',
                        "payment.refund": {
                            status: 'processed',
                            amount: refundAmount,
                            refundId: rzRefundId,
                            processedAt: new Date()
                        }
                    }
                },
                { new: true }
            );

            if (order) {
                logger.info(`Webhook [refund.processed]: Synced Order ${order.orderId} (Refunded)`);
            } else {
                logger.warn(`Webhook [refund.processed]: Order not found or already refunded for RZ-Payment: ${rzPaymentId}`);
            }
        }
    }
};
