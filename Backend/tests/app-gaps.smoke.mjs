/**
 * Three things the customer app asked the server for and got 404, plus Taxi
 * campaigns reaching the shared inbox.
 *
 * Run: node tests/app-gaps.smoke.mjs
 *
 *   GET /taxi/users/banners                         the Rides home strip
 *   GET /taxi/users/rental-vehicles, /rental-bookings   Rental, switched on
 *   GET /food/hero-banners/home-header-video/public the Food header video
 *   Taxi campaign -> every targeted customer's inbox, once, push or not
 */
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
  }
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(mongod.getUri());
const db = mongoose.connection;

const { userRouter } = await import('../src/modules/taxi/user/routes/userRoutes.js');
const landingRoutes = (await import('../src/modules/food/landing/routes/landing.routes.js')).default;
const { sendPushNotificationToAudience } = await import('../src/modules/taxi/services/pushNotificationService.js');

const app = express();
app.use(express.json());
app.use('/api/v1/taxi/users', userRouter);
app.use('/api/v1/food', landingRoutes);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1`;
const get = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};

const oid = () => new mongoose.Types.ObjectId();
await db.collection('taxibanners').insertMany([
  { title: 'Monsoon offer', image: 'https://x/m.jpg', redirect_url: 'https://x/offer', active: true, createdAt: new Date(Date.now() - 1000) },
  { title: 'Old', image: 'https://x/o.jpg', active: false, createdAt: new Date() },
  { title: 'Airport rides', image: 'https://x/a.jpg', deep_link: 'app://taxi/airport', createdAt: new Date() },
]);
await db.collection('food_hero_banners').insertMany([
  { imageUrl: 'https://x/header.gif', module: 'food', isActive: true, sortOrder: 0 },
  { imageUrl: 'https://x/header.mp4', resourceType: 'video', isActive: true, sortOrder: 1 },
  { imageUrl: 'https://x/rides.mp4', resourceType: 'video', module: 'taxi', isActive: true },
  { imageUrl: 'https://x/off.webm', isActive: false },
]);

console.log('\nRides banners');
await check('active banners, newest first, with the link the app opens', async () => {
  const r = await get('/taxi/users/banners');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.results.map((b) => [b.title, b.link]), [
    ['Airport rides', 'app://taxi/airport'],
    ['Monsoon offer', 'https://x/offer'],
  ]);
  assert.equal(r.body.data.results[0].image, 'https://x/a.jpg');
});

console.log('\nRental');
await check('the rental catalogue answers instead of 404', async () => {
  const r = await get('/taxi/users/rental-vehicles');
  assert.notEqual(r.status, 404, JSON.stringify(r.body));
});
await check('my rental bookings needs sign-in (401), not 404', async () => {
  const r = await get('/taxi/users/rental-bookings');
  assert.equal(r.status, 401, JSON.stringify(r.body));
});

console.log('\nFood header video');
await check('Food\'s video header banners, not GIFs, other sections or paused ones', async () => {
  const r = await get('/food/hero-banners/home-header-video/public');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.videos.map((v) => v.sourceUrl), ['https://x/header.mp4']);
  assert.equal(r.body.data.video.gifUrl, 'https://x/header.mp4');
});

console.log('\nTaxi campaigns in the inbox');
const u1 = oid();
const u2 = oid();
const gone = oid();
await db.collection('users').insertMany([
  { _id: u1, phone: '9000000001' },
  { _id: u2, phone: '9000000002', fcmTokens: [] },
  { _id: gone, phone: '9000000003', deletedAt: new Date() },
]);
const inbox = (id) => db.collection('food_notifications').find({ ownerId: id, ownerType: 'USER' }).toArray();
await check('a campaign to users lands in every active customer\'s inbox, push configured or not', async () => {
  const res = await sendPushNotificationToAudience({ notificationId: 'c1', sendTo: 'users', title: 'Weekend rides', body: '20% off', image: 'https://x/w.jpg' });
  assert.equal(res.deliveredCount, 0);
  const [n] = await inbox(u1);
  assert.equal(n.title, 'Weekend rides');
  assert.equal(n.vertical, 'taxi');
  assert.equal(n.source, 'ADMIN_BROADCAST');
  assert.equal((await inbox(u2)).length, 1);
  assert.equal((await inbox(gone)).length, 0);
});
await check('resending the same campaign files it once', async () => {
  await sendPushNotificationToAudience({ notificationId: 'c1', sendTo: 'all', title: 'Weekend rides', body: '20% off' });
  assert.equal((await inbox(u1)).length, 1);
});
await check('a drivers-only campaign does not reach customers', async () => {
  await sendPushNotificationToAudience({ notificationId: 'c2', sendTo: 'drivers', title: 'Driver bonus', body: 'Earn more' });
  assert.equal((await inbox(u1)).length, 1);
});

server.close();
await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll app-gap checks passed');
process.exit(failed ? 1 : 0);
