/**
 * A Food rider's Medical/Quick deliveries (made as the linked QC rider) count in
 * the delivery app's wallet, cash-in-hand and "Today's earning".
 * Run: node tests/rider-finance-qc-link.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'rider_qc_link' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { FoodDeliveryPartner: FoodRider } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { DeliveryBonusTransaction } = await import('../src/modules/food/admin/models/deliveryBonusTransaction.model.js');
const { getRiderFinance } = await import('../src/core/finance/riderFinance.service.js');
const { getDeliveryPartnerEarnings } = await import('../src/modules/food/delivery/services/delivery.service.js');
const link = await import('../src/core/delivery/qcRiderLink.js');

let seq = 0;
const deliverMedical = async (qcId, { earning = 40, total = 500 } = {}) => {
  seq += 1;
  await QcOrder.collection.insertOne({
    order_id: `MED-60000000${seq}`, orderStatus: 'delivered', userId: new mongoose.Types.ObjectId(),
    restaurantId: new mongoose.Types.ObjectId(), items: [], riderEarning: earning,
    pricing: { total }, payment: { method: 'cash', status: 'cod_pending' },
    dispatch: { status: 'accepted', deliveryPartnerId: new mongoose.Types.ObjectId(qcId) },
    deliveryState: { deliveredAt: new Date() }, createdAt: new Date(),
  });
};

for (const linked of [false, true]) {
  const label = linked ? 'rider linked to a taxi driver' : 'rider with no taxi driver';
  seq += 10;
  const phone = `95000000${seq}`;
  const food = await FoodRider.create({ name: 'R', phone, status: 'approved' });
  if (linked) {
    const d = await Driver.create({ name: 'R', phone: `+91${phone}`, password: 'secret123', vehicleType: 'bike', location: { type: 'Point', coordinates: [75.88, 22.72] } });
    await FoodRider.updateOne({ _id: food._id }, { $set: { driverId: d._id } });
    await Driver.updateOne({ _id: d._id }, { $set: { legacyDeliveryPartnerId: food._id } });
  }
  const qcId = await link.qcRiderIdForFoodRider(food._id);
  await deliverMedical(qcId);

  await check(`${label}: wallet counts the Medical earning and its cash`, async () => {
    const f = await getRiderFinance(food._id);
    assert.equal(String(f.qcPartnerId), String(qcId), 'QC record linked');
    assert.ok(f.cashInHand >= 500, `cashInHand ${f.cashInHand}`);
    assert.ok(Number(f.delivery?.totalEarned ?? f.totalEarned ?? f.breakdown?.totalEarned ?? 40) >= 40, JSON.stringify(f).slice(0, 300));
  });

  await check(`${label}: "Today's earning" includes the Medical delivery and the incentive`, async () => {
    await DeliveryBonusTransaction.create({ deliveryPartnerId: food._id, transactionId: `INC-TEST-${seq}`, amount: 150, reference: 'Daily target' });
    const r = await getDeliveryPartnerEarnings(String(food._id), { period: 'today' });
    assert.equal(r.summary.totalOrders, 1, JSON.stringify(r.summary));
    assert.equal(r.summary.orderEarning, 40);
    assert.equal(r.summary.incentive, 150);
    assert.equal(r.summary.totalEarnings, 190);
  });
}

await check('the same QC record reached two ways is counted once', async () => {
  const phone = '9500009999';
  const food = await FoodRider.create({ name: 'R', phone, status: 'approved' });
  const qcId = await link.qcRiderIdForFoodRider(food._id);
  const d = await Driver.create({ name: 'R', phone: `+91${phone}`, password: 'secret123', vehicleType: 'bike', location: { type: 'Point', coordinates: [75.88, 22.72] }, legacyDeliveryPartnerId: food._id, legacyQcPartnerId: new mongoose.Types.ObjectId(qcId) });
  await FoodRider.updateOne({ _id: food._id }, { $set: { driverId: d._id } });
  await deliverMedical(qcId, { total: 300 });
  const f = await getRiderFinance(food._id);
  assert.equal(f.cashInHand, 300, `counted twice? ${f.cashInHand}`);
});

await check('Quick/Medical accept counts the shared cash figure against the limit', async () => {
  const { PlatformSetting } = await import('../src/core/config/setting.model.js');
  const { invalidateCache: clearCache } = await import('../src/core/config/resolver.service.js');
  const setLimit = async (value) => {
    await PlatformSetting.updateOne({ key: 'finance.cashLimit', level: 'global', scopeId: '*' },
      { $set: { value } }, { upsert: true });
    if (typeof clearCache === 'function') clearCache();
  };
  const phone = '9500007777';
  const food = await FoodRider.create({ name: 'Cash', phone, status: 'approved' });
  const qcId = await link.qcRiderIdForFoodRider(food._id);
  await deliverMedical(qcId, { total: 500 });   // holds Rs 500 from a Medical order
  const delivery = await import('../src/modules/quickCommerce/modules/food/orders/services/order-delivery.service.js');
  const newCashOrder = async () => (await QcOrder.collection.insertOne({
    order_id: `MED-6100000${++seq}`, orderStatus: 'preparing', userId: new mongoose.Types.ObjectId(),
    restaurantId: new mongoose.Types.ObjectId(), items: [{ name: 'x', price: 200, quantity: 1 }],
    pricing: { total: 200 }, payment: { method: 'cash', status: 'cod_pending' },
    dispatch: { status: 'unassigned', offeredTo: [{ partnerId: new mongoose.Types.ObjectId(qcId), at: new Date(), action: 'offered' }] },
    deliveryAddress: { street: '1', city: 'Indore', location: { type: 'Point', coordinates: [75.88, 22.72] } }, createdAt: new Date(),
  })).insertedId;
  await setLimit(600);
  await assert.rejects(async () => delivery.acceptOrderDelivery(String(await newCashOrder()), qcId), /past your Rs\.600 limit/);
  await setLimit(1000);
  try { await delivery.acceptOrderDelivery(String(await newCashOrder()), qcId); }
  catch (e) { assert.ok(!/limit/.test(e.message), `refused for cash with headroom: ${e.message}`); }
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall rider QC-link finance checks passed');
process.exit(failed ? 1 : 0);
