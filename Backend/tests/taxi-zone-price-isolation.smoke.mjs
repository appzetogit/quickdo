/**
 * Editing one zone's Bike price must not change another zone's fare.
 *
 * Reproduces 28 Oct: Palampur's rows had the zone id saved as their service
 * location and the Palampur zone had no service location, so a Palampur ride
 * matched none of its own rows and fell back to the Bike row edited last
 * anywhere -- Indore's.
 *
 * Run: node tests/taxi-zone-price-isolation.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'taxi_zone_price' });
const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
const { Zone } = await import('../src/modules/taxi/driver/models/Zone.js');
const { resolveSetPriceForRide, findPricingZoneForPickup } = await import('../src/modules/taxi/services/rideService.js');

let failures = 0;
const check = async (label, fn) => {
    try { await fn(); console.log(`  ok   ${label}`); }
    catch (err) { failures += 1; console.log(`  FAIL ${label}\n       ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();
const square = (lng, lat) => ({ type: 'Polygon', coordinates: [[[lng - 0.1, lat - 0.1], [lng + 0.1, lat - 0.1], [lng + 0.1, lat + 0.1], [lng - 0.1, lat + 0.1], [lng - 0.1, lat - 0.1]]] });

const bike = oid();
const indoreLoc = oid();
const kangraLoc = oid();
const palampur = oid();
const indore = oid();
await Zone.collection.insertMany([
    { _id: palampur, name: 'palampur Taxi', active: true, geometry: square(76.53, 32.11) },
    { _id: indore, name: 'indore', active: true, service_location_id: indoreLoc, geometry: square(75.86, 22.72) },
]);
await Zone.collection.createIndex({ geometry: '2dsphere' });
const row = (doc, at) => ({ _id: oid(), vehicle_type: bike, active: 1, status: 'active', pricing_scope: 'ride', createdAt: at, updatedAt: at, ...doc });
await SetPrice.collection.insertMany([
    // Palampur, saved with the zone id where the service location belongs.
    row({ zone_id: palampur, service_location_id: palampur, transport_type: 'both', base_price: 40 }, new Date('2026-10-28T06:22:00Z')),
    // Indore, edited after it.
    row({ zone_id: indore, service_location_id: indoreLoc, transport_type: 'taxi', base_price: 47 }, new Date('2026-10-28T09:37:00Z')),
]);

await check('the Palampur zone is found for a Palampur pickup, whatever service location the app sends', async () => {
    const z = await findPricingZoneForPickup({ pickupPoint: [76.53, 32.11], serviceLocationId: kangraLoc });
    assert.equal(String(z?._id), String(palampur));
});
await check('a Palampur ride prices from Palampur\'s row, not the Bike row edited last', async () => {
    const r = await resolveSetPriceForRide({ serviceLocationId: kangraLoc, zoneId: palampur, transportType: 'taxi', vehicleTypeId: bike });
    assert.equal(r?.base_price, 40);
});
await check('an Indore ride still prices from Indore\'s row', async () => {
    const r = await resolveSetPriceForRide({ serviceLocationId: indoreLoc, zoneId: indore, transportType: 'taxi', vehicleTypeId: bike });
    assert.equal(r?.base_price, 47);
});
await check('a zone with no row of its own does not borrow another zone\'s price', async () => {
    const r = await resolveSetPriceForRide({ zoneId: oid(), transportType: 'taxi', vehicleTypeId: bike });
    assert.equal(r, null);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
