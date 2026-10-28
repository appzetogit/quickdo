/**
 * Delivery incentive ladders can be turned off (kept in history) or deleted.
 *
 * Run: node tests/incentive-delete.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
const m = await MongoMemoryServer.create(); await mongoose.connect(m.getUri());
const root = '../src/core/incentives/';
const { DriverIncentiveRule } = await import(root + 'models/driverIncentiveRule.model.js');
const c = await import(root + 'controllers/incentiveController.js');
const call = async (fn, req) => { let out = {}; const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } }; await fn(req, res, (e) => { throw e; }); return out; };
const a = await DriverIncentiveRule.collection.insertOne({ segment: 'foodAndQuick', targetOrders: 5, rewardAmount: 100, isActive: true, createdAt: new Date() });
const b = await DriverIncentiveRule.create({ segment: 'taxiAndPorter', tiers: [{ fromOrders: 1, toOrders: 5, rewardAmount: 50 }] });
let r = await call(c.deactivateIncentiveRuleController, { params: { id: String(b._id) }, query: {} });
assert.equal(r.status, 200); assert.equal((await DriverIncentiveRule.findById(b._id).lean()).isActive, false);
r = await call(c.deactivateIncentiveRuleController, { params: { id: String(a.insertedId) }, query: { permanent: '1' } });
assert.equal(r.status, 200); assert.equal(r.body.data.wasActive, true);
assert.equal(await DriverIncentiveRule.countDocuments({ _id: a.insertedId }), 0);
r = await call(c.deactivateIncentiveRuleController, { params: { id: String(a.insertedId) }, query: { permanent: '1' } });
assert.equal(r.status, 404);
const list = await call(c.listIncentiveRulesController, { query: {} });
assert.equal(list.body.data.recent.length, 1); assert.equal(list.body.data.active.length, 0);
console.log('turn off, permanent delete (incl. an old-style live rule), 404 on repeat, list: all ok');
await mongoose.disconnect(); await m.stop(); process.exit(0);
