/**
 * A Food & Quick target incentive lands in the DELIVERY wallet the rider app
 * shows, and Medical deliveries count towards the day's ladder.
 * Run: node tests/incentive-delivery-wallet.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'incentive_wallet' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { FoodDeliveryPartner: FoodRider } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { DriverIncentiveRule } = await import('../src/core/incentives/models/driverIncentiveRule.model.js');
const { DeliveryBonusTransaction } = await import('../src/modules/food/admin/models/deliveryBonusTransaction.model.js');
const incentives = await import('../src/core/incentives/services/incentiveService.js');
const link = await import('../src/core/delivery/qcRiderLink.js');

// A rider whose delivery account is linked to a taxi driver (all live riders are).
const driver = await Driver.create({
  name: 'Ramji', phone: '+919300000001', password: 'secret123', vehicleType: 'bike',
  location: { type: 'Point', coordinates: [76.53, 32.11] }, workMode: 'all',
});
const food = await FoodRider.create({ name: 'Ramji', phone: '9300000001', status: 'approved', driverId: driver._id });
await Driver.updateOne({ _id: driver._id }, { $set: { legacyDeliveryPartnerId: food._id } });
const qcId = await link.qcRiderIdForFoodRider(food._id);

await DriverIncentiveRule.create({
  segment: 'foodAndQuick', title: 'Daily target', windowType: 'daily', isActive: true,
  tiers: [{ fromOrders: 1, toOrders: 2, rewardAmount: 125 }],
});

const deliverMedical = (n) => QcOrder.collection.insertOne({
  order_id: `MED-30000000${n}`, orderStatus: 'delivered', userId: new mongoose.Types.ObjectId(),
  restaurantId: new mongoose.Types.ObjectId(), items: [], pricing: { total: 100 },
  dispatch: { status: 'accepted', deliveryPartnerId: new mongoose.Types.ObjectId(qcId) },
  deliveryState: { deliveredAt: new Date() }, createdAt: new Date(),
});

await check('Medical deliveries made through the Food app count towards today', async () => {
  await deliverMedical(1);
  const cur = await incentives.getCurrentIncentiveForFoodPartner(food._id);
  assert.equal(cur?.completedOrders, 1, JSON.stringify(cur));
});

await check('reaching the target pays the DELIVERY wallet, not the taxi wallet', async () => {
  await deliverMedical(2);
  await incentives.onFoodOrQuickCommerceOrderCompleted({ deliveryPartnerId: qcId, vertical: 'quickCommerce' });
  const bonus = await DeliveryBonusTransaction.find({ deliveryPartnerId: food._id }).lean();
  assert.equal(bonus.length, 1, 'one delivery bonus for the Food account');
  assert.equal(bonus[0].amount, 125);
  const d = await Driver.findById(driver._id).lean();
  assert.ok(!(Number(d.wallet?.balance) > 0), `taxi wallet must not be credited: ${JSON.stringify(d.wallet)}`);
});

await check('the same tier is not paid twice', async () => {
  await incentives.onFoodOrQuickCommerceOrderCompleted({ deliveryPartnerId: food._id, vertical: 'food' });
  assert.equal(await DeliveryBonusTransaction.countDocuments({ deliveryPartnerId: food._id }), 1);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall incentive delivery-wallet checks passed');
process.exit(failed ? 1 : 0);
