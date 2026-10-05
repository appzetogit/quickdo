// Proves scripts/sp-migrate-data.js before it is ever pointed at Atlas.
//
// Spins up TWO in-memory MongoDBs (a fake Truliq source and a fake K9 target), seeds
// the source with the old collection names plus a realistic admin collision, then runs
// the real script as a child process in dry-run, apply, re-apply and verify modes.
//
// Note: every assertion below is over a value resolved BEFORE check() is called.
// Passing an async fn to check() would swallow the rejection and always pass.
//
// Run: node tests/sp.migration.smoke.mjs

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/sp-migrate-data.js');

let failures = 0;
const check = (name, fn) => {
    if (fn.constructor.name === 'AsyncFunction') throw new Error(`check("${name}") was given an async fn — rejections would be swallowed`);
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n         ${err.message}`);
    }
};

const source = await MongoMemoryServer.create();
const target = await MongoMemoryServer.create();
const srcClient = await new MongoClient(source.getUri()).connect();
const tgtClient = await new MongoClient(target.getUri()).connect();
const srcDb = srcClient.db('Truliq');
const tgtDb = tgtClient.db('K9');

const count = (name) => tgtDb.collection(name).countDocuments();

// ── seed a realistic source ────────────────────────────────────────────────
await srcDb.collection('users').insertMany([
    { _id: new ObjectId(), name: 'Shared Person', phone: '9876543210' },
    { _id: new ObjectId(), name: 'SP Only', phone: '9000000001' },
]);
await srcDb.collection('vendors').insertMany([{ _id: new ObjectId(), businessName: 'V1' }, { _id: new ObjectId(), businessName: 'V2' }]);
await srcDb.collection('workers').insertOne({ _id: new ObjectId(), name: 'W1' });
await srcDb.collection('bookings').insertMany([{ _id: new ObjectId(), status: 'completed' }, { _id: new ObjectId(), status: 'pending' }]);
await srcDb.collection('transactions').insertOne({ _id: new ObjectId(), amount: 500 });
await srcDb.collection('settlements').insertOne({ _id: new ObjectId(), status: 'pending' });
await srcDb.collection('categories').insertOne({ _id: new ObjectId(), name: 'AC Repair' });
await srcDb.collection('admins').insertMany([
    { _id: new ObjectId(), email: 'sp-super@truliq.test', name: 'SP Super', password: 'x', role: 'super_admin' },
    { _id: new ObjectId(), email: 'shared@k9.test', name: 'Collides', password: 'x', role: 'admin' },
]);
// an unmapped collection -- the script must SHOUT about this, not silently drop it
await srcDb.collection('legacy_experiment').insertOne({ _id: new ObjectId(), note: 'not in the map' });

// ── seed a target that already has live data ───────────────────────────────
await tgtDb.collection('users').insertMany([
    { _id: new ObjectId(), name: 'Food Customer', phone: '9876543210' }, // same phone as an SP user
    { _id: new ObjectId(), name: 'Taxi Customer', phone: '9111111111' },
]);
await tgtDb.collection('admins').insertOne({
    _id: new ObjectId(), email: 'shared@k9.test', name: 'Existing Food Admin', password: 'y', servicesAccess: ['food'],
});
await tgtDb.collection('transactions').insertOne({ _id: new ObjectId(), amount: 999 }); // master's own

const run = (extra = []) =>
    execFileSync('node', [SCRIPT, ...extra], {
        env: { ...process.env, SP_SOURCE_MONGO_URI: source.getUri() + 'Truliq', MONGO_URI: target.getUri() + 'K9', MONGODB_DB_NAME: 'K9' },
        encoding: 'utf8',
    });

// ── 1. dry run must not write ──────────────────────────────────────────────
console.log('\n[1] dry run writes nothing');
const dry = run();
const afterDry = {
    spVendors: await count('sp_vendors'),
    spBookings: await count('sp_bookings'),
    spUsers: await count('sp_users'),
    admins: await count('admins'),
};
check('reports DRY RUN', () => assert.match(dry, /DRY RUN \(no writes\)/));
check('flags the unmapped collection by name', () => assert.match(dry, /legacy_experiment/));
check('warns that unmapped collections would be left behind', () => assert.match(dry, /NOT IN THE MAP/));
check(`sp_vendors still 0 (got ${afterDry.spVendors})`, () => assert.equal(afterDry.spVendors, 0));
check(`sp_bookings still 0 (got ${afterDry.spBookings})`, () => assert.equal(afterDry.spBookings, 0));
check(`sp_users still 0 (got ${afterDry.spUsers})`, () => assert.equal(afterDry.spUsers, 0));
check(`admins still 1 (got ${afterDry.admins})`, () => assert.equal(afterDry.admins, 1));

// ── 2. apply ───────────────────────────────────────────────────────────────
console.log('\n[2] apply copies the SP data');
const applied = run(['--apply']);
const after = {
    spVendors: await count('sp_vendors'),
    spBookings: await count('sp_bookings'),
    spWorkers: await count('sp_workers'),
    spUsers: await count('sp_users'),
    spCategories: await count('sp_categories'),
    spTx: await count('sp_transactions'),
    spSettlements: await count('sp_settlements'),
    masterTx: await count('transactions'),
    masterUsers: await count('users'),
};
const admins = await tgtDb.collection('admins').find({}).toArray();

check('reports APPLY', () => assert.match(applied, /APPLY \(writes to target\)/));
check(`sp_vendors = 2 (got ${after.spVendors})`, () => assert.equal(after.spVendors, 2));
check(`sp_bookings = 2 (got ${after.spBookings})`, () => assert.equal(after.spBookings, 2));
check(`sp_workers = 1 (got ${after.spWorkers})`, () => assert.equal(after.spWorkers, 1));
check(`sp_users = 2 (got ${after.spUsers})`, () => assert.equal(after.spUsers, 2));
check(`sp_categories = 1 (got ${after.spCategories})`, () => assert.equal(after.spCategories, 1));

console.log('\n[3] master data is untouched (the whole point of the rename)');
check(`master transactions still 1 (got ${after.masterTx})`, () => assert.equal(after.masterTx, 1));
check(`SP transaction landed in sp_transactions (got ${after.spTx})`, () => assert.equal(after.spTx, 1));
check(`SP settlement landed in sp_settlements (got ${after.spSettlements})`, () => assert.equal(after.spSettlements, 1));
check(`master users still 2 — SP users did NOT merge in (got ${after.masterUsers})`, () => assert.equal(after.masterUsers, 2));

console.log('\n[4] admin merge is insert-only');
check(`admins = 2: 1 existing + 1 inserted (got ${admins.length})`, () => assert.equal(admins.length, 2));
check('the colliding admin was NOT overwritten', () => {
    const collided = admins.find((a) => a.email === 'shared@k9.test');
    assert.equal(collided.name, 'Existing Food Admin');
    assert.deepEqual(collided.servicesAccess, ['food']);
});
check('the collision was reported, not silently dropped', () => assert.match(applied, /shared@k9\.test[\s\S]*?NOT modified/));
check('the new SP admin got serviceProvider access', () => {
    const fresh = admins.find((a) => a.email === 'sp-super@truliq.test');
    assert.deepEqual(fresh.servicesAccess, ['serviceProvider']);
    assert.equal(fresh.adminLevel, 'sp_superadmin');
});

console.log('\n[5] identity overlap is surfaced');
check('found the 1 shared phone number', () => assert.match(applied, /same phone on both sides\s*:\s*1/));

console.log('\n[6] idempotency');
const again = run(['--apply']);
const afterRerun = { spVendors: await count('sp_vendors'), admins: await count('admins') };
check(`sp_vendors still 2 after re-run (got ${afterRerun.spVendors})`, () => assert.equal(afterRerun.spVendors, 2));
check(`admins still 2 after re-run (got ${afterRerun.admins})`, () => assert.equal(afterRerun.admins, 2));
check('re-run refuses to clobber a non-empty target without --force', () => assert.match(again, /use --force/));

const forced = run(['--apply', '--force']);
const afterForce = await count('sp_vendors');
check(`--force upserts rather than duplicating (still 2, got ${afterForce})`, () => assert.equal(afterForce, 2));

console.log('\n[7] verify mode');
const verified = run(['--verify']);
check('verify passes after a successful copy', () => assert.match(verified, /VERIFY PASS/));

await srcClient.close();
await tgtClient.close();
await source.stop();
await target.stop();

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
