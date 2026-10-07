import { logger } from '../../utils/logger.js';
import { creditWallet } from '../../core/payments/wallet.service.js';
import { createPayment, markPaymentSuccess } from '../../core/payments/payment.service.js';
import { initiateRefund } from '../../core/payments/refund.service.js';
import { recordFailedFinancialOperation } from '../../core/finance/deadLetter.js';
import * as keys from '../../core/finance/idempotencyKeys.js';

/**
 * Post-delivery financial settlement processor.
 * Called by BullMQ when a delivery_completed event fires.
 *
 * Splits the order total into:
 * 1. Restaurant commission credit
 * 2. Delivery partner earning credit
 * 3. Platform profit credit (admin wallet)
 *
 * Also handles refunds on order cancellation.
 *
 * FAILURES (P0-3). Every credit now carries an idempotency key
 * (core/finance/idempotencyKeys.js), so running this job twice moves the money
 * once. That is what makes it safe to let BullMQ retry: a failed credit is
 * rethrown while attempts remain, and the retry re-runs all three -- the ones that
 * already landed return their first row and move nothing. Only on the LAST attempt
 * is a failure written to the dead-letter collection, so a credit is never dropped
 * and never paid twice.
 *
 * @param {import('bullmq').Job} job
 */
export const processPaymentJob = async (job) => {
    const { action, orderMongoId, orderId } = job.data || {};
    logger.info(`[PaymentProcessor] Processing ${action} for order ${orderId || orderMongoId} (job ${job.id})`);

    const ctx = { finalAttempt: isFinalAttempt(job) };

    try {
        switch (action) {
            case 'delivery_completed':
                await handleDeliveryCompleted(job.data, ctx);
                break;

            case 'order_cancelled':
                await handleOrderCancelled(job.data, ctx);
                break;

            case 'payment_verified':
                await handlePaymentVerified(job.data);
                break;

            default:
                logger.info(`[PaymentProcessor] No handler for action: ${action}`);
        }
    } catch (err) {
        logger.error(`[PaymentProcessor] Error processing ${action}: ${err.message}`);
        throw err; // Let BullMQ retry
    }

    return { processed: true, action, jobId: job.id };
};

/**
 * True when BullMQ will not run this job again if it fails now. `attemptsMade`
 * counts the attempts that already failed, so this run is attempt attemptsMade+1.
 * A job without retry options (or a hand-built one in a test) has one attempt.
 */
export const isFinalAttempt = (job) => {
    const allowed = Math.max(1, Number(job?.opts?.attempts) || 1);
    const made = Math.max(0, Number(job?.attemptsMade) || 0);
    return made + 1 >= allowed;
};

/**
 * Collects the failures of one job's credits, then decides once: retry the job
 * (attempts remain) or dead-letter each failure (last attempt).
 */
const failureBatch = (ctx) => {
    const failures = [];
    return {
        add: (deadLetter, error) => failures.push({ deadLetter, error }),
        async settle(label) {
            if (failures.length === 0) return;
            if (!ctx.finalAttempt) {
                const err = new Error(
                    `${label}: ${failures.length} money movement(s) failed (${failures.map((f) => f.error?.message).join('; ')}); retrying`,
                );
                err.failures = failures.map((f) => f.deadLetter.operation);
                throw err;
            }
            for (const { deadLetter, error } of failures) {
                await recordFailedFinancialOperation({ ...deadLetter, error });
            }
        },
    };
};

/**
 * After delivery is completed and payment is confirmed:
 * Split money to all parties.
 */
async function handleDeliveryCompleted(data, ctx = { finalAttempt: true }) {
    const {
        orderMongoId, orderId,
        restaurantId, deliveryPartnerId,
        riderEarning = 0, platformProfit = 0,
        commissionAmount = 0,
        total = 0, paymentMethod
    } = data;
    // Keyed on the order's database id: stable across retries and unique per order.
    const orderKey = String(orderMongoId || orderId || '');
    const failures = failureBatch(ctx);

    // 1. Credit restaurant wallet with their commission (payout)
    if (restaurantId && commissionAmount > 0) {
        try {
            await creditWallet({
                entityType: 'restaurant',
                entityId: restaurantId,
                amount: commissionAmount,
                description: `Order ${orderId} - restaurant commission`,
                category: 'commission',
                orderId: orderMongoId,
                metadata: { orderId, paymentMethod },
                idempotencyKey: keys.forOrderCommission(orderKey, restaurantId)
            });
            logger.info(`[PaymentProcessor] Restaurant ${restaurantId} credited ${commissionAmount} for order ${orderId}`);
        } catch (err) {
            failures.add({
                operation: 'credit_restaurant_commission',
                vertical: 'food',
                entityType: 'restaurant',
                entityId: restaurantId,
                amount: commissionAmount,
                orderId,
                payload: { orderMongoId, paymentMethod, category: 'commission' },
            }, err);
        }
    }

    // 2. Credit delivery partner wallet with their earning
    if (deliveryPartnerId && riderEarning > 0) {
        try {
            const { duplicate } = await creditWallet({
                entityType: 'deliveryBoy',
                entityId: deliveryPartnerId,
                amount: riderEarning,
                description: `Order ${orderId} - delivery earning`,
                category: 'delivery_earning',
                orderId: orderMongoId,
                metadata: { orderId, paymentMethod },
                idempotencyKey: keys.forOrderRiderEarning(orderKey)
            });

            // Increment delivery count -- once, with the credit, not on every retry.
            if (!duplicate) {
                const { FoodDeliveryWallet } = await import('../../modules/food/delivery/models/deliveryWallet.model.js');
                const mongoose = await import('mongoose');
                await FoodDeliveryWallet.updateOne(
                    { deliveryPartnerId: new mongoose.default.Types.ObjectId(deliveryPartnerId) },
                    { $inc: { totalDeliveries: 1 } }
                );
            }

            logger.info(`[PaymentProcessor] Delivery partner ${deliveryPartnerId} credited ${riderEarning} for order ${orderId}`);
        } catch (err) {
            failures.add({
                operation: 'credit_delivery_partner_earning',
                vertical: 'food',
                entityType: 'deliveryBoy',
                entityId: deliveryPartnerId,
                amount: riderEarning,
                orderId,
                payload: { orderMongoId, paymentMethod, category: 'delivery_earning' },
            }, err);
        }
    }

    // 3. Credit admin/platform wallet with platform profit
    if (platformProfit > 0) {
        try {
            await creditWallet({
                entityType: 'admin',
                entityId: 'platform',
                amount: platformProfit,
                description: `Order ${orderId} - platform profit`,
                category: 'platform_fee',
                orderId: orderMongoId,
                metadata: { orderId, paymentMethod, riderEarning },
                idempotencyKey: keys.forOrderPlatformFee(orderKey)
            });
            logger.info(`[PaymentProcessor] Platform credited ${platformProfit} for order ${orderId}`);
        } catch (err) {
            failures.add({
                operation: 'credit_platform_profit',
                vertical: 'food',
                entityType: 'admin',
                entityId: 'platform',
                amount: platformProfit,
                orderId,
                payload: { orderMongoId, paymentMethod, riderEarning, category: 'platform_fee' },
            }, err);
        }
    }

    await failures.settle(`delivery_completed ${orderId || orderMongoId}`);
}

/**
 * Handle order cancellation — trigger refund if payment was made.
 */
async function handleOrderCancelled(data, ctx = { finalAttempt: true }) {
    const { orderMongoId, paymentId, paymentMethod, paymentStatus, userId, amount, reason } = data;

    if (!paymentId || paymentStatus !== 'success') {
        logger.info(`[PaymentProcessor] No refund needed for order ${orderMongoId} (status: ${paymentStatus})`);
        return;
    }

    const failures = failureBatch(ctx);
    try {
        await initiateRefund({
            paymentId,
            orderId: orderMongoId,
            userId,
            amount,
            reason: reason || 'Order cancelled',
            refundTo: paymentMethod === 'wallet' ? 'wallet' : 'wallet', // Default to wallet refund
            // One cancellation refunds once, however often the job runs.
            idempotencyKey: `refund:order_cancelled:${orderMongoId || paymentId}`
        });
        logger.info(`[PaymentProcessor] Refund initiated for order ${orderMongoId}`);
    } catch (err) {
        /*
         * The worst of the swallowed failures: a customer whose order was cancelled
         * never gets their money back. Retried while attempts remain, then recorded
         * so it is findable by order id, which is how the support query arrives.
         */
        failures.add({
            operation: 'refund',
            vertical: 'food',
            entityType: 'user',
            entityId: userId,
            amount,
            orderId: orderMongoId,
            paymentId,
            payload: { paymentMethod, paymentStatus, reason: reason || 'Order cancelled', refundTo: 'wallet' },
        }, err);
    }
    await failures.settle(`order_cancelled ${orderMongoId}`);
}

/**
 * Handle payment verified — create a Payment record in the new system.
 */
async function handlePaymentVerified(data) {
    const { orderMongoId, orderId, userId, paymentMethod, paymentStatus, amount, gatewayPaymentId } = data;

    try {
        const payment = await createPayment({
            orderId: orderMongoId,
            userId,
            amount,
            method: paymentMethod,
            gateway: paymentMethod === 'razorpay' ? 'razorpay' : 'none',
            gatewayOrderId: data.razorpayOrderId || '',
            metadata: { orderId, source: 'payment_verified_event' }
        });

        if (paymentStatus === 'paid' && gatewayPaymentId) {
            await markPaymentSuccess(payment._id, { gatewayPaymentId });
        }

        logger.info(`[PaymentProcessor] Payment record created for order ${orderId}: ${payment._id}`);
    } catch (err) {
        // No money moves here, but a missing Payment record is what makes a later
        // refund impossible to reconcile against anything.
        await recordFailedFinancialOperation({
            operation: 'create_payment_record',
            vertical: 'food',
            entityType: 'user',
            entityId: userId,
            amount,
            orderId: orderMongoId,
            paymentId: gatewayPaymentId,
            payload: { orderId, paymentMethod, paymentStatus, razorpayOrderId: data.razorpayOrderId || '' },
            error: err,
        });
    }
}

export const __testables = { handleDeliveryCompleted, handleOrderCancelled };
