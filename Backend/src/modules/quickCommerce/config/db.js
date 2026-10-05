import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(config.mongodbUri);
        logger.info(`MongoDB connected: ${conn.connection.host}`);

        // Once the database is up, a service account saved in the admin panel
        // takes precedence over the one in the environment. Deliberately not
        // awaited or fatal: push failing to configure must not stop the API
        // from serving, and the env/file credential still covers it.
        const { reloadServiceAccountFromSettings } = await import('../core/notifications/firebase.service.js');
        void reloadServiceAccountFromSettings();
    } catch (error) {
        logger.error(`MongoDB connection error: ${error.message}`);
        process.exit(1);
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
