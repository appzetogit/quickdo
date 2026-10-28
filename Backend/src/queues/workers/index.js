/**
 * Runs every BullMQ worker in one process.
 *
 * Why this file exists: package.json declares six worker entrypoints, and
 * deploy/ecosystem.config.cjs started none of them. With BULLMQ_ENABLED=true the API
 * would keep enqueuing OTP sends, order dispatch retries, tracking updates and
 * payment reconciliation into queues that nothing consumed -- growing forever, with
 * no error surfacing anywhere, because a producer succeeds whether or not a consumer
 * exists.
 *
 * One process rather than six pm2 apps: these workers are I/O-bound on Redis and
 * MongoDB, so they interleave on one event loop, and six Node runtimes to do that is
 * ~300MB of resident memory for no throughput. Split one out into its own pm2 app if
 * a specific queue ever needs isolation or its own concurrency.
 *
 * WORKER_BUNDLE tells each worker module not to install its own SIGTERM handler.
 * Six handlers each ending in process.exit(0) means the first worker to finish
 * closing terminates the process while the others are still draining jobs.
 *
 * Run:  node src/queues/workers/index.js      (or: npm run worker:all)
 */
process.env.WORKER_BUNDLE = '1';

import 'dotenv/config';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { closeBullMQConnection } from '../index.js';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../../config/db.js';

/** Longer than the API's 10s: a worker may be mid-job when the signal arrives. */
const SHUTDOWN_TIMEOUT_MS = 15000;

if (!config.bullmqEnabled) {
    logger.warn('BULLMQ_ENABLED is not true — no workers to run. Exiting.');
    process.exit(0);
}
if (!config.redisEnabled) {
    logger.error('BullMQ requires Redis, but REDIS_ENABLED is not true. Exiting.');
    process.exit(1);
}

/**
 * Connect Mongo before any worker can claim a job.
 *
 * Only the tracking processor used to connect, lazily, inside the job itself.
 * Mongoose is a singleton, so every other worker silently depended on a
 * tracking job having run first -- which holds all day and fails at 04:00,
 * when the maintenance jobs fire and nothing has moved since the last deploy.
 * The FSSAI expiry check had been dying that way every night for twelve days:
 * `food_restaurants.find()` buffering timed out after 10000ms, logged and
 * otherwise invisible, so nobody was told their licence was expiring.
 *
 * Not exiting if it fails: connectDB already sets that policy -- in production
 * it keeps the process alive so Mongoose can reconnect -- and a worker bundle
 * that exits on a momentary Mongo blip would just restart-loop under pm2. The
 * connection state is logged instead, so a worker running without a database is
 * visible rather than silent.
 */
await connectDB();
if (mongoose.connection.readyState !== 1) {
    logger.warn(
        `Workers started without a live MongoDB connection (readyState=${mongoose.connection.readyState}). `
        + 'Mongoose will retry; jobs that query before it succeeds will time out.'
    );
}

// Each module starts its worker on import and exports nothing, so these are
// side-effect imports by design. Awaited together so a failure in one is reported
// rather than swallowed as an unhandled rejection.
const modules = [
    './otp.worker.js',
    './notification.worker.js',
    './order.worker.js',
    './tracking.worker.js',
    './payment.worker.js',
    './maintenance.worker.js',
];

const loaded = await Promise.allSettled(modules.map((m) => import(m)));
const failed = loaded
    .map((result, i) => ({ result, name: modules[i] }))
    .filter(({ result }) => result.status === 'rejected');

for (const { result, name } of failed) {
    logger.error(`Worker ${name} failed to start: ${result.reason?.message || result.reason}`);
}

// A partial start is worse than no start: pm2 reports the process online, the queues
// it did start drain normally, and the ones it did not are invisibly stalled.
if (failed.length > 0) {
    logger.error(`${failed.length}/${modules.length} workers failed to start. Exiting so pm2 restarts the process.`);
    process.exit(1);
}

logger.info(`All ${modules.length} BullMQ workers started in one process`);

let shuttingDown = false;
const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, closing workers`);

    const forced = setTimeout(() => {
        logger.error('Worker shutdown timed out, forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
        // Closing the shared BullMQ connection stops every worker from claiming new
        // jobs and lets in-flight ones finish.
        await closeBullMQConnection();
        await disconnectDB();
        clearTimeout(forced);
        logger.info('Workers closed cleanly');
        process.exit(0);
    } catch (err) {
        clearTimeout(forced);
        logger.error(`Worker shutdown error: ${err.message}`);
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
    logger.error(`Worker unhandled rejection: ${err?.message || err}`);
});
process.on('uncaughtException', (err) => {
    logger.error(`Worker uncaught exception: ${err?.message || err}`);
    process.exit(1);
});
