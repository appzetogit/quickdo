/**
 * Editing a promotional banner with a new image swaps the picture.
 *
 * Run: node tests/home-promotion-banner-edit.smoke.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'banner-edit-'));
process.env.UPLOAD_STORAGE_ROOT = uploadRoot;

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'banner_edit' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const svc = await import('../src/modules/food/landing/services/homePromotionBanner.service.js');
const { HomePromotionBanner } = await import('../src/modules/food/landing/models/homePromotionBanner.model.js');

// A 1x1 PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const created = await svc.createHomePromotionBanner({ buffer: png, originalname: 'a.png', mimetype: 'image/png' }, { title: 'Old' });
const oldFile = path.join(uploadRoot, created.publicId);

await check('the banner starts with its first image on disk', async () => {
  assert.ok(created.imageUrl);
  assert.ok(fs.existsSync(oldFile), oldFile);
});

await check('edit with a new image: new picture, old file removed, details saved', async () => {
  const updated = await svc.updateHomePromotionBanner(String(created._id), { title: 'New', zoneId: '' }, { buffer: png, originalname: 'b.png', mimetype: 'image/png' });
  assert.notEqual(updated.imageUrl, created.imageUrl);
  assert.notEqual(updated.publicId, created.publicId);
  assert.equal(updated.title, 'New');
  assert.equal(updated.zoneId, null);
  assert.ok(fs.existsSync(path.join(uploadRoot, updated.publicId)));
  assert.ok(!fs.existsSync(oldFile));
});

await check('edit without an image keeps the picture', async () => {
  const before = await HomePromotionBanner.findById(created._id).lean();
  const updated = await svc.updateHomePromotionBanner(String(created._id), { ctaLink: '/offers' });
  assert.equal(updated.imageUrl, before.imageUrl);
  assert.equal(updated.ctaLink, '/offers');
});

await check('fields outside the form are ignored', async () => {
  const before = await HomePromotionBanner.findById(created._id).lean();
  const updated = await svc.updateHomePromotionBanner(String(created._id), { imageUrl: 'https://evil.example/x.png', publicId: '../../etc', isActive: !before.isActive });
  assert.equal(updated.imageUrl, before.imageUrl);
  assert.equal(updated.publicId, before.publicId);
  assert.equal(updated.isActive, before.isActive);
});

await check('unknown banner returns null', async () => {
  assert.equal(await svc.updateHomePromotionBanner(String(new mongoose.Types.ObjectId()), { title: 'x' }), null);
});

await mongoose.disconnect();
await server.stop();
fs.rmSync(uploadRoot, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
