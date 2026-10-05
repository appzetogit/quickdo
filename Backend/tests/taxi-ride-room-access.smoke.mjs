/**
 * Only a ride's own rider and driver can join its room or read it.
 *
 * Run: node tests/taxi-ride-room-access.smoke.mjs
 *
 * ensureRideParticipantAccess checked ownership only for the roles 'user' and
 * 'driver' and let every other role through. The taxi socket accepts any
 * platform token, so a restaurant, a seller or an untranslated delivery partner
 * could join any ride room (live location, OTP, phone numbers).
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'taxi_ride_room' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const { authorizeRideRoomAccess } = await import('../src/modules/taxi/socket/middleware/rideRoomAuth.js');

const rider = new mongoose.Types.ObjectId();
const driver = new mongoose.Types.ObjectId();
const { insertedId: rideId } = await Ride.collection.insertOne({ userId: rider, driverId: driver, status: 'accepted', createdAt: new Date() });

const join = (role, sub) => authorizeRideRoomAccess({ socket: { auth: { role, sub: sub && String(sub) } }, rideId: String(rideId) });
const refused = async (p) => {
  const err = await p.then(() => null, (e) => e);
  assert.ok(err, 'was let in');
  assert.equal(err.statusCode, 403);
};

await check('the ride\'s rider can join', async () => { await join('user', rider); });
await check('the ride\'s driver can join', async () => { await join('driver', driver); });
await check('another rider is refused', async () => { await refused(join('user', new mongoose.Types.ObjectId())); });
await check('another driver is refused', async () => { await refused(join('driver', new mongoose.Types.ObjectId())); });
for (const role of ['restaurant', 'seller', 'DELIVERY_PARTNER', 'owner', '', undefined]) {
  await check(`role ${JSON.stringify(role)} is refused, even with the rider's own id`, async () => { await refused(join(role, rider)); });
}
await check('no id is refused', async () => { await refused(join('user', undefined)); });

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
