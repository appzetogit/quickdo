import { AdminAudit } from './models/adminAudit.model.js';
import { redactForAudit, collectTargetIds } from './auditRedact.js';
import { logger } from '../../utils/logger.js';

/**
 * Admin activity log (SOW plan 2.7): one row for every admin write, on every panel.
 *
 * Mounted once at the top of the API router (routes/index.js), ahead of every
 * vertical's own authentication, rather than next to each panel's
 * enforceAdminAccess. Each panel authenticates differently (food and quick commerce
 * set req.user.role 'ADMIN', taxi sets req.auth.role 'admin', service provider sets
 * req.user from its own admins), and every one of them has finished by the time the
 * response is sent -- so the row is written on 'finish', when the caller's identity
 * and the real outcome are both known. A handler that throws still leaves a row,
 * with its 4xx/5xx status.
 *
 * What is recorded: method, path, module, the admin, the ids the request named, a
 * REDACTED body summary (auditRedact.js), status, outcome, ip and duration.
 * What is never recorded: passwords, OTPs, tokens, keys, card or bank numbers.
 *
 * Money moves are already recorded, with the permission decision, by
 * requireFinancePermission; it marks the request so this does not write a second row.
 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const VERB = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

// The old service-provider server's top-level prefixes, still served (routes/index.js).
const SP_LEGACY = ['admin', 'users', 'user', 'vendors', 'workers', 'bookings', 'payments', 'notifications', 'public', 'scrap', 'image'];

/** Which panel a path belongs to. */
export const moduleForPath = (url = '') => {
    const segs = String(url).split('?')[0].split('/').filter(Boolean);
    if (segs[0] === 'api') segs.shift();
    if (segs[0] === 'v1') {
        switch (segs[1]) {
            case 'food': return 'food';
            case 'qc': return 'quickCommerce';
            case 'taxi': return 'taxi';
            case 'sp': return 'serviceProvider';
            default: return 'platform';
        }
    }
    if (SP_LEGACY.includes(segs[0])) return 'serviceProvider';
    return 'platform';
};

/**
 * The section of the panel that was written to: the first meaningful segment after
 * the admin prefix, e.g. /v1/food/admin/restaurants/:id/approve -> 'restaurants'.
 */
export const resourceForPath = (url = '') => {
    const segs = String(url).split('?')[0].split('/').filter(Boolean)
        .filter((s) => !['api', 'v1', 'food', 'qc', 'taxi', 'sp', 'platform', 'admin'].includes(s));
    const first = segs.find((s) => !/^[a-f0-9]{24}$/i.test(s));
    return (first || '').slice(0, 60);
};

const ADMIN_ROLE = /admin/i;

/** Who made the request, from whichever auth middleware ran. */
export const resolveAdminActor = (req) => {
    const id = req.user?.userId || req.user?.id || (req.user?._id ? String(req.user._id) : '') || req.auth?.sub || '';
    const role = req.user?.role || req.auth?.originalRole || req.auth?.role || req.userRole || '';
    return {
        id: String(id || ''),
        role: String(role || ''),
        email: String(req.user?.email || req.admin?.email || ''),
        isAdmin: ADMIN_ROLE.test(String(role || '')),
    };
};

const outcomeFor = (status) => (status >= 200 && status < 400 ? 'succeeded' : status >= 400 && status < 500 ? 'rejected' : 'failed');

const isObjectId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));

/** Best-effort email for the actor. Never throws, never blocks the response. */
const lookupEmail = async (actorId) => {
    if (!isObjectId(actorId)) return '';
    try {
        const { loadAdminCached } = await import('../../modules/food/admin/middlewares/foodAdmin.middleware.js');
        const admin = await loadAdminCached(actorId);
        return admin?.email || '';
    } catch {
        return '';
    }
};

export const buildActivityRow = (req, res, { startedAt = Date.now() } = {}) => {
    const actor = resolveAdminActor(req);
    const path = req.originalUrl || req.url || '';
    const status = res.statusCode || 0;
    const targetIds = collectTargetIds({ path, params: req.params, body: req.body });
    return {
        kind: 'activity',
        module: moduleForPath(path),
        actorId: isObjectId(actor.id) ? actor.id : undefined,
        actorEmail: actor.email,
        actorRole: actor.role,
        resource: resourceForPath(path),
        action: VERB[req.method] || String(req.method || '').toLowerCase(),
        permitted: status !== 403 && status !== 401,
        method: req.method,
        path: path.split('?')[0].slice(0, 500),
        targetId: targetIds[0] || '',
        targetIds,
        bodySummary: redactForAudit(req.body, req.files || req.file),
        outcome: outcomeFor(status),
        statusCode: status,
        requestId: String(req.id || req.requestId || ''),
        ip: req.ip || '',
        durationMs: Math.max(0, Date.now() - startedAt),
    };
};

export const adminActivityLog = (req, res, next) => {
    if (!WRITE_METHODS.has(req.method)) return next();
    const startedAt = Date.now();
    res.on('finish', () => {
        if (req.adminAuditHandled) return; // the finance row already covers it
        const actor = resolveAdminActor(req);
        // Only authenticated admins: anonymous and customer/partner writes are not admin activity.
        if (!actor.id || !actor.isAdmin) return;
        let row;
        try {
            row = buildActivityRow(req, res, { startedAt });
        } catch (err) {
            logger.error(`ADMIN ACTIVITY LOG: could not build row for ${req.method} ${req.originalUrl}: ${err.message}`);
            return;
        }
        (async () => {
            if (!row.actorEmail) row.actorEmail = await lookupEmail(actor.id);
            await AdminAudit.create(row);
        })().catch((err) => {
            logger.error(`ADMIN ACTIVITY LOG WRITE FAILED for ${row.method} ${row.path} by ${actor.id}: ${err.message}`);
        });
    });
    return next();
};
