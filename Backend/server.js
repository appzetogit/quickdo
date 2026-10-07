/*
 * FIRST, before anything else is evaluated.
 *
 * ES modules run in the order they are imported, so this one checks the source
 * tree before a single other module -- or anything injected into one -- has a
 * chance to execute. A check written as a statement further down would run
 * after every import above it had already done its work.
 *
 * It exits the process on a finding. See scripts/sourceIntegrity.mjs for what
 * it looks for and why this project needs it.
 */
import './scripts/sourceIntegrity.mjs';

import './src/config/env.js';
import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';
import mongoose from 'mongoose';
import app from './src/app.js';

import { config } from './src/config/env.js';
import { validateConfig } from './src/config/validateEnv.js';
import { connectDB, disconnectDB } from './src/config/db.js';
import { connectRedis, closeRedis } from './src/config/redis.js';
import { initSocket } from './src/config/socket.js';
import { initializeQueues, closeBullMQConnection } from './src/queues/index.js';
import { expireExpiredOffers } from './src/modules/food/admin/services/admin.service.js';
import { syncExpiredFssaiNotifications } from './src/modules/food/restaurant/services/fssaiExpiry.service.js';

import { logger } from './src/utils/logger.js';
import { initializeFirebaseRealtime, setFirebaseServiceAccountOverride } from './src/config/firebase.js';

const SHUTDOWN_TIMEOUT_MS = 10000;
let server = null;
let expireOffersInterval = null;
let manualAssignExpiryInterval = null;
let fssaiExpiryInterval = null;
let spScheduler = null;
let ledgerNightlyInterval = null;
let insightsNightlyInterval = null;
let taxiScheduledDispatchWorker = null;
let storeScheduledDispatchWorker = null;

const gracefulShutdown = async (signal) => {
    logger.info(`${signal} received, starting graceful shutdown`);
    if (!server) {
        process.exit(0);
        return;
    }
    server.close(async () => {
        try {
            await disconnectDB();
            await closeRedis();
            await closeBullMQConnection();
            if (expireOffersInterval) clearInterval(expireOffersInterval);
            if (manualAssignExpiryInterval) clearInterval(manualAssignExpiryInterval);
            if (fssaiExpiryInterval) clearInterval(fssaiExpiryInterval);
            if (spScheduler) spScheduler.stop();
            if (ledgerNightlyInterval) clearInterval(ledgerNightlyInterval);
            if (insightsNightlyInterval) clearInterval(insightsNightlyInterval);
            if (taxiScheduledDispatchWorker) await taxiScheduledDispatchWorker.close().catch(() => {});
            if (storeScheduledDispatchWorker) await storeScheduledDispatchWorker.close().catch(() => {});
            logger.info('Graceful shutdown complete');
            process.exit(0);
        } catch (err) {
            logger.error(`Shutdown error: ${err.message}`);
            process.exit(1);
        }
    });
    setTimeout(() => {
        logger.error('Shutdown timeout, forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
};

const startServer = async () => {
    try {
        validateConfig();

        // 1. Connect to Database (MongoDB).
        //
        // Awaited now, where it used to be fire-and-forget, because the Firebase
        // credentials may live in the settings document that the admin panel writes.
        // firebase-admin cannot have its credentials changed after initializeApp, so
        // they have to be resolved BEFORE the next step, not patched in afterwards.
        // Failure is still non-fatal: we log and fall through to the env values.
        try {
            await connectDB();
            const { getFirebaseServiceAccount, getFirebaseSettings } = await import('./src/core/settings/firebaseSettings.service.js');
            const [sa, settings] = await Promise.all([getFirebaseServiceAccount(), getFirebaseSettings()]);
            if (settings.source === 'database' && sa) {
                setFirebaseServiceAccountOverride(sa, settings.databaseURL);
                logger.info(`Firebase credentials loaded from the settings document (project ${sa.project_id})`);
            }
        } catch (err) {
            logger.error(`Failed to connect to MongoDB or read Firebase settings: ${err.message}`);
        }

        initializeFirebaseRealtime();

        // Cross-vertical activity feed. Hooks the four aggregate schemas so the feed
        // stays in step without every controller having to remember to update it.
        // Non-fatal: a failure here costs the unified history, not the platform.
        try {
            const { attachAllActivityHooks } = await import('./src/core/activity/attachActivityHooks.js');
            await attachAllActivityHooks();
        } catch (err) {
            logger.error(`Activity feed hooks failed to attach: ${err.message}`);
        }

        // 2. Create HTTP server from Express app
        const httpServer = http.createServer(app);

        // 3. Initialize Socket.IO with the HTTP server (Redis adapter when Redis enabled)
        await initSocket(httpServer);

        // 3b. Initialize Taxi Module Socket handlers on the same IO instance
        const { getIO } = await import('./src/config/socket.js');
        const { configureTaxiSocketServer } = await import('./src/modules/taxi/socket/index.js');
        configureTaxiSocketServer(getIO());

        // 3c. Service-Provider socket handlers, on namespace /sp of the same IO instance.
        // SP controllers reach it via require('../../sockets').getIO(); the legacy
        // req.app.get('io') call sites are served by the app.set below. Master itself
        // never reads app.get('io'), so this key is free.
        const { configureSPSocketServer } = await import('./src/modules/serviceProvider/sockets/index.js');
        const spNamespace = configureSPSocketServer(getIO());
        app.set('io', spNamespace);

        // 3d. Quick-commerce socket handlers, on namespace /qc. Until this line
        // existed, QC's initSocket was never called at all and every QC realtime
        // feature (order tracking, chat, emergency alerts) was silently dead.
        const { initSocket: initQCSocket } = await import('./src/modules/quickCommerce/config/socket.js');
        await initQCSocket(getIO());

        if (config.redisEnabled) {
            await connectRedis();
        }

        // 5a. Watchdog: Recover stuck orders from previous run
        const runWatchdog = async () => {
            try {
                const { recoverStuckOrders } = await import('./src/modules/food/orders/services/order.service.js');
                await recoverStuckOrders();
            } catch (err) {
                logger.error(`Watchdog startup error: ${err.message}`);
            }
        };

        // runWatchdog() WRITES to the database: it unassigns delivery partners
        // from stuck orders and re-dispatches them.
        // A second instance sharing a primary's database must not run these.
        const runBootJobs = () => {
            if (!config.backgroundJobsEnabled) {
                logger.warn('BACKGROUND_JOBS_ENABLED=false — skipping watchdog (read-mostly instance)');
                return;
            }
            runWatchdog();
        };

        if (mongoose.connection.readyState === 1) {
            runBootJobs();
        } else {
            mongoose.connection.once('connected', runBootJobs);
        }

        // 5. Conditionally initialize BullMQ queues.
        // BullMQ requires Redis; skip queue bootstrap when Redis is disabled.
        if (config.bullmqEnabled && config.redisEnabled) {
            try {
                initializeQueues();
            } catch (err) {
                logger.error(`BullMQ initialization error (server continues): ${err.message}`);
            }
        } else if (config.bullmqEnabled && !config.redisEnabled) {
            logger.warn('BullMQ is enabled but Redis is disabled. Queue initialization skipped.');
        }

        // /api/debug-log used to live here: an unauthenticated endpoint that appended
        // arbitrary request bodies to a hardcoded dev-machine path. Deleted.

        app.post('/api/deploy', (req, res) => {
            const signature = req.headers['x-hub-signature-256'];
            const secret = process.env.DEPLOY_WEBHOOK_SECRET;

            if (!secret) {
                logger.error('DEPLOY_WEBHOOK_SECRET is not configured. Webhook deployment request rejected.');
                return res.status(500).send('Deploy webhook secret is not configured.');
            }

            const hash = 'sha256=' + crypto
                .createHmac('sha256', secret)
                .update(JSON.stringify(req.body))
                .digest('hex');

            // timingSafeEqual, not ===: a plain compare leaks how many leading bytes
            // matched through response timing. Length is checked first because
            // timingSafeEqual throws on unequal lengths.
            const sigBuf = Buffer.from(String(signature || ''));
            const hashBuf = Buffer.from(hash);
            if (sigBuf.length !== hashBuf.length || !crypto.timingSafeEqual(sigBuf, hashBuf)) {
                return res.status(403).send('Unauthorized');
            }

            exec('cd ~ && ./deploy.sh', (err, stdout, stderr) => {
                if (err) {
                    console.error(err);
                    return res.send('Deploy failed');
                }

                console.log(stdout);
                res.send('Deploy success');
            });
        });

        // 6. Start the HTTP server - Bind immediately to PORT
        const PORT = process.env.PORT || 5000;
        server = httpServer.listen(PORT, '0.0.0.0', () => {
            logger.info('=== STARTUP DIAGNOSTICS ===');
            logger.info(`Node Environment: ${config.nodeEnv}`);
            logger.info(`Port: ${PORT}`);
            logger.info(`MongoDB Connection Status: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Connecting/Disconnected'}`);
            logger.info('Startup completion status: SUCCESS');
            logger.info('===========================');
            console.log(`🌐 [URL] http://localhost:${PORT}`);
        });

        const runExpire = async () => {
            try {
                await expireExpiredOffers();
            } catch (err) {
                logger.error(`Expire offers error: ${err.message}`);
            }
        };

        const runFssaiExpirySync = async () => {
            try {
                await syncExpiredFssaiNotifications();
            } catch (err) {
                logger.error(`FSSAI expiry sync error: ${err.message}`);
            }
        };

        // Service-Provider wave-based vendor alerting. Without this a booking is
        // created and no vendor is ever notified, so it is not optional.
        const startSPScheduler = async () => {
            try {
                const { initializeScheduler } = await import('./src/modules/serviceProvider/services/bookingScheduler.js');
                spScheduler = initializeScheduler(spNamespace);
                logger.info('Service-Provider booking scheduler started (wave-based vendor alerting)');
            } catch (err) {
                logger.error(`SP booking scheduler failed to start: ${err.message}`);
            }
        };

        const startIntervals = () => {
            // The SP scheduler is gated SEPARATELY from the rest.
            //
            // BACKGROUND_JOBS_ENABLED covers the food/taxi watchdog, offer expiry
            // and FSSAI sync, and defaults to ON — the k9-backend instance leaves
            // it unset and already runs those against the same cluster. Running a
            // second copy here is what that flag exists to prevent.
            //
            // The Service-Provider module lives only in this deployment, so its
            // scheduler has no competing instance. Tying it to the same switch
            // meant SP dispatch was collateral damage: no wave promotion, no
            // notifiedWorkers, and no realtime alert to any vendor or worker.
            if (process.env.SP_SCHEDULER_ENABLED !== 'false') {
                startSPScheduler();
            } else {
                logger.warn('SP_SCHEDULER_ENABLED=false — SP wave alerting is OFF; partners will only see work by polling');
            }

            // Master ledger nightly reconciliation. Its own flag, off by default, and
            // not tied to BACKGROUND_JOBS_ENABLED: it claims each night in the database,
            // so a second instance cannot double-run it. See core/finance/ledgerNightly.js.
            import('./src/core/finance/ledgerNightly.js')
                .then(({ startLedgerNightly }) => { ledgerNightlyInterval = startLedgerNightly(); })
                .catch((err) => logger.error(`Ledger nightly failed to start: ${err.message}`));

            // Nightly insights (forecasts, bought-together, demand per zone). Claims
            // each night in the database, so a second instance does not repeat it.
            // INSIGHTS_NIGHTLY_ENABLED=false turns it off. See core/analytics/insights.service.js.
            import('./src/core/analytics/insights.service.js')
                .then(({ startInsightsNightly }) => { insightsNightlyInterval = startInsightsNightly(); })
                .catch((err) => logger.error(`Insights nightly failed to start: ${err.message}`));

            // Releases new orders to the restaurant when their cancellation hold ends.
            // Not tied to BACKGROUND_JOBS_ENABLED: a held order must always reach the
            // restaurant, and each release is claimed in the database, so a second
            // instance cannot alert twice. See core/orders/orderHold.js.
            Promise.all([
                import('./src/modules/food/orders/services/order.helpers.js'),
                import('./src/modules/quickCommerce/modules/food/orders/services/order.helpers.js'),
            ])
                .then(() => import('./src/core/orders/orderHold.js'))
                .then(({ startOrderHoldSweeper }) => startOrderHoldSweeper())
                .catch((err) => logger.error(`Order hold sweeper failed to start: ${err.message}`));

            // Manual rider assignments nobody answered in time go back to
            // auto-dispatch (core/delivery/manualAssign.js). Here in the API, not the
            // workers: the hand-back tells the admin panel and the rider over the
            // socket, and restarts dispatch, whose offers also go out over the
            // socket -- the workers process has no socket server, so from there the
            // panel stayed on "time up" and riders got no in-app offer. Each release
            // is a write conditioned on the state it read, so a second instance is
            // harmless. Not tied to BACKGROUND_JOBS_ENABLED, like the hold sweeper.
            import('./src/core/delivery/manualAssign.js')
                .then(({ expireManualAssignments }) => {
                    const tick = () => expireManualAssignments()
                        .catch((err) => logger.error(`Manual-assign expiry failed: ${err.message}`));
                    manualAssignExpiryInterval = setInterval(tick, 30 * 1000);
                    manualAssignExpiryInterval.unref?.();
                })
                .catch((err) => logger.error(`Manual-assign expiry failed to start: ${err.message}`));

            // Taxi scheduled rides: the dispatch round at the scheduled time
            // (plan §4.13). A delayed BullMQ job when BullMQ is on -- consumed
            // here, where the socket server is -- else in-memory timers re-armed
            // from the database. Each round is claimed on the ride, so a second
            // instance or a retry cannot fire it twice; not tied to
            // BACKGROUND_JOBS_ENABLED, like the hold sweeper.
            import('./src/modules/taxi/services/dispatchService.js')
                .then(async ({ startScheduledDispatchWorker, restoreScheduledDispatches }) => {
                    if (config.bullmqEnabled && config.redisEnabled) {
                        taxiScheduledDispatchWorker = await startScheduledDispatchWorker();
                    }
                    // Safe on every boot: a ride's job id is fixed, and a timer is replaced.
                    const restored = await restoreScheduledDispatches();
                    if (restored) logger.info(`Taxi scheduled dispatch: ${restored} ride(s) re-armed`);
                })
                .catch((err) => logger.error(`Taxi scheduled dispatch failed to start: ${err.message}`));

            // Scheduled quick-commerce orders (plan §5.3): rider search N minutes
            // before the delivery slot. Same arrangement as taxi above -- a
            // delayed BullMQ job consumed here, else timers re-armed from the
            // database; each round claimed once on the order.
            import('./src/core/orders/scheduledDispatch.js')
                .then(async ({ startStoreScheduledDispatchWorker, restoreStoreScheduledDispatches }) => {
                    if (config.bullmqEnabled && config.redisEnabled) {
                        storeScheduledDispatchWorker = await startStoreScheduledDispatchWorker();
                    }
                    const restored = await restoreStoreScheduledDispatches();
                    if (restored) logger.info(`Store scheduled dispatch: ${restored} order(s) re-armed`);
                })
                .catch((err) => logger.error(`Store scheduled dispatch failed to start: ${err.message}`));

            if (!config.backgroundJobsEnabled) {
                logger.warn('BACKGROUND_JOBS_ENABLED=false — skipping offer expiry and FSSAI sync (read-mostly instance)');
                return;
            }

            runExpire();
            expireOffersInterval = setInterval(runExpire, 5 * 60 * 1000);

            runFssaiExpirySync();
            fssaiExpiryInterval = setInterval(runFssaiExpirySync, 60 * 60 * 1000);
        };

        if (mongoose.connection.readyState === 1) {
            startIntervals();
        } else {
            mongoose.connection.once('connected', () => {
                startIntervals();
            });
        }

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        // Handle server errors (like EADDRINUSE)
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`Port ${PORT} is already in use. Please kill the process or use a different port.`);
            } else {
                logger.error(`Server Error: ${err.message}`);
            }
            process.exit(1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (err) => {
            logger.error(`Unhandled Rejection: ${err?.message || err}`);
            if (config.nodeEnv === 'production') {
                if (server) server.close(() => process.exit(1));
                else process.exit(1);
            }
        });

        process.on('uncaughtException', (err) => {
            logger.error(`Uncaught Exception: ${err?.message || err}`);
            if (config.nodeEnv === 'production') {
                process.exit(1);
            }
        });

    } catch (error) {
        logger.error(`Error starting server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

