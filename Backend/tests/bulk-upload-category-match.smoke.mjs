/**
 * A bulk upload uses the category that already exists instead of making
 * another, and making a category global folds it into a global twin.
 *
 * Run: node tests/bulk-upload-category-match.smoke.mjs
 *
 * Every restaurant that uploaded "Rice" before an admin made one global got
 * its own "Rice"; the admin then made each of those global, which left three
 * or four global "Rice", "Paneer", "Noodles" categories side by side.
 */
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

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

const sheet = async (rows) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Menu');
    ws.addRow(['Category', 'Item Name', 'Description', 'Base Price', 'Food Type (Veg/Non-Veg)*']);
    for (const r of rows) ws.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
};

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'bulk_category_match' });

    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const { FoodCategory } = await import('../src/modules/food/admin/models/category.model.js');
    const { processBulkMenuUpload } = await import('../src/modules/food/restaurant/services/bulkUpload.service.js');
    const { createRestaurantCategory } = await import('../src/modules/food/restaurant/services/restaurantCategory.service.js');
    const { makeCategoryGlobal } = await import('../src/modules/food/admin/services/admin.service.js');
    const { categoryNameKey } = await import('../src/modules/food/shared/categoryWorkflow.js');

    const zoneA = new mongoose.Types.ObjectId();
    const zoneB = new mongoose.Types.ObjectId();
    const one = await FoodRestaurant.create({ restaurantName: 'One', ownerName: 'O', ownerPhone: '9000000021', status: 'approved', zoneId: zoneA });
    const two = await FoodRestaurant.create({ restaurantName: 'Two', ownerName: 'O', ownerPhone: '9000000022', status: 'approved', zoneId: zoneA });

    const globalRice = await FoodCategory.create({ name: 'Rice', approvalStatus: 'approved', isApproved: true, isActive: true });
    await FoodCategory.create({ name: 'Sweets & Desserts', approvalStatus: 'approved', isApproved: true, isActive: true });
    await FoodCategory.create({ name: 'Momos', approvalStatus: 'approved', isApproved: true, isActive: true, zoneId: zoneB });

    await check('names match whatever the case, spacing or "&"/"and"', () => {
        assert.equal(categoryNameKey('Sweets & Desserts'), categoryNameKey(' sweets and  desserts'));
        assert.equal(categoryNameKey('Veg Main Course'), categoryNameKey('veg main-course '));
        assert.notEqual(categoryNameKey('Veg Burgers'), categoryNameKey('Non Veg Burgers'));
    });

    await check('a bulk upload uses the global category instead of creating one', async () => {
        const res = await processBulkMenuUpload(String(one._id), await sheet([
            ['rice ', 'Jeera Rice', '', 120, 'Veg'],
            ['Sweets and Desserts', 'Gulab Jamun', '', 80, 'Veg'],
        ]));
        assert.equal(res.success, 2, JSON.stringify(res));
        assert.equal(await FoodCategory.countDocuments({}), 3, 'a category was created');
        const jeera = await FoodItem.findOne({ name: 'Jeera Rice' }).lean();
        assert.equal(String(jeera.categoryId), String(globalRice._id));
        assert.equal(jeera.categoryName, 'Rice');
    });

    await check('a global category in another zone is not used; a new one is made', async () => {
        await processBulkMenuUpload(String(one._id), await sheet([['Momos', 'Veg Momos', '', 90, 'Veg']]));
        const own = await FoodCategory.findOne({ name: 'Momos', restaurantId: one._id }).lean();
        assert.ok(own, 'expected the restaurant\'s own Momos');
    });

    await check('a second upload reuses the restaurant\'s own category', async () => {
        await processBulkMenuUpload(String(one._id), await sheet([['MOMOS', 'Fried Momos', '', 100, 'Veg']]));
        assert.equal(await FoodCategory.countDocuments({ restaurantId: one._id }), 1);
    });

    await check('adding a category whose name already exists is refused', async () => {
        await assert.rejects(
            () => createRestaurantCategory(String(two._id), { name: 'RICE', foodTypeScope: 'Both' }),
            /"Rice" already exists/,
        );
        const created = await createRestaurantCategory(String(two._id), { name: 'Thali', foodTypeScope: 'Both' });
        assert.equal(created.name, 'Thali');
    });

    await check('making a copy global folds it into the global twin, dishes and all', async () => {
        // Restaurant Two's own "Momos" from before the zone-B one was global.
        const copy = await FoodCategory.create({ name: 'momos', restaurantId: two._id, createdByRestaurantId: two._id, approvalStatus: 'approved', isActive: true, zoneId: zoneA });
        await FoodItem.create({ restaurantId: two._id, name: 'Paneer Momos', categoryId: copy._id, categoryName: 'momos', price: 110, foodType: 'Veg' });
        // The first own copy goes global and becomes the twin.
        const first = await FoodCategory.findOne({ name: 'Momos', restaurantId: one._id }).lean();
        const firstOut = await makeCategoryGlobal(String(first._id));
        assert.equal(firstOut.mergedFrom, undefined, 'nothing to merge into yet (the zone-B one is not global)');
        const out = await makeCategoryGlobal(String(copy._id));
        assert.equal(String(out._id), String(first._id));
        assert.equal(out.mergedFrom, String(copy._id));
        assert.equal(await FoodCategory.countDocuments({ _id: copy._id }), 0);
        const dish = await FoodItem.findOne({ name: 'Paneer Momos' }).lean();
        assert.equal(String(dish.categoryId), String(first._id));
        assert.equal(dish.categoryName, 'Momos');
    });

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
