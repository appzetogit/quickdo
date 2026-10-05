// Quick-commerce integration guard.
//
// This module is a FORK of this repo's own food module -- 55 of its 61 model names were
// identical (FoodUser, FoodOrder, FoodRestaurant...). Left alone every one throws
// OverwriteModelError at boot, and any that survived would read and write food's live
// collections. So the assertions that matter are about isolation, not features.
//
// Run: node tests/qc.smoke.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let failures = 0;
const check = (name, fn) => {
    if (fn.constructor.name === 'AsyncFunction') throw new Error(`check("${name}") given an async fn`);
    try { fn(); console.log(`  ok   ${name}`); }
    catch (err) { failures++; console.log(`  FAIL ${name}\n         ${err.message}`); }
};

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.NODE_ENV = 'test';
await mongoose.connect(process.env.MONGO_URI);

const { default: app } = await import('../src/app.js');
const { default: qcRouter } = await import('../src/modules/quickCommerce/routes/index.js');
const server = app.listen(0);
const port = server.address().port;

const get = (path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
        let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
});

console.log('\n[1] model registry — the fork must not overwrite food');

const all = Object.keys(mongoose.models);
const qc = all.filter((n) => n.startsWith('QC'));
const food = all.filter((n) => n.startsWith('Food'));

check(`QC* models registered (${qc.length})`, () => assert.ok(qc.length >= 60, `only ${qc.length}`));
check(`Food* models still registered (${food.length})`, () => assert.ok(food.length >= 40, `only ${food.length}`));

check('no QC model kept a Food* registry name', () => {
    const bad = qc.filter((n) => n.startsWith('QCFood'));
    assert.deepEqual(bad, [], `still Food-prefixed: ${bad.join(', ')}`);
});

console.log('\n[2] collection isolation — THE check');

const collectionOf = (n) => mongoose.models[n].collection.name;
const qcCollections = qc.map(collectionOf);
const otherCollections = all.filter((n) => !n.startsWith('QC')).map(collectionOf);

// Isolation was the rule when quick-commerce was merged in as its own fork: 55 of its
// 61 model names collided with food, and nothing was safe to share. Unification since
// has made a few collections shared ON PURPOSE -- a platform aggregate that spans
// verticals and carries a `vertical` field to tell the rows apart.
//
// The exceptions are listed rather than the rule being dropped, so an ACCIDENTAL
// share still fails this test. Adding a name here should be a deliberate decision.
const DELIBERATELY_SHARED = new Set([
    // The unified notification inbox. QC keeps its own model so its writes default to
    // vertical:'quickCommerce', but they land in the shared collection.
    'food_notifications',
    // The customer's one wallet (24 Sep 2026). Quick's wallet model is the shared
    // CustomerWallet schema on this collection, translating Quick customer ids to the
    // platform account on every read and write, so money moves freely between Food,
    // Rides and Quick & Medical. Guarded by tests/one-wallet-quick.smoke.mjs.
    'food_user_wallets',
]);

const leaked = (c) => !c.startsWith('qc_') && !DELIBERATELY_SHARED.has(c);

check('every QC model is on a qc_ collection (or a declared shared one)', () => {
    const bad = qc.map((n) => [n, collectionOf(n)]).filter(([, c]) => leaked(c));
    assert.deepEqual(bad, [], `not namespaced: ${JSON.stringify(bad)}`);
});

check('no QC collection is shared with food, taxi, sp or core by accident', () => {
    const shared = qcCollections.filter((c) => otherCollections.includes(c) && !DELIBERATELY_SHARED.has(c));
    assert.deepEqual([...new Set(shared)], [], `SHARED: ${[...new Set(shared)].join(', ')}`);
});

check('the shared collections really are shared, not a stale exception', () => {
    // If a name here stops being shared, the exception is dead and should be removed.
    for (const c of DELIBERATELY_SHARED) {
        assert.ok(qcCollections.includes(c), `${c} is allowlisted but no QC model uses it`);
        assert.ok(otherCollections.includes(c), `${c} is allowlisted but nothing outside QC uses it`);
    }
});

for (const live of ['users', 'admins', 'payments', 'refunds', 'settlements', 'food_orders', 'food_items', 'food_restaurants']) {
    check(`nothing QC touches "${live}"`, () => assert.equal(qcCollections.includes(live), false));
}

check('food models keep their own collections', () => {
    assert.equal(mongoose.models.FoodOrder?.collection.name, 'food_orders');
    assert.equal(mongoose.models.FoodUser?.collection.name, 'users');
});

console.log('\n[3] every QC ref resolves');

check('no dangling ref in any QC schema', () => {
    const missing = [];
    for (const n of qc) {
        mongoose.models[n].schema.eachPath((p, type) => {
            const ref = type.options?.ref || type.caster?.options?.ref;
            if (ref && !mongoose.models[ref]) missing.push(`${n}.${p} -> ${ref}`);
        });
    }
    assert.deepEqual(missing, [], missing.slice(0, 6).join(', '));
});

// Refs that cross into the platform ON PURPOSE. Same rule as the shared-collection
// allowlist above: exceptions are named, so an accidental cross-ref still fails.
const DELIBERATE_PLATFORM_REFS = new Set([
    // The identity link: every satellite user points at the customer's ONE platform
    // identity in the shared `users` collection. That is the identity merge working,
    // not a leak.
    'QCUser.platformUserId -> FoodUser',
]);

check('no QC schema still points at a Food* model (undeclared)', () => {
    const crossed = [];
    for (const n of qc) {
        mongoose.models[n].schema.eachPath((p, type) => {
            const ref = type.options?.ref || type.caster?.options?.ref;
            const entry = `${n}.${p} -> ${ref}`;
            if (ref && ref.startsWith('Food') && !DELIBERATE_PLATFORM_REFS.has(entry)) crossed.push(entry);
        });
    }
    assert.deepEqual(crossed, [], `would read food data: ${crossed.slice(0, 6).join(', ')}`);
});

check('the declared platform refs actually exist (no stale exceptions)', () => {
    for (const entry of DELIBERATE_PLATFORM_REFS) {
        const [modelDotPath] = entry.split(' -> ');
        const [model, ...pathParts] = modelDotPath.split('.');
        const type = mongoose.models[model]?.schema.path(pathParts.join('.'));
        assert.ok(type?.options?.ref, `${entry} is allowlisted but the ref is gone`);
    }
});

console.log('\n[4] routing');

for (const p of ['/api/v1/health', '/api/v1/food/admin/business-settings/public', '/api/v1/sp/public/cities']) {
    const r = await get(p);
    check(`existing ${p} -> ${r.status} (unaffected)`, () => assert.notEqual(r.status, 404));
}
for (const p of ['/api/v1/qc/health', '/api/v1/qc/admin/business-settings/public']) {
    const r = await get(p);
    check(`quick-commerce ${p} -> ${r.status} (mounted)`, () => assert.notEqual(r.status, 404));
}

check('quick-commerce did NOT claim /v1/food', () => {
    const paths = [];
    const walk = (stack, prefix = '') => {
        for (const l of stack) {
            if (l.route) { paths.push(prefix + l.route.path); continue; }
            if (l.name === 'router' && l.handle?.stack) {
                const src = l.regexp?.source ?? '';
                const mount = src === '^\\/?(?=\\/|$)' ? '' : src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\$$/, '').replace(/\\\//g, '/');
                walk(l.handle.stack, prefix + mount);
            }
        }
    };
    walk(qcRouter.stack);
    const leaked = paths.filter((p) => p.startsWith('/v1/') || p.startsWith('/food/'));
    assert.deepEqual(leaked.slice(0, 5), [], `still version/food-prefixed: ${leaked.slice(0, 5).join(', ')}`);
});

server.close();
await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
