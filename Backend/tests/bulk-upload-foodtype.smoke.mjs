/**
 * Bulk menu upload reads the Food Type column the way people type it, and the
 * panel is told about every row it refused.
 *
 * Run: node tests/bulk-upload-foodtype.smoke.mjs
 *
 * Joy Espresso (pure veg) uploaded a menu six times and got nothing: the pure-
 * veg check wanted the cell to read exactly "Veg", so "veg" or a blank cell
 * refused every row -- and those refusals were neither counted as failed nor
 * sent under the key the panel reads, so the upload looked successful.
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

// Columns as in the template: Category, Name, Description, Base Price, Food Type, ...
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
    await mongoose.connect(replSet.getUri(), { dbName: 'bulk_foodtype' });

    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const { processBulkMenuUpload } = await import('../src/modules/food/restaurant/services/bulkUpload.service.js');

    const cafe = await FoodRestaurant.create({ restaurantName: 'Espresso Test Bar', ownerName: 'O', ownerPhone: '9000000011', status: 'approved', pureVegRestaurant: true });
    const diner = await FoodRestaurant.create({ restaurantName: 'Mixed Diner', ownerName: 'O', ownerPhone: '9000000012', status: 'approved', pureVegRestaurant: false });

    let res;
    await check('pure-veg cafe: "veg", "VEG", "Veg " and a blank Food Type all upload as Veg', async () => {
        res = await processBulkMenuUpload(String(cafe._id), await sheet([
            ['Hot Coffee', 'Cappuccino', 'Classic', 160, 'veg'],
            ['Hot Coffee', 'Latte', 'Milky', 170, 'VEG'],
            ['Cold Coffee', 'Iced Americano', '', 150, 'Veg '],
            ['Bakes', 'Blueberry Muffin', '', 120, ''],
        ]));
        assert.equal(res.success, 4, JSON.stringify(res));
        const items = await FoodItem.find({ restaurantId: cafe._id }).lean();
        assert.equal(items.length, 4);
        assert.ok(items.every((i) => i.foodType === 'Veg'), items.map((i) => i.foodType).join(','));
    });

    await check('pure-veg cafe: a Non-Veg row is refused, counted as failed and listed in errors', async () => {
        res = await processBulkMenuUpload(String(cafe._id), await sheet([
            ['Sandwiches', 'Veg Club', '', 180, 'Veg'],
            ['Sandwiches', 'Chicken Club', '', 220, 'Non-Veg'],
        ]));
        assert.equal(res.success, 1);
        assert.equal(res.failed, 1);
        assert.ok(Array.isArray(res.errors) && res.errors.length === 1, JSON.stringify(res));
        assert.match(res.errors[0].error, /pure veg/i);
        assert.equal(res.errors[0].row, 3);
    });

    await check('an unreadable Food Type is reported, not silently dropped', async () => {
        res = await processBulkMenuUpload(String(cafe._id), await sheet([['Hot Coffee', 'Mocha', '', 180, 'Coffee']]));
        assert.equal(res.success, 0);
        assert.equal(res.failed, 1);
        assert.match(res.errors[0].error, /not recognised/);
    });

    await check('regular restaurant: lowercase "veg" is stored as Veg (it used to become Non-Veg)', async () => {
        res = await processBulkMenuUpload(String(diner._id), await sheet([
            ['Starters', 'Paneer Tikka', '', 220, 'veg'],
            ['Starters', 'Chicken Tikka', '', 260, 'non veg'],
            ['Starters', 'Fries', '', 120, ''],
        ]));
        assert.equal(res.success, 3, JSON.stringify(res));
        const byName = Object.fromEntries((await FoodItem.find({ restaurantId: diner._id }).lean()).map((i) => [i.name, i.foodType]));
        assert.deepEqual(byName, { 'Paneer Tikka': 'Veg', 'Chicken Tikka': 'Non-Veg', Fries: 'Non-Veg' });
    });

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
