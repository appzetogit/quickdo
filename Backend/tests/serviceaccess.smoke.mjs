// Server-side vertical access.
//
// Before this middleware, servicesAccess gated only the sidebar: any admin token
// reached every vertical's admin API. These checks pin the SP rule now applied
// platform-wide: non-empty servicesAccess must name the vertical; absent/empty
// means unrestricted; quick-commerce-native admins (qc_admins) pass; unknown ids do not.
//
// Run: node tests/serviceaccess.smoke.mjs

import assert from 'node:assert/strict';
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

const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { requireServiceAccess } = await import('../src/core/roles/serviceAccess.middleware.js');

const run = (vertical, req) => new Promise((resolve, reject) => {
    let status = null;
    const res = { };
    res.status = (c) => { status = c; return res; };
    res.json = () => resolve({ status, passed: false });
    requireServiceAccess(vertical)(req, res, (err) => (err ? reject(err) : resolve({ status: 200, passed: true })));
});

// servicesAccess DEFAULTS to ['food'] in the schema -- an admin created without the
// field is food-scoped, not unrestricted. Unrestricted must be explicit [].
const unrestricted = await FoodAdmin.create({ name: 'Legacy', email: 'legacy@x.com', password: 'x', role: 'admin', servicesAccess: [] });
const foodOnly = await FoodAdmin.create({ name: 'FoodOnly', email: 'food@x.com', password: 'x', role: 'admin', servicesAccess: ['food'] });
const multi = await FoodAdmin.create({ name: 'Multi', email: 'multi@x.com', password: 'x', role: 'admin', servicesAccess: ['food', 'quickCommerce'] });
const inactive = await FoodAdmin.create({ name: 'Off', email: 'off@x.com', password: 'x', role: 'admin', isActive: false });

const reqFor = (id) => ({ user: { userId: String(id) } });

console.log('\n[1] the SP rule, platform-wide');
{
    const a = await run('food', reqFor(unrestricted._id));
    check('empty servicesAccess is unrestricted', () => assert.equal(a.passed, true));
    const a2 = await run('taxi', reqFor(unrestricted._id));
    check('empty servicesAccess reaches every vertical', () => assert.equal(a2.passed, true));

    const defaulted = await FoodAdmin.create({ name: 'Def', email: 'def@x.com', password: 'x', role: 'admin' });
    const a3 = await run('quickCommerce', reqFor(defaulted._id));
    check("schema default ['food'] scopes an admin created without the field", () => assert.equal(a3.status, 403));

    const b = await run('food', reqFor(foodOnly._id));
    check('scoped admin passes their own vertical', () => assert.equal(b.passed, true));

    const c = await run('quickCommerce', reqFor(foodOnly._id));
    check('scoped admin is 403 on another vertical', () => {
        assert.equal(c.passed, false);
        assert.equal(c.status, 403);
    });

    const d = await run('quickCommerce', reqFor(multi._id));
    check('multi-vertical access works', () => assert.equal(d.passed, true));

    const e = await run('taxi', reqFor(multi._id));
    check('...and still excludes unlisted verticals', () => assert.equal(e.status, 403));
}

console.log('\n[2] edges');
{
    const a = await run('food', reqFor(inactive._id));
    check('inactive platform admin is 403 everywhere', () => assert.equal(a.status, 403));

    // A quick-commerce-native admin (in qc_admins, not the platform collection)
    // passes; an id found in neither is refused -- it used to pass, so a
    // deleted admin's token kept working until it expired.
    const { FoodAdmin: QCAdmin } = await import('../src/modules/quickCommerce/core/admin/admin.model.js');
    const qcNative = await QCAdmin.collection.insertOne({ email: 'qc@x.in', isActive: true, isDeleted: false });
    const b = await run('quickCommerce', reqFor(qcNative.insertedId));
    check('vertical-native admin (in qc_admins) passes', () => assert.equal(b.passed, true));
    const b2 = await run('quickCommerce', reqFor(new mongoose.Types.ObjectId()));
    check('an admin id found nowhere is refused', () => assert.equal(b2.status, 403));
    const b3 = await run('food', reqFor(new mongoose.Types.ObjectId()));
    check('... on food too', () => assert.equal(b3.status, 403));

    const c = await run('food', { user: {} });
    check('no subject -> 401', () => assert.equal(c.status, 401));

    const d = await run('taxi', { auth: { sub: String(unrestricted._id) } });
    check("taxi's req.auth.sub shape is understood", () => assert.equal(d.passed, true));
}

await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
