/**
 * The set-price guard: service location from the zone, one active price per
 * vehicle per zone per service.
 *
 * Run: node tests/taxi-set-price-guard.smoke.mjs
 */
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'set_price_guard' });
const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
const { Zone } = await import('../src/modules/taxi/driver/models/Zone.js');
const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
const { setPriceGuard } = await import('../src/modules/taxi/admin/setPriceGuard.js');

let failures = 0;
const check = async (label, fn) => {
    try { await fn(); console.log(`  ok   ${label}`); }
    catch (err) { failures += 1; console.log(`  FAIL ${label}\n       ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();

const loc = oid();
const withLoc = oid();
const noLoc = oid();
const bike = oid();
await Zone.collection.insertMany([
    { _id: withLoc, name: 'indore', active: true, service_location_id: loc },
    { _id: noLoc, name: 'palampur Taxi', active: true },
]);
await Vehicle.collection.insertOne({ _id: bike, name: 'Bike' });
const existing = (await SetPrice.collection.insertOne({ vehicle_type: bike, zone_id: withLoc, service_location_id: loc, transport_type: 'both', pricing_scope: 'ride', active: 1, status: 'active', base_price: 40, base_distance: 2, price_per_distance: 10 })).insertedId;

// What reached the real handler, or the guard's own answer.
const app = express();
app.use(express.json());
app.use('/set-prices', setPriceGuard);
app.all('/set-prices*', (req, res) => res.json({ reached: true, body: req.body }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/set-prices`;
const send = (method, path, body) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, json: await r.json() }));

await check('the zone object is not saved as the service location', async () => {
    const r = await send('POST', '/', { zone: { _id: String(noLoc) }, zone_id: String(noLoc), vehicle_type: String(oid()), transport_type: 'taxi' });
    assert.equal(r.json.reached, true);
    assert.equal(r.json.body.zone, undefined);
    assert.equal(r.json.body.service_location_id, undefined);
});
await check('a zone with a service location fills it in', async () => {
    const r = await send('POST', '/', { zone_id: String(withLoc), service_location_id: String(withLoc), vehicle_type: String(oid()), transport_type: 'taxi' });
    assert.equal(r.json.body.service_location_id, String(loc));
});
await check('a second active Bike price in the same zone is refused, with the row to edit', async () => {
    const r = await send('POST', '/', { zone_id: String(withLoc), vehicle_type: String(bike), transport_type: 'taxi', active: 1 });
    assert.equal(r.status, 409);
    assert.match(r.json.message, /Bike already has an active Taxi \+ Parcel price/);
    assert.equal(r.json.data.conflictingSetPriceId, String(existing));
});
await check('editing that same row is allowed', async () => {
    const r = await send('PATCH', `/${existing}`, { base_price: 45 });
    assert.equal(r.json.reached, true);
});
await check('saving it switched off, or in another zone, is allowed', async () => {
    assert.equal((await send('POST', '/', { zone_id: String(withLoc), vehicle_type: String(bike), transport_type: 'taxi', active: 0 })).json.reached, true);
    assert.equal((await send('POST', '/', { zone_id: String(noLoc), vehicle_type: String(bike), transport_type: 'taxi', active: 1 })).json.reached, true);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
