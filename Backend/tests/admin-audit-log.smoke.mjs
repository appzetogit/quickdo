/**
 * Admin activity log (SOW plan 2.7).
 *
 * Run: node tests/admin-audit-log.smoke.mjs
 *
 * Isolated in-memory MongoDB replica set. Drives the real middleware through a
 * real HTTP server, with each panel's own way of identifying its admin (food /
 * quick commerce req.user.role 'ADMIN', taxi req.auth, service provider req.user
 * from its own admins), then reads the rows back through the real list endpoint.
 *
 *   - every admin write leaves exactly one row; reads, customers and anonymous
 *     callers leave none;
 *   - a money move audited by requireFinancePermission is not logged twice;
 *   - a rejected or failed write is logged with its outcome;
 *   - NO secret ever reaches the row: passwords, OTPs, tokens, keys, card and bank
 *     numbers are redacted wherever they sit in the body;
 *   - the list endpoint filters by admin, module, action and date, paginates, and
 *     refuses sub-admins.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

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
const settle = () => new Promise((r) => setTimeout(r, 150)); // rows are written on 'finish'

const SECRETS = [
    'Sup3r-Secret-Pass', 'smtp-app-password', '482913', 'tok_live_abcdef', 'rzp_live_ABCDEF123456',
    '4111111111111111', '4111 1111 1111 1111', '123456789012', 'HDFC0001234', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', '9988',
];

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'admin_audit_log' });

    const { adminActivityLog } = await import('../src/core/admin/adminActivityLog.middleware.js');
    const { redactForAudit, REDACTED } = await import('../src/core/admin/auditRedact.js');
    const { requireFinancePermission } = await import('../src/core/admin/requireFinancePermission.middleware.js');
    const { AdminAudit } = await import('../src/core/admin/models/adminAudit.model.js');
    const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
    const { signAccessToken } = await import('../src/core/auth/token.util.js');
    const auditRoutes = (await import('../src/core/admin/adminAuditLog.routes.js')).default;

    const superAdmin = await FoodAdmin.create({ email: 'owner@qd.test', password: 'OwnerPass1!', name: 'Owner', role: 'ADMIN', isActive: true, adminLevel: 'platform_superadmin', admin_type: 'superadmin', permissions: ['*'], servicesAccess: ['food', 'quickCommerce', 'taxi', 'serviceProvider'] });
    const subAdmin = await FoodAdmin.create({ email: 'sub@qd.test', password: 'SubPass1!', name: 'Sub', role: 'ADMIN', isActive: true, adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: superAdmin._id, module: 'food', permissions: ['orders.read'], servicesAccess: ['food'] });

    // A stand-in for each panel's own auth, driven by test headers.
    const fakeAuth = (req, _res, next) => {
        const who = req.get('x-test-who');
        if (who === 'food-admin') req.user = { userId: String(superAdmin._id), role: 'ADMIN' };
        if (who === 'sub-admin') req.user = { userId: String(subAdmin._id), role: 'ADMIN' };
        if (who === 'taxi-admin') req.auth = { sub: String(superAdmin._id), role: 'admin', originalRole: 'super-admin' };
        if (who === 'sp-admin') req.user = { _id: superAdmin._id, id: String(superAdmin._id), role: 'super_admin', email: 'owner@qd.test' };
        if (who === 'customer') req.user = { userId: String(new mongoose.Types.ObjectId()), role: 'USER' };
        next();
    };

    const app = express();
    app.use(express.json());
    const api = express.Router();
    api.use(adminActivityLog); // mounted where routes/index.js mounts it: before every panel
    api.use('/v1/platform/audit-log', auditRoutes);
    api.use(fakeAuth);
    api.post('/v1/food/admin/restaurants/:id/approve', (req, res) => res.json({ success: true }));
    api.patch('/v1/platform/settings/profile', (req, res) => res.json({ success: true }));
    api.post('/v1/qc/admin/products', (req, res) => res.status(400).json({ success: false, message: 'Name is required' }));
    api.delete('/v1/taxi/admin/drivers/:id', (req, res) => res.json({ success: true }));
    api.post('/admin/vendors/:id/approve', (req, res) => res.json({ success: true }));
    api.get('/v1/food/admin/orders', (req, res) => res.json({ success: true }));
    api.post('/v1/food/orders', (req, res) => res.json({ success: true }));
    api.post('/v1/food/admin/explode', () => { throw new Error('boom'); });
    api.patch('/v1/food/admin/withdrawals/:id', requireFinancePermission('WITHDRAWAL_DECIDE'), (req, res) => res.json({ success: true }));
    app.use('/api', api);
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'Internal server error' }));

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (method, path, { who, body, token } = {}) => {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(who ? { 'x-test-who': who } : {}),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json().catch(() => null) };
    };

    const restaurantId = String(new mongoose.Types.ObjectId());
    console.log('\nwhat gets a row');
    await check('a food admin write: one row with method, path, module, admin, target id, status, ip', async () => {
        await call('POST', `/v1/food/admin/restaurants/${restaurantId}/approve`, { who: 'food-admin', body: { note: 'looks fine' } });
        await settle();
        const rows = await AdminAudit.find({ path: `/api/v1/food/admin/restaurants/${restaurantId}/approve` }).lean();
        assert.equal(rows.length, 1);
        const [r] = rows;
        assert.equal(r.kind, 'activity');
        assert.equal(r.module, 'food');
        assert.equal(r.method, 'POST');
        assert.equal(r.action, 'create');
        assert.equal(r.resource, 'restaurants');
        assert.equal(String(r.actorId), String(superAdmin._id));
        assert.equal(r.actorEmail, 'owner@qd.test');
        assert.ok(r.targetIds.includes(restaurantId));
        assert.equal(r.statusCode, 200);
        assert.equal(r.outcome, 'succeeded');
        assert.ok(r.ip);
        assert.deepEqual(r.bodySummary, { note: 'looks fine' });
    });
    await check('taxi (req.auth) and service-provider legacy (/admin/...) admins are logged under their module', async () => {
        const driverId = String(new mongoose.Types.ObjectId());
        const vendorId = String(new mongoose.Types.ObjectId());
        await call('DELETE', `/v1/taxi/admin/drivers/${driverId}`, { who: 'taxi-admin' });
        await call('POST', `/admin/vendors/${vendorId}/approve`, { who: 'sp-admin', body: {} });
        await settle();
        const taxi = await AdminAudit.findOne({ targetIds: driverId }).lean();
        assert.equal(taxi.module, 'taxi');
        assert.equal(taxi.action, 'delete');
        const sp = await AdminAudit.findOne({ targetIds: vendorId }).lean();
        assert.equal(sp.module, 'serviceProvider');
        assert.equal(sp.actorEmail, 'owner@qd.test');
    });
    await check('a rejected (4xx) and a failed (5xx) admin write are logged with their outcome', async () => {
        await call('POST', '/v1/qc/admin/products', { who: 'food-admin', body: { price: 10 } });
        await call('POST', '/v1/food/admin/explode', { who: 'food-admin', body: {} });
        await settle();
        const qc = await AdminAudit.findOne({ path: '/api/v1/qc/admin/products' }).lean();
        assert.equal(qc.module, 'quickCommerce');
        assert.equal(qc.outcome, 'rejected');
        assert.equal(qc.statusCode, 400);
        const boom = await AdminAudit.findOne({ path: '/api/v1/food/admin/explode' }).lean();
        assert.equal(boom.outcome, 'failed');
        assert.equal(boom.statusCode, 500);
    });
    await check('reads, customer writes and anonymous writes leave no row', async () => {
        const before = await AdminAudit.countDocuments();
        await call('GET', '/v1/food/admin/orders', { who: 'food-admin' });
        await call('POST', '/v1/food/orders', { who: 'customer', body: { items: [] } });
        await call('POST', `/v1/food/admin/restaurants/${restaurantId}/approve`, { body: {} });
        await settle();
        assert.equal(await AdminAudit.countDocuments(), before);
    });
    await check('a money move is logged ONCE, by the finance check, with module and redacted body', async () => {
        const wid = String(new mongoose.Types.ObjectId());
        await call('PATCH', `/v1/food/admin/withdrawals/${wid}`, { who: 'food-admin', body: { status: 'approved', reason: 'verified bank', accountNumber: '123456789012' } });
        await settle();
        const rows = await AdminAudit.find({ path: `/api/v1/food/admin/withdrawals/${wid}` }).lean();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].kind, 'finance');
        assert.equal(rows[0].module, 'food');
        assert.equal(rows[0].bodySummary.accountNumber, REDACTED);
        assert.equal(rows[0].reason, 'verified bank');
    });

    console.log('\nsecrets never reach the log');
    await check('passwords, OTPs, tokens, keys, card and bank numbers are redacted wherever they are', async () => {
        await call('PATCH', '/v1/platform/settings/profile', {
            who: 'food-admin',
            body: {
                brand: { name: 'Quick Drop' },
                newPassword: 'Sup3r-Secret-Pass',
                integrations: { email: { host: 'smtp.example.com', pass: 'smtp-app-password' }, razorpay: { keyId: 'rzp_live_ABCDEF123456', keySecret: 'shh' } },
                otp: '482913',
                session: { refreshToken: 'tok_live_abcdef' },
                payout: { cardNumber: '4111111111111111', bank: { accountNumber: '123456789012', ifsc: 'HDFC0001234' } },
                notes: ['call 4111 1111 1111 1111', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'],
                upiPin: '9988',
            },
        });
        await settle();
        const row = await AdminAudit.findOne({ path: '/api/v1/platform/settings/profile' }).lean();
        assert.ok(row, 'row written');
        assert.equal(row.module, 'platform');
        const text = JSON.stringify(row);
        for (const secret of SECRETS) assert.ok(!text.includes(secret), `leaked: ${secret}`);
        assert.equal(row.bodySummary.brand.name, 'Quick Drop', 'harmless fields are kept');
        assert.equal(row.bodySummary.integrations.email.host, 'smtp.example.com');
        assert.equal(row.bodySummary.integrations.email.pass, REDACTED);
        assert.equal(row.bodySummary.newPassword, REDACTED);
        assert.equal(row.bodySummary.otp, REDACTED);
        assert.match(row.bodySummary.notes[0], /^call \[REDACTED\]$/, 'a card number inside free text is cut out, the text kept');
    });
    await check('redactForAudit caps size and depth', async () => {
        const big = { list: Array.from({ length: 50 }, (_, i) => ({ i, text: 'x'.repeat(500) })) };
        const s = redactForAudit(big);
        assert.ok(JSON.stringify(s).length <= 4000);
        assert.equal(redactForAudit({}), undefined);
    });

    console.log('\nthe admin page API');
    const ownerToken = signAccessToken({ userId: String(superAdmin._id), role: 'ADMIN' });
    const subToken = signAccessToken({ userId: String(subAdmin._id), role: 'ADMIN' });
    await check('a sub-admin cannot read the log (403)', async () => {
        const r = await call('GET', '/v1/platform/audit-log', { token: subToken });
        assert.equal(r.status, 403);
    });
    await check('filters: module, action, admin, date; pagination', async () => {
        const all = await call('GET', '/v1/platform/audit-log?limit=100', { token: ownerToken });
        assert.equal(all.status, 200);
        assert.ok(all.body.data.total >= 7);
        const taxi = await call('GET', '/v1/platform/audit-log?module=taxi', { token: ownerToken });
        assert.ok(taxi.body.data.rows.length >= 1 && taxi.body.data.rows.every((r) => r.module === 'taxi'));
        const deletes = await call('GET', '/v1/platform/audit-log?action=delete', { token: ownerToken });
        assert.ok(deletes.body.data.rows.every((r) => r.action === 'delete'));
        const mine = await call('GET', `/v1/platform/audit-log?adminId=${superAdmin._id}`, { token: ownerToken });
        assert.equal(mine.body.data.total, all.body.data.total);
        const nobody = await call('GET', `/v1/platform/audit-log?adminId=${subAdmin._id}`, { token: ownerToken });
        assert.equal(nobody.body.data.total, 0);
        const future = await call('GET', '/v1/platform/audit-log?from=2999-01-01', { token: ownerToken });
        assert.equal(future.body.data.total, 0);
        const today = new Date().toISOString().slice(0, 10);
        const todays = await call('GET', `/v1/platform/audit-log?from=${today}&to=${today}`, { token: ownerToken });
        assert.equal(todays.body.data.total, all.body.data.total);
        const p1 = await call('GET', '/v1/platform/audit-log?limit=2&page=1', { token: ownerToken });
        const p2 = await call('GET', '/v1/platform/audit-log?limit=2&page=2', { token: ownerToken });
        assert.equal(p1.body.data.rows.length, 2);
        assert.notEqual(p1.body.data.rows[0]._id, p2.body.data.rows[0]._id);
        assert.equal(p1.body.data.totalPages, Math.ceil(all.body.data.total / 2));
    });
    await check('reading the log is not itself logged, and the admins list names who acted', async () => {
        const before = await AdminAudit.countDocuments();
        const admins = await call('GET', '/v1/platform/audit-log/admins', { token: ownerToken });
        assert.ok(admins.body.data.some((a) => a.id === String(superAdmin._id) && a.email === 'owner@qd.test'));
        await settle();
        assert.equal(await AdminAudit.countDocuments(), before);
    });

    server.close();
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
