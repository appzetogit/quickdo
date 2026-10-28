/**
 * A rider with no orders yet sees the incentive ladder of the zone they are in.
 *
 * Run: node tests/incentive-zone-from-location.smoke.mjs
 *
 * The home-screen card took the rider's zone only from their latest order. On a
 * new platform (no orders at all) every rider read "no zone", which matches only
 * an all-zones ladder -- and every ladder the admin had set was per zone, so the
 * card was hidden for everyone. The rider's last known location now decides.
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
await mongoose.connect(mongo.getUri(), { dbName: 'incentive_zone_location' });

const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { DriverIncentiveRule } = await import('../src/core/incentives/models/driverIncentiveRule.model.js');
const { getCurrentIncentiveForFoodPartner } = await import('../src/core/incentives/services/incentiveService.js');

const box = (lat, lng, d) => [
    { latitude: lat - d, longitude: lng - d }, { latitude: lat - d, longitude: lng + d },
    { latitude: lat + d, longitude: lng + d }, { latitude: lat + d, longitude: lng - d },
];
const oid = () => new mongoose.Types.ObjectId();
const palampur = await FoodZone.collection.insertOne({ name: 'Palampur food', isActive: true, coordinates: box(32.11, 76.54, 0.1) });
const indore = await FoodZone.collection.insertOne({ name: 'Indore', isActive: true, coordinates: box(22.72, 75.86, 0.2) });
await DriverIncentiveRule.create({ segment: 'foodAndQuick', windowType: 'daily', isActive: true, zoneId: palampur.insertedId, tiers: [{ fromOrders: 1, toOrders: 5, rewardAmount: 125 }, { fromOrders: 6, toOrders: 10, rewardAmount: 200 }] });
await DriverIncentiveRule.create({ segment: 'foodAndQuick', windowType: 'daily', isActive: true, zoneId: indore.insertedId, tiers: [{ fromOrders: 1, toOrders: 5, rewardAmount: 100 }] });

const rider = async (name, lat, lng) => {
    const _id = oid();
    await FoodDeliveryPartner.collection.insertOne({ _id, name, phone: String(9300000000 + Math.floor(Math.random() * 1e6)), status: 'approved', ...(lat != null ? { lastLat: lat, lastLng: lng } : {}) });
    return _id;
};

await check('a rider in Palampur with no orders sees the Palampur ladder', async () => {
    const card = await getCurrentIncentiveForFoodPartner(await rider('jk', 32.1099, 76.5401));
    assert.ok(card, 'no card');
    assert.equal(card.totalRewardAmount, 325);
    assert.equal(card.tiers.length, 2);
});

await check('a rider in Indore with no orders sees the Indore ladder', async () => {
    const card = await getCurrentIncentiveForFoodPartner(await rider('demo', 22.687, 75.888));
    assert.equal(card?.totalRewardAmount, 100);
});

await check('a rider outside every zone, or with no location, still gets no card', async () => {
    assert.equal(await getCurrentIncentiveForFoodPartner(await rider('far', 19.07, 72.88)), null);
    assert.equal(await getCurrentIncentiveForFoodPartner(await rider('none')), null);
});

await check('the latest order still wins over the location', async () => {
    const id = await rider('mover', 22.687, 75.888); // in Indore now
    await FoodOrder.collection.insertOne({ _id: oid(), orderStatus: 'delivered', zoneId: palampur.insertedId, dispatch: { deliveryPartnerId: id }, updatedAt: new Date(), createdAt: new Date() });
    const card = await getCurrentIncentiveForFoodPartner(id);
    assert.equal(card?.totalRewardAmount, 325);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
