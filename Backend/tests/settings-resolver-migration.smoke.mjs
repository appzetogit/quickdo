/**
 * Per-service settings moved into the config resolver (Phase 6).
 *
 * Run: node tests/settings-resolver-migration.smoke.mjs
 *
 * Isolated in-memory MongoDB. Seeds each service's OLD settings (Food and Quick
 * fee settings, Food's radius ceiling, taxi's transport-ride settings), then
 * drives the REAL readers -- the checkout fee overlay, the order quantity
 * ceiling, the radius ceiling, taxi's scheduled-ride search buffer -- and checks:
 *
 *   - readers return the old values while nothing is migrated;
 *   - the migration's dry run writes nothing; --apply copies; a second --apply
 *     is a no-op (idempotent);
 *   - every reader returns IDENTICAL values before and after;
 *   - a global value set before migration keeps the meaning it had: below a
 *     service's own for the new keys, above it for the platform fee (and the
 *     migration does not copy a value the global one already shadows);
 *   - precedence after migration: zone > vertical > global;
 *   - saving the old screen keeps the migrated row in step, and never creates one;
 *   - the provenance endpoint data says where each value comes from.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.BULLMQ_ENABLED = 'false';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const main = async () => {
    const server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { dbName: 'settings_migration' });

    const { FoodFeeSettings } = await import('../src/modules/food/admin/models/feeSettings.model.js');
    const { FoodFeeSettings: QuickFeeSettings } = await import('../src/modules/quickCommerce/modules/food/admin/models/feeSettings.model.js');
    const { FoodServiceRadiusSettings } = await import('../src/modules/food/admin/models/serviceRadiusSettings.model.js');
    const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
    const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
    const { PlatformSetting } = await import('../src/core/config/setting.model.js');
    const resolver = await import('../src/core/config/resolver.service.js');
    const legacy = await import('../src/core/config/legacySettings.js');
    const { withMasterFees } = await import('../src/core/finance/platformFees.service.js');
    const { getOrderQuantityCeiling, invalidateOrderQuantityCeilingCache } = await import('../src/modules/food/shared/orderQuantityCeiling.js');
    const { loadServiceRadiusSettings } = await import('../src/modules/food/restaurant/services/serviceRadius.service.js');
    const { scheduleRideDispatch } = await import('../src/modules/taxi/services/dispatchService.js');
    const { migrateSettingsToResolver } = await import('../scripts/migrate-settings-to-resolver.mjs');

    const ZONE = '64b000000000000000000001';
    const quiet = () => {};

    const seed = async () => {
        await Promise.all([
            FoodFeeSettings.deleteMany({}), QuickFeeSettings.deleteMany({}), FoodServiceRadiusSettings.deleteMany({}),
            AdminBusinessSetting.deleteMany({}), PlatformSetting.deleteMany({}),
        ]);
        await FoodFeeSettings.create({ platformFee: 7, platformFeeGstRate: 12, gstRate: 5, maxOrderQuantityCeiling: 25, isActive: true });
        await QuickFeeSettings.create({ platformFee: 3, gstRate: 9, deliveryFee: 20, isActive: true });
        await FoodServiceRadiusSettings.create({ key: 'default', maxRadiusKm: 12 });
        await AdminBusinessSetting.create({ scope: 'default', transport_ride: { minimum_time_for_starting_trip_drivers_for_schedule_ride: '20' } });
        resolver.invalidateCache();
    };

    // Every reader, as the services call them.
    const taxiBufferMinutes = async () => {
        const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
        const ride = await Ride.create({ scheduledAt }).catch(() => ({ _id: new mongoose.Types.ObjectId(), scheduledAt }));
        const { runAt } = await scheduleRideDispatch(ride);
        return Math.round((scheduledAt.getTime() - runAt.getTime()) / 60000);
    };
    const readAll = async ({ zoneId } = {}) => {
        resolver.invalidateCache();
        invalidateOrderQuantityCeilingCache();
        const foodDoc = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
        const quickDoc = await QuickFeeSettings.findOne({ isActive: { $ne: false } }).sort({ createdAt: -1 }).lean();
        const food = await withMasterFees('food', foodDoc, { zoneId });
        const quick = await withMasterFees('quickCommerce', quickDoc, { zoneId });
        return {
            foodPlatformFee: food.platformFee,
            foodPlatformFeeGst: food.platformFeeGstRate,
            foodGst: food.gstRate,
            quickPlatformFee: quick.platformFee,
            quickGst: quick.gstRate,
            quickDeliveryFee: quick.deliveryFee,
            ceiling: await getOrderQuantityCeiling(),
            radius: (await loadServiceRadiusSettings()).maxRadiusKm,
            taxiLead: await taxiBufferMinutes(),
        };
    };
    const OWN = {
        foodPlatformFee: 7, foodPlatformFeeGst: 12, foodGst: 5,
        quickPlatformFee: 3, quickGst: 9, quickDeliveryFee: 20,
        ceiling: 25, radius: 12, taxiLead: 20,
    };

    console.log('\nnothing migrated: readers return each service\'s own values');
    await seed();
    const before = await readAll();
    await check('every reader returns the old copy', async () => {
        assert.deepEqual(before, OWN);
    });
    await check('provenance says "service\'s own" for every moved setting', async () => {
        const p = await legacy.settingsProvenance();
        assert.equal(p.length, legacy.LEGACY_SETTINGS.length);
        for (const row of p) assert.equal(row.origin, 'legacy', `${row.key}/${row.vertical}`);
    });

    console.log('\nmigration');
    await check('dry run reports copies and writes nothing', async () => {
        const { report, changed } = await migrateSettingsToResolver({ apply: false, log: quiet });
        assert.equal(changed, 0);
        assert.equal(report.filter((r) => r.action === 'copy').length, legacy.LEGACY_SETTINGS.length);
        assert.equal(await PlatformSetting.countDocuments({}), 0);
    });
    await check('--apply copies every value into a vertical row', async () => {
        const { counts, changed } = await migrateSettingsToResolver({ apply: true, log: quiet });
        assert.equal(changed, 0, 'no effective value changed');
        assert.equal(counts.copied, legacy.LEGACY_SETTINGS.length);
        const row = await PlatformSetting.findOne({ key: 'fees.itemGstRate', level: 'vertical', scopeId: 'quickCommerce' }).lean();
        assert.equal(row.value, 9);
        const taxi = await PlatformSetting.findOne({ key: 'orders.scheduledDispatchLeadMinutes', level: 'vertical', scopeId: 'taxi' }).lean();
        assert.equal(taxi.value, 20);
    });
    await check('readers return identical values after migration', async () => {
        assert.deepEqual(await readAll(), before);
    });
    await check('provenance now says "vertical override"', async () => {
        const p = await legacy.settingsProvenance();
        for (const row of p) {
            assert.equal(row.origin, 'vertical', `${row.key}/${row.vertical}`);
            assert.equal(row.migrated, true);
        }
    });
    await check('a second --apply is a no-op', async () => {
        const n = await PlatformSetting.countDocuments({});
        const { counts, changed } = await migrateSettingsToResolver({ apply: true, log: quiet });
        assert.equal(changed, 0);
        assert.deepEqual(counts, { 'in-sync': legacy.LEGACY_SETTINGS.length });
        assert.equal(await PlatformSetting.countDocuments({}), n);
    });

    console.log('\nprecedence after migration');
    await check('zone > vertical > global', async () => {
        await resolver.set('fees.flatDeliveryFee', { level: 'global', value: 50 });
        let r = await readAll();
        assert.equal(r.quickDeliveryFee, 20, 'vertical beats global');
        await resolver.set('fees.flatDeliveryFee', { level: 'zone', scopeId: ZONE, value: 35 });
        r = await readAll({ zoneId: ZONE });
        assert.equal(r.quickDeliveryFee, 35, 'zone beats vertical');
        r = await readAll();
        assert.equal(r.quickDeliveryFee, 20, 'other zones keep the vertical value');
        const p = (await legacy.settingsProvenance({ vertical: 'quickCommerce', zoneId: ZONE })).find((x) => x.key === 'fees.flatDeliveryFee');
        assert.equal(p.origin, 'zone');
        assert.equal(p.effective, 35);
        await resolver.set('fees.flatDeliveryFee', { level: 'vertical', scopeId: 'quickCommerce', value: null });
        r = await readAll();
        assert.equal(r.quickDeliveryFee, 20, 'vertical cleared: back to the service\'s own (still set), above global');
        await resolver.set('fees.flatDeliveryFee', { level: 'zone', scopeId: ZONE, value: null });
        await resolver.set('fees.flatDeliveryFee', { level: 'global', value: null });
        await resolver.set('fees.flatDeliveryFee', { level: 'vertical', scopeId: 'quickCommerce', value: 20 });
    });
    await check('a Master vertical value beats the service\'s own copy', async () => {
        await resolver.set('orders.maxQuantityPerItem', { level: 'vertical', scopeId: 'food', value: 40 });
        assert.equal((await readAll()).ceiling, 40);
        await resolver.set('orders.maxQuantityPerItem', { level: 'vertical', scopeId: 'food', value: 25 });
    });

    console.log('\nthe old screens');
    await check('saving the old screen updates the migrated row', async () => {
        await QuickFeeSettings.updateOne({}, { $set: { deliveryFee: 25 } });
        const doc = await QuickFeeSettings.findOne({}).lean();
        const synced = await legacy.syncLegacyWrite('quickFeeSettings', doc);
        assert.deepEqual(synced.map((s) => s.key), ['fees.flatDeliveryFee']);
        assert.equal((await readAll()).quickDeliveryFee, 25);
        await legacy.syncLegacyWrite('taxiTransportRide', { minimum_time_for_starting_trip_drivers_for_schedule_ride: '45' });
        assert.equal((await readAll()).taxiLead, 45);
    });
    await check('saving the old screen never creates a row', async () => {
        await PlatformSetting.deleteOne({ key: 'fees.itemGstRate', level: 'vertical', scopeId: 'food' });
        await legacy.syncLegacyWrite('foodFeeSettings', { gstRate: 18, platformFee: 7, platformFeeGstRate: 12, maxOrderQuantityCeiling: 25 });
        assert.equal(await PlatformSetting.countDocuments({ key: 'fees.itemGstRate', level: 'vertical', scopeId: 'food' }), 0);
    });

    console.log('\na global value set before migration keeps its meaning');
    await seed();
    await resolver.set('fees.itemGstRate', { level: 'global', value: 3 });
    await resolver.set('fees.platformFee', { level: 'global', value: 10 });
    await resolver.set('orders.scheduledDispatchLeadMinutes', { level: 'global', value: 60 });
    const withGlobal = await readAll();
    await check('new keys: the service\'s own still wins over a global value', async () => {
        assert.equal(withGlobal.foodGst, 5);
        assert.equal(withGlobal.quickGst, 9);
        assert.equal(withGlobal.taxiLead, 20, 'taxi keeps its own lead, not the quick-commerce global');
    });
    await check('platform fee: the global value wins, as it always has', async () => {
        assert.equal(withGlobal.foodPlatformFee, 10);
        assert.equal(withGlobal.quickPlatformFee, 10);
    });
    await check('migration skips the shadowed platform fee and changes nothing', async () => {
        const { report, changed } = await migrateSettingsToResolver({ apply: true, log: quiet });
        assert.equal(changed, 0);
        const fee = report.filter((r) => r.key === 'fees.platformFee');
        assert.deepEqual(fee.map((r) => r.action), ['skip', 'skip']);
        assert.equal(await PlatformSetting.countDocuments({ key: 'fees.platformFee', level: 'vertical' }), 0);
        assert.deepEqual(await readAll(), withGlobal);
    });
    await check('a service with no own value follows the global one', async () => {
        await FoodFeeSettings.updateMany({}, { $unset: { gstRate: 1 } });
        await PlatformSetting.deleteOne({ key: 'fees.itemGstRate', level: 'vertical', scopeId: 'food' });
        assert.equal((await readAll()).foodGst, 3);
        const p = (await legacy.settingsProvenance({ vertical: 'food' })).find((x) => x.key === 'fees.itemGstRate');
        assert.equal(p.origin, 'global');
    });
    await check('the checkout\'s fallback object is not treated as a setting', async () => {
        resolver.invalidateCache();
        const out = await withMasterFees('food', { platformFee: 0, gstRate: 0 });
        assert.equal(out.gstRate, 3, 'no fee document: the global value applies');
    });

    console.log('\nvalues the registry would refuse stay on the old copy');
    await seed();
    await check('an out-of-range old value is skipped, and readers keep using it', async () => {
        await QuickFeeSettings.updateMany({}, { $set: { deliveryFee: 20000 } });
        const before2 = await readAll();
        const { report, changed } = await migrateSettingsToResolver({ apply: true, log: quiet });
        assert.equal(changed, 0);
        const r = report.find((x) => x.key === 'fees.flatDeliveryFee');
        assert.equal(r.action, 'skip');
        assert.match(r.note, /not valid/);
        assert.deepEqual(await readAll(), before2);
        assert.equal(before2.quickDeliveryFee, 20000);
    });

    await mongoose.disconnect();
    await server.stop();
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall settings migration checks passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
