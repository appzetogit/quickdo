/**
 * Idempotency ledger: mounts the real middleware on a throwaway Express app backed by
 * an in-memory MongoDB, and drives it over actual HTTP.
 *
 * The behaviour worth guarding is the behaviour that costs money if it breaks: a
 * double-tapped "Place order" must create one order, not two, and a client retrying
 * over a flaky connection must get the first response back rather than a second
 * charge. The concurrency case matters most -- two requests arriving in the same
 * millisecond is exactly the shape a double-tap produces, and it is the one a
 * check-then-insert would let through.
 *
 * Run:  node tests/idempotency.smoke.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let fails = 0;
const test = async (name, fn) => {
    try { await fn(); console.log(`  PASS  ${name}`); }
    catch (err) { fails += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
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

    const { idempotency } = await import('../src/middleware/idempotency.js');
    const { IdempotencyKey } = await import('../src/core/idempotency/idempotencyKey.model.js');
    await IdempotencyKey.syncIndexes();

    // Counts real executions, so "did the handler run twice?" is directly observable
    // rather than inferred from the response.
    let executions = 0;

    const app = express();
    app.use(express.json());
    // A stand-in for authMiddleware: the ledger scopes by req.user, and the scoping
    // is one of the things under test.
    app.use((req, _res, next) => {
        req.user = { userId: req.headers['x-test-user'] || 'user-1' };
        next();
    });
    app.post('/orders', idempotency(), (req, res) => {
        executions += 1;
        res.status(201).json({ success: true, orderId: `ORD-${executions}`, echo: req.body });
    });
    app.post('/boom', idempotency(), (_req, res) => {
        executions += 1;
        res.status(500).json({ success: false, message: 'gateway exploded' });
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const post = (path, body, headers = {}) => new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request(
            {
                host: '127.0.0.1', port, path, method: 'POST',
                headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
            },
            (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
            },
        );
        req.on('error', reject);
        req.end(payload);
    });

    console.log('\n[1] Without a key, nothing changes');

    await test('no Idempotency-Key means the request just runs', async () => {
        executions = 0;
        const a = await post('/orders', { item: 'x' });
        const b = await post('/orders', { item: 'x' });
        assert.equal(a.status, 201);
        assert.equal(b.status, 201);
        assert.equal(executions, 2, 'existing clients must be unaffected');
        assert.notEqual(a.body.orderId, b.body.orderId);
    });

    console.log('\n[2] With a key, a retry replays');

    await test('the same key executes once and replays the first response', async () => {
        executions = 0;
        const headers = { 'idempotency-key': 'key-retry-1' };
        const first = await post('/orders', { item: 'atta' }, headers);
        const second = await post('/orders', { item: 'atta' }, headers);

        assert.equal(executions, 1, 'the handler ran twice — this is the duplicate order');
        assert.equal(second.status, first.status);
        assert.deepEqual(second.body, first.body, 'the retry must get the original response');
    });

    await test('x-idempotency-key is accepted too', async () => {
        executions = 0;
        const headers = { 'x-idempotency-key': 'key-alt-1' };
        await post('/orders', { item: 'ghee' }, headers);
        await post('/orders', { item: 'ghee' }, headers);
        assert.equal(executions, 1);
    });

    console.log('\n[3] Concurrency — the double-tap case');

    await test('two simultaneous requests with one key execute once', async () => {
        executions = 0;
        const headers = { 'idempotency-key': 'key-race-1' };
        const [a, b] = await Promise.all([
            post('/orders', { item: 'rice' }, headers),
            post('/orders', { item: 'rice' }, headers),
        ]);

        assert.equal(executions, 1, 'both requests executed — the unique index did not hold');
        // The loser either replays the winner's response or is told to retry; both are
        // correct, and both mean only one order exists.
        const statuses = [a.status, b.status].sort();
        assert.ok(
            statuses[0] === 201 && (statuses[1] === 201 || statuses[1] === 409),
            `unexpected statuses: ${statuses}`,
        );
    });

    console.log('\n[4] Misuse is rejected, not silently swallowed');

    await test('the same key with a different body is a 422', async () => {
        executions = 0;
        const headers = { 'idempotency-key': 'key-mismatch-1' };
        await post('/orders', { item: 'dal', qty: 1 }, headers);
        const second = await post('/orders', { item: 'dal', qty: 99 }, headers);

        assert.equal(second.status, 422);
        assert.equal(executions, 1);
        assert.match(second.body.message, /different request body/);
    });

    console.log('\n[5] Scoping');

    await test('the same key from a different user does not collide', async () => {
        executions = 0;
        const key = { 'idempotency-key': 'key-shared-1' };
        const a = await post('/orders', { item: 'oil' }, { ...key, 'x-test-user': 'user-A' });
        const b = await post('/orders', { item: 'oil' }, { ...key, 'x-test-user': 'user-B' });

        assert.equal(executions, 2, 'two different users must both get their order');
        assert.notEqual(a.body.orderId, b.body.orderId,
            'user B replayed user A\'s response — the scope is missing the owner');
    });

    await test('the same key on a different endpoint does not collide', async () => {
        executions = 0;
        const headers = { 'idempotency-key': 'key-path-1' };
        await post('/orders', { item: 'tea' }, headers);
        const other = await post('/boom', { item: 'tea' }, headers);
        assert.equal(executions, 2, 'the scope must include the path');
        assert.equal(other.status, 500);
    });

    console.log('\n[6] Failures do not pin the key');

    await test('a failed request releases its key so a retry can succeed', async () => {
        executions = 0;
        const headers = { 'idempotency-key': 'key-fail-1' };
        const failed = await post('/boom', { item: 'z' }, headers);
        assert.equal(failed.status, 500);

        // Give the fire-and-forget release a moment to land.
        await new Promise((r) => setTimeout(r, 150));

        const stored = await IdempotencyKey.findOne({ key: 'key-fail-1' }).lean();
        assert.equal(stored, null, 'a 500 was stored, so the client can never retry its way out');
    });

    await test('only 2xx responses are stored for replay', async () => {
        const ok = await IdempotencyKey.findOne({ key: 'key-retry-1' }).lean();
        assert.equal(ok.status, 'completed');
        assert.equal(ok.responseStatus, 201);
        assert.ok(ok.responseBody?.orderId, 'the response body must be replayable');
        assert.ok(ok.fingerprint, 'the body fingerprint must be recorded');
    });

    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await rs.stop();

    console.log(fails === 0 ? '\nIdempotency ledger holds.\n' : `\n${fails} FAILED\n`);
    process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
