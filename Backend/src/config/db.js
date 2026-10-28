import mongoose from 'mongoose';
import dns from 'node:dns';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

export const connectDB = async () => {
    try {
        const dnsServers = String(config.mongodbDnsServers || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        if (dnsServers.length > 0) {
            try {
                dns.setServers(dnsServers);
                logger.info(`Using custom DNS servers for MongoDB lookup: ${dnsServers.join(', ')}`);
            } catch (dnsError) {
                logger.warn(`Failed to set custom DNS servers: ${dnsError.message}`);
            }
        }

        const conn = await mongoose.connect(config.mongodbUri, {
            serverSelectionTimeoutMS: config.mongodbServerSelectionTimeoutMs,
            connectTimeoutMS: config.mongodbConnectTimeoutMs,
            family: 4, // Prefer IPv4 where local resolvers have IPv6/SRV issues.
        });
        logger.info(`MongoDB connected: ${conn.connection.host}`);
        // A standalone server cannot run transactions; see standaloneTransactions.js.
        try {
            const { adaptTransactionsToTopology } = await import('./standaloneTransactions.js');
            await adaptTransactionsToTopology(conn.connection);
        } catch (err) {
            logger.warn(`[db] topology check failed: ${err.message}`);
        }
    } catch (error) {
        logger.error(`MongoDB connection error: ${error.message}`);
        if (config.nodeEnv === 'production') {
            logger.warn('⚠️ Server is running in production mode. Keeping the process alive to allow Mongoose automatic reconnection.');
        } else {
            process.exit(1);
        }
    }
};

/**
 * Close MongoDB connection (e.g. graceful shutdown).
 * @returns {Promise<void>}
 */
export const disconnectDB = async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
};

export const connectDatabase = connectDB;