import os from 'node:os';
import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { AdminAudit } from './models/adminAudit.model.js';

/**
 * How long the admin activity log keeps its rows, and the nightly purge.
 *
 * Two periods (Master settings, core/config/registry.js):
 *   audit.retentionDays           activity rows   default 365,  min 30
 *   audit.financeRetentionDays    finance rows    default 2555 (about 7 years), min 365
 *
 * Why a purge job and not a MongoDB TTL index: a TTL index has one
 * expireAfterSeconds for every row it covers, and finance rows must outlive
 * activity rows. Two partial TTL indexes on the same createdAt key are not
 * allowed, rows written before 2.7 carry no `kind` at all (and are finance
 * rows), and an index's expiry would need a collMod each time an admin changes
 * the setting on a running cluster. A nightly delete reads the setting when it
 * runs, so a change simply applies from the next night.
 *
 * Run once per night across instances: the first instance to insert the
 * night's claim row runs it, the rest see the duplicate key and skip -- the
 * same pattern as the insights job.
 */

const DAY_MS = 24 * 3600 * 1000;
const FLOOR = { activity: 30, finance: 365 };

const runSchema = new mongoose.Schema(
    {
        night: { type: String, required: true, unique: true },
        host: { type: String, default: '' },
        status: { type: String, default: 'running' },
        startedAt: { type: Date },
        finishedAt: { type: Date },
        retentionDays: { type: Number },
        financeRetentionDays: { type: Number },
        deleted: { activity: Number, finance: Number },
        error: { type: String, default: '' },
    },
    { collection: 'admin_audit_purge_runs', timestamps: true },
);
// The run history keeps itself short.
runSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const AdminAuditPurgeRun =
    mongoose.models.AdminAuditPurgeRun || mongoose.model('AdminAuditPurgeRun', runSchema);

/** The periods in effect. Never below the floors, and finance never shorter than activity. */
export async function auditRetention() {
    let activity = 365;
    let finance = 2555;
    let source = { activity: 'Registered default', finance: 'Registered default' };
    try {
        const { getMany } = await import('../config/resolver.service.js');
        const r = await getMany(['audit.retentionDays', 'audit.financeRetentionDays']);
        activity = Number(r['audit.retentionDays']?.value) || activity;
        finance = Number(r['audit.financeRetentionDays']?.value) || finance;
        source = { activity: r['audit.retentionDays']?.source || source.activity, finance: r['audit.financeRetentionDays']?.source || source.finance };
    } catch (err) {
        logger.warn(`auditRetention: settings read failed, using defaults: ${err.message}`);
    }
    activity = Math.max(FLOOR.activity, Math.round(activity));
    finance = Math.max(FLOOR.finance, Math.round(finance), activity);
    return { retentionDays: activity, financeRetentionDays: finance, source };
}

/*
 * Finance rows are kind 'finance' OR have no kind (written before activity rows
 * existed). Everything else is an activity row. Written as two complementary
 * filters so no row can fall between them.
 */
const FINANCE = { $or: [{ kind: 'finance' }, { kind: { $exists: false } }, { kind: null }] };
const ACTIVITY = { kind: { $exists: true, $nin: ['finance', null] } };

/** Delete every row past its period. Returns counts. */
export async function purgeExpiredAudits({ now = new Date() } = {}) {
    const { retentionDays, financeRetentionDays } = await auditRetention();
    const activityCutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    const financeCutoff = new Date(now.getTime() - financeRetentionDays * DAY_MS);
    const [a, f] = await Promise.all([
        AdminAudit.deleteMany({ ...ACTIVITY, createdAt: { $lt: activityCutoff } }),
        AdminAudit.deleteMany({ ...FINANCE, createdAt: { $lt: financeCutoff } }),
    ]);
    const deleted = { activity: a.deletedCount || 0, finance: f.deletedCount || 0 };
    return { retentionDays, financeRetentionDays, activityCutoff, financeCutoff, deleted };
}

const istDay = (now) => new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const isDue = (now) => new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCHours() >= 3;

/** Run tonight's purge if due (after 03:00 IST) and nobody has. Safe to call often. */
export async function runAuditPurgeIfDue({ now = new Date(), force = false } = {}) {
    if (!force && !isDue(now)) return null;
    const night = istDay(now);
    let claim;
    try {
        claim = await AdminAuditPurgeRun.create({ night, host: os.hostname(), startedAt: now });
    } catch (err) {
        if (err?.code === 11000) return null; // another instance has tonight
        throw err;
    }
    try {
        const result = await purgeExpiredAudits({ now });
        await AdminAuditPurgeRun.updateOne({ _id: claim._id }, {
            $set: {
                status: 'done',
                finishedAt: new Date(),
                retentionDays: result.retentionDays,
                financeRetentionDays: result.financeRetentionDays,
                deleted: result.deleted,
            },
        });
        logger.info(`[AuditRetention] ${night}: deleted ${result.deleted.activity} activity and ${result.deleted.finance} finance row(s)`);
        return { night, ...result };
    } catch (err) {
        await AdminAuditPurgeRun.updateOne({ _id: claim._id }, { $set: { status: 'failed', finishedAt: new Date(), error: err.message } });
        throw err;
    }
}

/** For the Admin Activity Log page: what is kept, and when the purge last ran. */
export async function auditRetentionOverview() {
    const [retention, last] = await Promise.all([
        auditRetention(),
        AdminAuditPurgeRun.findOne({ status: 'done' }).sort({ startedAt: -1 }).lean(),
    ]);
    return {
        ...retention,
        lastPurge: last
            ? { night: last.night, at: last.finishedAt || last.startedAt, deleted: last.deleted || { activity: 0, finance: 0 } }
            : null,
    };
}

/** Every 30 minutes; purges once per night after 03:00 India time. Off with AUDIT_RETENTION_ENABLED=false. */
export const startAuditRetentionNightly = () => {
    if (process.env.AUDIT_RETENTION_ENABLED === 'false') return null;
    let busy = false;
    const tick = async () => {
        if (busy) return;
        busy = true;
        try {
            await runAuditPurgeIfDue();
        } catch (err) {
            logger.error(`[AuditRetention] nightly tick failed: ${err.message}`);
        } finally {
            busy = false;
        }
    };
    setTimeout(tick, 90 * 1000).unref?.();
    logger.info('Admin activity log retention scheduled (after 03:00 IST, once per night across instances)');
    const handle = setInterval(tick, 30 * 60 * 1000);
    handle.unref?.();
    return handle;
};
