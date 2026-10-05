import dotenv from 'dotenv';

dotenv.config();

const sanitizeUploadBaseUrl = (value) => String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(https?):\/(?!\/)/i, '$1://')
    .replace(/\/+$/, '');

export const config = {
    // Basic server config
    port: process.env.PORT || 5000,
    host: process.env.HOST || '0.0.0.0',
    socketPort: process.env.SOCKET_PORT || 5001,
    socketHost: process.env.SOCKET_HOST || process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',

    /**
     * Public web app origin, used to build shareable links (e.g. rider referral invites).
     * REFERRAL_LINK_BASE_URL wins so links can point at a marketing/deep-link host that
     * differs from the app origin. Trailing slashes are stripped.
     */
    publicWebUrl: String(
        process.env.REFERRAL_LINK_BASE_URL || process.env.FRONTEND_URL || ''
    ).trim().replace(/\/+$/, ''),

    // Database
    mongodbUri: process.env.MONGO_URI || process.env.MONGODB_URI,

    // JWT
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
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

    // Rate limiting
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW || 15),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX || 2500),
    rateLimitDevMaxRequests: Number(process.env.RATE_LIMIT_DEV_MAX || 2000),
    authRateLimitWindowMinutes: Number(process.env.AUTH_RATE_LIMIT_WINDOW || 15),
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),
    authRateLimitDevMax: Number(process.env.AUTH_RATE_LIMIT_DEV_MAX || 100),

    // Security
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),

    // Uploads (local VPS storage — served by nginx, not Node)
    uploadStorageRoot: process.env.UPLOAD_STORAGE_ROOT
        || (process.env.NODE_ENV === 'production' ? '/var/www/uploads' : 'uploads'),
    uploadBaseUrl: sanitizeUploadBaseUrl(process.env.UPLOAD_BASE_URL)
        || (process.env.NODE_ENV === 'production' ? '/uploads' : '/uploads'),
    uploadMaxFileSizeBytes: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 5) * 1024 * 1024,
    uploadRateLimitWindowMinutes: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW || 15),
    uploadRateLimitMax: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 60),
    uploadRateLimitDevMax: Number(process.env.UPLOAD_RATE_LIMIT_DEV_MAX || 200),
    /** WebP output quality (1–100). 90 = high quality, small size reduction. */
    uploadWebpQuality: Number(process.env.UPLOAD_WEBP_QUALITY || 90),
    /** Max width in px; larger images are resized (aspect ratio kept). */
    uploadWebpMaxWidth: Number(process.env.UPLOAD_WEBP_MAX_WIDTH || 2560),
    /** @deprecated Use uploadStorageRoot — kept for backward compatibility */
    uploadPath: process.env.UPLOAD_PATH || process.env.UPLOAD_STORAGE_ROOT || '/var/www/uploads',

    // Redis
    // Auto-enable when REDIS_URL is set (SOP sets URL but often omits REDIS_ENABLED=true)
    redisEnabled: process.env.REDIS_ENABLED === 'true'
        || (!!process.env.REDIS_URL && process.env.REDIS_ENABLED !== 'false'),
    redisUrl: process.env.REDIS_URL,

    // BullMQ
    bullmqEnabled: process.env.BULLMQ_ENABLED === 'true',

    // Runtime roles / background jobs
    serverBackgroundJobsEnabled: process.env.SERVER_BACKGROUND_JOBS_ENABLED !== 'false',
    serverQueueBootstrapEnabled: process.env.SERVER_QUEUE_BOOTSTRAP_ENABLED !== 'false',

    // Storage (local VPS — legacy Cloudinary env vars no longer required)

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

    // Google Maps (Directions / Distance for delivery routing)
    googleMapsApiKey:
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.VITE_GOOGLE_MAPS_API_KEY ||
        '',

    // Socket.io
    socketCorsOrigin: process.env.SOCKET_CORS_ORIGIN || '*',

    // Razorpay (payments)
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET, // ✅ NEW

    // Email (SMTP) – for admin forgot password OTP etc.
    emailHost: process.env.EMAIL_HOST,
    emailPort: Number(process.env.EMAIL_PORT) || 587,
    emailUser: process.env.EMAIL_USER,
    emailPass: process.env.EMAIL_PASS ? String(process.env.EMAIL_PASS).replace(/\s/g, '') : '',
    emailFrom: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@example.com'
};
