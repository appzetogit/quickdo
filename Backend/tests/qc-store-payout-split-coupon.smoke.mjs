/**
 * The store app's payout matches the ledger on a coupon the store part-funds.
 *
 * Run: node tests/qc-store-payout-split-coupon.smoke.mjs
 *
 * Found in review: an admin can create an offer the store half-funds
 * (restaurantBearPercentage 50). The ledger deducts that half from the store;
 * the store app only counted a discount as the store's when the store created
 * the coupon, so it showed the store Rs 50 more than it was paid on a Rs 100
 * coupon.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'qc_payout_split' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { FoodOffer } = await import('../src/modules/quickCommerce/modules/food/admin/models/offer.model.js');
const { attachRestaurantPayout } = await import('../src/modules/quickCommerce/modules/food/shared/restaurantPayout.js');
const { resolveDiscountSplitByCoupon } = await import('../src/modules/quickCommerce/modules/food/shared/discountSplit.util.js');

const offers = FoodOffer.collection;
await offers.insertMany([
  { couponCode: 'HALF', createdByRole: 'ADMIN', adminBearPercentage: 50, restaurantBearPercentage: 50 },
  { couponCode: 'ADMINPAYS', createdByRole: 'ADMIN' },
  { couponCode: 'STOREPAYS', createdByRole: 'RESTAURANT' },
]);

const order = (couponCode) => ({
  _id: new mongoose.Types.ObjectId(),
  pricing: { subtotal: 500, discount: 100, couponCode, total: 400 },
});
const fundedFor = async (code) => {
  const [o] = await attachRestaurantPayout([order(code)]);
  return o.restaurantPayout.discountFundedByRestaurant;
};

await check('a 50/50 admin coupon: the store app shows the same Rs 50 the ledger deducts', async () => {
  const ledger = await resolveDiscountSplitByCoupon({ couponCode: 'HALF', discount: 100 });
  assert.equal(ledger.restaurantDiscountShare, 50);
  assert.equal(await fundedFor('HALF'), 50);
});
await check('an admin-funded coupon still costs the store nothing', async () => {
  assert.equal(await fundedFor('ADMINPAYS'), 0);
});
await check('a store-created coupon is still the store\'s in full', async () => {
  assert.equal(await fundedFor('STOREPAYS'), 100);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
