import rateLimit, { MemoryStore } from 'express-rate-limit';
import { verifyAccessToken } from '../core/auth/token.util.js';
import { RedisStore } from 'rate-limit-redis';
import { config } from '../config/env.js';
import { getRedisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * A store that starts on in-memory limiting and upgrades itself to Redis once Redis
 * is actually connected.
 *
 * Why this exists at all: the limiters used to run on express-rate-limit's default
 * MemoryStore, which counts per PROCESS. Every instance, and every pm2 worker, kept
 * its own tally — so the real ceiling was the configured limit multiplied by however
 * many processes were running, and a restart reset it to zero.
 *
 * Why the indirection instead of constructing RedisStore at module load: this file is
 * imported (app.js -> route files) BEFORE connectRedis() runs in server.js, and
 * RedisStore's constructor eagerly fires an unawaited SCRIPT LOAD. With no connection
 * yet that promise rejects with nothing attached, which Node treats as an unhandled
 * rejection and kills the process on startup. Deferring construction to the first
 * real request — by which point Redis has long since connected — avoids it, and the
 * await inside increment() means a genuine failure is caught by passOnStoreError
 * rather than crashing.
 */
class LazyRedisStore {
    constructor(prefix) {
        this.prefix = prefix;
        this.memoryStore = new MemoryStore();
        this.redisStore = null;
        this.redisStoreFailed = false;
        this.options = null;
    }

    init(options) {
        this.options = options;
        this.memoryStore.init(options);
    }

    getActiveStore() {
        if (this.redisStore) return this.redisStore;
        if (this.redisStoreFailed || !config.redisEnabled) return this.memoryStore;

        const client = getRedisClient();
        if (!client || !client.isReady) return this.memoryStore;

        try {
            const store = new RedisStore({
                prefix: this.prefix,
                sendCommand: (...args) => client.sendCommand(args),
            });
            if (this.options) store.init(this.options);
            this.redisStore = store;
            logger.info(`Rate limiter: using Redis store (${this.prefix})`);
            return store;
        } catch (err) {
            this.redisStoreFailed = true;
            logger.warn(`Rate limiter: could not switch to Redis (${this.prefix}), staying on memory: ${err.message}`);
            return this.memoryStore;
        }
    }

    async increment(key) {
        try {
            return await this.getActiveStore().increment(key);
        } catch (err) {
            if (this.redisStore) {
                // Redis is live but this call failed (connection blip). Drop back to
                // memory rather than failing every request from here on.
                this.redisStoreFailed = true;
                this.redisStore = null;
                logger.warn(`Rate limiter: Redis error (${this.prefix}), falling back to memory: ${err.message}`);
                return this.memoryStore.increment(key);
            }
            throw err;
        }
    }

    async decrement(key) {
        return this.getActiveStore().decrement(key);
    }

    async resetKey(key) {
        return this.getActiveStore().resetKey(key);
    }
}

/**
 * Normalise an IP for use as a rate-limit key.
 *
 * IPv6 clients are routinely handed a whole /64, so keying on the full address lets
 * one host cycle through addresses and reset its bucket at will. Collapsing to the
 * first four hextets buckets the whole /64 together. IPv4 (including ::ffff: mapped
 * form) is used as-is.
 */
export const normaliseIp = (ip) => {
    if (!ip) return 'unknown';
    const raw = String(ip).replace(/^::ffff:/, '');
    if (!raw.includes(':')) return raw;
    return `${raw.split(':').slice(0, 4).join(':')}::/64`;
};

/**
 * Key by the VERIFIED user when there is one, else by IP.
 *
 * Indian mobile carriers and office networks put thousands of subscribers behind a
 * handful of NAT addresses, so a purely IP-keyed limiter makes them share one bucket:
 * a busy evening produces mass false 429s while a single abusive client on its own IP
 * stays under the limit.
 *
 * Only safe on limiters mounted AFTER authMiddleware, where req.user comes from a
 * verified JWT. Limiters that run before auth must stay IP-keyed, or an attacker
 * could mint unverifiable tokens to get a fresh bucket per request.
 */
export const identityKey = (req) => {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return userId ? `u:${userId}` : `ip:${normaliseIp(req.ip)}`;
};

/**
 * Payment webhooks must not be throttled by the global per-IP limiter.
 *
 * They arrive from a small set of provider IPs and are retried aggressively on
 * non-2xx. Counting them against one bucket means a burst of legitimate callbacks
 * starts returning 429, the provider reads that as failure, retries harder, and
 * payments silently stop reconciling. HMAC signature verification is their real gate.
 */
const isWebhookPath = (req) => (req.originalUrl || req.url || '').includes('/payments/webhook');

/**
 * The admin this request is VERIFIABLY from, or null.
 *
 * The global limiter runs before authMiddleware, and the warning on identityKey
 * above is the reason this verifies the signature rather than decoding the
 * token: an attacker who could get a fresh bucket by inventing a token would
 * have no limit at all. An unverifiable token simply falls through to the IP
 * bucket, so a forged one is never better than sending none.
 *
 * The cost is one HMAC check per request, which authMiddleware performs again
 * moments later -- cheap next to the Redis round trip already happening here.
 */
/** The signature-checked identity on the request, or null. Every vertical signs
 *  with the same access secret (userId for food/quick, sub for taxi). */
const verifiedIdentity = (req) => {
    const header = req.headers?.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    try {
        const claims = verifyAccessToken(header.slice(7).trim());
        const id = claims?.userId || claims?.id || claims?.sub || null;
        if (!id) return null;
        return { id: String(id), role: String(claims?.role || '').toUpperCase() };
    } catch {
        return null;
    }
};

const verifiedAdminId = (req) => {
    const who = verifiedIdentity(req);
    return who && who.role === 'ADMIN' ? who.id : null;
};

/*
 * An admin panel screen is dozens of calls -- badges, counters, lists, the
 * dashboard's several cards -- and a whole office shares one public IP. On the
 * shared IP bucket that lands on "Too many requests" during ordinary work, and
 * one busy admin locks out everyone beside them.
 *
 * A verified admin therefore gets their OWN bucket, and a larger one. It is not
 * a hole: the identity is signature-checked, so the only way to obtain this
 * bucket is to genuinely be an admin, and each admin is still bounded.
 */
const ADMIN_MAX = Number(process.env.RATE_LIMIT_ADMIN_MAX) || 5000;

/*
 * The same for every signed-in user -- rider, store, customer. The apps poll
 * (a rider going online checks its orders every few seconds), and a team or a
 * household on one Wi-Fi shares one public IP: on the shared IP bucket they
 * locked each other out with "Too many requests". Each verified user now has
 * their own bucket; only anonymous traffic is counted per IP.
 */
const USER_MAX = Number(process.env.RATE_LIMIT_USER_MAX) || 3000;

export const __testables = { verifiedAdminId, verifiedIdentity, ADMIN_MAX, USER_MAX };

const windowMs = config.rateLimitWindowMinutes * 60 * 1000;

export const apiRateLimiter = rateLimit({
    windowMs,
    // Dev UX: local UI can generate lots of background API calls (location, polling, etc).
    // Keep production strict, but avoid blocking local development.
    max: (req) => {
        if (config.nodeEnv === 'development') return Math.max(config.rateLimitMaxRequests, 2000);
        if (req.__rlAdminId) return ADMIN_MAX;
        if (req.__rlUserId) return USER_MAX;
        return config.rateLimitMaxRequests;
    },
    standardHeaders: true,
    legacyHeaders: false,
    // If the store errors, fail OPEN rather than 500-ing all API traffic.
    passOnStoreError: true,
    store: new LazyRedisStore('rl:api:'),
    /*
     * Keyed per admin once the token checks out, per IP otherwise. Resolved
     * here and stashed, because `max` above needs the same answer and the two
     * disagreeing would put an admin in one bucket and count them against
     * another's ceiling.
     */
    keyGenerator: (req) => {
        const who = verifiedIdentity(req);
        req.__rlAdminId = who && who.role === 'ADMIN' ? who.id : null;
        req.__rlUserId = who && who.role !== 'ADMIN' ? `${who.role || 'user'}:${who.id}` : null;
        if (req.__rlAdminId) return `admin:${req.__rlAdminId}`;
        if (req.__rlUserId) return `user:${req.__rlUserId}`;
        return normaliseIp(req.ip);
    },
    skip: isWebhookPath,
    message: {
        success: false,
        message: 'Too many requests, please try again later.',
    },
});

/**
 * Generous limiter for provider payment webhooks — a backstop against a runaway
 * retry loop, not an authentication mechanism.
 */
export const webhookRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: new LazyRedisStore('rl:webhook:'),
    keyGenerator: (req) => normaliseIp(req.ip),
    message: { success: false, message: 'Webhook rate limit exceeded.' },
});

const authWindowMs = config.authRateLimitWindowMinutes * 60 * 1000;

/** Stricter rate limit for auth routes (OTP, login, refresh, logout). */
export const authRateLimiter = rateLimit({
    windowMs: authWindowMs,
    // Dev UX: login/otp testing can be frequent. Production stays strict.
    max: config.nodeEnv === 'development' ? Math.max(config.authRateLimitMax, 100) : config.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: new LazyRedisStore('rl:auth:'),
    // Pre-authentication, so bucket by IP *and* the identifier being targeted.
    // Without the identifier one NAT'd carrier IP locks out every real user behind
    // it; without the IP an attacker sprays across many phone numbers. Keying on
    // both means neither dimension alone can exhaust the other's budget. Per-phone
    // issuance is additionally capped in core/otp/otpRateLimit.service.js.
    keyGenerator: (req) => {
        const identifier = req.body?.phone || req.body?.email || req.body?.username || '';
        return `${normaliseIp(req.ip)}|${String(identifier).trim().toLowerCase()}`;
    },
    message: {
        success: false,
        message: 'Too many authentication attempts. Please try again later.',
    },
});

/**
 * Money-moving and abuse-prone actions the generic limiter is too loose for: order
 * creation, payment verification, price calculation (a coupon-code oracle), wallet
 * topup. Mounted behind authMiddleware, so bucketed per user — 30 orders / 5 min is
 * a sane per-account ceiling but a hard outage if shared across one office NAT.
 */
export const sensitiveActionRateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: config.nodeEnv === 'development' ? 300 : 30,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: new LazyRedisStore('rl:sensitive:'),
    keyGenerator: identityKey,
    message: {
        success: false,
        message: 'Too many attempts. Please slow down and try again in a few minutes.',
    },
});

/**
 * High-frequency authenticated endpoints: driver location pings and order-status
 * polling. These fire every few seconds per active session by design, so they get a
 * dedicated per-user bucket rather than draining the global one — a driver on a long
 * delivery would otherwise exhaust the shared quota alone.
 */
export const realtimeRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: config.nodeEnv === 'development' ? 1000 : 120,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: new LazyRedisStore('rl:realtime:'),
    keyGenerator: identityKey,
    message: { success: false, message: 'Too many realtime updates. Please slow down.' },
});

/**
 * Registration / KYC upload (restaurant and delivery-partner signup with files).
 * Rare for a real user, attractive for spam and storage abuse, so the window is long
 * and the ceiling low. Pre-authentication, so IP is the only trustworthy signal.
 */
export const registrationRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.nodeEnv === 'development' ? 100 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: new LazyRedisStore('rl:register:'),
    keyGenerator: (req) => normaliseIp(req.ip),
    message: { success: false, message: 'Too many registration attempts. Please try again later.' },
});

/**
 * The restaurant signup upload, open to people who have no account yet. A
 * signup sends a dozen or so documents and photos, so the bound is generous
 * but it exists: anonymous callers could otherwise fill storage.
 */
export const uploadAttachmentRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.nodeEnv === 'development' ? 500 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: new LazyRedisStore('rl:upload-attachment:'),
    keyGenerator: (req) => normaliseIp(req.ip),
    message: { success: false, message: 'Too many uploads. Please try again later.' },
});

/** Which backing store the limiters are on. For the dev-only health endpoint. */
export const getRateLimitSummary = () => ({
    redisEnabled: config.redisEnabled,
    redisReady: Boolean(getRedisClient()?.isReady),
});
