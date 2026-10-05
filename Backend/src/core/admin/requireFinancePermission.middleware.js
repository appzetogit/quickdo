import { sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/env.js';
import { decide, FINANCE_ACTIONS } from './financeAuthz.js';
import { AdminAudit } from './models/adminAudit.model.js';

/**
 * Mount this on anything that moves money.
 *
 * Two jobs, both currently unperformed anywhere in the platform:
 *
 *   1. check that this particular admin is allowed to do this particular thing
 *      (a role check is not that -- every admin has the same role);
 *   2. leave a row saying they did it, so a balance that changed overnight has an
 *      attributable cause.
 *
 * The outcome is recorded on response finish rather than up front, so the audit
 * reflects what actually happened -- including a handler that threw. That makes it
 * honest but NOT atomic with the money move: a process killed between the mutation
 * and the response leaves the money moved and no row. Closing that needs the audit
 * write inside each handler's own transaction, which is the follow-up; this is the
 * part that can be had without touching fourteen handlers.
 *
 * Fails CLOSED on an infrastructure error (admin lookup throws) but only while
 * enforcing -- in tolerant mode an outage in this middleware must not take the
 * withdrawal queue down with it.
 *
 * KNOWN GAP, to close before FINANCE_PERMISSIONS_ENFORCED is switched on: this
 * reads master's `admins` collection, and quick-commerce has its own admins in
 * `qc_admins` with an incompatible permissions shape (a nested object rather than
 * a flat array). A QC-native admin is therefore absent here. Tolerant mode records
 * them as a violation and lets them through, which is correct for now -- but
 * enforcing would refuse them, and QC's own admins would lose their money routes.
 * The admin identities must merge first. See
 * modules/quickCommerce/core/roles/adminPermission.middleware.js.
 */

const resolveActorId = (req) =>
    req.user?.userId || req.user?.id || req.user?._id || req.auth?.sub || null;

/** Best-effort: who the money belongs to, from wherever this route puts it. */
const resolveTarget = (req) =>
    String(
        req.params?.deliveryPartnerId
        ?? req.params?.partnerId
        ?? req.params?.driverId
        ?? req.params?.id
        ?? req.body?.deliveryPartnerId
        ?? req.body?.driverId
        ?? req.body?.deliveryId
        ?? '',
    );

const recordOutcome = (row, res) => {
    res.on('finish', () => {
        const status = res.statusCode;
        AdminAudit.create({
            ...row,
            statusCode: status,
            outcome: status >= 200 && status < 300 ? 'succeeded' : status >= 400 && status < 500 ? 'rejected' : 'failed',
        }).catch((err) => {
            // An audit that cannot be written must be shouted about, not swallowed:
            // the whole value of this row is that somebody can find it later.
            logger.error(`AUDIT WRITE FAILED for ${row.method} ${row.path} by ${row.actorId}: ${err.message}`);
        });
    });
};

export const requireFinancePermission = (actionKey) => {
    if (!FINANCE_ACTIONS[actionKey]) {
        // Thrown at mount time, not request time -- a typo in a route file should
        // fail the boot, not silently permit money to move unchecked.
        throw new Error(`requireFinancePermission: unknown action "${actionKey}"`);
    }

    return async (req, res, next) => {
        const enforcing = Boolean(config.financePermissionsEnforced);
        const actorId = resolveActorId(req);
        const spec = FINANCE_ACTIONS[actionKey];
        const reason = String(req.body?.reason || req.body?.note || '').trim();

        let admin = null;
        try {
            if (actorId) {
                const { FoodAdmin } = await import('./admin.model.js');
                admin = await FoodAdmin.findById(actorId)
                    .select('permissions adminLevel module servicesAccess email role isActive isDeleted')
                    .lean();
            }
        } catch (err) {
            logger.error(`finance authz lookup failed for ${actorId}: ${err.message}`);
            if (enforcing) return sendError(res, 503, 'Authorization check unavailable');
            // Tolerant mode: carry on with admin=null, which decide() treats as
            // unauthenticated -- but see below, we only log it.
        }

        const verdict = decide(admin, actionKey, {
            enforcing,
            reason,
            // Reason is advisory until enforcement starts, so the admin panel can
            // ship its reason field in a separate release from this one.
            requireReason: enforcing,
        });

        const row = {
            actorId: admin?._id || (actorId || undefined),
            actorEmail: admin?.email || '',
            actorRole: admin?.role || req.user?.role || '',
            resource: spec.resource,
            action: spec.action,
            permitted: verdict.permitted,
            toleratedViolation: verdict.tolerated,
            method: req.method,
            path: req.originalUrl || req.url,
            targetType: spec.targetType,
            targetId: resolveTarget(req),
            reason,
            clientRequestId: String(req.get?.('idempotency-key') || req.body?.clientRequestId || ''),
            requestId: req.id || req.requestId || '',
            ip: req.ip || '',
        };

        if (verdict.tolerated) {
            logger.warn(
                `FINANCE AUTHZ (tolerated): ${row.actorEmail || actorId} lacks ${spec.resource}.${spec.action} `
                + `but was allowed through on ${row.method} ${row.path}. Grant it before enforcement is enabled.`,
            );
        }

        if (!verdict.allow) {
            // Record the refusal too -- a denied attempt to move money is exactly
            // the kind of thing somebody will later want to know about.
            AdminAudit.create({ ...row, statusCode: verdict.status, outcome: 'rejected' }).catch((err) =>
                logger.error(`AUDIT WRITE FAILED (denial) for ${row.path}: ${err.message}`),
            );
            return sendError(res, verdict.status, verdict.message);
        }

        req.financeActor = { adminId: row.actorId, email: row.actorEmail, reason, actionKey };
        recordOutcome(row, res);
        return next();
    };
};
