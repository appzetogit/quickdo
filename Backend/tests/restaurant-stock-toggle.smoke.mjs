/**
 * A restaurant switching a dish off and back on is not an edit, so the dish
 * comes straight back on the menu.
 *
 * Run: node tests/restaurant-stock-toggle.smoke.mjs
 *
 * Reported 12 Sep: "the active/inactive toggle ain't working from the
 * restaurant". The item editor posts the whole dish on every save, so the
 * in-stock switch arrived as name + price + image + isAvailable. Any save that
 * mentioned an approval-worthy field re-opened approval, so the dish went
 * pending and vanished from the customer menu -- and switching it back on kept
 * it pending, so nothing the restaurant did brought it back until an admin
 * approved it. The Inventory page, which posts isActive on its own, was fine.
 *
 * Drives the real updateRestaurantFood and the real customer menu.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'stock_toggle' });

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { updateRestaurantFood } = await import('../src/modules/food/restaurant/services/restaurantFood.service.js');
const { getPublicApprovedRestaurantMenu } = await import('../src/modules/food/restaurant/services/restaurantMenu.service.js');

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};

const restaurant = await FoodRestaurant.create({
    restaurantName: 'Toggle Kitchen', ownerName: 'Owner', status: 'approved',
    email: `toggle${Date.now()}@example.com`, phone: `9${String(Date.now()).slice(-9)}`,
});
const dish = await FoodItem.create({
    restaurantId: restaurant._id, name: 'Paneer Tikka', description: 'Grilled',
    price: 200, basePrice: 200, foodType: 'Veg', preparationTime: '20 mins',
    approvalStatus: 'approved', isAvailable: true, isActive: true,
});

/** Exactly what the item editor posts: the whole dish, every time. */
const itemEditorSave = (overrides) => updateRestaurantFood(String(restaurant._id), String(dish._id), {
    name: 'Paneer Tikka', description: 'Grilled', image: '', foodType: 'Veg',
    preparationTime: '20 mins', basePrice: 200, discountPercent: 0, variantsEnabled: false,
    ...overrides,
});
const state = async () => {
    const doc = await FoodItem.findById(dish._id).lean();
    const menu = await getPublicApprovedRestaurantMenu(String(restaurant._id));
    const onMenu = (menu?.sections || [])
        .flatMap((s) => [...(s.items || []), ...(s.subsections || []).flatMap((x) => x.items || [])])
        .some((i) => String(i.id || i._id) === String(dish._id));
    return { approval: doc.approvalStatus, isAvailable: doc.isAvailable, isActive: doc.isActive, onMenu };
};

console.log('\nthe in-stock switch on the item page');
await itemEditorSave({ isAvailable: false });
await check('switching off takes it off the customer menu, without asking the admin', async () => {
    const s = await state();
    assert.equal(s.isAvailable, false, 'still available');
    assert.equal(s.approval, 'approved', `approval became ${s.approval}`);
    assert.equal(s.onMenu, false, 'still on the menu');
});
await itemEditorSave({ isAvailable: true });
await check('THE BUG: switching it back on puts it straight back on the menu', async () => {
    const s = await state();
    assert.equal(s.isAvailable, true, 'still off');
    assert.equal(s.approval, 'approved', `approval became ${s.approval}`);
    assert.equal(s.onMenu, true, 'did not come back on the menu');
});

console.log('\nthe restaurant\'s other own-fields, saved the same way');
await itemEditorSave({ isRecommended: true });
await check('highlighting a dish is not an edit', async () => assert.equal((await state()).approval, 'approved'));
await itemEditorSave({ availabilitySchedule: { isEnabled: true, days: [{ day: 'Monday', isAvailable: true, startTime: '09:00', endTime: '22:00' }] } });
await check('setting a serving window is not an edit', async () => assert.equal((await state()).approval, 'approved'));
await itemEditorSave({});
await check('saving with nothing changed is not an edit', async () => {
    const s = await state();
    assert.equal(s.approval, 'approved');
    assert.equal(s.onMenu, true, 'a no-op save took it off the menu');
});

console.log('\na real edit still needs the admin');
await itemEditorSave({ basePrice: 260 });
await check('a price change goes for approval and leaves the menu', async () => {
    const s = await state();
    assert.equal(s.approval, 'pending', 'a price change slipped through without approval');
    assert.equal(s.onMenu, false);
});
await check('and the new price is what awaits approval', async () =>
    assert.equal((await FoodItem.findById(dish._id).lean()).basePrice, 260));

const renamed = await FoodItem.create({
    restaurantId: restaurant._id, name: 'Dal', price: 100, basePrice: 100,
    approvalStatus: 'approved', isAvailable: true, isActive: true,
});
await updateRestaurantFood(String(restaurant._id), String(renamed._id), { name: 'Dal Makhani' });
await check('so does a rename', async () =>
    assert.equal((await FoodItem.findById(renamed._id).lean()).approvalStatus, 'pending'));

console.log('\nthe Inventory page switch, which posts the flag on its own');
const other = await FoodItem.create({
    restaurantId: restaurant._id, name: 'Roti', price: 20, basePrice: 20,
    approvalStatus: 'approved', isAvailable: true, isActive: true,
});
await updateRestaurantFood(String(restaurant._id), String(other._id), { isActive: false });
await check('switching off sets both flags and keeps it approved', async () => {
    const doc = await FoodItem.findById(other._id).lean();
    assert.equal(doc.isActive, false);
    assert.equal(doc.isAvailable, false);
    assert.equal(doc.approvalStatus, 'approved');
});
await updateRestaurantFood(String(restaurant._id), String(other._id), { isActive: true });
await check('and switching on restores both', async () => {
    const doc = await FoodItem.findById(other._id).lean();
    assert.equal(doc.isActive, true);
    assert.equal(doc.isAvailable, true);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
