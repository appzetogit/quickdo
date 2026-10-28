/**
 * Quick commerce (stores, medical): min/max order quantity per product and per
 * pack size, saved from the admin editor and enforced at checkout.
 *
 * Run: node tests/qc-quantity-limits.smoke.mjs
 *
 * The store side had no quantity limits at all: the admin editor (shared with
 * Food) showed Min/Max boxes, and whatever was typed was dropped on save and
 * never checked when ordering.
 */
import assert from 'node:assert/strict';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_quantity_limits' });

const B = '../src/modules/quickCommerce/modules/food';
const { FoodItem } = await import(`${B}/admin/models/food.model.js`);
const { normalizeFoodVariantsInput, serializeFoodVariants } = await import(`${B}/admin/services/foodVariant.service.js`);
const { resolveOrderCartItems } = await import(`${B}/orders/helpers/order-cart-items.helper.js`);
const { createFoodQuantityLimits } = await import('../src/modules/food/shared/foodQuantityLimits.js');

const rid = new mongoose.Types.ObjectId();

await check('per-size limits are saved, returned, and a bad pair is refused', async () => {
    const v = normalizeFoodVariantsInput([{ name: '500 ml', price: 30, minOrderQuantity: '2', maxOrderQuantity: '5' }, { name: '1 L', price: 55 }]);
    assert.equal(v[0].minOrderQuantity, 2);
    assert.equal(v[0].maxOrderQuantity, 5);
    assert.equal(v[1].minOrderQuantity, undefined);
    const out = serializeFoodVariants(v);
    assert.equal(out[0].maxOrderQuantity, 5);
    assert.equal(out[1].maxOrderQuantity, null);
    assert.throws(() => normalizeFoodVariantsInput([{ name: 'X', price: 10, minOrderQuantity: 6, maxOrderQuantity: 2 }]), /cannot be below its minimum/);
});

await check('a save that leaves a size\'s limits out keeps them', async () => {
    const existing = [{ _id: new mongoose.Types.ObjectId(), name: '500 ml', price: 30, minOrderQuantity: 2, maxOrderQuantity: 5 }];
    const v = normalizeFoodVariantsInput([{ _id: String(existing[0]._id), name: '500 ml', price: 32 }], { existing });
    assert.equal(v[0].minOrderQuantity, 2);
    assert.equal(v[0].maxOrderQuantity, 5);
});

const milk = await FoodItem.create({
    restaurantId: rid, name: 'Milk', price: 30, approvalStatus: 'approved', variantsEnabled: true,
    minOrderQuantity: 1, maxOrderQuantity: 10,
    variants: [{ name: '500 ml', price: 30, minOrderQuantity: 2, maxOrderQuantity: 5 }, { name: '1 L', price: 55 }],
});
const eggs = await FoodItem.create({ restaurantId: rid, name: 'Eggs', price: 6, approvalStatus: 'approved', minOrderQuantity: 6, maxOrderQuantity: 30 });
const [small, large] = milk.variants.map((v) => String(v._id));
const line = (item, quantity, variantId) => [{ itemId: String(item._id), quantity, ...(variantId ? { variantId } : {}) }];

await check('checkout refuses a size below its minimum or above its maximum', async () => {
    await assert.rejects(() => resolveOrderCartItems(rid, line(milk, 1, small)), /500 ml/);
    await assert.rejects(() => resolveOrderCartItems(rid, line(milk, 6, small)), /500 ml/);
    const ok = await resolveOrderCartItems(rid, line(milk, 3, small));
    assert.equal(ok[0].quantity, 3);
});

await check('a size that sets no limit uses the product\'s (max 10)', async () => {
    await resolveOrderCartItems(rid, line(milk, 10, large));
    await assert.rejects(() => resolveOrderCartItems(rid, line(milk, 11, large)), /Milk/);
});

await check('a product without sizes: its own minimum of 6 applies', async () => {
    await assert.rejects(() => resolveOrderCartItems(rid, line(eggs, 4)), /Eggs/);
    await resolveOrderCartItems(rid, line(eggs, 12));
});

await check('the admin editor\'s product-level pair saves and lists for stores', async () => {
    const q = createFoodQuantityLimits(FoodItem);
    const limits = await q.prepareFoodQuantityLimits({ name: 'Eggs', minOrderQuantity: 12, maxOrderQuantity: 60 }, { foodId: eggs._id });
    await q.saveFoodQuantityLimits(eggs._id, limits);
    const [row] = await q.withFoodQuantityLimits([{ _id: eggs._id }]);
    assert.equal(row.minOrderQuantity, 12);
    assert.equal(row.maxOrderQuantity, 60);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
