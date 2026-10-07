/**
 * Two incentive ladders:
 *   - Food, Daily needs & Medical: food and quick orders;
 *   - Taxi: every completed ride.
 *
 * Parcel delivery was removed, and with it the bike-parcel share of the food
 * ladder and the Heavy parcel ladder. This guards that rides no longer reach
 * the food ladder and that an old heavyParcel rule is never shown.
 *
 * Run: node tests/incentive-two-ladders.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'incentive_two_ladders' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const { FoodDeliveryPartner: FoodRider } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { DriverIncentiveRule } = await import('../src/core/incentives/models/driverIncentiveRule.model.js');
const { DeliveryBonusTransaction } = await import('../src/modules/food/admin/models/deliveryBonusTransaction.model.js');
const incentives = await import('../src/core/incentives/services/incentiveService.js');
const { validateIncentiveRuleUpsertDto } = await import('../src/core/incentives/validators/incentiveRule.validator.js');

const at = { type: 'Point', coordinates: [75.88, 22.72] };
const mkDriver = (phone, caps) => Driver.create({
  name: 'R', phone, password: 'secret123', vehicleType: 'bike', location: at, workMode: 'all', serviceCapabilities: caps,
});

// Food + Daily needs + Medical rider; Food account linked only via partner.driverId.
const rider = await mkDriver('+919400000001', ['delivery', 'quickCommerce']);
const food = await FoodRider.create({ name: 'R', phone: '9400000001', status: 'approved', driverId: rider._id });
const taxiDriver = await mkDriver('+919400000002', ['taxi']);
// Approved for parcels before parcel delivery was removed.
const legacyParcelDriver = await mkDriver('+919400000003', ['parcel']);

await DriverIncentiveRule.create([
  { segment: 'foodAndQuick', title: 'Food ladder', windowType: 'daily', isActive: true, tiers: [{ fromOrders: 1, toOrders: 2, rewardAmount: 150 }] },
  { segment: 'taxiAndPorter', title: 'Taxi ladder', windowType: 'daily', isActive: true, tiers: [{ fromOrders: 1, toOrders: 2, rewardAmount: 300 }] },
  // An old rule from before the removal: still loads, never shown.
  { segment: 'heavyParcel', title: 'Heavy parcel ladder', windowType: 'daily', isActive: true, tiers: [{ fromOrders: 1, toOrders: 3, rewardAmount: 400 }] },
]);

const ride = (driverId, serviceType, vehicleIconType) => Ride.collection.insertOne({
  driverId, userId: new mongoose.Types.ObjectId(), serviceType, vehicleIconType, liveStatus: 'completed',
  status: 'completed', completedAt: new Date(), pickupLocation: at, dropLocation: at, createdAt: new Date(),
}).then((r) => Ride.collection.findOne({ _id: r.insertedId }));

await check('the food ladder counts food orders only, not rides', async () => {
  await FoodOrder.collection.insertMany([1, 2].map((n) => ({
    order_id: `FOD-400000${n}`, orderStatus: 'delivered', dispatch: { status: 'accepted', deliveryPartnerId: food._id },
    deliveryState: { deliveredAt: new Date() }, createdAt: new Date(),
  })));
  // A ride the linked driver record completed does not move the food ladder.
  await ride(rider._id, 'parcel', 'bike');
  const card = await incentives.getCurrentIncentiveForFoodPartner(food._id);
  assert.equal(card.title, 'Food ladder');
  assert.equal(card.completedOrders, 2);
});

await check('the delivery rider asking for the ride card gets the FOOD ladder', async () => {
  const card = await incentives.getCurrentIncentiveForDriver(rider._id);
  assert.equal(card.title, 'Food ladder');
});

await check('every completed ride climbs the Taxi ladder and pays the taxi wallet', async () => {
  const first = await ride(taxiDriver._id, 'ride', 'bike');
  await incentives.onTaxiRideCompleted({ driverId: taxiDriver._id, ride: first });
  // An old parcel trip completing after the removal counts as a ride.
  const second = await ride(taxiDriver._id, 'parcel', 'car');
  await incentives.onTaxiRideCompleted({ driverId: taxiDriver._id, ride: second });
  const card = await incentives.getCurrentIncentiveForDriver(taxiDriver._id);
  assert.equal(card.title, 'Taxi ladder');
  assert.equal(card.completedOrders, 2);
  const d = await Driver.findById(taxiDriver._id).lean();
  assert.equal(Number(d.wallet?.balance), 300, JSON.stringify(d.wallet));
});

await check('a driver who only holds the retired parcel capability is not shown the Heavy parcel ladder', async () => {
  assert.equal(await incentives.ladderSegmentForDriver(legacyParcelDriver._id), 'taxiAndPorter');
  const card = await incentives.getCurrentIncentiveForDriver(legacyParcelDriver._id);
  assert.notEqual(card?.title, 'Heavy parcel ladder');
});

await check('no parcel helpers are left on the service', async () => {
  assert.equal(incentives.segmentOfRide, undefined);
  assert.equal(incentives.__testables.segmentOfRide, undefined);
  assert.equal(incentives.__testables.deliveryZoneIdAt, undefined);
});

await check('a new Heavy parcel ladder cannot be created', async () => {
  const tiers = [{ fromOrders: 1, toOrders: 2, rewardAmount: 10 }];
  assert.throws(() => validateIncentiveRuleUpsertDto({ segment: 'heavyParcel', title: 'x', tiers }));
  assert.doesNotThrow(() => validateIncentiveRuleUpsertDto({ segment: 'taxiAndPorter', title: 'x', tiers }));
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
