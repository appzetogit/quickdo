export const logger = {
    info: (msg) => console.log(`✅ [INFO] ${new Date().toLocaleTimeString()}: ${msg}`),
    error: (msg) => console.error(`❌ [ERROR] ${new Date().toLocaleTimeString()}: ${msg}`),
    warn: (msg) => console.warn(`⚠️ [WARN] ${new Date().toLocaleTimeString()}: ${msg}`),
    // Callers use debug (the tracking worker did, and crashed on every job with
    // "logger.debug is not a function"). Quiet unless LOG_DEBUG is set.
    debug: (msg) => { if (process.env.LOG_DEBUG === 'true') console.log(`🔍 [DEBUG] ${new Date().toLocaleTimeString()}: ${msg}`); }
};
