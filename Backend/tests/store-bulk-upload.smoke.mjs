/**
 * Store (quick-commerce) bulk upload, end to end against the store's own
 * template.
 *
 * Run: node tests/store-bulk-upload.smoke.mjs
 *
 *  - Rows from the template upload for a grocery store and a pharmacy, with the
 *    Food Type typed loosely or left blank.
 *  - A workbook whose first sheet is not sheet id 1 (a sheet was deleted and
 *    the file re-saved) still reads -- it used to fail "worksheet missing".
 *  - An old .xls, or a file that is not a workbook at all, gets a message that
 *    says what to do instead of a server error.
 *  - Refused rows are counted as failed and listed under `errors`.
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
const rejects = (p) => p.then(() => null, (e) => e);

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'store_bulk' });

    const base = '../src/modules/quickCommerce/modules/food';
    const { FoodRestaurant: Store } = await import(`${base}/restaurant/models/restaurant.model.js`);
    const { FoodItem: StoreItem } = await import(`${base}/admin/models/food.model.js`);
    const { generateBulkMenuTemplate, processBulkMenuUpload } = await import(`${base}/restaurant/services/bulkUpload.service.js`);

    // The store's own template, filled in the way a store would.
    const fromTemplate = async (rows, { deleteFirstSheet = false } = {}) => {
        const wb = await generateBulkMenuTemplate();
        let ws = wb.worksheets[0];
        if (deleteFirstSheet) {
            // Re-create the sheet under a new id, as Excel does after a delete + re-save.
            const headers = ws.getRow(1).values.slice(1);
            wb.removeWorksheet(ws.id);
            ws = wb.addWorksheet('Products');
            ws.addRow(headers);
        }
        rows.forEach((r, i) => { ws.getRow(i + 2).values = r; });
        return Buffer.from(await wb.xlsx.writeBuffer());
    };
    // Category, Name, Description, Base Price, Food Type, Recommended, Prep Time, Image URL
    const grocery = await Store.create({ restaurantName: 'Daily Mart', ownerName: 'O', ownerPhone: '9000000021', status: 'approved', storeType: 'grocery', pureVegRestaurant: false });
    const pharmacy = await Store.create({ restaurantName: 'Care Pharmacy', ownerName: 'O', ownerPhone: '9000000022', status: 'approved', storeType: 'pharmacy', pureVegRestaurant: false });

    await check('grocery store: template rows upload, Food Type typed loosely or blank', async () => {
        const res = await processBulkMenuUpload(String(grocery._id), await fromTemplate([
            ['Staples', 'Basmati Rice 1kg', 'Long grain', 120, 'veg', 'No', '5-10 mins', ''],
            ['Dairy', 'Eggs (6 pcs)', '', 60, 'Egg', '', '5-10 mins', ''],
            ['Household', 'Dish Soap 500ml', '', 99, '', '', '', ''],
        ]));
        assert.equal(res.success, 3, JSON.stringify(res));
        assert.equal(res.failed, 0);
        const items = Object.fromEntries((await StoreItem.find({ restaurantId: grocery._id }).lean()).map((i) => [i.name, i.foodType]));
        assert.deepEqual(items, { 'Basmati Rice 1kg': 'Veg', 'Eggs (6 pcs)': 'Non-Veg', 'Dish Soap 500ml': 'Non-Veg' });
    });

    await check('pharmacy: template rows upload', async () => {
        const res = await processBulkMenuUpload(String(pharmacy._id), await fromTemplate([
            ['Pain Relief', 'Paracetamol 500mg (10 tabs)', '', 30, 'Veg', '', '', ''],
            ['Personal Care', 'Hand Sanitiser 100ml', '', 50, '', '', '', ''],
        ]));
        assert.equal(res.success, 2, JSON.stringify(res));
        assert.equal(await StoreItem.countDocuments({ restaurantId: pharmacy._id }), 2);
    });

    await check('a re-saved workbook whose first sheet is not id 1 still reads', async () => {
        const res = await processBulkMenuUpload(String(grocery._id), await fromTemplate(
            [['Snacks', 'Salted Chips 50g', '', 20, 'Veg', '', '', '']],
            { deleteFirstSheet: true },
        ));
        assert.equal(res.success, 1, JSON.stringify(res));
    });

    await check('an old .xls file gets a "save as .xlsx" message, not a server error', async () => {
        const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
        const err = await rejects(processBulkMenuUpload(String(grocery._id), xls));
        assert.equal(err?.statusCode, 400, err?.message);
        assert.match(err.message, /old-format \.xls/);
    });

    await check('a file that is not a workbook gets a clear message', async () => {
        const err = await rejects(processBulkMenuUpload(String(grocery._id), Buffer.from('name,price\nrice,120\n')));
        assert.equal(err?.statusCode, 400, err?.message);
        assert.match(err.message, /not an \.xlsx/);
    });

    await check('a refused row is counted as failed and listed under errors', async () => {
        const res = await processBulkMenuUpload(String(grocery._id), await fromTemplate([
            ['Staples', 'Wheat Flour 5kg', '', 250, 'Veg', '', '', ''],
            ['Staples', 'Mystery Item', '', 10, 'Grocery', '', '', ''],
        ]));
        assert.equal(res.success, 1, JSON.stringify(res));
        assert.equal(res.failed, 1);
        assert.equal(res.errors.length, 1);
        assert.match(res.errors[0].error, /not recognised/);
    });

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
