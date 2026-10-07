import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { getBullMQConnection } from '../connection.js';
import { EMAIL_QUEUE } from '../queue.constants.js';
import { processEmailJob } from '../processors/email.processor.js';

/**
 * Consumes the 'email' queue (queues/email.queue.js). Started with every other
 * worker by queues/workers/index.js, which deploy/ecosystem.config.cjs runs as
 * `master-workers`; `npm run worker:email` runs it alone.
 */
const startEmailWorker = () => {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled. Email worker not started.');
        return null;
    }
    const connection = getBullMQConnection();
    if (!connection) {
        logger.error('Email worker: Redis connection unavailable. Exiting.');
        process.exit(1);
    }
    const worker = new Worker(EMAIL_QUEUE, processEmailJob, {
        connection,
        // SMTP providers throttle bursts; a handful in flight is plenty.
        concurrency: 3,
    });
    // Recipient and kind only: the job body can carry a one-time code.
    worker.on('completed', (job) => logger.info(`Email job ${job.id} (${job.name}) completed`));
    worker.on('failed', (job, err) => logger.error(`Email job ${job?.id} (${job?.name}) to ${job?.data?.to} failed: ${err.message}`));
    worker.on('error', (err) => logger.error(`Email worker error: ${err.message}`));
    logger.info('Email worker started');
    return worker;
};

const worker = startEmailWorker();
// Standalone entrypoint only; index.js owns shutdown when it bundles the workers.
if (worker && !process.env.WORKER_BUNDLE) {
    const shutdown = async () => {
        await worker.close();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
