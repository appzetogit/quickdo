/**
 * Admin alerts reach every signed-in admin, and nobody else.
 *
 * Run: node tests/admin-alerts.smoke.mjs
 *
 * The admin panel's sound never rang for new orders: it listened for an event
 * the server never sent, without a token the server would accept. Alerts now go
 * out as `admin_alert` to the admin room that admin sockets join on connect.
 *
 * Uses the frontend's socket.io-client (the backend has no client dependency
 * and does not need one in production).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.REDIS_ENABLED = 'false';
process.env.ADMIN_ALERT_PUSH = 'false';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromFrontend = createRequire(path.join(here, '../../Frontend/package.json'));
const { io: connect } = requireFromFrontend('socket.io-client');

const { initSocket } = await import('../src/config/socket.js');
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { alertAdmins, buildAdminAlert, ADMIN_ALERT_EVENT } = await import('../src/core/notifications/adminAlerts.js');

const server = http.createServer();
const io = await initSocket(server);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;

const open = (role) =>
    new Promise((resolve, reject) => {
        const token = signAccessToken({ userId: `000000000000000000000${role.length}0`.slice(-24), role });
        const s = connect(url, { transports: ['websocket'], auth: { token }, reconnection: false });
        const got = [];
        s.on(ADMIN_ALERT_EVENT, (a) => got.push(a));
        s.on('connect', () => resolve({ s, got }));
        s.on('connect_error', reject);
    });
const settle = () => new Promise((r) => setTimeout(r, 150));

const admin = await open('ADMIN');
const superAdmin = await open('SUPER_ADMIN');
const superAdminNoUnderscore = await open('superadmin');
const customer = await open('USER');
const restaurant = await open('RESTAURANT');
await settle();

await check('an alert reaches admins and super admins, not customers or restaurants', async () => {
    alertAdmins({ kind: 'order', module: 'food', title: 'New food order #QD1', refId: 'o1', link: '/admin/food/orders/all' });
    await settle();
    assert.equal(admin.got.length, 1);
    assert.equal(superAdmin.got.length, 1);
    assert.equal(superAdminNoUnderscore.got.length, 1, 'role "superadmin" (live data) missed the alert');
    assert.equal(customer.got.length, 0);
    assert.equal(restaurant.got.length, 0);
    assert.equal(admin.got[0].title, 'New food order #QD1');
    assert.equal(admin.got[0].link, '/admin/food/orders/all');
});

await check('the same record rings once (retries and echoes are dropped)', async () => {
    alertAdmins({ kind: 'order', module: 'food', title: 'New food order #QD1', refId: 'o1' });
    await settle();
    assert.equal(admin.got.length, 1);
});

await check('SOS is urgent; other kinds are not', async () => {
    alertAdmins({ kind: 'sos', module: 'taxi', title: 'SOS', refId: 's1' });
    await settle();
    const sos = admin.got.find((a) => a.kind === 'sos');
    assert.ok(sos && sos.urgent === true);
    assert.equal(admin.got[0].urgent, false);
});

await check('payload is tidy: unknown kind falls back, outside links dropped, long text cut', async () => {
    const a = buildAdminAlert({ kind: 'nope', module: 'food', title: 'x'.repeat(300), link: 'https://evil.example', refId: 'r' });
    assert.equal(a.kind, 'order');
    assert.equal(a.link, '');
    assert.equal(a.title.length, 120);
});

await check('never throws without a socket server or with junk input', async () => {
    assert.doesNotThrow(() => alertAdmins(undefined));
    assert.doesNotThrow(() => alertAdmins({ title: null }));
});

for (const c of [admin, superAdmin, superAdminNoUnderscore, customer, restaurant]) c.s.close();
io.close();
server.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
