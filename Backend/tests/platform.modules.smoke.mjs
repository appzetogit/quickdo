/**
 * Module kill-switch and admin permission caching.
 *
 * The cases that matter are the ones where being wrong is worse than not having the
 * feature: a kill-switch that also blocks reads is an outage, one that blocks its own
 * admin route cannot be undone, and one that blocks payment webhooks strands money.
 * The caching half is guarded on revocation latency, because a cache that keeps
 * serving a deactivated admin is a security regression dressed as an optimisation.
 *
 * Run:  node tests/platform.modules.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let fails = 0;
const test = async (name, fn) => {
    try { await fn(); console.log(`  PASS  ${name}`); }
    catch (err) { fails += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
};

/** Minimal express-like req/res so the middleware can be driven without a server. */
const run = async (middleware, { method = 'POST', url = '/v1/taxi/rides' } = {}) => {
    const req = { method, url, originalUrl: url, headers: {} };
    let result = { nexted: false, status: null, body: null, headers: {} };
    const res = {
        set(k, v) { result.headers[k] = v; return this; },
        status(code) { result.status = code; return this; },
        json(body) { result.body = body; return this; },
    };
    await middleware(req, res, () => { result.nexted = true; });
    return result;
};

async function main() {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    console.log('Booting in-memory MongoDB…');
    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const uri = rs.getUri();
    process.env.MONGODB_URI = uri;
    process.env.MONGO_URI = uri;
    process.env.REDIS_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    await mongoose.connect(uri);

    const { MODULES } = await import('../src/core/modules/moduleRegistry.js');
    const { setModuleEnabled, isModuleEnabled, clearModuleStateCache } =
        await import('../src/core/modules/moduleState.service.js');
    const { requireModuleEnabled } = await import('../src/middleware/moduleEnabled.js');

    const guard = requireModuleEnabled(MODULES.TAXI);

    console.log('\n[1] Default state');

    await test('an untouched module is enabled', async () => {
        assert.equal(await isModuleEnabled(MODULES.TAXI), true);
    });

    await test('a write passes while enabled', async () => {
        const r = await run(guard);
        assert.equal(r.nexted, true);
    });

    console.log('\n[2] Disabling blocks new commitments');

    await test('a write is refused with 503 and the operator reason', async () => {
        await setModuleEnabled(MODULES.TAXI, false, { reason: 'Payment provider outage', actorId: 'admin-1' });
        const r = await run(guard);
        assert.equal(r.nexted, false);
        assert.equal(r.status, 503);
        assert.match(r.body.message, /Payment provider outage/);
    });

    await test('503 carries Retry-After so clients back off', async () => {
        const r = await run(guard);
        assert.ok(r.headers['Retry-After'], 'no Retry-After header');
    });

    console.log('\n[3] What must NEVER be blocked');

    await test('reads still work — in-flight orders stay visible', async () => {
        for (const method of ['GET', 'HEAD']) {
            const r = await run(guard, { method, url: '/v1/taxi/rides/abc' });
            assert.equal(r.nexted, true, `${method} was blocked`);
        }
    });

    await test('OPTIONS passes, or CORS preflight breaks', async () => {
        const r = await run(guard, { method: 'OPTIONS' });
        assert.equal(r.nexted, true, 'preflight blocked — the browser would report a network error');
    });

    await test('the admin route stays open, or the switch cannot be undone', async () => {
        const r = await run(guard, { method: 'PATCH', url: '/v1/taxi/admin/settings' });
        assert.equal(r.nexted, true);
    });

    await test('payment webhooks stay open, or money is stranded', async () => {
        const r = await run(guard, { method: 'POST', url: '/v1/taxi/payments/webhook/razorpay' });
        assert.equal(r.nexted, true);
    });

    await test('auth stays open so operators can sign in', async () => {
        const r = await run(guard, { method: 'POST', url: '/v1/taxi/auth/login' });
        assert.equal(r.nexted, true);
    });

    console.log('\n[4] Isolation and recovery');

    await test('disabling one vertical does not touch another', async () => {
        assert.equal(await isModuleEnabled(MODULES.FOOD), true);
        assert.equal(await isModuleEnabled(MODULES.QUICK_COMMERCE), true);
        const foodGuard = requireModuleEnabled(MODULES.FOOD);
        const r = await run(foodGuard, { url: '/v1/food/orders' });
        assert.equal(r.nexted, true);
    });

    await test('re-enabling takes effect immediately, not after the TTL', async () => {
        await setModuleEnabled(MODULES.TAXI, true, { actorId: 'admin-1' });
        const r = await run(guard);
        assert.equal(r.nexted, true, 'still blocked after re-enable — the cache was not refreshed');
    });

    await test('the reason is cleared on re-enable', async () => {
        const { getModuleState } = await import('../src/core/modules/moduleState.service.js');
        const s = await getModuleState(MODULES.TAXI);
        assert.equal(s.enabled, true);
        assert.equal(s.reason, '');
    });

    await test('an unknown module is not the switch\'s business', async () => {
        assert.equal(await isModuleEnabled('nope'), true);
    });

    await test('state survives a cold cache (it is persisted, not in-memory)', async () => {
        await setModuleEnabled(MODULES.QUICK_COMMERCE, false, { reason: 'catalogue rebuild', actorId: 'a' });
        clearModuleStateCache();
        assert.equal(await isModuleEnabled(MODULES.QUICK_COMMERCE), false);
        await setModuleEnabled(MODULES.QUICK_COMMERCE, true, { actorId: 'a' });
    });

    console.log('\n[5] Admin permission cache');

    const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
    const { attachFoodAdminContext, invalidateAdminCache } =
        await import('../src/modules/food/admin/middlewares/foodAdmin.middleware.js');

    const admin = await FoodAdmin.create({
        name: 'Cache Test', email: 'cache@test.local', password: 'secret123',
        adminLevel: 'subadmin', admin_type: 'subadmin', module: 'food',
        permissions: ['orders.read'], isActive: true, servicesAccess: ['food'],
    });

    const attach = async () => {
        const req = { user: { userId: String(admin._id) } };
        let err = null;
        await attachFoodAdminContext(req, {}, (e) => { err = e || null; });
        return { req, err };
    };

    await test('the admin loads and is attached', async () => {
        const { req, err } = await attach();
        assert.equal(err, null);
        assert.equal(String(req.admin._id), String(admin._id));
        assert.deepEqual(req.admin.permissions, ['orders.read']);
    });

    await test('a cache hit still yields a mongoose document, not a POJO', async () => {
        const { req } = await attach();
        assert.equal(typeof req.admin.toObject, 'function',
            'consumers are written against a document; a plain object is a silent behaviour change');
    });

    await test('mutating one request\'s admin cannot leak into the next', async () => {
        const a = await attach();
        a.req.admin.permissions = ['HACKED'];
        const b = await attach();
        assert.deepEqual(b.req.admin.permissions, ['orders.read'],
            'the cached document is shared mutable state');
    });

    await test('invalidation makes a permission change visible immediately', async () => {
        await FoodAdmin.updateOne({ _id: admin._id }, { $set: { permissions: ['orders.write'] } });
        invalidateAdminCache(admin._id);
        const { req } = await attach();
        assert.deepEqual(req.admin.permissions, ['orders.write']);
    });

    await test('a deactivated admin is refused', async () => {
        await FoodAdmin.updateOne({ _id: admin._id }, { $set: { isActive: false } });
        invalidateAdminCache(admin._id);
        const { err } = await attach();
        assert.ok(err, 'a deactivated admin was let through');
        assert.match(err.message, /deactivated/i);
    });

    await test('a deactivation is not re-served from cache afterwards', async () => {
        const { err } = await attach();
        assert.ok(err, 'the refusal was cached as a pass on the retry');
    });

    await mongoose.disconnect();
    await rs.stop();

    console.log(fails === 0 ? '\nPlatform module switch and admin cache hold.\n' : `\n${fails} FAILED\n`);
    process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
