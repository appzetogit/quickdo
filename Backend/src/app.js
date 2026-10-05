import { blockPrivateStatic, privateFileLinks, servePrivateFile } from './core/files/privateFiles.js';
import { config, isOriginAllowed } from './config/env.js';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoSanitize from 'mongo-sanitize';
import xssClean from 'xss-clean';
import routes from './routes/index.js';
import errorHandler from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { responseTimeLogger } from './middleware/responseTimeLogger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { healthCheck } from './config/health.js';


const app = express();

// Service-Provider (Homster) came in as a CJS app whose Mongoose models reject
// explicit nulls, so its integration added a global null-stripper. Global was too
// wide: every other vertical uses null to mean "clear this field", and having it
// deleted before the controller ran made those saves no-ops that still reported
// success -- e.g. an earning add-on could never be set back to unlimited
// redemptions. Scoped to the paths that actually needed it.
const SP_NULL_STRIP_PREFIXES = [
    '/api/v1/sp',
    '/api/users', '/api/user', '/api/vendors', '/api/workers', '/api/bookings',
    '/api/scrap', '/api/image', '/api/public'
];

const needsNullStrip = (p) => SP_NULL_STRIP_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));

const stripNullsDeep = (value) => {
    if (Array.isArray(value)) {
        return value.map(stripNullsDeep);
    }
    if (value && typeof value === 'object') {
        const next = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === null) continue;
            next[k] = stripNullsDeep(v);
        }
        return next;
    }
    return value;
};

// Trust first proxy (essential for express-rate-limit if behind a proxy)
app.set('trust proxy', 1);

// Request ID tracing (before other middlewares so all logs can use it)
app.use(requestIdMiddleware);

// Health endpoints (no rate limit, minimal JSON, no secrets)
app.get('/health', async (_req, res) => {
    try {
        const data = await healthCheck();
        // DEGRADED stays 200 so the instance keeps serving traffic while monitoring
        // alerts on it; only DOWN (no MongoDB) is a non-2xx, which is what the
        // post-deploy gate polls for.
        res.status(data.status === 'DOWN' ? 503 : 200).json(data);
    } catch (err) {
        res.status(503).json({ status: 'DOWN', error: 'Health check failed' });
    }
});
app.get('/ready', (_req, res) => {
    res.status(200).json({ status: 'ready' });
});

/**
 * Uploaded images.
 *
 * In production nginx serves this path straight off disk and never reaches
 * Node; this handler is the fallback that makes local dev work and keeps the
 * site serving if the nginx location block is ever missing — which is exactly
 * how food images broke before (URLs pointed at /uploads, nothing served it).
 *
 * Mounted ahead of helmet and the body parsers deliberately: these are plain
 * image bytes, so they need neither, and helmet's default same-origin resource
 * policy would block the Flutter app and any cross-origin admin build from
 * loading them. Filenames are content-random and never reused, so the long
 * immutable cache is safe.
 */
app.use(
    '/uploads',
    // Identity documents are never served from here (see core/files/privateFiles.js).
    blockPrivateStatic,
    (_req, res, next) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        next();
    },
    express.static(path.resolve(config.uploadStorageRoot), {
        maxAge: '1y',
        immutable: true,
        index: false,
        fallthrough: false
    })
);

// Security & parsing middlewares
app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
    hsts: config.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    xssFilter: true,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({
    limit: config.requestJsonLimit,
    verify: (req, res, buf) => {
        // ✅ Store rawBody for signature verification (Razorpay Webhooks)
        if (req.originalUrl && req.originalUrl.includes('/webhook/razorpay')) {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true, limit: config.requestUrlencodedLimit }));

// Protect against NoSQL injection and XSS
app.use((req, _res, next) => {
    req.body = mongoSanitize(req.body);
    req.query = mongoSanitize(req.query);
    req.params = mongoSanitize(req.params);
    if (needsNullStrip(req.path)) {
        req.body = stripNullsDeep(req.body);
        req.query = stripNullsDeep(req.query);
        req.params = stripNullsDeep(req.params);
    }
    next();
});

// xss-clean HTML-escapes every string in the body. That is right for the whole API
// except the CMS pages, whose `content` field is stored as HTML by design and
// rendered with dangerouslySetInnerHTML. Escaping it turned an admin's saved markup
// into visible tags, and because each save re-escaped the previous one, the damage
// compounded on every edit. Admin-only and role-gated, so the exemption is narrow.
const xssCleanMiddleware = xssClean();
const CMS_HTML_PATH = /\/admin\/pages-social-media\//;
app.use((req, res, next) => {
    if (CMS_HTML_PATH.test(req.path)) return next();
    return xssCleanMiddleware(req, res, next);
});

// Global rate limiting for API routes
app.use('/api', apiRateLimiter);

// Optional: log API response time (method, path, status, duration) - no sensitive data
app.use('/api', responseTimeLogger);

// API Routes
// Identity documents: signed links in every API response, and the one route
// that opens them (core/files/privateFiles.js).
app.get('/api/v1/files/p/*', servePrivateFile);
app.use('/api', privateFileLinks);
app.use('/api', routes);

// Error Handling
app.use(errorHandler);

export default app;
