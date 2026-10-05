/**
 * Logged in is not the same as allowed: taxi open-user access, unpaid wallet
 * top-ups, and the food / quick-commerce payment router.
 *
 * Run: node tests/auth-open-access.smoke.mjs
 *
 * Found by sweeping food, quick-commerce and taxi for the class of bug the
 * service-provider cash routes had:
 *
 *  - Taxi `authenticateOrResolveUser`, on 52 customer routes: with no token, the
 *    caller became any user id it sent -- or, sending none, the OLDEST user. In
 *    production.
 *  - Taxi customer POST /users/wallet/topup and driver POST /drivers/wallet/top-up
 *    credited the requested amount with no payment. Together with the first: an
 *    anonymous request could credit any customer's wallet.
 *  - /v1/food/payments and /v1/qc/payments sat behind authMiddleware only: any
 *    customer could create and process payouts, and read any partner's wallet.
 *
 * Real middleware and routers; the database is an in-memory replica set.
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
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.entries(vars).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
    try { return await fn(); } finally {
        Object.entries(saved).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
    }
};

const listen = async (app) => {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    return { server, base: `http://127.0.0.1:${server.address().port}` };
};

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'auth_open' });

    // --- taxi open-user access ----------------------------------------------
    console.log('\ntaxi: no token');
    const { authenticateOrResolveUser } = await import('../src/modules/taxi/middlewares/authMiddleware.js');
    const { User } = await import('../src/modules/taxi/user/models/User.js');
    const victim = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id: victim, name: 'Oldest', phone: '9930000000', createdAt: new Date(0) });

    const probe = express();
    probe.use(express.json());
    probe.post('/probe', authenticateOrResolveUser(['user']), (req, res) => res.json({ as: req.auth?.sub }));
    probe.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ message: err.message }));
    const taxi = await listen(probe);
    const post = (headers = {}, body = {}) => fetch(`${taxi.base}/probe`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

    await check('production: no token is 401, and does not become the oldest user', async () => {
        await withEnv({ NODE_ENV: 'production', TAXI_OPEN_USER_ACCESS: 'true' }, async () => {
            const r = await post();
            assert.equal(r.status, 401);
            assert.notEqual(r.body.as, String(victim));
        });
    });
    await check('production: naming a victim in x-user-id or the body is 401', async () => {
        await withEnv({ NODE_ENV: 'production', TAXI_OPEN_USER_ACCESS: 'true' }, async () => {
            assert.equal((await post({ 'x-user-id': String(victim) })).status, 401);
            assert.equal((await post({}, { userId: String(victim) })).status, 401);
        });
    });
    await check('development without the flag: also 401', async () => {
        await withEnv({ NODE_ENV: 'development', TAXI_OPEN_USER_ACCESS: undefined }, async () => {
            assert.equal((await post({ 'x-user-id': String(victim) })).status, 401);
        });
    });
    await check('development with the flag: an explicit id resolves; no id is still 401', async () => {
        await withEnv({ NODE_ENV: 'development', TAXI_OPEN_USER_ACCESS: 'true' }, async () => {
            const named = await post({ 'x-user-id': String(victim) });
            assert.equal(named.status, 200);
            assert.equal(named.body.as, String(victim));
            assert.equal((await post()).status, 401, 'never picks an arbitrary user');
        });
    });

    console.log('\ntaxi: unpaid top-ups');
    const { topupUserWallet } = await import('../src/modules/taxi/user/controllers/userController.js');
    const { topUpMyWallet } = await import('../src/modules/taxi/driver/controllers/driverController.js');
    const invoke = async (handler, req) => {
        try { await handler(req, { status() { return this; }, json() { return this; } }); return 200; }
        catch (err) { return err.statusCode || err.status || 500; }
    };
    await check('customer manual top-up is refused without the flag', async () => {
        await withEnv({ TAXI_MANUAL_WALLET_TOPUP_ENABLED: undefined }, async () => {
            assert.equal(await invoke(topupUserWallet, { body: { amount: 50000 }, auth: { sub: String(victim) } }), 403);
        });
    });
    await check('driver manual top-up is refused without the flag', async () => {
        await withEnv({ TAXI_MANUAL_WALLET_TOPUP_ENABLED: undefined }, async () => {
            assert.equal(await invoke(topUpMyWallet, { body: { amount: 50000 }, auth: { sub: String(new mongoose.Types.ObjectId()) } }), 403);
        });
    });

    // --- food / QC payment routers --------------------------------------------
    for (const [label, path] of [
        ['food', '../src/core/payments/payment.routes.js'],
        ['quick-commerce', '../src/modules/quickCommerce/core/payments/payment.routes.js'],
    ]) {
        console.log(`\n${label} payments router`);
        const { default: router } = await import(path);
        const app = express();
        app.use(express.json());
        // Stands in for authMiddleware: identity from headers.
        app.use((req, _res, next) => { req.user = { userId: req.headers['x-id'], role: req.headers['x-role'] }; next(); });
        app.use('/payments', router);
        app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ message: err.message }));
        const { server, base } = await listen(app);
        const call = (method, url, who, body) => fetch(`${base}/payments${url}`, {
            method, headers: { 'content-type': 'application/json', 'x-id': who.id, 'x-role': who.role },
            body: body ? JSON.stringify(body) : undefined,
        }).then((r) => r.status);

        const restaurant = { id: String(new mongoose.Types.ObjectId()), role: 'RESTAURANT' };
        const customer = { id: String(new mongoose.Types.ObjectId()), role: 'USER' };
        const rider = { id: String(new mongoose.Types.ObjectId()), role: 'DELIVERY_PARTNER' };
        // A real platform admin with this vertical: an admin id that exists in no
        // admin collection is now refused (a deleted admin's token used to pass).
        const adminId = new mongoose.Types.ObjectId();
        await mongoose.connection.collection('admins').updateOne(
            { _id: adminId },
            { $setOnInsert: { email: `admin-${adminId}@t.test`, role: 'ADMIN', adminLevel: 'platform_superadmin', admin_type: 'superadmin', permissions: ['*'], servicesAccess: ['food', 'quickCommerce', 'taxi'], isActive: true } },
            { upsert: true },
        );
        const admin = { id: String(adminId), role: 'ADMIN' };

        await check(`${label}: a customer cannot create or process a payout`, async () => {
            assert.equal(await call('POST', '/admin/settlements', customer, { entityType: 'restaurant', entityId: restaurant.id, amount: 99999 }), 403);
            assert.equal(await call('POST', `/admin/settlements/${new mongoose.Types.ObjectId()}/process`, rider, {}), 403);
        });
        await check(`${label}: a customer cannot read admin finance`, async () => {
            assert.equal(await call('GET', '/admin/finance/summary', customer), 403);
            assert.equal(await call('GET', '/admin/settlements', restaurant), 403);
        });
        await check(`${label}: nobody reads another partner's wallet`, async () => {
            assert.equal(await call('GET', `/restaurant/${new mongoose.Types.ObjectId()}/wallet`, restaurant), 403);
            assert.equal(await call('GET', `/delivery/${new mongoose.Types.ObjectId()}/wallet`, rider), 403);
            assert.equal(await call('GET', `/restaurant/${restaurant.id}/wallet`, customer), 403);
        });
        await check(`${label}: a partner reads their own wallet, and an admin anyone's`, async () => {
            assert.notEqual(await call('GET', `/restaurant/${restaurant.id}/wallet`, restaurant), 403);
            assert.notEqual(await call('GET', `/delivery/${rider.id}/wallet`, rider), 403);
            assert.notEqual(await call('GET', `/restaurant/${restaurant.id}/wallet`, admin), 403);
        });
        await check(`${label}: order payment trails are admin-only`, async () => {
            assert.equal(await call('GET', `/orders/${new mongoose.Types.ObjectId()}/payments`, customer), 403);
            assert.notEqual(await call('GET', `/orders/${new mongoose.Types.ObjectId()}/payments`, admin), 403);
        });
        await check(`${label}: an admin can still create a payout`, async () => {
            assert.notEqual(await call('POST', '/admin/settlements', admin, { entityType: 'restaurant', entityId: restaurant.id, amount: 100 }), 403);
        });
        server.close();
    }

    // --- anonymous writes to admin content and uploads --------------------------
    console.log('\nanonymous writes');
    {
        const { adminRouter: taxiAdminRouter } = await import('../src/modules/taxi/admin/routes/adminRoutes.js');
        const { createRequire } = await import('node:module');
        const req2 = createRequire(import.meta.url);
        const spUploadRoutes = req2('../src/modules/serviceProvider/routes/admin-routes/upload.routes.js');
        const app = express();
        app.use(express.json());
        app.use('/taxi', taxiAdminRouter);
        app.use('/sp', spUploadRoutes);
        app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ message: err.message }));
        const { server, base } = await listen(app);
        const status = (method, url) => fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }).then((r) => r.status);
        await check('taxi on-boarding screens: create, edit and delete need an admin token', async () => {
            assert.equal(await status('POST', '/taxi/on-boarding'), 401);
            assert.equal(await status('PATCH', '/taxi/on-boarding/' + new mongoose.Types.ObjectId()), 401);
            assert.equal(await status('DELETE', '/taxi/on-boarding/' + new mongoose.Types.ObjectId()), 401);
        });
        await check('taxi on-boarding screens stay readable before sign-in', async () => {
            assert.notEqual(await status('GET', '/taxi/on-boarding'), 401);
        });
        await check('SP upload signature and direct upload need a signed-in account', async () => {
            assert.equal(await status('GET', '/sp/upload/sign-signature?folder=x'), 401);
            assert.equal(await status('POST', '/sp/upload'), 401);
        });
        server.close();
    }

    // The finance permission audit is written fire-and-forget; let it land before disconnecting.
    await new Promise((r) => setTimeout(r, 500));
    taxi.server.close();
    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
