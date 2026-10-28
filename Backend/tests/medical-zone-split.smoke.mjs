/**
 * Medical's zones are its own, and quick commerce cannot see them.
 *
 * Run: node tests/medical-zone-split.smoke.mjs
 *
 * A pharmacy is a quick-commerce seller, so until now it shared quick
 * commerce's map: a zone drawn for groceries decided where medicine could go,
 * and a zone drawn in the Medical panel turned up under Quick Shop. They are
 * now two collections.
 *
 * The failure this guards against is a quiet one. If a medical order resolved
 * against the grocery map, nothing would throw -- an address would simply be
 * refused as "we don't deliver there" while the Medical panel plainly showed a
 * zone covering it, or worse, accepted for a zone medical never drew.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'medical_zone_split' });

const BASE = '../src/modules/quickCommerce/modules/food';
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { MedicalZone } = await import(`${BASE}/admin/models/medicalZone.model.js`);
const zoneService = await import(`${BASE}/shared/zoneServiceability.js`);
const admin = await import(`${BASE}/admin/services/admin.service.js`);

const { ZONE_VERTICALS, findZoneForPoint, zoneModelFor } = zoneService;

/** A square around a point, big enough to contain it comfortably. */
const square = (lat, lng, d = 0.05) => [
    { latitude: lat - d, longitude: lng - d },
    { latitude: lat - d, longitude: lng + d },
    { latitude: lat + d, longitude: lng + d },
    { latitude: lat + d, longitude: lng - d },
];

// Two different places. Groceries serve one, medicine the other.
const GROCERY_TOWN = { lat: 21.15, lng: 79.09 };
const MEDICAL_TOWN = { lat: 22.73, lng: 75.87 };

await QCZone.create({
    name: 'Grocery Town', zoneName: 'Grocery Town', isActive: true,
    coordinates: square(GROCERY_TOWN.lat, GROCERY_TOWN.lng),
});
await MedicalZone.create({
    name: 'Medicine Town', zoneName: 'Medicine Town', isActive: true,
    coordinates: square(MEDICAL_TOWN.lat, MEDICAL_TOWN.lng),
});

console.log('\ntwo maps, asked the same question');

await check('the collections are different', () => {
    assert.equal(QCZone.collection.name, 'qc_zones');
    assert.equal(MedicalZone.collection.name, 'medical_zones');
    assert.notEqual(zoneModelFor('quick'), zoneModelFor('medical'));
});

await check('a grocery address resolves on the quick map', async () => {
    const zone = await findZoneForPoint(GROCERY_TOWN.lat, GROCERY_TOWN.lng, ZONE_VERTICALS.QUICK);
    assert.ok(zone, 'not found');
    assert.equal(zone.name, 'Grocery Town');
});

await check('THE POINT: that same address is NOT medical-serviceable', async () => {
    const zone = await findZoneForPoint(GROCERY_TOWN.lat, GROCERY_TOWN.lng, ZONE_VERTICALS.MEDICAL);
    assert.equal(zone, null, `medical saw ${zone?.name}`);
});

await check('and the medical address is not a quick-commerce one', async () => {
    const medical = await findZoneForPoint(MEDICAL_TOWN.lat, MEDICAL_TOWN.lng, ZONE_VERTICALS.MEDICAL);
    assert.equal(medical?.name, 'Medicine Town');
    const quick = await findZoneForPoint(MEDICAL_TOWN.lat, MEDICAL_TOWN.lng, ZONE_VERTICALS.QUICK);
    assert.equal(quick, null, `quick commerce saw ${quick?.name}`);
});

await check('an unnamed vertical means quick commerce, not medical', async () => {
    // Every caller written before the split is asking about groceries. A
    // default of medical would quietly repoint all of them.
    const zone = await findZoneForPoint(GROCERY_TOWN.lat, GROCERY_TOWN.lng);
    assert.equal(zone?.name, 'Grocery Town');
});

await check('so does an unrecognised one', async () => {
    const zone = await findZoneForPoint(GROCERY_TOWN.lat, GROCERY_TOWN.lng, 'pharmacy-ish');
    assert.equal(zone?.name, 'Grocery Town');
});

console.log('\nthe admin panel writes into the map it is showing');

await check('a zone created as medical lands in medical_zones only', async () => {
    const created = await admin.createZone({
        name: 'Drawn In Medical',
        coordinates: square(23.0, 76.0),
    }, 'medical');
    assert.ok(created.zone, created.error);

    assert.ok(await MedicalZone.findOne({ name: 'Drawn In Medical' }));
    assert.equal(await QCZone.findOne({ name: 'Drawn In Medical' }), null,
        'it turned up under Quick Shop');
});

await check('a zone created without a vertical lands in quick commerce', async () => {
    const created = await admin.createZone({
        name: 'Drawn By Default',
        coordinates: square(24.0, 77.0),
    });
    assert.ok(created.zone, created.error);
    assert.ok(await QCZone.findOne({ name: 'Drawn By Default' }));
    assert.equal(await MedicalZone.findOne({ name: 'Drawn By Default' }), null);
});

await check('each panel lists only its own', async () => {
    const medical = await admin.getZones({ vertical: 'medical' });
    const quick = await admin.getZones({});
    const names = (r) => r.zones.map((z) => z.name).sort();
    assert.deepEqual(names(medical), ['Drawn In Medical', 'Medicine Town']);
    assert.deepEqual(names(quick), ['Drawn By Default', 'Grocery Town']);
});

await check('editing a medical zone does not touch the quick one sharing its id', async () => {
    /*
     * The migration copies zones keeping their _id, so for a while the same id
     * exists in both collections. That is what lets nine pharmacies survive the
     * split untouched -- and it means an edit must be applied to exactly one of
     * them.
     */
    const shared = new mongoose.Types.ObjectId();
    const body = { name: 'Shared Id', coordinates: square(25.0, 78.0), isActive: true };
    await QCZone.create({ _id: shared, ...body });
    await MedicalZone.create({ _id: shared, ...body });

    await admin.updateZone(String(shared), { name: 'Renamed By Medical' }, 'medical');

    assert.equal((await MedicalZone.findById(shared)).name, 'Renamed By Medical');
    assert.equal((await QCZone.findById(shared)).name, 'Shared Id', 'quick commerce was edited too');
});

await check('and deleting from one leaves the other standing', async () => {
    const shared = await MedicalZone.findOne({ name: 'Renamed By Medical' });
    await admin.deleteZone(String(shared._id), 'medical');
    assert.equal(await MedicalZone.findById(shared._id), null);
    assert.ok(await QCZone.findById(shared._id), 'quick commerce lost its zone');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
