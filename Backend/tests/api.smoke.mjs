/**
 * API-level smoke tests: boots the REAL Express app in-process against an isolated
 * in-memory MongoDB and makes actual HTTP requests. Never touches the Atlas cluster.
 *
 * This closes the gap left by the data-layer suites — it exercises routing, auth
 * middleware, request validation and response shapes, not just Mongo queries.
 *
 * Run:  node tests/api.smoke.mjs
 */
import assert from 'assert';
import http from 'http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ ok: false }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = rs.getUri();

  // Env must be set BEFORE importing the app (config is read at module load).
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI = uri;
  process.env.REDIS_ENABLED = 'false';
  process.env.BULLMQ_ENABLED = 'false';
  process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
  process.env.JWT_SECRET ||= 'test-access-secret';
  process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
  process.env.NODE_ENV = 'test';

  await mongoose.connect(uri, { dbName: 'apismoke' });

  const { default: app } = await import('../src/app.js');
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { signAccessToken } = await import('../src/modules/taxi/services/tokenService.js');

  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  console.log(`App listening on ${base}\n`);

  const req = async (method, path, { token, body } = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await r.json(); } catch { /* non-JSON */ }
    return { status: r.status, body: json };
  };

  let seq = 9200000000;
  const mkDriver = async (over = {}) => {
    const d = await Driver.create({
      name: 'API Driver', phone: `+91${seq++}`, password: 'secret123', vehicleType: 'car',
      isOnline: true, approve: true, status: 'approved',
      serviceCapabilities: ['taxi', 'delivery'], workMode: 'all',
      location: { type: 'Point', coordinates: [72.5, 23.0] },
      ...over,
    });
    return { driver: d, token: signAccessToken({ sub: String(d._id), role: 'driver' }) };
  };

  console.log('Auth');

  await test('work-mode rejects an unauthenticated request', async () => {
    const r = await req('PATCH', '/taxi/drivers/work-mode', { body: { workMode: 'taxi' } });
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  });

  await test('work-mode rejects a garbage token', async () => {
    const r = await req('PATCH', '/taxi/drivers/work-mode', { token: 'not-a-jwt', body: { workMode: 'taxi' } });
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  });

  console.log('\nWork-mode endpoint');

  await test('sets workMode to "taxi" and persists it', async () => {
    const { driver, token } = await mkDriver();
    const r = await req('PATCH', '/taxi/drivers/work-mode', { token, body: { workMode: 'taxi' } });
    assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.data?.workMode, 'taxi');
    const fresh = await Driver.findById(driver._id).lean();
    assert.equal(fresh.workMode, 'taxi', 'persisted to DB');
  });

  await test('sets workMode to "delivery"', async () => {
    const { driver, token } = await mkDriver();
    const r = await req('PATCH', '/taxi/drivers/work-mode', { token, body: { workMode: 'delivery' } });
    assert.equal(r.status, 200);
    assert.equal((await Driver.findById(driver._id).lean()).workMode, 'delivery');
  });

  await test('rejects an invalid workMode value', async () => {
    const { token } = await mkDriver();
    const r = await req('PATCH', '/taxi/drivers/work-mode', { token, body: { workMode: 'bicycles' } });
    assert.equal(r.status, 400, `expected 400, got ${r.status}`);
  });

  await test('rejects a missing workMode', async () => {
    const { token } = await mkDriver();
    const r = await req('PATCH', '/taxi/drivers/work-mode', { token, body: {} });
    assert.equal(r.status, 400);
  });

  console.log('\nCapability guards');

  await test('taxi-only driver cannot select "delivery"', async () => {
    const { token } = await mkDriver({ serviceCapabilities: ['taxi'] });
    const r = await req('PATCH', '/taxi/drivers/work-mode', { token, body: { workMode: 'delivery' } });
    assert.equal(r.status, 400, `expected 400, got ${r.status}`);
  });

  await test('taxi-only driver cannot select "all"', async () => {
    const { token } = await mkDriver({ serviceCapabilities: ['taxi'] });
    const r = await req('PATCH', '/taxi/drivers/work-mode', { token, body: { workMode: 'all' } });
    assert.equal(r.status, 400);
  });

  await test('delivery-only driver cannot select "taxi"', async () => {
    const { token } = await mkDriver({ serviceCapabilities: ['delivery'] });
    const r = await req('PATCH', '/taxi/drivers/work-mode', { token, body: { workMode: 'taxi' } });
    assert.equal(r.status, 400);
  });

  await test('a driver cannot change another driver\'s work mode', async () => {
    const { driver: victim } = await mkDriver({ workMode: 'all' });
    const { token: attackerToken } = await mkDriver();
    // The endpoint derives the driver from the token, so the victim must be untouched.
    await req('PATCH', '/taxi/drivers/work-mode', { token: attackerToken, body: { workMode: 'taxi', driverId: String(victim._id) } });
    assert.equal((await Driver.findById(victim._id).lean()).workMode, 'all', 'victim unchanged');
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);

  await new Promise((res) => server.close(res));
  await mongoose.disconnect().catch(() => {});
  await rs.stop().catch(() => {});
  return failed;
}

let code = 1;
try { code = await main(); } catch (e) { console.error('Harness error:', e); code = 1; }
process.exit(code === 0 ? 0 : 1);
