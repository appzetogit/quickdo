// Identity merge, phase 1: one platform identity per customer, linked explicitly.
//
// Run: node tests/identity.smoke.mjs

import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createRequire } from 'node:module';

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

const { FoodUser } = await import('../src/core/users/user.model.js');
const { FoodUser: QCUser } = await import('../src/modules/quickCommerce/core/users/user.model.js');
const require = createRequire(import.meta.url);
const SPUser = require('../src/modules/serviceProvider/models/User.js');
const { ensurePlatformUser, linkSatellite } = await import('../src/core/identity/identityLink.service.js');
const { resolveCustomerIdentities } = await import('../src/core/activity/identityResolver.js');

console.log('\n[1] ensurePlatformUser');
{
    const id1 = await ensurePlatformUser({ phone: '9876500001', name: 'A' });
    check('creates a platform user for a new phone', () => assert.ok(id1));

    const id2 = await ensurePlatformUser({ phone: '+91 98765 00001' });
    check('a prefixed variant of the same phone reuses it', () => assert.equal(String(id2), String(id1)));

    const before = await FoodUser.countDocuments();
    await ensurePlatformUser({ phone: '9876500001' });
    const after = await FoodUser.countDocuments();
    check('no duplicate platform users created', () => assert.equal(after, before));

    const bad = await ensurePlatformUser({ phone: '123' });
    check('unusable phone -> null, not a throw', () => assert.equal(bad, null));

    const stored = await FoodUser.findById(id1).lean();
    check('created identity stores the normalized phone', () => assert.equal(stored.phone, '9876500001'));
}

console.log('\n[2] linkSatellite stamps the satellite');
{
    const sp = await SPUser.create({ name: 'SP Cust', phone: '9876500002' });
    const pid = await linkSatellite(SPUser, sp._id, { phone: '9876500002', name: 'SP Cust' });
    check('returns the platform id', () => assert.ok(pid));

    const reread = await SPUser.findById(sp._id).lean();
    check('sp_user carries platformUserId', () => assert.equal(String(reread.platformUserId), String(pid)));

    // A failing link must never throw at a registration site.
    let threw = null;
    try { await linkSatellite(SPUser, sp._id, { phone: 'garbage' }); } catch (e) { threw = e; }
    check('bad phone -> null, never a throw', () => assert.equal(threw, null));
}

console.log('\n[3] the resolver prefers links and survives missing phones');
{
    // Linked pair, but the satellite stores a DIFFERENT phone format than master --
    // exactly the case suffix matching gets right and exact matching would miss,
    // and vice versa: the link makes format irrelevant.
    const master = await FoodUser.create({ phone: '9876500003', name: 'Linked' });
    await QCUser.create({ phone: '+91-98765-00003', name: 'Linked', platformUserId: master._id });

    const r1 = await resolveCustomerIdentities(master._id);
    check('linked qc satellite resolves', () => assert.ok(r1.resolved.includes('quickCommerce')));

    // A master user with NO phone used to end resolution immediately; links do not
    // need one.
    const phoneless = await FoodUser.create({ phone: '0000000004', name: 'NoPhone' });
    await FoodUser.updateOne({ _id: phoneless._id }, { $set: { phone: '' } });
    await SPUser.create({ name: 'Sat', phone: '9876500005', platformUserId: phoneless._id });

    const r2 = await resolveCustomerIdentities(phoneless._id);
    check('resolution works with no phone on the master user', () => assert.ok(r2.resolved.includes('serviceProvider')));

    // Unlinked legacy satellite still resolves through the phone fallback.
    const legacyMaster = await FoodUser.create({ phone: '9876500006', name: 'Legacy' });
    await SPUser.create({ name: 'LegacySat', phone: '+919876500006' });
    const r3 = await resolveCustomerIdentities(legacyMaster._id);
    check('unlinked satellite still resolves via phone fallback', () => assert.ok(r3.resolved.includes('serviceProvider')));

    // Somebody ELSE's satellite must never resolve to this customer.
    const other = await FoodUser.create({ phone: '9876500007', name: 'Other' });
    const r4 = await resolveCustomerIdentities(other._id);
    check('no cross-customer leakage', () => assert.equal(r4.ids.length, 1));
}

console.log('\n[4] the backfill script');
{
    // Unlinked satellites: one matching an existing platform user, one brand new.
    await SPUser.create({ name: 'BF1', phone: '9876500008' });
    await FoodUser.create({ phone: '9876500008', name: 'BF1 master' });
    await QCUser.create({ phone: '9876500009', name: 'BF2 only-qc' });

    const { execFileSync } = await import('node:child_process');
    const env = { ...process.env, MONGO_URI: process.env.MONGO_URI };

    const dry = execFileSync('node', ['scripts/link-user-identities.js'], { env, encoding: 'utf8' });
    check('dry run reports the pending links', () => assert.match(dry, /DRY-RUN\s+linked=\d/));
    const stillUnlinked = await SPUser.countDocuments({ phone: '9876500008', platformUserId: null });
    check('dry run writes nothing', () => assert.equal(stillUnlinked, 1));

    const commit = execFileSync('node', ['scripts/link-user-identities.js', '--commit'], { env, encoding: 'utf8' });
    check('commit runs', () => assert.match(commit, /DONE/));

    const sp = await SPUser.findOne({ phone: '9876500008' }).lean();
    const master = await FoodUser.findOne({ phone: '9876500008' }).lean();
    check('satellite linked to the EXISTING platform user', () => assert.equal(String(sp.platformUserId), String(master._id)));

    const qc = await QCUser.findOne({ phone: '9876500009' }).lean();
    check('satellite-only customer got a platform identity created', () => assert.ok(qc.platformUserId));
    const created = await FoodUser.findById(qc.platformUserId).lean();
    check('...with the normalized phone and the satellite name', () => {
        assert.equal(created.phone, '9876500009');
        assert.equal(created.name, 'BF2 only-qc');
    });

    const again = execFileSync('node', ['scripts/link-user-identities.js', '--commit'], { env, encoding: 'utf8' });
    check('re-running is a no-op (idempotent)', () => assert.match(again, /linked=0 created=0/));
}

await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
