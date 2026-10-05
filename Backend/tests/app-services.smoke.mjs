/**
 * The admin decides which services the customer app shows, everywhere or per zone.
 *
 * Run: node tests/app-services.smoke.mjs
 *
 * What this guards:
 *   - nothing is hidden until an admin hides it -- a fresh platform shows all four;
 *   - "off everywhere" beats any zone;
 *   - "off in a zone" hides the service only for customers inside that zone, and
 *     only that service -- food's zone switch must not hide taxi;
 *   - each service is judged on its OWN map (food, quick and medical polygons,
 *     taxi's GeoJSON), because the same address can be in one and not another;
 *   - being outside every zone does not hide a tile;
 *   - the app's read is public, the admin's writes need an admin.
 */
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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
process.env.MONGODB_URI = mongo.getUri('app_services');
await mongoose.connect(mongo.getUri('app_services'));

const rules = await import('../src/core/appServices/appServices.rules.js');
const svc = await import('../src/core/appServices/appServices.service.js');
const routes = (await import('../src/core/appServices/appServices.routes.js')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const { QCZone } = await import('../src/modules/quickCommerce/modules/food/admin/models/zone.model.js');
const { MedicalZone } = await import('../src/modules/quickCommerce/modules/food/admin/models/medicalZone.model.js');
const { Zone: TaxiZone } = await import('../src/modules/taxi/driver/models/Zone.js');
await TaxiZone.init(); // the 2dsphere index $geoIntersects needs

// Indore and Bhopal, far apart.
const INDORE = { lat: 22.7196, lng: 75.8577 };
const BHOPAL = { lat: 23.2599, lng: 77.4126 };
const NOWHERE = { lat: 10.0, lng: 70.0 };

const ring = ({ lat, lng }, d = 0.1) => [
    { latitude: lat - d, longitude: lng - d },
    { latitude: lat - d, longitude: lng + d },
    { latitude: lat + d, longitude: lng + d },
    { latitude: lat + d, longitude: lng - d },
];
const geo = ({ lat, lng }, d = 0.1) => ({
    type: 'Polygon',
    coordinates: [[
        [lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d],
    ]],
});

const foodIndore = await FoodZone.create({ name: 'Indore Food', isActive: true, coordinates: ring(INDORE) });
await FoodZone.create({ name: 'Bhopal Food', isActive: true, coordinates: ring(BHOPAL) });
await QCZone.create({ name: 'Indore Quick', isActive: true, coordinates: ring(INDORE) });
// Medical is drawn only in Bhopal: Indore is outside every medical zone.
await MedicalZone.create({ name: 'Bhopal Medical', isActive: true, coordinates: ring(BHOPAL) });
const taxiIndore = await TaxiZone.create({ name: 'Indore Taxi', active: true, geometry: geo(INDORE) });

const at = async (point) => {
    svc.clearAppServicesCache();
    const out = await svc.resolveAppServicesAt(point || {});
    return Object.fromEntries(out.services.map((s) => [s.key, s]));
};

console.log('\nnothing hidden until someone hides it');

await check('a fresh platform shows all four services', async () => {
    const s = await at(INDORE);
    assert.deepEqual(Object.keys(s).sort(), ['food', 'medical', 'quick', 'taxi']);
    for (const key of Object.keys(s)) assert.equal(s[key].visible, true, `${key} hidden`);
});

await check('each service reports its own zone at the same address', async () => {
    const s = await at(INDORE);
    assert.equal(s.food.zone?.name, 'Indore Food');
    assert.equal(s.quick.zone?.name, 'Indore Quick');
    assert.equal(s.taxi.zone?.name, 'Indore Taxi', 'taxi GeoJSON zone not found');
    assert.equal(s.medical.inZone, false, 'Indore has no medical zone');
});

await check('outside every zone is not a reason to hide a tile', async () => {
    const s = await at(NOWHERE);
    for (const key of Object.keys(s)) {
        assert.equal(s[key].visible, true, key);
        assert.equal(s[key].inZone, false, key);
    }
});

console.log('\nper zone');

await check('food switched off in Indore: hidden in Indore', async () => {
    await svc.setZoneEnabled('food', String(foodIndore._id), false, { actorId: 'admin1' });
    const s = await at(INDORE);
    assert.equal(s.food.visible, false);
    assert.equal(s.food.reason, 'disabled_in_zone');
});

await check('  but still shown in Bhopal', async () => {
    assert.equal((await at(BHOPAL)).food.visible, true);
});

await check('  and only food: quick and taxi in Indore are untouched', async () => {
    const s = await at(INDORE);
    assert.equal(s.quick.visible, true);
    assert.equal(s.taxi.visible, true);
});

await check('taxi switched off in its GeoJSON zone', async () => {
    await svc.setZoneEnabled('taxi', String(taxiIndore._id), false, { actorId: 'admin1' });
    assert.equal((await at(INDORE)).taxi.visible, false);
    await svc.setZoneEnabled('taxi', String(taxiIndore._id), true, { actorId: 'admin1' });
    assert.equal((await at(INDORE)).taxi.visible, true);
});

await check('switching the zone back on shows it again, with one rule stored', async () => {
    await svc.setZoneEnabled('food', String(foodIndore._id), true, { actorId: 'admin1' });
    await svc.setZoneEnabled('food', String(foodIndore._id), false, { actorId: 'admin1' });
    await svc.setZoneEnabled('food', String(foodIndore._id), true, { actorId: 'admin2' });
    assert.equal((await at(INDORE)).food.visible, true);
    const { AppServicesState } = await import('../src/core/appServices/appServices.model.js');
    const doc = await AppServicesState.findById('platform').lean();
    const rows = doc.zoneRules.filter((r) => r.service === 'food' && r.zoneId === String(foodIndore._id));
    assert.equal(rows.length, 1, `${rows.length} rules for one zone`);
    assert.equal(rows[0].updatedBy, 'admin2');
});

await check('a zone id from another service is refused', async () => {
    await assert.rejects(
        () => svc.setZoneEnabled('medical', String(foodIndore._id), false),
        /does not exist for this service/,
    );
});

console.log('\neverywhere');

await check('medical switched off everywhere: hidden in every city, and with no location', async () => {
    await svc.setServiceEnabled('medical', false, { actorId: 'admin1' });
    assert.equal((await at(INDORE)).medical.visible, false);
    assert.equal((await at(BHOPAL)).medical.reason, 'disabled');
    assert.equal((await at(null)).medical.visible, false);
});

await check('off everywhere beats a zone that is switched on', async () => {
    const medical = await MedicalZone.findOne({ name: 'Bhopal Medical' });
    await svc.setZoneEnabled('medical', String(medical._id), true);
    assert.equal((await at(BHOPAL)).medical.visible, false);
    await svc.setServiceEnabled('medical', true);
    assert.equal((await at(BHOPAL)).medical.visible, true);
});

await check('the admin view lists every service with its zones and switches', async () => {
    await svc.setZoneEnabled('food', String(foodIndore._id), false, { actorId: 'admin9' });
    const view = await svc.getAdminView();
    const food = view.services.find((s) => s.key === 'food');
    assert.deepEqual(food.zones.map((z) => z.name), ['Bhopal Food', 'Indore Food']);
    const indore = food.zones.find((z) => z.name === 'Indore Food');
    assert.equal(indore.enabled, false);
    assert.equal(indore.updatedBy, 'admin9');
    assert.equal(view.services.find((s) => s.key === 'taxi').zones[0].name, 'Indore Taxi');
    await svc.setZoneEnabled('food', String(foodIndore._id), true);
});

await check('unknown services and non-boolean values are refused', async () => {
    await assert.rejects(() => svc.setServiceEnabled('parcel', false), /Unknown service/);
    await assert.rejects(() => svc.setServiceEnabled('food', 'no'), /true or false/);
});

await check('the rule alone: a stored rule for a service not in the list is ignored', () => {
    const state = rules.normalizeAppServicesState({
        services: { food: { enabled: false }, bogus: { enabled: false } },
        zoneRules: [{ service: 'bogus', zoneId: 'z', enabled: false }],
    });
    assert.equal(state.services.food.enabled, false);
    assert.equal(state.services.bogus, undefined);
    assert.equal(state.zoneRules.length, 0);
});

console.log('\nover HTTP');

const app = express();
app.use(express.json());
app.use('/v1/platform/app-services', routes);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/v1/platform/app-services`;
const adminToken = signAccessToken({ userId: String(new mongoose.Types.ObjectId()), role: 'ADMIN' });

await check('the app reads without signing in', async () => {
    const res = await fetch(`${base}?lat=${INDORE.lat}&lng=${INDORE.lng}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.located, true);
    assert.equal(body.data.services.length, 4);
});

await check('the admin view needs a token', async () => {
    assert.equal((await fetch(`${base}/admin`)).status, 401);
    const res = await fetch(`${base}/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(res.status, 200);
});

await check('a customer token cannot flip a switch', async () => {
    const userToken = signAccessToken({ userId: String(new mongoose.Types.ObjectId()), role: 'RESTAURANT' });
    const res = await fetch(`${base}/admin/food`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
    });
    assert.ok([401, 403].includes(res.status), `status ${res.status}`);
});

await check('an admin hides taxi everywhere over HTTP, and the app sees it', async () => {
    const res = await fetch(`${base}/admin/taxi`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
    });
    assert.equal(res.status, 200, await res.text());
    svc.clearAppServicesCache();
    const body = await (await fetch(base)).json();
    assert.equal(body.data.services.find((s) => s.key === 'taxi').visible, false);
});

await check('a bad zone over HTTP is a 404, not a 500', async () => {
    const res = await fetch(`${base}/admin/food/zones/${new mongoose.Types.ObjectId()}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
    });
    assert.equal(res.status, 404);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
