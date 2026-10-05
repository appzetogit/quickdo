import { Payment, PAYMENT_VERTICALS } from './models/payment.model.js';
import { logger } from '../../utils/logger.js';

/**
 * The one way any vertical records a gateway payment.
 *
 * Before this, food, quick-commerce and service-provider each had their own payment
 * or transaction model, so "how much did we take yesterday" had three answers and no
 * single query could produce a platform total.
 *
 * SCOPE -- this is the GATEWAY PAYMENT aggregate only: money moving in or out through
 * a provider. It is deliberately NOT the wallet ledger. `SPTransaction` and taxi's
 * `WalletTransaction` carry balanceBefore/balanceAfter per actor; that is a different
 * aggregate with a different lifecycle and it keeps its own collections. Merging the
 * two would produce a table where half the columns are null on every row.
 */

const SUBJECT_BY_VERTICAL = Object.freeze({
    food: 'FoodOrder',
    quickCommerce: 'QCOrder',
    taxi: 'TaxiRide',
    serviceProvider: 'SPBooking',
});

const PAYER_BY_VERTICAL = Object.freeze({
    food: 'FoodUser',
    quickCommerce: 'QCUser',
    taxi: 'TaxiUser',
    serviceProvider: 'SPUser',
});

/**
 * Record (or update) a payment attempt.
 *
 * Idempotent on `gatewayOrderId` when one is supplied: gateways retry webhooks, and a
 * duplicate row means double-counted revenue. Callers without a gateway id (cash, COD)
 * must pass `subjectId`, which is then the dedupe key together with the vertical.
 *
 * @param {object}  input
 * @param {string}  input.vertical       one of PAYMENT_VERTICALS
 * @param {string}  input.userId         payer
 * @param {number}  input.amount
 * @param {string}  input.method
 * @param {string} [input.subjectId]     order / ride / booking id
 * @param {string} [input.status='created']
 * @param {string} [input.gateway='none']
 * @param {string} [input.gatewayOrderId]
 * @param {string} [input.gatewayPaymentId]
 * @param {object} [input.rawResponse]
 * @param {object} [input.metadata]
 */
export const recordPayment = async (input) => {
    const {
        vertical, userId, amount, method,
        subjectId, status = 'created', gateway = 'none',
        gatewayOrderId, gatewayPaymentId, rawResponse, metadata, currency = 'INR',
    } = input || {};

    if (!PAYMENT_VERTICALS.includes(vertical)) {
        throw new Error(`recordPayment: unknown vertical "${vertical}"`);
    }
    if (!userId) throw new Error('recordPayment: userId is required');
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) {
        throw new Error(`recordPayment: amount must be a non-negative number, got ${amount}`);
    }
    if (!method) throw new Error('recordPayment: method is required');

    const subjectModel = SUBJECT_BY_VERTICAL[vertical];
    const payerModel = PAYER_BY_VERTICAL[vertical];

    const doc = {
        vertical,
        module: vertical,
        userId,
        payerModel,
        amount: Number(amount),
        currency,
        method,
        gateway,
        status,
        subjectModel,
        ...(subjectId ? { subjectId } : {}),
        // Mirror the subject into `orderId` for the order-shaped verticals. Both food
        // and quick-commerce have readers that query { orderId } -- getPaymentsByOrder,
        // findOrCreatePayment -- against an existing index, and leaving it unset made
        // every lookup of a payment they had just written come back empty.
        //
        // It is a QUERY key only. `orderId` still declares ref: 'FoodOrder', so
        // populate('orderId') is correct for food alone; anything polymorphic must
        // populate('subjectId'), which resolves through subjectModel.
        ...(subjectId && (vertical === 'food' || vertical === 'quickCommerce') ? { orderId: subjectId } : {}),
        ...(gatewayOrderId ? { gatewayOrderId } : {}),
        ...(gatewayPaymentId ? { gatewayPaymentId } : {}),
        ...(rawResponse ? { rawResponse } : {}),
        ...(metadata ? { metadata } : {}),
    };

    // Dedupe ONLY on a real gateway order id.
    //
    // Deliberately not on (vertical, subjectId): an order legitimately has several
    // payment attempts -- the first fails, the customer retries with another method --
    // and each attempt is its own row that support and reconciliation rely on.
    // Collapsing them would destroy that history. A retried webhook always carries the
    // same gatewayOrderId, which is the case worth protecting against.
    const dedupeKey = typeof gatewayOrderId === 'string' && gatewayOrderId.trim() ? gatewayOrderId.trim() : null;

    if (!dedupeKey) {
        return Payment.create(doc);
    }

    return Payment.findOneAndUpdate(
        { gatewayOrderId: dedupeKey },
        { $set: doc },
        { new: true, upsert: true, setDefaultsOnInsert: true },
    );
};

/** Platform-wide totals, the query that was impossible before. */
export const getPaymentTotals = async ({ from, to, status = 'success' } = {}) => {
    const match = { status };
    if (from || to) {
        match.createdAt = {};
        if (from) match.createdAt.$gte = new Date(from);
        if (to) match.createdAt.$lte = new Date(to);
    }
    const rows = await Payment.aggregate([
        { $match: match },
        { $group: { _id: '$vertical', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { amount: -1 } },
    ]);
    return {
        byVertical: rows.map((r) => ({ vertical: r._id || 'unknown', amount: r.amount, count: r.count })),
        total: rows.reduce((a, r) => a + r.amount, 0),
        count: rows.reduce((a, r) => a + r.count, 0),
    };
};

export { PAYMENT_VERTICALS };
