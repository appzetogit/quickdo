/**
 * Identity documents are private: signed, expiring links only.
 *
 * Run: node tests/private-files.smoke.mjs
 *
 * What this guards:
 *   - /uploads refuses PAN, GST, FSSAI, Aadhaar, licence and prescription paths,
 *     but still serves menus and banners;
 *   - an API response to a signed-in caller carries a signed link that opens
 *     the file (old /uploads-era files included), and a tampered or expired one
 *     does not;
 *   - an anonymous response carries an unsigned link (storable, not openable);
 *   - a signed link posted back is stored unsigned;
 *   - new uploads of these documents land outside the public folder.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
process.env.UPLOAD_STORAGE_ROOT = path.join(tmp, 'uploads');
process.env.PRIVATE_UPLOAD_ROOT = path.join(tmp, 'private-uploads');
process.env.UPLOAD_BASE_URL = 'https://example.test/uploads';
process.env.NODE_ENV = 'test';

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); } catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

const pf = await import('../src/core/files/privateFiles.js');
const storage = await import('../src/services/storage.service.js');

fs.mkdirSync(path.join(tmp, 'uploads', 'food/restaurants/pan'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'uploads', 'food/restaurants/menu'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'uploads', 'food/restaurants/pan/old.webp'), 'PANBYTES');
fs.writeFileSync(path.join(tmp, 'uploads', 'food/restaurants/menu/dish.webp'), 'MENUBYTES');

const app = express();
app.use(express.json());
app.use('/uploads', pf.blockPrivateStatic, express.static(path.join(tmp, 'uploads'), { fallthrough: false }));
app.get('/api/v1/files/p/*', pf.servePrivateFile);
app.use('/api', pf.privateFileLinks);
app.get('/api/doc', (req, res) => {
  if (req.headers['x-user']) req.user = { userId: 'u1' };
  res.json({ success: true, data: { panImage: 'https://example.test/uploads/food/restaurants/pan/old.webp', menu: 'https://example.test/uploads/food/restaurants/menu/dish.webp' } });
});
app.post('/api/echo', (req, res) => res.json({ got: req.body }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = (p, headers = {}) => fetch(`${base}${p}`, { headers });

await check('/uploads refuses identity documents', async () => {
  assert.equal((await get('/uploads/food/restaurants/pan/old.webp')).status, 404);
});
await check('/uploads still serves menus', async () => {
  assert.equal((await get('/uploads/food/restaurants/menu/dish.webp')).status, 200);
});

let signed;
await check('a signed-in response carries a signed link, menus untouched', async () => {
  const body = await (await get('/api/doc', { 'x-user': '1' })).json();
  signed = body.data.panImage;
  assert.match(signed, /^https:\/\/example\.test\/api\/v1\/files\/p\/food\/restaurants\/pan\/old\.webp\?e=\d+&s=/);
  assert.equal(body.data.menu, 'https://example.test/uploads/food/restaurants/menu/dish.webp');
});
await check('the signed link opens the old file', async () => {
  const u = new URL(signed);
  const r = await get(u.pathname + u.search);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'PANBYTES');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
});
await check('a tampered or expired link does not', async () => {
  const u = new URL(signed);
  assert.equal((await get(u.pathname + u.search.replace(/s=./, 's=X'))).status, 403);
  assert.equal((await get(u.pathname + '?e=1&s=abc')).status, 403);
  assert.equal((await get(u.pathname)).status, 403);
});
await check('an anonymous response carries an unsigned link', async () => {
  const body = await (await get('/api/doc')).json();
  assert.equal(body.data.panImage, 'https://example.test/api/v1/files/p/food/restaurants/pan/old.webp');
});
await check('a signed link posted back is stored unsigned', async () => {
  const r = await fetch(`${base}/api/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panImage: signed }) });
  const body = await r.json();
  assert.equal(body.got.panImage, 'https://example.test/api/v1/files/p/food/restaurants/pan/old.webp');
});
await check('new identity documents are written outside the public folder', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6300010000050001' + '0d0a2db40000000049454e44ae426082', 'hex');
  const stored = await storage.saveImageFile({ buffer: png, mimetype: 'image/png' }, 'food/restaurants/gst');
  assert.match(stored.url, /\/api\/v1\/files\/p\/food\/restaurants\/gst\//);
  assert.ok(fs.existsSync(path.join(tmp, 'private-uploads', stored.path)), 'in the private root');
  assert.ok(!fs.existsSync(path.join(tmp, 'uploads', stored.path)), 'not in the public root');
});

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
