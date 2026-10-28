/**
 * Three incentive ladders (client, 2026-10-01):
 *   - Food, Daily needs, Medical & Bike parcel: orders plus parcels on a 2-wheeler;
 *   - Taxi: passenger rides only;
 *   - Heavy parcel: parcel/porter jobs on anything but a 2-wheeler.
 *
 * Run: node tests/incentive-three-ladders.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'incentive_three_ladders' });
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

const at = { type: 'Point', coordinates: [75.88, 22.72] };
const mkDriver = (phone, caps) => Driver.create({
  name: 'R', phone, password: 'secret123', vehicleType: 'bike', location: at, workMode: 'all', serviceCapabilities: caps,
});

// Food + Daily needs + Medical + Bike parcel rider; Food account linked only via partner.driverId.
const rider = await mkDriver('+919400000001', ['delivery', 'quickCommerce', 'parcel']);
const food = await FoodRider.create({ name: 'R', phone: '9400000001', status: 'approved', driverId: rider._id });
const taxiDriver = await mkDriver('+919400000002', ['taxi']);
const truck = await mkDriver('+919400000003', ['parcel']);

await DriverIncentiveRule.create([
  { segment: 'foodAndQuick', title: 'Food ladder', windowType: 'daily', isActive: true, tiers: [{ fromOrders: 1, toOrders: 2, rewardAmount: 150 }] },
  { segment: 'taxiAndPorter', title: 'Taxi ladder', windowType: 'daily', isActive: true, tiers: [{ fromOrders: 1, toOrders: 5, rewardAmount: 300 }] },
  { segment: 'heavyParcel', title: 'Heavy parcel ladder', windowType: 'daily', isActive: true, tiers: [{ fromOrders: 1, toOrders: 3, rewardAmount: 400 }] },
]);

const ride = (driverId, serviceType, vehicleIconType) => Ride.collection.insertOne({
  driverId, userId: new mongoose.Types.ObjectId(), serviceType, vehicleIconType, liveStatus: 'completed',
  status: 'completed', completedAt: new Date(), pickupLocation: at, dropLocation: at, createdAt: new Date(),
}).then((r) => Ride.collection.findOne({ _id: r.insertedId }));

const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
const bikeType = new mongoose.Types.ObjectId();
await Vehicle.collection.insertOne({ _id: bikeType, name: 'Bike', icon_types: 'bike', transport_type: 'taxi' });

await check('which ladder a ride climbs', async () => {
  const { segmentOfRide } = incentives.__testables;
  assert.equal(await segmentOfRide({ serviceType: 'parcel', vehicleIconType: 'bike' }), 'foodAndQuick');
  assert.equal(await segmentOfRide({ serviceType: 'parcel', vehicleIconType: 'truck' }), 'heavyParcel');
  assert.equal(await segmentOfRide({ serviceType: 'ride', vehicleIconType: 'bike' }), 'taxiAndPorter');
  assert.equal(await segmentOfRide({ serviceType: 'ride', vehicleIconType: 'car' }), 'taxiAndPorter');
  // Seen live 2026-10-01: a bike parcel saved with an empty icon type.
  assert.equal(await segmentOfRide({ serviceType: 'parcel', vehicleIconType: '', vehicleTypeId: bikeType }), 'foodAndQuick');
});

await check('a bike parcel + a food order fill the food ladder and pay the DELIVERY wallet', async () => {
  await FoodOrder.collection.insertOne({
    order_id: 'FOD-4000001', orderStatus: 'delivered', dispatch: { status: 'accepted', deliveryPartnerId: food._id },
    deliveryState: { deliveredAt: new Date() }, createdAt: new Date(),
  });
  const parcel = await ride(rider._id, 'parcel', 'bike');
  await incentives.onTaxiRideCompleted({ driverId: rider._id, ride: parcel });
  const bonus = await DeliveryBonusTransaction.find({ deliveryPartnerId: food._id }).lean();
  assert.equal(bonus.length, 1, 'one food-ladder reward');
  assert.equal(bonus[0].amount, 150);
  const card = await incentives.getCurrentIncentiveForFoodPartner(food._id);
  assert.equal(card.completedOrders, 2);
});

await check('the option-1 rider asking for the ride card gets the FOOD ladder', async () => {
  const card = await incentives.getCurrentIncentiveForDriver(rider._id);
  assert.equal(card.title, 'Food ladder');
  assert.equal(card.completedOrders, 2);
});

await check('the Taxi ladder counts passenger rides only', async () => {
  await ride(taxiDriver._id, 'ride', 'bike');
  await ride(taxiDriver._id, 'ride', 'car');
  await ride(taxiDriver._id, 'parcel', 'truck'); // not a taxi ride
  const card = await incentives.getCurrentIncentiveForDriver(taxiDriver._id);
  assert.equal(card.title, 'Taxi ladder');
  assert.equal(card.completedOrders, 2);
});

await check('the Heavy parcel ladder counts non-2-wheeler parcels and pays the taxi wallet', async () => {
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const job = await ride(truck._id, 'parcel', 'truck');
    // eslint-disable-next-line no-await-in-loop
    await incentives.onTaxiRideCompleted({ driverId: truck._id, ride: job });
  }
  await ride(truck._id, 'ride', 'car'); // not a parcel
  const card = await incentives.getCurrentIncentiveForDriver(truck._id);
  assert.equal(card.title, 'Heavy parcel ladder');
  assert.equal(card.completedOrders, 3);
  const d = await Driver.findById(truck._id).lean();
  assert.equal(Number(d.wallet?.balance), 400, JSON.stringify(d.wallet));
});

await check('a bike parcel with an empty icon (bike vehicle type) moves the food ladder', async () => {
  const before = (await incentives.getCurrentIncentiveForFoodPartner(food._id)).completedOrders;
  const r = await Ride.collection.insertOne({
    driverId: rider._id, userId: new mongoose.Types.ObjectId(), serviceType: 'parcel', vehicleIconType: '',
    vehicleTypeId: bikeType, liveStatus: 'completed', status: 'completed', completedAt: new Date(),
    pickupLocation: at, dropLocation: at, createdAt: new Date(),
  });
  await incentives.onTaxiRideCompleted({ driverId: rider._id, ride: await Ride.collection.findOne({ _id: r.insertedId }) });
  assert.equal((await incentives.getCurrentIncentiveForFoodPartner(food._id)).completedOrders, before + 1);
});

await check('a bike parcel does not count on the Taxi ladder', async () => {
  await ride(taxiDriver._id, 'parcel', 'bike');
  const card = await incentives.getCurrentIncentiveForDriver(taxiDriver._id);
  assert.equal(card.completedOrders, 2);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
