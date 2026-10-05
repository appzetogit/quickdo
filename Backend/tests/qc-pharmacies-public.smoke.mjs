/**
 * Anyone can browse pharmacies; only a signed-in customer can send one a
 * prescription.
 *
 * Run: node tests/qc-pharmacies-public.smoke.mjs
 *
 * GET /qc/medical/pharmacies sat behind the login check with the rest of
 * /medical. A customer whose session had lapsed opened the Medical tab to
 * "Could not load pharmacies -- check your connection" while Food and Rides
 * beside it rendered normally, because their browse screens are public.
 * Production logged these 401s every day, all "token required": the phones
 * were sending no token at all.
 *
 * Drives the real quick-commerce router over HTTP, so the ORDER of the mounts
 * is what is tested -- the public route only works if it answers before the
 * authenticated /medical block does.
 */
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const qcRouter = (await import('../src/modules/quickCommerce/routes/index.js')).default;
const app = express();
app.use(express.json());
app.use('/api/v1/qc', qcRouter);
// Errors as JSON with their status, as the real app does.
app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1/qc`;

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

await check('a signed-out customer can browse pharmacies', async () => {
  const res = await fetch(`${base}/medical/pharmacies?lat=22.728&lng=75.884`);
  // Not 401. With no pharmacies seeded the list is simply empty.
  assert.notEqual(res.status, 401, 'still behind the login check');
  assert.equal(res.status, 200, `status ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body?.data?.pharmacies), 'no pharmacies array');
});

await check('without a location it asks for one, rather than refusing the customer', async () => {
  const res = await fetch(`${base}/medical/pharmacies`);
  assert.notEqual(res.status, 401);
  const body = await res.json();
  assert.match(String(body.message), /location/i);
});

await check('sending a prescription still requires signing in', async () => {
  const res = await fetch(`${base}/medical/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(res.status, 401, `a prescription was accepted without a login (status ${res.status})`);
});

await check("reading your own requests still requires signing in", async () => {
  const res = await fetch(`${base}/medical/requests`);
  assert.equal(res.status, 401, `status ${res.status}`);
});

await check('cancelling a request still requires signing in', async () => {
  const res = await fetch(`${base}/medical/requests/${new mongoose.Types.ObjectId()}/cancel`, { method: 'POST' });
  assert.equal(res.status, 401, `status ${res.status}`);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
