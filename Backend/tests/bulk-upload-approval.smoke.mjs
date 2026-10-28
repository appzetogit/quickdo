/**
 * Bulk-uploaded items go through admin approval and then reach customers.
 *
 * Run: node tests/bulk-upload-approval.smoke.mjs
 *
 * For a restaurant (Food) and a store (quick commerce):
 *   bulk upload -> items are pending and hidden from the public menu
 *               -> they appear in the admin's pending-approvals list
 *               -> approve one, bulk-approve the rest
 *               -> every item is on the public menu
 * and re-uploading an approved item sends it back for approval.
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

/** Names of every dish on the public menu, however the menu nests them. */
const menuNames = (menu) => {
    const names = new Set();
    const walk = (v) => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (v && typeof v === 'object') {
            if (typeof v.name === 'string' && (v.price !== undefined || v.foodType !== undefined)) names.add(v.name);
            Object.values(v).forEach(walk);
        }
    };
    walk(menu);
    return names;
};

const VERTICALS = [
    { label: 'restaurant', base: '../src/modules/food', storeType: undefined },
    { label: 'store', base: '../src/modules/quickCommerce/modules/food', storeType: 'grocery' },
];

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'bulk_approval' });

    for (const { label, base, storeType } of VERTICALS) {
        console.log(`\n${label}`);
        const { FoodRestaurant } = await import(`${base}/restaurant/models/restaurant.model.js`);
        const { FoodItem } = await import(`${base}/admin/models/food.model.js`);
        const bulk = await import(`${base}/restaurant/services/bulkUpload.service.js`);
        const approval = await import(`${base}/admin/services/foodApproval.service.js`);
        const admin = await import(`${base}/admin/services/admin.service.js`);
        const menu = await import(`${base}/restaurant/services/restaurantMenu.service.js`);

        const seller = await FoodRestaurant.create({
            restaurantName: `${label} approval test`, ownerName: 'O',
            ownerPhone: label === 'store' ? '9000000031' : '9000000032',
            status: 'approved', pureVegRestaurant: false, ...(storeType ? { storeType } : {}),
        });
        const sid = String(seller._id);

        const upload = async (rows) => {
            const wb = label === 'store' ? await bulk.generateBulkMenuTemplate() : new ExcelJS.Workbook();
            const ws = wb.worksheets[0] || wb.addWorksheet('Menu');
            if (label !== 'store') ws.addRow(['Category', 'Item Name', 'Description', 'Base Price', 'Food Type']);
            rows.forEach((r, i) => { ws.getRow(i + 2).values = r; });
            return bulk.processBulkMenuUpload(sid, Buffer.from(await wb.xlsx.writeBuffer()));
        };
        const names = ['A Item', 'B Item', 'C Item'].map((n) => `${label} ${n}`);

        await check(`${label}: bulk-uploaded items are pending and not on the public menu`, async () => {
            const res = await upload(names.map((n, i) => ['Bulk Cat', n, '', 100 + i * 10, 'Veg']));
            assert.equal(res.success, 3, JSON.stringify(res));
            const items = await FoodItem.find({ restaurantId: seller._id }).lean();
            assert.equal(items.length, 3);
            assert.ok(items.every((i) => i.approvalStatus === 'pending'), items.map((i) => i.approvalStatus).join());
            const shown = menuNames(await menu.getPublicApprovedRestaurantMenu(sid));
            assert.ok(names.every((n) => !shown.has(n)), `pending items visible: ${[...shown]}`);
        });

        await check(`${label}: they appear in the admin's pending-approvals list`, async () => {
            const list = await approval.listPendingFoodApprovals({ restaurantId: sid });
            const rows = list.requests || list.foodRequests || list.items || list.data || list;
            const listed = JSON.stringify(rows);
            names.forEach((n) => assert.ok(listed.includes(n), `${n} missing from pending list`));
        });

        await check(`${label}: approve one, bulk-approve the rest, all reach the public menu`, async () => {
            const first = await FoodItem.findOne({ restaurantId: seller._id, name: names[0] }).lean();
            await approval.approveFoodItem(String(first._id));
            await admin.bulkApproveFoodItems(sid);
            const items = await FoodItem.find({ restaurantId: seller._id }).lean();
            assert.ok(items.every((i) => i.approvalStatus === 'approved'), items.map((i) => i.approvalStatus).join());
            const shown = menuNames(await menu.getPublicApprovedRestaurantMenu(sid));
            names.forEach((n) => assert.ok(shown.has(n), `${n} not on public menu (has: ${[...shown].join(', ')})`));
        });

        await check(`${label}: re-uploading an approved item sends it back for approval`, async () => {
            const res = await upload([['Bulk Cat', names[1], 'new description', 999, 'Veg']]);
            assert.equal(res.success, 1);
            const item = await FoodItem.findOne({ restaurantId: seller._id, name: names[1] }).lean();
            assert.equal(item.approvalStatus, 'pending');
            assert.equal(await FoodItem.countDocuments({ restaurantId: seller._id }), 3, 'duplicate created');
        });
    }

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
