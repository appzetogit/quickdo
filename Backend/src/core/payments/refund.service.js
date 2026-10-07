import mongoose from 'mongoose';
import { Refund } from './models/refund.model.js';
import { Payment } from './models/payment.model.js';
import { creditWallet } from './wallet.service.js';
import { getRazorpayInstance, isRazorpayConfigured } from '../../modules/food/orders/helpers/razorpay.helper.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Refunds, for every vertical.
 *
 * - Wallet refunds credit the platform wallet at once (initiateRefund).
 * - Gateway refunds send the money back to the card/UPI through Razorpay
 *   (refundGatewayPayment). Every food, quick-commerce and service-provider path
 *   that refunds an online payment goes through it, so each refund:
 *     * has ONE row here, named by an idempotency key -- a retry, a replayed job or
 *       a double-clicked admin button finds that row instead of refunding twice;
 *     * records Razorpay's refund id and status, which the `refund.processed` /
 *       `refund.failed` webhooks keep up to date (applyGatewayRefundEvent);
 *     * shows on the admin refunds page with its gateway status.
 */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const toId = (v) => (isId(v) ? new mongoose.Types.ObjectId(String(v)) : null);
const MOCK_GATEWAY_ALLOWED = config.nodeEnv !== 'production';
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/**
 * The call to Razorpay. Returns Razorpay's refund entity ({ id, status, ... }).
 * Replaceable in tests so no test ever reaches the real API (the .env in this repo
 * holds LIVE keys).
 */
const defaultGatewayRefund = async ({ gatewayPaymentId, amountPaise, notes, receipt }) => {
    if (MOCK_GATEWAY_ALLOWED && String(gatewayPaymentId).startsWith('mock_')) {
        return { id: `mock_rfnd_${Date.now()}`, status: 'processed', payment_id: gatewayPaymentId, amount: amountPaise };
    }
    if (!isRazorpayConfigured()) throw new Error('Razorpay is not configured on this server');
    const instance = getRazorpayInstance();
    try {
        return await instance.payments.refund(gatewayPaymentId, {
            amount: amountPaise,
            speed: 'normal',
            notes,
            ...(receipt ? { receipt } : {})
        });
    } catch (err) {
        const message = err?.error?.description || err?.error?.message || err?.message || 'Razorpay refund API error';
        throw new Error(message);
    }
};

let gatewayRefund = defaultGatewayRefund;

/** Can a gateway refund be attempted for this payment? If not, callers fall back to the wallet. */
const gatewayAvailable = (gatewayPaymentId) =>
    gatewayRefund !== defaultGatewayRefund
    || isRazorpayConfigured()
    || (MOCK_GATEWAY_ALLOWED && String(gatewayPaymentId || '').startsWith('mock_'));

/** Tests only: replace the Razorpay call. Pass nothing to restore the real one. */
export const __setRefundGatewayForTests = (fn) => {
    gatewayRefund = typeof fn === 'function' ? fn : defaultGatewayRefund;
};

/** Razorpay refund status -> the platform's refund status. */
const platformStatusFor = (gatewayStatus) => {
    const s = String(gatewayStatus || '').toLowerCase();
    if (s === 'processed') return 'processed';
    if (s === 'failed') return 'failed';
    // 'pending' / 'created': Razorpay accepted it; money is on its way.
    return 'processed';
};

/**
 * Refund an online (Razorpay) payment, once.
 *
 * @param {object} p
 * @param {string} p.vertical          'food' | 'quickCommerce' | 'serviceProvider' | 'taxi'
 * @param {string} p.gatewayPaymentId  Razorpay payment id (pay_...)
 * @param {number} p.amount            rupees
 * @param {string} p.idempotencyKey    names this refund: same key, same refund
 * @param {string} [p.orderId]         the vertical's order/booking _id
 * @param {string} [p.orderRef]        human order code
 * @param {string} [p.userId]
 * @param {string} [p.reason]
 * @param {string} [p.source]          what asked for it ('order_cancelled', 'admin_refund', ...)
 * @param {string} [p.paymentId]       core Payment _id when there is one
 * @param {string} [p.initiatedBy]     admin id, for admin refunds
 * @returns {Promise<{success: boolean, refundId: string, status: string, gatewayStatus: string,
 *   duplicate: boolean, inProgress?: boolean, error?: string, refund: object}>}
 *   Same shape as the old initiateRazorpayRefund helper (success / refundId / status /
 *   error) so call sites change one line.
 */
export async function refundGatewayPayment({
    vertical = 'food',
    gatewayPaymentId,
    amount,
    idempotencyKey,
    orderId = null,
    orderRef = '',
    userId = null,
    reason = '',
    source = '',
    paymentId = null,
    initiatedBy = null,
    notes = {},
} = {}) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error('refundGatewayPayment: idempotencyKey is required');
    if (!gatewayPaymentId) throw new Error('refundGatewayPayment: gatewayPaymentId is required');
    const rupees = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(rupees) || rupees <= 0) throw new Error('refundGatewayPayment: amount must be positive');

    const now = new Date();
    /*
     * Claim the refund. The unique index on idempotencyKey makes concurrent callers
     * race to one row; whoever inserts it (or re-claims a FAILED one) is the only
     * caller that talks to Razorpay.
     */
    let claim;
    try {
        claim = await Refund.findOneAndUpdate(
            { idempotencyKey: key },
            {
                $setOnInsert: {
                    vertical,
                    source,
                    orderId: toId(orderId),
                    orderRef: String(orderRef || ''),
                    userId: toId(userId),
                    paymentId: toId(paymentId),
                    amount: rupees,
                    reason,
                    refundTo: 'gateway',
                    gatewayPaymentId: String(gatewayPaymentId),
                    status: 'pending',
                    gatewayStatus: 'initiating',
                    attempts: 1,
                    processedBy: toId(initiatedBy),
                },
            },
            { upsert: true, new: true, includeResultMetadata: true },
        );
    } catch (err) {
        if (err?.code !== 11000) throw err;
        claim = { value: await Refund.findOne({ idempotencyKey: key }), lastErrorObject: { updatedExisting: true } };
    }

    let refund = claim.value;
    const inserted = claim.lastErrorObject?.updatedExisting === false;

    if (!inserted) {
        if (refund.status !== 'failed') {
            // Already refunded, or another caller is mid-flight: never call Razorpay twice.
            const inProgress = refund.gatewayStatus === 'initiating';
            return {
                success: !inProgress,
                inProgress,
                duplicate: true,
                refundId: refund.gatewayRefundId || '',
                status: refund.status,
                gatewayStatus: refund.gatewayStatus,
                refund: plain(refund),
            };
        }
        // A failed refund may be retried -- but only by one caller at a time.
        refund = await Refund.findOneAndUpdate(
            { _id: refund._id, status: 'failed' },
            { $set: { status: 'pending', gatewayStatus: 'initiating', failureReason: '', amount: rupees }, $inc: { attempts: 1 } },
            { new: true },
        );
        if (!refund) {
            const current = await Refund.findOne({ idempotencyKey: key });
            return {
                success: current?.status === 'processed',
                inProgress: current?.gatewayStatus === 'initiating',
                duplicate: true,
                refundId: current?.gatewayRefundId || '',
                status: current?.status || 'pending',
                gatewayStatus: current?.gatewayStatus || '',
                refund: plain(current) || null,
            };
        }
    }

    try {
        const rz = await gatewayRefund({
            gatewayPaymentId: String(gatewayPaymentId),
            amountPaise: Math.round(rupees * 100),
            receipt: key.slice(0, 40),
            notes: {
                ...notes,
                vertical,
                ...(orderRef ? { order: String(orderRef) } : {}),
                ...(reason ? { reason: String(reason).slice(0, 200) } : {}),
                refund_key: key.slice(0, 200),
            },
        });
        const gatewayStatus = String(rz?.status || 'pending').toLowerCase();
        const status = platformStatusFor(gatewayStatus);
        refund = await Refund.findByIdAndUpdate(
            refund._id,
            {
                $set: {
                    gatewayRefundId: String(rz?.id || ''),
                    gatewayStatus,
                    status,
                    processedAt: new Date(),
                },
            },
            { new: true },
        );
        logger.info(`Gateway refund ${refund.gatewayRefundId} (${gatewayStatus}) for ${vertical} ${orderRef || orderId || ''} amount=${rupees} key=${key}`);
        return {
            success: status !== 'failed',
            duplicate: false,
            refundId: refund.gatewayRefundId,
            status: gatewayStatus,
            gatewayStatus,
            refund: plain(refund),
        };
    } catch (err) {
        const message = err?.message || 'Razorpay refund API error';
        refund = await Refund.findByIdAndUpdate(
            refund._id,
            { $set: { status: 'failed', gatewayStatus: 'failed', failureReason: message.slice(0, 500) } },
            { new: true },
        );
        logger.error(`Gateway refund FAILED for ${vertical} ${orderRef || orderId || ''} payment=${gatewayPaymentId} key=${key}: ${message}`);
        return {
            success: false,
            duplicate: false,
            refundId: '',
            status: 'failed',
            gatewayStatus: 'failed',
            error: message,
            refund: plain(refund) || null,
        };
    }
}

/**
 * Apply a Razorpay `refund.processed` / `refund.failed` / `refund.created` event to
 * the refund row it belongs to. Idempotent: applying the same event twice changes
 * nothing the second time. A 'processed' row is never moved back to failed.
 *
 * @returns {Promise<{updated: boolean, refund: object|null}>}
 */
export async function applyGatewayRefundEvent(event, refundEntity = {}) {
    const gatewayRefundId = String(refundEntity.id || '');
    if (!gatewayRefundId) return { updated: false, refund: null };
    const statusByEvent = {
        'refund.processed': 'processed',
        'refund.failed': 'failed',
        'refund.created': 'pending',
    };
    const gatewayStatus = statusByEvent[event];
    if (!gatewayStatus) return { updated: false, refund: null };

    let filter = { gatewayRefundId };
    let row = await Refund.findOne(filter).lean();
    if (!row && refundEntity.payment_id) {
        // The webhook can beat our own write of the refund id: match the in-flight
        // claim for that payment and amount instead.
        filter = {
            gatewayPaymentId: String(refundEntity.payment_id),
            gatewayRefundId: { $in: ['', null] },
            amount: Number(refundEntity.amount || 0) / 100,
        };
        row = await Refund.findOne(filter).lean();
    }
    if (!row) return { updated: false, refund: null };

    const $set = { gatewayRefundId, gatewayStatus };
    const guard = { _id: row._id };
    if (gatewayStatus === 'processed') {
        $set.status = 'processed';
        $set.processedAt = row.processedAt || new Date();
        guard.gatewayStatus = { $ne: 'processed' };
    } else if (gatewayStatus === 'failed') {
        $set.status = 'failed';
        $set.failureReason = String(
            refundEntity.error_description || refundEntity.notes?.failure_reason || 'Razorpay reported the refund as failed',
        ).slice(0, 500);
        // Never downgrade a refund Razorpay already confirmed.
        guard.gatewayStatus = { $nin: ['processed', 'failed'] };
    } else {
        guard.gatewayStatus = { $in: ['', 'initiating'] };
    }
    const updated = await Refund.findOneAndUpdate(guard, { $set }, { new: true }).lean();
    return { updated: Boolean(updated), refund: updated || row };
}

/**
 * Initiate a refund for a payment.
 * - For wallet payments → credits user wallet immediately.
 * - For gateway payments → creates a pending refund record (processGatewayRefund() does actual refund).
 *
 * `idempotencyKey` (optional) names the refund: a second call with the same key
 * returns the first row and credits nothing.
 */
export async function initiateRefund({ paymentId, orderId, userId, amount, reason = '', refundTo, idempotencyKey }) {
    const key = idempotencyKey ? String(idempotencyKey).trim() : '';
    if (key) {
        const prior = await Refund.findOne({ idempotencyKey: key }).lean();
        if (prior && prior.status !== 'failed') return prior;
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) throw new Error('Payment not found');
    if (payment.status !== 'success') throw new Error('Can only refund successful payments');

    // Determine refund path
    const to = refundTo || (payment.method === 'wallet' ? 'wallet' : 'wallet');
    // Default to wallet refund for all methods — safer, faster. Admin can override to gateway.

    let refund;
    if (key) {
        // Reuse a failed row for this key rather than colliding with it.
        refund = await Refund.findOneAndUpdate(
            { idempotencyKey: key },
            {
                $set: { status: 'pending', refundTo: to, failureReason: '' },
                $setOnInsert: {
                    idempotencyKey: key,
                    paymentId: new mongoose.Types.ObjectId(paymentId),
                    orderId: orderId ? new mongoose.Types.ObjectId(orderId) : payment.orderId,
                    userId: userId ? new mongoose.Types.ObjectId(userId) : payment.userId,
                    amount: Number(amount) || payment.amount,
                    currency: payment.currency || 'INR',
                    reason,
                    vertical: 'food',
                    gatewayPaymentId: payment.gatewayPaymentId || '',
                },
                $inc: { attempts: 1 },
            },
            { upsert: true, new: true },
        );
    } else {
        refund = await Refund.create({
            paymentId: new mongoose.Types.ObjectId(paymentId),
            orderId: orderId ? new mongoose.Types.ObjectId(orderId) : payment.orderId,
            userId: userId ? new mongoose.Types.ObjectId(userId) : payment.userId,
            amount: Number(amount) || payment.amount,
            currency: payment.currency || 'INR',
            reason,
            status: 'pending',
            refundTo: to,
            vertical: 'food',
            gatewayPaymentId: payment.gatewayPaymentId || '',
        });
    }

    // If refunding to wallet, credit immediately
    if (to === 'wallet') {
        try {
            const { duplicate } = await creditWallet({
                entityType: 'user',
                entityId: String(userId || payment.userId),
                amount: refund.amount,
                description: `Refund for order`,
                category: 'order_refund',
                orderId: String(refund.orderId),
                paymentId: String(paymentId),
                metadata: { refundId: refund._id, reason },
                // The wallet credit is named after the refund row, so a retry of a
                // half-finished refund cannot credit the customer twice.
                idempotencyKey: `refund_wallet:${refund._id}`
            });

            refund.status = 'processed';
            refund.processedAt = new Date();
            await refund.save();

            // Also credit back to the existing FoodUserWallet for backward compat
            // (once: a retry whose ledger credit was a duplicate already did this).
            if (!duplicate) await addRefundToLegacyWallet(userId || payment.userId, refund.amount, orderId);

            // Mark payment as refunded
            payment.status = 'refunded';
            await payment.save();

            logger.info(`Refund processed (wallet): ${refund._id} amount=${refund.amount}`);
        } catch (err) {
            refund.status = 'failed';
            refund.failureReason = String(err.message || '').slice(0, 500);
            refund.metadata = { error: err.message };
            await refund.save();
            throw err;
        }
    }

    return refund.toObject();
}

/**
 * Process a gateway refund (Razorpay) for a pending refund record.
 * Goes through refundGatewayPayment, keyed on the refund row, so calling it twice
 * for one row refunds once.
 */
export async function processGatewayRefund(refundId) {
    const refund = await Refund.findById(refundId);
    if (!refund) throw new Error('Refund not found');
    if (refund.status === 'processed') return refund.toObject();

    const payment = refund.paymentId ? await Payment.findById(refund.paymentId) : null;
    const gatewayPaymentId = refund.gatewayPaymentId || payment?.gatewayPaymentId || '';
    const viaGateway = gatewayPaymentId && (!payment || payment.gateway === 'razorpay');

    if (viaGateway && gatewayAvailable(gatewayPaymentId)) {
        const key = refund.idempotencyKey || `refund_row:${refund._id}`;
        if (!refund.idempotencyKey) {
            refund.idempotencyKey = key;
            refund.refundTo = 'gateway';
            refund.gatewayPaymentId = gatewayPaymentId;
            refund.status = 'failed'; // lets refundGatewayPayment claim this row
            await refund.save();
        } else if (refund.status === 'pending' && !refund.gatewayRefundId && refund.gatewayStatus !== 'initiating') {
            refund.status = 'failed';
            await refund.save();
        }
        const result = await refundGatewayPayment({
            vertical: refund.vertical || 'food',
            gatewayPaymentId,
            amount: refund.amount,
            idempotencyKey: key,
            orderId: refund.orderId,
            orderRef: refund.orderRef,
            userId: refund.userId,
            reason: refund.reason,
            source: refund.source || 'gateway_refund',
            paymentId: refund.paymentId,
        });
        if (!result.success) throw new Error(result.error || 'Gateway refund failed');
        if (payment) {
            payment.status = 'refunded';
            await payment.save();
        }
        return result.refund;
    }

    if (!payment) throw new Error('Payment not found');
    // Fallback to wallet refund
    return initiateRefund({
        paymentId: String(payment._id),
        orderId: String(refund.orderId),
        userId: String(refund.userId),
        amount: refund.amount,
        reason: refund.reason,
        refundTo: 'wallet'
    });
}

/**
 * Get refunds for an order.
 */
export async function getRefundsByOrder(orderId) {
    return Refund.find({ orderId: new mongoose.Types.ObjectId(orderId) })
        .sort({ createdAt: -1 })
        .lean();
}

/**
 * List refunds with filters.
 */
export async function listRefunds({ status, vertical, gatewayStatus, refundTo, q, page = 1, limit = 20 } = {}) {
    const filter = {};
    if (status) filter.status = String(status);
    if (vertical) filter.vertical = String(vertical);
    if (gatewayStatus) filter.gatewayStatus = String(gatewayStatus);
    if (refundTo) filter.refundTo = String(refundTo);
    if (q) {
        const term = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60);
        if (term) {
            filter.$or = [
                { orderRef: new RegExp(term, 'i') },
                { gatewayPaymentId: new RegExp(`^${term}`) },
                { gatewayRefundId: new RegExp(`^${term}`) },
            ];
        }
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * size;
    const [docs, total] = await Promise.all([
        Refund.find(filter).sort({ createdAt: -1 }).skip(skip).limit(size).lean(),
        Refund.countDocuments(filter)
    ]);

    return { refunds: docs, total, page: pageNum, limit: size, totalPages: Math.ceil(total / size) };
}

/**
 * Backward compatibility: add a refund transaction to the legacy FoodUserWallet embedded array.
 */
async function addRefundToLegacyWallet(userId, amount, orderId) {
    try {
        const { FoodUserWallet } = await import('../../modules/food/user/models/userWallet.model.js');
        const wallet = await FoodUserWallet.findOne({ userId: new mongoose.Types.ObjectId(userId) });
        if (wallet) {
            wallet.transactions.unshift({
                type: 'refund',
                amount,
                status: 'Completed',
                description: 'Order refund',
                metadata: { source: 'order_refund', orderId: String(orderId) }
            });
            wallet.balance = (Number(wallet.balance) || 0) + amount;
            await wallet.save();
        }
    } catch (err) {
        logger.warn(`addRefundToLegacyWallet failed: ${err.message}`);
    }
}
