import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const generateRandomSecret = (name) => {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(`[env] ❌ Critical Security Error: ${name} environment variable is required in production mode!`);
    }   
    const fallback = crypto.randomBytes(32).toString('hex');
    console.warn(`[env] ⚠️ ${name} environment variable is not set. Generated a random secure fallback secret.`);
    return fallback;
};

const parseOrigins = (value) =>
    String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

/** Trailing slashes off, and repair the common `https:/host` single-slash typo. */
const sanitizeUploadBaseUrl = (value) => String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(https?):\/(?!\/)/i, '$1://')
    .replace(/\/+$/, '');

const fallbackCorsOrigins = [
    ...parseOrigins(process.env.SOCKET_CORS_ORIGIN),
    ...parseOrigins(process.env.FRONTEND_URL),
];
const uniqueCorsOrigins = [...new Set(fallbackCorsOrigins)];
const resolvedCorsOrigin = uniqueCorsOrigins.length > 0 ? uniqueCorsOrigins.join(',') : '*';

export const config = {
    // Basic server config
    port: process.env.PORT || 5000,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    mongodbUri: process.env.MONGO_URI || process.env.MONGODB_URI,
    mongodbDnsServers: process.env.MONGODB_DNS_SERVERS || '8.8.8.8,1.1.1.1',
    mongodbServerSelectionTimeoutMs: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 30000),
    mongodbConnectTimeoutMs: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 30000),

    // JWT
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || generateRandomSecret('JWT_ACCESS_SECRET'),
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || generateRandomSecret('JWT_REFRESH_SECRET'),
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',

    // OTP
    otpExpiry: process.env.OTP_EXPIRY || '5m',
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
    otpExpirySeconds: Number(process.env.OTP_EXPIRY_SECONDS || 300),
    otpRateLimit: Number(process.env.OTP_RATE_LIMIT || 3),
    otpRateWindow: Number(process.env.OTP_RATE_WINDOW || 600),
    useDefaultOtp: process.env.USE_DEFAULT_OTP === 'true',

    // SMS India Hub
    smsIndiaHubUsername: process.env.SMS_INDIA_HUB_USERNAME,
    smsApiKey: process.env.SMS_INDIA_HUB_API_KEY,
    smsSenderId: process.env.SMS_INDIA_HUB_SENDER_ID,
    smsDltTemplateId: process.env.SMS_INDIA_HUB_DLT_TEMPLATE_ID,
    /*
     * These four were configured on the server and read by nothing: the sender
     * hard-coded its own endpoint, gateway id and message text and ignored them.
     * The message is the one that matters -- SMS India Hub rejects anything that
     * is not character-for-character the DLT-registered template (ErrorCode
     * 006), so the approved wording has to be settable without a deploy.
     */
    smsIndiaHubUrl: process.env.SMS_INDIA_HUB_URL,
    smsIndiaHubGwid: process.env.SMS_INDIA_HUB_GWID,
    smsIndiaHubTemplateText: process.env.SMS_INDIA_HUB_TEMPLATE_TEXT,
    smsIndiaHubTimeoutMs: Number(process.env.SMS_INDIA_HUB_TIMEOUT_MS) || 15000,

    // Rate limiting
    rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW || 15),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX || 100),
    authRateLimitWindowMinutes: Number(process.env.AUTH_RATE_LIMIT_WINDOW || 15),
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),

    // Security
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),

    // Uploads (local disk — served by nginx in production, express.static in dev)
    //
    // Food used to push images to Cloudinary. That account is disabled, so every
    // stored delivery URL 401s; local disk is now the store of record.
    // Must match the nginx `location /uploads/` alias, which already serves
    // /var/www/uploads/ for quickCommerce. Food now writes into the same root
    // under its own folder prefix.
    uploadStorageRoot: process.env.UPLOAD_STORAGE_ROOT
        || (process.env.NODE_ENV === 'production' ? '/var/www/uploads' : 'uploads'),
    /**
     * Prefix for persisted image URLs. Set this to an ABSOLUTE origin in
     * production: the Flutter APK has no page origin to resolve `/uploads/...`
     * against, so a relative prefix renders on the web and breaks in the app.
     */
    uploadBaseUrl: sanitizeUploadBaseUrl(process.env.UPLOAD_BASE_URL) || '/uploads',
    uploadMaxFileSizeBytes: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 5) * 1024 * 1024,
    /** WebP output quality (1–100). */
    uploadWebpQuality: Number(process.env.UPLOAD_WEBP_QUALITY || 90),
    /** Max width in px; larger images are resized (aspect ratio kept). */
    uploadWebpMaxWidth: Number(process.env.UPLOAD_WEBP_MAX_WIDTH || 2560),
    /** @deprecated Use uploadStorageRoot */
    uploadPath: process.env.UPLOAD_PATH || 'uploads/',
    /*
     * 25mb, not 2mb, because the taxi admin panel posts images as base64 data URLs
     * inside the JSON body -- driver profile photos, vehicle types, CMS banners,
     * goods types, pooling vehicles, bus service media.
     *
     * Base64 inflates a file by a third, and several of those screens submit more
     * than one image in a single payload: CreateDriver sends a profile picture plus
     * every uploaded document at once. So a genuinely small 1MB photo arrived as
     * ~1.37MB and a two-document driver form cleared 2mb easily -- express rejected
     * the request with "request entity too large" before any image-size check ran,
     * which is why the panel reported an oversized image for a 1MB file.
     *
     * nginx already accepts 50M in front of this, so 2mb was the binding limit and
     * the only one nobody had matched to what the client actually sends.
     */
    requestJsonLimit: process.env.REQUEST_JSON_LIMIT || '25mb',
    requestUrlencodedLimit: process.env.REQUEST_URLENCODED_LIMIT || '25mb',

    // Redis
    redisEnabled: process.env.REDIS_ENABLED === 'true',
    redisUrl: process.env.REDIS_URL,

    // BullMQ
    bullmqEnabled: process.env.BULLMQ_ENABLED === 'true',

    // Cloudinary
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
    cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,

    // Firebase / FCM
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    firebaseDatabaseUrl: process.env.VITE_FIREBASE_DATABASE_URL,
    firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
    firebaseWebApiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    firebaseWebAuthDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    firebaseWebStorageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
    firebaseWebMessagingSenderId:
        process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
    firebaseWebAppId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
    firebaseWebMeasurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID,
    firebaseWebVapidKey: process.env.VITE_FIREBASE_VAPID_KEY || process.env.FIREBASE_VAPID_KEY,

    // Socket.io
    socketCorsOrigin: resolvedCorsOrigin,

    // Razorpay (payments)
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET, // ✅ NEW

    // Email (SMTP) – for admin forgot password OTP etc.
    emailHost: process.env.EMAIL_HOST,
    emailPort: Number(process.env.EMAIL_PORT) || 587,
    emailUser: process.env.EMAIL_USER,
    emailPass: process.env.EMAIL_PASS ? String(process.env.EMAIL_PASS).replace(/\s/g, '') : '',
    emailFrom: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@example.com',

    // WhatsApp (Meta Cloud API)
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    whatsappVersion: process.env.WHATSAPP_VERSION || 'v20.0',
    whatsappUseTemplate: process.env.WHATSAPP_USE_TEMPLATE === 'true',
    whatsappFoodTemplateName: process.env.WHATSAPP_FOOD_TEMPLATE_NAME || 'food_invoice',
    whatsappTaxiTemplateName: process.env.WHATSAPP_TAXI_TEMPLATE_NAME || 'taxi_invoice',

    // Petpooja Integration
    petpoojaEnabled: process.env.PETPOOJA_ENABLED === 'true',
    petpoojaApiKey: process.env.PETPOOJA_API_KEY || '',
    petpoojaClientCode: process.env.PETPOOJA_CLIENT_CODE || '',
    petpoojaOutletId: process.env.PETPOOJA_OUTLET_ID || '',
    petpoojaApiUrl: process.env.PETPOOJA_API_URL || 'https://api.petpooja.com/v2',
    petpoojaWebhookSecret: process.env.PETPOOJA_WEBHOOK_SECRET || '',

    // Background jobs: boot watchdog, seeders, offer/FSSAI expiry sweeps, and the
    // service-provider booking scheduler. Default ON so normal deployments are
    // unchanged; set BACKGROUND_JOBS_ENABLED=false on any SECOND instance sharing a
    // database with a primary.
    //
    // This is not a nice-to-have. recoverStuckOrders() nulls the delivery partner on
    // orders stuck in `assigned` and re-triggers auto-assign — a second instance
    // booting against live data would unassign real riders from in-flight orders and
    // re-dispatch them on every restart.
    backgroundJobsEnabled: process.env.BACKGROUND_JOBS_ENABLED !== 'false',

    // Driver unification: when true, dispatch treats taxi drivers + delivery partners as one
    // pool and honors workMode + the activeAssignment busy-lock. Default OFF for safe dual-run —
    // flip only after the backfill migration has run and been validated on staging.
    unifiedDispatchEnabled: process.env.UNIFIED_DISPATCH_ENABLED === 'true',

    // Financial admin routes: when true, an admin without `wallet.write` is refused
    // instead of merely logged. Default OFF, and deliberately so — `permissions`
    // defaults to [] on the admin schema and only the seeded superadmin has ['*'],
    // so enforcing on day one would lock the operations team out of the withdrawal
    // queue. While it is off, every violation is written to admin_audits with
    // toleratedViolation: true. That collection IS the to-do list: grant the
    // permissions it names, confirm it stops growing, then flip this on.
    financePermissionsEnforced: process.env.FINANCE_PERMISSIONS_ENFORCED === 'true',

    // Run the master eligibility engine alongside each vertical's own gate and log
    // where they disagree. Decides nothing and changes no dispatch outcome — it
    // exists so the cutover is made from evidence rather than from confidence.
    // Off by default because it costs a riderFinance call per candidate on a hot
    // path; turn it on in staging, then in production for a week, then read the
    // WOULD_BLOCK / WOULD_ALLOW lines before wiring the engine in for real.
    eligibilityShadowEnabled: process.env.ELIGIBILITY_SHADOW_ENABLED === 'true'
};

// Taxi Module Compatibility Export
export const env = {
    ...config,
    // Taxi modules use `env.corsOrigin`; keep it in sync with socket CORS origin.
    corsOrigin: config.socketCorsOrigin,
    mongoUri: config.mongodbUri,
    jwtSecret: config.jwtAccessSecret,
    jwtExpiresIn: config.jwtAccessExpiresIn,
    cloudinary: {
        cloudName: config.cloudinaryCloudName,
        apiKey: config.cloudinaryApiKey,
        apiSecret: config.cloudinaryApiSecret,
        folder: process.env.CLOUDINARY_FOLDER || 'Quick Drop-taxi',
    },
    firebase: {
        databaseURL: config.firebaseDatabaseUrl,
        serviceAccountPath: config.firebaseServiceAccountPath,
        serviceAccountJson: config.firebaseServiceAccount,
    },
    sms: {
        useDefaultOtp: config.useDefaultOtp ? 'true' : 'false',
        otpExpiryMinutes: config.otpExpiryMinutes,
        staticOtpPhone: process.env.STATIC_OTP_PHONE,
        staticOtpCode: process.env.STATIC_OTP_CODE,
        indiaHub: {
            username: config.smsIndiaHubUsername,
            password: process.env.SMS_INDIA_HUB_PASSWORD,
            apiKey: config.smsApiKey,
            senderId: config.smsSenderId,
            dltTemplateId: config.smsDltTemplateId,
        }
    },
    driverWallet: {
        defaultCashLimit: Number(process.env.DRIVER_WALLET_DEFAULT_CASH_LIMIT || 500),
        commissionPercent: Number(process.env.DRIVER_COMMISSION_PERCENT || 20),
    }
};

export const isOriginAllowed = (origin) => {
    if (!origin) return true; // Allow non-browser requests (e.g. mobile apps, curl)

    // Parse configured allowed origins
    const allowed = String(config.socketCorsOrigin || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    const list = allowed.length > 0 ? allowed : ['https://k9rides.onrender.com'];

    if (list.includes('*') || list.includes(origin)) {
        return true;
    }

    try {
        const url = new URL(origin);
        if (
            url.hostname.endsWith('.vercel.app') ||
            url.hostname.endsWith('.k9rides.com') ||
            url.hostname === 'k9rides.com' ||
            // Service-Provider (Homster/Truliq) front-ends. Only the admin panel moves
            // into master's frontend; the user, vendor and worker apps stay on these
            // domains and keep calling this backend through the legacy /api prefixes.
            url.hostname.endsWith('.homster.in') ||
            url.hostname === 'homster.in' ||
            url.hostname.endsWith('.truliq.com') ||
            url.hostname === 'truliq.com' ||
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1'
        ) {
            return true;
        }
    } catch (_) { }

    return false;
};

