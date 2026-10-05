// Phase 1 exit criterion for the Service-Provider integration.
//
// Boots the real express app against an in-memory MongoDB (never your Atlas) and
// asserts: master's food/taxi routes still answer, the SP module answers on its
// canonical /v1/sp prefix AND on the legacy prefixes the shipped mobile builds
// use, every SP model is registered under an SP* name on an sp_* collection, and
// nothing landed on a collection master already owns.
//
// Run: node tests/sp.smoke.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const EXPECTED_SHARED_COLLECTIONS = new Set(['admins']); // deliberate merges
const MASTER_OWNED = ['users', 'transactions', 'settlements', 'payments', 'refunds', 'food_orders', 'food_restaurants'];

let failures = 0;
const check = (name, fn) => {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n         ${err.message}`);
    }
};

const request = (server, path) =>
    new Promise((resolve, reject) => {
        const { port } = server.address();
        http.get({ host: '127.0.0.1', port, path }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.NODE_ENV = 'test';

await mongoose.connect(process.env.MONGO_URI);
const { default: app } = await import('../src/app.js');
const server = app.listen(0);

console.log('\n[1] model registry');

const spModels = Object.keys(mongoose.models).filter((n) => n.startsWith('SP'));
check(`29 SP* models registered (got ${spModels.length})`, () => assert.equal(spModels.length, 29));

check('no SP model landed on a master-owned collection', () => {
    const bad = spModels
        .map((n) => [n, mongoose.models[n].collection.name])
        .filter(([, c]) => MASTER_OWNED.includes(c) && !EXPECTED_SHARED_COLLECTIONS.has(c));
    assert.deepEqual(bad, [], `collided: ${JSON.stringify(bad)}`);
});

check("SPAdmin shares the 'admins' collection (deliberate merge)", () =>
    assert.equal(mongoose.models.SPAdmin.collection.name, 'admins'));

check("SPUser is isolated on 'sp_users' in phase 1", () =>
    assert.equal(mongoose.models.SPUser.collection.name, 'sp_users'));

check('SPTransaction / SPSettlement no longer collide with core/payments', () => {
    assert.equal(mongoose.models.SPTransaction.collection.name, 'sp_transactions');
    assert.equal(mongoose.models.SPSettlement.collection.name, 'sp_settlements');
    assert.equal(mongoose.models.Transaction.collection.name, 'transactions');
    assert.equal(mongoose.models.Settlement.collection.name, 'settlements');
});

check('every SP model ref resolves to a registered model', () => {
    const missing = [];
    for (const name of spModels) {
        mongoose.models[name].schema.eachPath((p, type) => {
            const ref = type.options?.ref || type.caster?.options?.ref;
            if (ref && !mongoose.models[ref]) missing.push(`${name}.${p} -> ${ref}`);
        });
    }
    assert.deepEqual(missing, [], `unresolved: ${missing.join(', ')}`);
});

console.log('\n[2] routing — master modules still answer');

for (const path of ['/api/v1/health', '/api/v1/food/admin/business-settings/public']) {
    const res = await request(server, path);
    check(`${path} -> ${res.status} (not 404)`, () => assert.notEqual(res.status, 404));
}

console.log('\n[3] routing — SP canonical prefix');

for (const path of ['/api/v1/sp/public/cities', '/api/v1/sp/public/config', '/api/v1/sp/admin/dashboard/stats']) {
    const res = await request(server, path);
    check(`${path} -> ${res.status} (route exists)`, () => assert.notEqual(res.status, 404));
}

console.log('\n[4] routing — legacy prefixes shipped clients still call');

// notification.routes.js defines /user, /vendor, /worker, /admin -- there is no
// bare GET /, so hit a real one.
for (const path of ['/api/public/cities', '/api/admin/dashboard/stats', '/api/notifications/user']) {
    const res = await request(server, path);
    check(`${path} -> ${res.status} (route exists)`, () => assert.notEqual(res.status, 404));
}

console.log('\n[5] routing — SP must not shadow master');

{
    const res = await request(server, '/api/v1/admin/queues');
    check('/api/v1/admin/queues still reaches master (401, not SP 404)', () => assert.notEqual(res.status, 404));
}

console.log('\n[6] shared `admins` collection — service scope is enforced');

{
    // SPAdmin and FoodAdmin write to the same collection, so seed both shapes and
    // confirm SP's login only lets the right ones through.
    const { default: SPAdmin } = await import('../src/modules/serviceProvider/models/Admin.js');
    const post = (path, payload) =>
        new Promise((resolve, reject) => {
            const body = JSON.stringify(payload);
            const req = http.request(
                {
                    host: '127.0.0.1',
                    port: server.address().port,
                    path,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                },
                (res) => {
                    let b = '';
                    res.on('data', (c) => (b += c));
                    res.on('end', () => resolve({ status: res.statusCode, body: b }));
                },
            );
            req.on('error', reject);
            req.end(body);
        });

    await SPAdmin.create({ name: 'SP Native', email: 'sp-native@test.local', password: 'Passw0rd!' });
    // role super_admin because cityManagement.routes.js does a path-less
    // router.use(isSuperAdmin) and is mounted on /admin ahead of everything else,
    // so every SP admin endpoint requires it. Pre-existing behaviour, preserved.
    await SPAdmin.create({ name: 'SP Scoped', email: 'sp-scoped@test.local', password: 'Passw0rd!', role: 'super_admin', servicesAccess: ['serviceProvider'] });
    await SPAdmin.create({ name: 'SP Plain', email: 'sp-plain@test.local', password: 'Passw0rd!', role: 'admin', servicesAccess: ['serviceProvider'] });
    await SPAdmin.create({ name: 'Food Only', email: 'food-only@test.local', password: 'Passw0rd!', servicesAccess: ['food'] });
    await SPAdmin.create({ name: 'Platform', email: 'platform@test.local', password: 'Passw0rd!', servicesAccess: ['food', 'taxi', 'serviceProvider'] });

    const login = (email) => post('/api/v1/sp/admin/auth/login', { email, password: 'Passw0rd!' });

    const nativeRes = await login('sp-native@test.local');
    check('legacy SP-native admin (no servicesAccess) can still log in', () => assert.equal(nativeRes.status, 200));

    const scopedRes = await login('sp-scoped@test.local');
    check("admin scoped to 'serviceProvider' can log in", () => assert.equal(scopedRes.status, 200));

    const platformRes = await login('platform@test.local');
    check('platform admin with all three services can log in', () => assert.equal(platformRes.status, 200));

    const foodRes = await login('food-only@test.local');
    check('food-only admin is REJECTED with 403 (not 200)', () => assert.equal(foodRes.status, 403));

    const wrongPass = await post('/api/v1/sp/admin/auth/login', { email: 'sp-scoped@test.local', password: 'wrong' });
    check('wrong password still rejected', () => assert.equal(wrongPass.status, 401));

    // and the middleware gate, not just the login gate
    const token = JSON.parse(foodRes.body).accessToken;
    check('food-only admin got no token', () => assert.equal(token, undefined));

    const goodToken = JSON.parse(scopedRes.body).accessToken;
    const authed = await new Promise((resolve, reject) => {
        http.get(
            { host: '127.0.0.1', port: server.address().port, path: '/api/v1/sp/admin/dashboard/stats', headers: { Authorization: `Bearer ${goodToken}` } },
            (res) => {
                let b = '';
                res.on('data', (c) => (b += c));
                res.on('end', () => resolve({ status: res.statusCode }));
            },
        ).on('error', reject);
    });
    check('valid SP super_admin token reaches a protected route (not 401/403)', () => {
        assert.notEqual(authed.status, 401);
        assert.notEqual(authed.status, 403);
    });

    // Pin the quirk so a later refactor of the /admin mount order can't silently
    // widen access: a non-super admin must still be shut out.
    const plainToken = JSON.parse((await login('sp-plain@test.local')).body).accessToken;
    const plainRes = await new Promise((resolve, reject) => {
        http.get(
            { host: '127.0.0.1', port: server.address().port, path: '/api/v1/sp/admin/dashboard/stats', headers: { Authorization: `Bearer ${plainToken}` } },
            (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); },
        ).on('error', reject);
    });
    check('non-super SP admin still gets 403 (mount order preserved)', () => assert.equal(plainRes.status, 403));

    // ── one login, three panels ──────────────────────────────────────────────
    // A token minted by MASTER's admin login must work on SP routes, because that
    // is the whole point of sharing the `admins` collection and the JWT secret.
    const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
    await FoodAdmin.create({
        email: 'platform-super@test.local',
        password: 'Passw0rd!',
        name: 'Platform Super',
        isActive: true,
        servicesAccess: ['food', 'taxi', 'serviceProvider'],
        adminLevel: 'platform_superadmin',
        admin_type: 'superadmin',
        role: 'super_admin', // SP's isSuperAdmin re-reads this from the DB
        permissions: ['*'],
    });
    await FoodAdmin.create({
        email: 'food-super@test.local',
        password: 'Passw0rd!',
        name: 'Food Super',
        isActive: true,
        servicesAccess: ['food'],
        adminLevel: 'food_superadmin',
        admin_type: 'superadmin',
        role: 'super_admin',
        permissions: ['*'],
    });

    const masterLogin = (email) => post('/api/v1/auth/admin/login', { email, password: 'Passw0rd!' });
    const hit = (token) =>
        new Promise((resolve, reject) => {
            http.get(
                { host: '127.0.0.1', port: server.address().port, path: '/api/v1/sp/admin/dashboard/stats', headers: { Authorization: `Bearer ${token}` } },
                (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); },
            ).on('error', reject);
        });

    const pRes = await masterLogin('platform-super@test.local');
    check('master admin login succeeds', () => assert.equal(pRes.status, 200));
    const pTok = JSON.parse(pRes.body).data?.accessToken || JSON.parse(pRes.body).accessToken;
    check('master token carries an access token', () => assert.ok(pTok));
    const pHit = await hit(pTok);
    check('MASTER-issued token with serviceProvider access reaches SP routes', () => {
        assert.notEqual(pHit.status, 401);
        assert.notEqual(pHit.status, 403);
    });

    const fRes = await masterLogin('food-super@test.local');
    const fTok = JSON.parse(fRes.body).data?.accessToken || JSON.parse(fRes.body).accessToken;
    const fHit = await hit(fTok);
    check('MASTER-issued food-only token is REJECTED by SP routes', () => assert.equal(fHit.status, 403));
}

console.log('\n[7] admin hierarchy knows about the new module');

{
    const { ADMIN_LEVELS, ADMIN_MODULES, MODULE_SUPERADMIN_LEVELS } = await import('../src/core/admin/adminHierarchy.constants.js');
    const h = await import('../src/core/admin/adminHierarchy.service.js');

    check('serviceProvider is a known module', () => assert.equal(ADMIN_MODULES.SERVICE_PROVIDER, 'serviceProvider'));
    check('sp_superadmin is a known level', () => assert.equal(ADMIN_LEVELS.SERVICE_PROVIDER_SUPERADMIN, 'sp_superadmin'));

    const spSuper = { role: 'ADMIN', admin_type: 'superadmin', servicesAccess: ['serviceProvider'] };
    check('SP-only superadmin resolves to sp_superadmin', () =>
        assert.equal(h.resolveAdminLevel(spSuper), ADMIN_LEVELS.SERVICE_PROVIDER_SUPERADMIN));
    check('SP-only superadmin resolves to the serviceProvider module', () =>
        assert.equal(h.resolveAdminModule(spSuper), ADMIN_MODULES.SERVICE_PROVIDER));
    check('SP superadmin is superadmin-like', () => assert.equal(h.isSuperAdminLike(spSuper), true));
    check('SP superadmin has module access to serviceProvider', () =>
        assert.equal(h.hasModuleAccess(spSuper, ADMIN_MODULES.SERVICE_PROVIDER), true));
    check('SP superadmin has NO module access to food', () =>
        assert.equal(h.hasModuleAccess(spSuper, ADMIN_MODULES.FOOD), false));

    // regression: existing food behaviour must be byte-identical
    const foodSuper = { role: 'ADMIN', admin_type: 'superadmin', servicesAccess: ['food'] };
    check('food-only superadmin still resolves to food_superadmin', () =>
        assert.equal(h.resolveAdminLevel(foodSuper), ADMIN_LEVELS.FOOD_SUPERADMIN));
    check('food-only superadmin still resolves to the food module', () =>
        assert.equal(h.resolveAdminModule(foodSuper), ADMIN_MODULES.FOOD));

    // regression: the taxi asymmetry is preserved on purpose (see the comment in
    // resolveAdminLevel) -- a taxi-only superadmin is still PLATFORM_SUPERADMIN.
    const taxiSuper = { role: 'ADMIN', admin_type: 'superadmin', servicesAccess: ['taxi'] };
    check('taxi-only superadmin is unchanged (still platform_superadmin)', () =>
        assert.equal(h.resolveAdminLevel(taxiSuper), ADMIN_LEVELS.PLATFORM_SUPERADMIN));

    const platform = { role: 'ADMIN', admin_type: 'superadmin', servicesAccess: ['food', 'taxi', 'serviceProvider'] };
    check('platform superadmin can create an sp_superadmin', () =>
        assert.ok(h.getCreatableAdminLevels(platform).includes(ADMIN_LEVELS.SERVICE_PROVIDER_SUPERADMIN)));
    check('MODULE_SUPERADMIN_LEVELS covers all three services', () =>
        assert.equal(Object.keys(MODULE_SUPERADMIN_LEVELS).length, 3));
}

server.close();
await mongoose.disconnect();
await mongod.stop();

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
