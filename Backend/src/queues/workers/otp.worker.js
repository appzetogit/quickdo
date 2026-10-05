import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { getBullMQConnection } from '../connection.js';
import { OTP_QUEUE } from '../queue.constants.js';
import { processOtpJob } from '../processors/otp.processor.js';

const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
};

const startOtpWorker = () => {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled. OTP worker not started.');
        return null;
    }
    const connection = getBullMQConnection();
    if (!connection) {
        logger.error('OTP worker: Redis connection unavailable. Exiting.');
        process.exit(1);
    }
    const worker = new Worker(OTP_QUEUE, processOtpJob, {
        connection,
        concurrency: 5,
        defaultJobOptions
    });
    worker.on('completed', (job) => logger.info(`OTP job ${job.id} completed`));
    worker.on('failed', (job, err) => logger.error(`OTP job ${job?.id} failed: ${err.message}`));
    worker.on('error', (err) => logger.error(`OTP worker error: ${err.message}`));
    logger.info('OTP worker started');
    return worker;
};

const worker = startOtpWorker();
// Standalone entrypoint only. When index.js runs every worker in one process it
// sets WORKER_BUNDLE and owns shutdown for all of them -- six handlers each
// calling process.exit(0) would let the first one to finish kill the others
// mid-job.
if (worker && !process.env.WORKER_BUNDLE) {
    const shutdown = async () => {
        await worker.close();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
