/**
 * A bike parcel shows in the delivery app's earnings, week and history.
 *
 * Run: node tests/rider-earnings-include-parcels.smoke.mjs
 *
 * Seen live 2026-10-01: a Food + Bike parcel rider completed a cash parcel
 * (fare 54, earning 53.46) and "Today's earning", "Today's trips", "This week"
 * and the earnings breakup all stayed at 0: they summed food orders only.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'rider_earnings_parcels' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const svc = await import('../src/modules/food/delivery/services/delivery.service.js');

const driverId = new mongoose.Types.ObjectId();
const rider = await FoodDeliveryPartner.create({ name: 'R', phone: '9500000001', status: 'approved', driverId });
const at = { type: 'Point', coordinates: [75.88, 22.72] };

await FoodOrder.collection.insertOne({
  order_id: 'FOD-5000001', orderStatus: 'delivered', riderEarning: 40,
  dispatch: { status: 'accepted', deliveryPartnerId: rider._id },
  deliveryState: { deliveredAt: new Date() }, createdAt: new Date(),
});
await Ride.collection.insertOne({
  driverId, userId: new mongoose.Types.ObjectId(), serviceType: 'parcel', liveStatus: 'completed', status: 'completed',
  fare: 54, driverEarnings: 53.46, commissionAmount: 0.54, paymentMethod: 'cash',
  completedAt: new Date(), createdAt: new Date(), pickupLocation: at, dropLocation: at,
});
// Someone else's ride must not count.
await Ride.collection.insertOne({
  driverId: new mongoose.Types.ObjectId(), serviceType: 'parcel', liveStatus: 'completed', fare: 99, driverEarnings: 90,
  completedAt: new Date(), createdAt: new Date(), pickupLocation: at, dropLocation: at,
});

await check("today's earning and orders include the parcel", async () => {
  const { summary } = await svc.getDeliveryPartnerEarnings(String(rider._id), { period: 'today' });
  assert.equal(summary.totalOrders, 2);
  assert.equal(summary.totalEarnings, 93.46);
});

await check("the week's pocket includes the parcel as a trip and a payment", async () => {
  const pocket = await svc.getDeliveryPocketDetails(String(rider._id));
  assert.equal(pocket.trips.length, 2);
  assert.ok(pocket.trips.some((t) => t.restaurantName === 'Bike parcel' && t.earningAmount === 53.46));
  assert.equal(Math.round(pocket.summary.totalEarning * 100) / 100, 93.46);
});

await check('a Medical delivery is listed in history under the pharmacy name', async () => {
  const link = await import('../src/core/delivery/qcRiderLink.js');
  const qcId = await link.qcRiderIdForFoodRider(rider._id);
  const pharmacy = new mongoose.Types.ObjectId();
  await mongoose.connection.db.collection('qc_restaurants').insertOne({ _id: pharmacy, restaurantName: 'Quick Medical', storeType: 'pharmacy' });
  const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
  await QcOrder.collection.insertOne({
    order_id: 'MED-1000000009', orderStatus: 'delivered', riderEarning: 30, restaurantId: pharmacy,
    dispatch: { status: 'accepted', deliveryPartnerId: new mongoose.Types.ObjectId(qcId) },
    deliveryState: { deliveredAt: new Date() }, createdAt: new Date(),
  });
  const { trips } = await svc.getDeliveryPartnerTripHistory(String(rider._id), { period: 'daily', status: 'Completed' });
  assert.ok(trips.some((t) => t.restaurantName === 'Quick Medical'), JSON.stringify(trips.map((t) => t.restaurantName)));
  const pocket = await svc.getDeliveryPocketDetails(String(rider._id));
  assert.ok(pocket.transactions.payment.some((t) => /Quick Medical/.test(t.description)), JSON.stringify(pocket.transactions.payment.map((t) => t.description)));
});

await check('trip history does NOT repeat the parcel (the app lists rides itself)', async () => {
  const { trips } = await svc.getDeliveryPartnerTripHistory(String(rider._id), { period: 'daily', status: 'Completed' });
  assert.ok(!trips.some((t) => t.restaurantName === 'Bike parcel'), JSON.stringify(trips.map((t) => t.restaurantName)));
});

await check('a bonus credited today appears in history, tagged, with its amount', async () => {
  const { DeliveryBonusTransaction } = await import('../src/modules/food/admin/models/deliveryBonusTransaction.model.js');
  await DeliveryBonusTransaction.create({
    deliveryPartnerId: rider._id, transactionId: 'INC-20261001-aaaaaa-bbbbbb', amount: 150,
    reference: 'Daily incentive — tier 1-5 (5 completed today)',
  });
  const { trips } = await svc.getDeliveryPartnerTripHistory(String(rider._id), { period: 'daily' });
  const bonus = trips.find((t) => t.type === 'bonus');
  assert.ok(bonus, JSON.stringify(trips.map((t) => t.restaurantName)));
  assert.equal(bonus.earningAmount, 150);
  assert.match(bonus.restaurantName, /^Incentive bonus · Daily incentive/);
  const cancelled = await svc.getDeliveryPartnerTripHistory(String(rider._id), { period: 'daily', status: 'Cancelled' });
  assert.ok(!cancelled.trips.some((t) => t.type === 'bonus'));
});

await check('a Medical delivery in history is tagged medical', async () => {
  const { trips } = await svc.getDeliveryPartnerTripHistory(String(rider._id), { period: 'daily' });
  assert.equal(trips.find((t) => t.restaurantName === 'Quick Medical')?.category, 'medical');
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
