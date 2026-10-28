import { logger } from '../../utils/logger.js';

/**
 * BullMQ processor for order lifecycle jobs.
 *
 * Current implementation is intentionally logging-only to avoid changing API behavior.
 * @param {import('bullmq').Job} job
 */
export const processOrderJob = async (job) => {
    const data = job?.data || {};
    const action = data.action || 'unknown';
    const orderId = data.orderId || '';
    const orderMongoId = data.orderMongoId || '';

    logger.info(
        `[BullMQ:order] action=${action} jobId=${job.id} orderId=${orderId} orderMongoId=${orderMongoId}`
    );

    // Handle Smart Dispatch Timeout
    if (action === 'DISPATCH_TIMEOUT_CHECK') {
        try {
            const { processDispatchTimeout } = await import('../../modules/food/orders/services/order.service.js');
            // Pass full data object to allow attempt count and other options
            await processDispatchTimeout(orderMongoId, data.partnerId, data);
        } catch (err) {
            logger.error(`[BullMQ:order] DISPATCH_TIMEOUT_CHECK failed: ${err.message}`);
        }
    }

    // Handle Petpooja Order Push (Asynchronous / Non-blocking)
    if (action === 'PETPOOJA_ORDER_PUSH') {
        try {
            const { pushOrderToPetpooja } = await import('../../modules/food/orders/services/petpooja.service.js');
            await pushOrderToPetpooja(orderMongoId);
        } catch (err) {
            logger.error(`[BullMQ:order] PETPOOJA_ORDER_PUSH failed: ${err.message}`);
            throw err; // Re-throw to trigger BullMQ retry backoff
        }
    }

    // Handle Petpooja Status Update (Asynchronous / Non-blocking)
    if (action === 'PETPOOJA_STATUS_UPDATE') {
        try {
            const { updateOrderStatusInPetpooja } = await import('../../modules/food/orders/services/petpooja.service.js');
            await updateOrderStatusInPetpooja(orderMongoId, data.status);
        } catch (err) {
            logger.error(`[BullMQ:order] PETPOOJA_STATUS_UPDATE failed: ${err.message}`);
            throw err;
        }
    }

    return { processed: true, action, jobId: job.id };
};
