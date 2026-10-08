/**
 * Admin activity log retention (core/admin/auditRetention.js).
 *
 * Run: node tests/audit-retention.smoke.mjs
 *
 * Isolated in-memory MongoDB.
 *   - defaults: activity rows kept 365 days, finance rows 2555;
 *   - the nightly purge deletes activity rows past their period and keeps
 *     finance rows (including old rows with no `kind`) until theirs;
 *   - a changed setting applies on the next purge; the floors (30 / 365) and
 *     "finance never shorter than activity" hold even if a value slips past;
 *   - the registry refuses a period below its minimum;
 *   - the purge runs once per night across instances, and not before 03:00 IST;
 *   - GET /v1/platform/audit-log/retention reports what is in effect.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const DAY = 24 * 3600 * 1000;

const main = async () => {
    const server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { dbName: 'audit_retention' });

    const { AdminAudit } = await import('../src/core/admin/models/adminAudit.model.js');
    const retention = await import('../src/core/admin/auditRetention.js');
    const resolver = await import('../src/core/config/resolver.service.js');
    const { PlatformSetting } = await import('../src/core/config/setting.model.js');

    const now = new Date('2026-10-08T00:00:00Z'); // 05:30 IST -- due
    const ago = (days) => new Date(now.getTime() - days * DAY);
    const seed = async () => {
        await AdminAudit.deleteMany({});
        const rows = [
            { kind: 'activity', path: '/a/400', createdAt: ago(400) },
            { kind: 'activity', path: '/a/200', createdAt: ago(200) },
            { kind: 'activity', path: '/a/40', createdAt: ago(40) },
            { kind: 'activity', path: '/a/10', createdAt: ago(10) },
            { kind: 'finance', path: '/f/3000', createdAt: ago(3000) },
            { kind: 'finance', path: '/f/1000', createdAt: ago(1000) },
            { kind: 'finance', path: '/f/400', createdAt: ago(400) },
        ];
        // timestamps:true would overwrite createdAt; insert through the driver.
        await AdminAudit.collection.insertMany(rows.map((r) => ({ ...r, updatedAt: r.createdAt })));
        // A pre-2.7 row: no kind at all. It is a finance row.
        await AdminAudit.collection.insertOne({ path: '/legacy/1000', createdAt: ago(1000), updatedAt: ago(1000) });
    };
    const paths = async () => (await AdminAudit.find({}).select('path').lean()).map((r) => r.path).sort();

    await check('defaults: 365 days for activity, 2555 for finance', async () => {
        const r = await retention.auditRetention();
        assert.equal(r.retentionDays, 365);
        assert.equal(r.financeRetentionDays, 2555);
    });

    await check('purge deletes activity rows past 365 days and only finance rows past 2555', async () => {
        await seed();
        const out = await retention.purgeExpiredAudits({ now });
        assert.deepEqual(out.deleted, { activity: 1, finance: 1 });
        assert.deepEqual(await paths(), ['/a/10', '/a/200', '/a/40', '/f/1000', '/f/400', '/legacy/1000']);
    });

    await check('a row with no kind is kept as a finance row, not purged at the activity period', async () => {
        assert.ok((await paths()).includes('/legacy/1000'));
    });

    await check('a changed setting applies on the next purge', async () => {
        await seed();
        await resolver.set('audit.retentionDays', { level: 'global', value: 30, updatedBy: 'test' });
        await resolver.set('audit.financeRetentionDays', { level: 'global', value: 730, updatedBy: 'test' });
        const out = await retention.purgeExpiredAudits({ now });
        assert.equal(out.retentionDays, 30);
        assert.equal(out.financeRetentionDays, 730);
        assert.deepEqual(await paths(), ['/a/10', '/f/400']);
    });

    await check('the registry refuses a period below its minimum', async () => {
        await assert.rejects(() => resolver.set('audit.retentionDays', { level: 'global', value: 7 }), /at least 30/);
        await assert.rejects(() => resolver.set('audit.financeRetentionDays', { level: 'global', value: 100 }), /at least 365/);
        await assert.rejects(() => resolver.set('audit.retentionDays', { level: 'vertical', scopeId: 'food', value: 60 }), /cannot be set at the vertical level/);
    });

    await check('floors hold even for a value written around the registry; finance never shorter than activity', async () => {
        await PlatformSetting.updateOne({ level: 'global', scopeId: '*', key: 'audit.retentionDays' }, { $set: { value: 5 } });
        resolver.invalidateCache();
        let r = await retention.auditRetention();
        assert.equal(r.retentionDays, 30);
        await resolver.set('audit.retentionDays', { level: 'global', value: 1000 });
        await resolver.set('audit.financeRetentionDays', { level: 'global', value: 400 });
        r = await retention.auditRetention();
        assert.equal(r.retentionDays, 1000);
        assert.equal(r.financeRetentionDays, 1000);
        await resolver.set('audit.retentionDays', { level: 'global', value: null });
        await resolver.set('audit.financeRetentionDays', { level: 'global', value: null });
    });

    await check('the nightly purge is not due before 03:00 IST', async () => {
        const early = new Date('2026-10-07T20:00:00Z'); // 01:30 IST
        assert.equal(await retention.runAuditPurgeIfDue({ now: early }), null);
        assert.equal(await retention.AdminAuditPurgeRun.countDocuments({}), 0);
    });

    await check('it runs once per night across instances', async () => {
        await seed();
        const [a, b] = await Promise.all([
            retention.runAuditPurgeIfDue({ now }),
            retention.runAuditPurgeIfDue({ now }),
        ]);
        const ran = [a, b].filter(Boolean);
        assert.equal(ran.length, 1, 'exactly one instance claims the night');
        assert.deepEqual(ran[0].deleted, { activity: 1, finance: 1 });
        assert.equal(await retention.runAuditPurgeIfDue({ now: new Date(now.getTime() + 3600 * 1000) }), null, 'same night later: skipped');
        const runs = await retention.AdminAuditPurgeRun.find({}).lean();
        assert.equal(runs.length, 1);
        assert.equal(runs[0].status, 'done');
    });

    await check('GET /retention reports what is in effect and the last purge', async () => {
        // The route module's own auth chain is exercised in admin-audit-log.smoke;
        // here the overview it serves.
        const ov = await retention.auditRetentionOverview();
        assert.equal(ov.retentionDays, 365);
        assert.equal(ov.financeRetentionDays, 2555);
        assert.equal(ov.lastPurge.night, '2026-10-08');
        assert.deepEqual(ov.lastPurge.deleted, { activity: 1, finance: 1 });
        assert.equal(ov.source.activity, 'Registered default');
    });

    await check('the route is mounted on the audit-log router', async () => {
        const router = (await import('../src/core/admin/adminAuditLog.routes.js')).default;
        const paths = router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
        assert.ok(paths.includes('get /retention'), paths.join(', '));
        // Behind the same superadmin gate as the log: anonymous is refused.
        const app = express();
        app.use('/v1/platform/audit-log', router);
        const srv = http.createServer(app).listen(0);
        try {
            const res = await fetch(`http://127.0.0.1:${srv.address().port}/v1/platform/audit-log/retention`);
            assert.ok([401, 403].includes(res.status), `status ${res.status}`);
        } finally {
            srv.close();
        }
    });

    await mongoose.disconnect();
    await server.stop();
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall audit retention checks passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
