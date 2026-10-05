import { logger } from '../../utils/logger.js';

/**
 * BullMQ processor for automated maintenance tasks.
 * @param {import('bullmq').Job} job
 */
export const processMaintenanceJob = async (job) => {
    const data = job?.data || {};
    const type = data.type || 'unknown';

    if (type === 'MANUAL_ASSIGN_EXPIRY') {
        // Runs in the API now (server.js), where the socket server is. A tick left
        // over in Redis from before the move is ignored.
        return { processed: false, type, jobId: job.id, movedToApi: true };
    }

    logger.info(`[BullMQ:maintenance] type=${type} jobId=${job.id}`);

    if (type === 'SUBSCRIPTION_EXPIRY_CHECK') {
        logger.info('[BullMQ:maintenance] SUBSCRIPTION_EXPIRY_CHECK skipped because restaurant billing has been removed.');
    }

    if (type === 'FSSAI_EXPIRY_CHECK') {
        try {
            const { syncExpiredFssaiNotifications } = await import('../../modules/food/restaurant/services/fssaiExpiry.service.js');
            const results = await syncExpiredFssaiNotifications();
            logger.info(`[BullMQ:maintenance] FSSAI_EXPIRY_CHECK complete. Total Expired: ${results.totalExpired}, Notifications: ${results.createdCount}`);
        } catch (err) {
            logger.error(`[BullMQ:maintenance] FSSAI_EXPIRY_CHECK failed: ${err.message}`);
            throw err;
        }
    }

    if (type === 'STALE_SWEEP') {
        // Unpaid quick-commerce orders give their stock back, and abandoned taxi
        // rides stop blocking their driver and customer. Each step on its own:
        // one failing must not stop the other.
        try {
            const { expireStalePendingPaymentOrders } = await import('../../modules/quickCommerce/modules/food/orders/services/order.service.js');
            await expireStalePendingPaymentOrders();
        } catch (err) {
            logger.error(`[BullMQ:maintenance] QC pending-payment sweep failed: ${err.message}`);
        }
        try {
            const { sweepStaleRides } = await import('../../modules/taxi/services/staleRideSweep.js');
            await sweepStaleRides();
        } catch (err) {
            logger.error(`[BullMQ:maintenance] taxi stale ride sweep failed: ${err.message}`);
        }
    }

    return { processed: true, type, jobId: job.id };
};
