import { logger } from '../../utils/logger.js';
import { creditWallet } from '../../core/payments/wallet.service.js';
import { createPayment, markPaymentSuccess } from '../../core/payments/payment.service.js';
import { initiateRefund } from '../../core/payments/refund.service.js';
import { recordFailedFinancialOperation } from '../../core/finance/deadLetter.js';

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
 * @param {import('bullmq').Job} job
 */
export const processPaymentJob = async (job) => {
    const { action, orderMongoId, orderId } = job.data || {};
    logger.info(`[PaymentProcessor] Processing ${action} for order ${orderId || orderMongoId} (job ${job.id})`);

    try {
        switch (action) {
            case 'delivery_completed':
                await handleDeliveryCompleted(job.data);
                break;

            case 'order_cancelled':
                await handleOrderCancelled(job.data);
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
 * After delivery is completed and payment is confirmed:
 * Split money to all parties.
 */
async function handleDeliveryCompleted(data) {
    const {
        orderMongoId, orderId,
        restaurantId, deliveryPartnerId,
        riderEarning = 0, platformProfit = 0,
        commissionAmount = 0,
        total = 0, paymentMethod
    } = data;

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
                metadata: { orderId, paymentMethod }
            });
            logger.info(`[PaymentProcessor] Restaurant ${restaurantId} credited ${commissionAmount} for order ${orderId}`);
        } catch (err) {
            /*
             * Recorded rather than rethrown, and rather than merely logged.
             *
             * Rethrowing would let BullMQ retry, but this handler makes three
             * credits in sequence and none is idempotent -- a retry after a partial
             * success pays the earlier parties twice. Silent under-payment would
             * become silent double-payment.
             *
             * So the failure is captured with enough payload to replay, and becomes
             * work for the dead-letter queue once the ledger's unique idempotency
             * index makes retrying safe.
             */
            await recordFailedFinancialOperation({
                operation: 'credit_restaurant_commission',
                vertical: 'food',
                entityType: 'restaurant',
                entityId: restaurantId,
                amount: commissionAmount,
                orderId,
                payload: { orderMongoId, paymentMethod, category: 'commission' },
                error: err,
            });
        }
    }

    // 2. Credit delivery partner wallet with their earning
    if (deliveryPartnerId && riderEarning > 0) {
        try {
            await creditWallet({
                entityType: 'deliveryBoy',
                entityId: deliveryPartnerId,
                amount: riderEarning,
                description: `Order ${orderId} - delivery earning`,
                category: 'delivery_earning',
                orderId: orderMongoId,
                metadata: { orderId, paymentMethod }
            });

            // Increment delivery count
            const { FoodDeliveryWallet } = await import('../../modules/food/delivery/models/deliveryWallet.model.js');
            const mongoose = await import('mongoose');
            await FoodDeliveryWallet.updateOne(
                { deliveryPartnerId: new mongoose.default.Types.ObjectId(deliveryPartnerId) },
                { $inc: { totalDeliveries: 1 } }
            );

            logger.info(`[PaymentProcessor] Delivery partner ${deliveryPartnerId} credited ${riderEarning} for order ${orderId}`);
        } catch (err) {
            // The rider not being paid was previously one log line. See above for
            // why this is recorded rather than retried.
            await recordFailedFinancialOperation({
                operation: 'credit_delivery_partner_earning',
                vertical: 'food',
                entityType: 'deliveryBoy',
                entityId: deliveryPartnerId,
                amount: riderEarning,
                orderId,
                payload: { orderMongoId, paymentMethod, category: 'delivery_earning' },
                error: err,
            });
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
                metadata: { orderId, paymentMethod, riderEarning }
            });
            logger.info(`[PaymentProcessor] Platform credited ${platformProfit} for order ${orderId}`);
        } catch (err) {
            await recordFailedFinancialOperation({
                operation: 'credit_platform_profit',
                vertical: 'food',
                entityType: 'admin',
                entityId: 'platform',
                amount: platformProfit,
                orderId,
                payload: { orderMongoId, paymentMethod, riderEarning, category: 'platform_fee' },
                error: err,
            });
        }
    }
}

/**
 * Handle order cancellation — trigger refund if payment was made.
 */
async function handleOrderCancelled(data) {
    const { orderMongoId, paymentId, paymentMethod, paymentStatus, userId, amount, reason } = data;

    if (!paymentId || paymentStatus !== 'success') {
        logger.info(`[PaymentProcessor] No refund needed for order ${orderMongoId} (status: ${paymentStatus})`);
        return;
    }

    try {
        await initiateRefund({
            paymentId,
            orderId: orderMongoId,
            userId,
            amount,
            reason: reason || 'Order cancelled',
            refundTo: paymentMethod === 'wallet' ? 'wallet' : 'wallet' // Default to wallet refund
        });
        logger.info(`[PaymentProcessor] Refund initiated for order ${orderMongoId}`);
    } catch (err) {
        /*
         * The worst of the five swallowed failures: a customer whose order was
         * cancelled never gets their money back, and the only trace was a log line.
         * Recorded so it is findable by order id, which is how the support query
         * actually arrives.
         */
        await recordFailedFinancialOperation({
            operation: 'refund',
            vertical: 'food',
            entityType: 'user',
            entityId: userId,
            amount,
            orderId: orderMongoId,
            paymentId,
            payload: { paymentMethod, paymentStatus, reason: reason || 'Order cancelled', refundTo: 'wallet' },
            error: err,
        });
    }
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
