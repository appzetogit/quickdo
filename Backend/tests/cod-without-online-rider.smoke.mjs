/**
 * Cash on delivery is never refused just because no rider is online (or an
 * online rider has no cash limit set). The admin's COD order limit still holds;
 * 0 means no limit.
 * Run: node tests/cod-without-online-rider.smoke.mjs
 */
import assert from 'node:assert/strict';
import { startFoodWorld } from './food-order-fixture.mjs';

const w = await startFoodWorld('cod_no_rider');
const order_ = async (user) => {
  const items = [w.appLine(w.dish)];
  const pricing = await w.quote(user._id, { items });
  return w.place(user._id, { items, pricing });
};
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label} :: ${e.stack || e.message}`); }
};

await check('COD order is placed with NO rider online', async () => {
  await w.m.FoodDeliveryPartner.updateMany({}, { $set: { availabilityStatus: 'offline' } });
  const user = await w.makeUser();
  const res = await order_(user);
  const order = await w.saved(res);
  assert.ok(order, 'order saved');
  assert.equal(order.payment.method, 'cash');
  assert.equal(order.payment.status, 'cod_pending');
});

await check('COD order is placed when the online rider has no cash limit set', async () => {
  await w.m.FoodDeliveryPartner.updateMany({}, { $set: { availabilityStatus: 'online' } });
  const user = await w.makeUser();
  assert.ok(await w.saved(await order_(user)));
});

await check('a COD order limit of 0 means no limit', async () => {
  const { FoodFeeSettings } = await import('../src/modules/food/admin/models/feeSettings.model.js');
  await FoodFeeSettings.updateMany({}, { $set: { codOrderLimit: 0 } });
  const user = await w.makeUser();
  assert.ok(await w.saved(await order_(user)));
});

await check('the admin COD order limit still refuses larger orders', async () => {
  const { FoodFeeSettings } = await import('../src/modules/food/admin/models/feeSettings.model.js');
  await FoodFeeSettings.updateMany({}, { $set: { codOrderLimit: 100 } });
  const user = await w.makeUser();
  await assert.rejects(() => order_(user), /not allowed for orders of/);
  await FoodFeeSettings.updateMany({}, { $unset: { codOrderLimit: '' } });
});

await w.stop();
console.log(failed ? `${failed} FAILED` : 'all COD-without-rider checks passed');
process.exit(failed ? 1 : 0);
