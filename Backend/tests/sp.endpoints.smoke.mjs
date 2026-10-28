// Sweeps every GET endpoint the Service-Provider module exposes and fails on any 5xx.
//
// Point: a controller that references an unimported symbol, or populates a model that
// was never registered, returns 500 only when that one endpoint is hit. Unit tests and
// a boot check both miss it. This walks the real router table and calls all of them.
//
// 4xx is fine (missing fixtures, not-found ids). 5xx is a bug.
//
// Run: node tests/sp.endpoints.smoke.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const OID = '000000000000000000000001';

/** Recursively collect GET paths from an express router stack. */
const collectGetPaths = (stack, prefix = '') => {
    const out = [];
    for (const layer of stack) {
        if (layer.route) {
            if (layer.route.methods?.get) out.push(prefix + layer.route.path);
            continue;
        }
        if (layer.name === 'router' && layer.handle?.stack) {
            // Recover the mount path from the layer's regexp. Express stores it as a
            // regexp; when mounted at '/' there is no meaningful prefix.
            let mount = '';
            const src = layer.regexp?.source ?? '';
            if (src !== '^\\/?(?=\\/|$)') {
                mount = src
                    .replace(/^\^/, '')
                    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
                    .replace(/\$$/, '')
                    .replace(/\\\//g, '/');
            }
            out.push(...collectGetPaths(layer.handle.stack, prefix + mount));
        }
    }
    return out;
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.NODE_ENV = 'test';
await mongoose.connect(process.env.MONGO_URI);

const { default: app } = await import('../src/app.js');
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { default: spRouter } = await import('../src/modules/serviceProvider/routes/index.js');

await FoodAdmin.create({
    email: 'sweep@test.local',
    password: 'Passw0rd!',
    name: 'Sweep',
    isActive: true,
    servicesAccess: ['serviceProvider'],
    adminLevel: 'sp_superadmin',
    admin_type: 'superadmin',
    role: 'super_admin',
    permissions: ['*'],
});

const server = app.listen(0);
const port = server.address().port;

const call = (path, method = 'GET', body = null, token = null) =>
    new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const headers = {};
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });

const login = await call('/api/v1/sp/admin/auth/login', 'POST', { email: 'sweep@test.local', password: 'Passw0rd!' });
const token = JSON.parse(login.body).accessToken;
assert.ok(token, 'could not obtain an SP admin token');

const paths = [...new Set(collectGetPaths(spRouter.stack))]
    .filter((p) => p && !p.includes('*'))
    .map((p) => p.replace(/:[A-Za-z0-9_]+/g, OID))
    .sort();

const serverErrors = [];
let ok = 0;
let clientErr = 0;

for (const p of paths) {
    const res = await call(`/api/v1/sp${p}`, 'GET', null, token);
    if (res.status >= 500) serverErrors.push(`${p} -> ${res.status} ${res.body.slice(0, 120)}`);
    else if (res.status < 400) ok++;
    else clientErr++;
}

console.log(`\nswept ${paths.length} GET endpoints`);
console.log(`  2xx/3xx : ${ok}`);
console.log(`  4xx     : ${clientErr}`);
console.log(`  5xx     : ${serverErrors.length}`);
if (serverErrors.length) {
    console.log('\n--- SERVER ERRORS ---');
    serverErrors.forEach((e) => console.log('  ' + e));
}

server.close();
await mongoose.disconnect();
await mongod.stop();

if (paths.length < 50) {
    console.log(`\nFAIL — only ${paths.length} routes discovered, the walker is broken\n`);
    process.exit(1);
}
console.log(`\n${serverErrors.length === 0 ? 'PASS' : `FAIL — ${serverErrors.length} endpoint(s) returned 5xx`}\n`);
process.exit(serverErrors.length === 0 ? 0 : 1);
