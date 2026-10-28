/**
 * Keep the "Dummy driver" (8120743311, a fixed-OTP test number) online in
 * Indore, so the customer app shows delivery partners as available.
 *
 * A rider counts as available only while their last GPS position is under
 * DISPATCH_STALE_GPS_MS old (45 min), so this re-sends the rider's position
 * through the same path the delivery app uses when it goes online
 * (updateDeliveryAvailability, which also keeps the Quick/Medical rider record
 * in step). Run from cron every 10 minutes:
 *
 *   *\/10 * * * * cd /opt/master/Backend && node scripts/keep-test-rider-online.mjs >> /var/log/keep-test-rider-online.log 2>&1
 *
 * Remove that cron line once real riders are online.
 *
 *   node scripts/keep-test-rider-online.mjs --offline   # take the rider offline
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const TEST_RIDER_PHONE = '8120743311';
// Central Indore, inside the Indore food zone.
const LAT = 22.687;
const LNG = 75.888;

const offline = process.argv.includes('--offline');

await mongoose.connect(process.env.MONGODB_URI);
try {
  const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
  const { updateDeliveryAvailability } = await import('../src/modules/food/delivery/services/delivery.service.js');

  const riders = await FoodDeliveryPartner.find({ phone: { $regex: `${TEST_RIDER_PHONE}$` } })
    .select('_id name status')
    .lean();
  if (riders.length !== 1) {
    throw new Error(`expected exactly one rider on ${TEST_RIDER_PHONE}, found ${riders.length}`);
  }
  const [rider] = riders;
  if (rider.status !== 'approved') throw new Error(`rider ${rider._id} is ${rider.status}, not approved`);

  const result = await updateDeliveryAvailability(String(rider._id), offline
    ? { status: 'offline' }
    : { status: 'online', latitude: LAT, longitude: LNG });
  // The Quick/Medical sync is fire-and-forget inside the service; give it a moment.
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`${new Date().toISOString()} ${rider.name} (${rider._id}) -> ${result.availabilityStatus}`);
} finally {
  await mongoose.disconnect();
}
