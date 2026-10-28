/**
 * Transactions on a standalone MongoDB (the superapp server).
 *
 * Run: node tests/standalone-transactions.smoke.mjs
 *
 * mongodb-memory-server runs a standalone mongod, like superapp. Before the
 * guard, a write inside startTransaction fails with "Transaction numbers are
 * only allowed on a replica set member"; after it, the writes go through.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'standalone_tx' });
const Thing = mongoose.model('Thing', new mongoose.Schema({ n: Number }));
await Thing.create({ n: 1 });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const txWrite = async () => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const doc = await Thing.findOne({ n: 1 }).session(session);
    doc.n = 2;
    await doc.save({ session });
    await session.commitTransaction();
  } finally {
    await session.endSession();
  }
};

await check('without the guard, a transaction fails on a standalone server', async () => {
  await assert.rejects(txWrite, /Transaction numbers are only allowed/);
});

const { adaptTransactionsToTopology } = await import('../src/config/standaloneTransactions.js');
await check('the guard detects standalone and adapts', async () => {
  const r = await adaptTransactionsToTopology(mongoose.connection);
  assert.equal(r.standalone, true);
  assert.equal(r.patched, true);
});
await check('after it, the same code path writes', async () => {
  await txWrite();
  assert.equal((await Thing.findOne({}).lean()).n, 2);
});
await check('withTransaction runs its callback', async () => {
  const session = await mongoose.startSession();
  const out = await session.withTransaction(async () => Thing.updateOne({}, { $set: { n: 3 } }));
  await session.endSession();
  assert.ok(out);
  assert.equal((await Thing.findOne({}).lean()).n, 3);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall standalone transaction checks passed');
process.exit(failed ? 1 : 0);
