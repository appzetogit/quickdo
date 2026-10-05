/**
 * A city ride stays inside the pickup's zone (client rule 2026-09-30).
 * Run: node tests/taxi-same-zone-trip.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'taxi_zone' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { Zone } = await import('../src/modules/taxi/driver/models/Zone.js');
const { assertTripInsidePickupZone } = await import('../src/modules/taxi/services/matchingService.js');
await Zone.syncIndexes();

await check('with no zones set up, nothing is refused', async () => {
  assert.equal(await assertTripInsidePickupZone({ pickupCoords: [75.85, 22.75], dropCoords: [80, 20] }), null);
});

const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
await Zone.collection.insertMany([
  { name: 'Indore', geometry: square(75.8, 22.7, 75.9, 22.8) },
  { name: 'Palampur', geometry: square(76.5, 32.0, 76.6, 32.2) },
]);

await check('pickup and drop in the same zone: allowed', async () => {
  const z = await assertTripInsidePickupZone({ pickupCoords: [75.85, 22.75], dropCoords: [75.88, 22.72] });
  assert.equal(z.name, 'Indore');
});
await check('drop outside the pickup zone: refused, naming the zone', async () => {
  await assert.rejects(
    () => assertTripInsidePickupZone({ pickupCoords: [75.85, 22.75], dropCoords: [75.95, 22.75] }),
    (e) => e.statusCode === 400 && /outside your pickup's service area \(Indore\)/.test(e.message),
  );
});
await check('drop in a DIFFERENT zone: refused', async () => {
  await assert.rejects(() => assertTripInsidePickupZone({ pickupCoords: [75.85, 22.75], dropCoords: [76.55, 32.1] }), /outside/);
});
await check('a stop outside the zone is refused, whatever its shape', async () => {
  for (const stop of [[75.95, 22.75], { coordinates: [75.95, 22.75] }, { lat: 22.75, lng: 75.95 }]) {
    await assert.rejects(
      () => assertTripInsidePickupZone({ pickupCoords: [75.85, 22.75], dropCoords: [75.88, 22.72], stops: [stop] }),
      /stop on this trip is outside/,
    );
  }
});
await check('pickup in no zone: refused', async () => {
  await assert.rejects(() => assertTripInsidePickupZone({ pickupCoords: [77.0, 28.6], dropCoords: [77.01, 28.61] }), /not available at this pickup/);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall same-zone trip checks passed');
process.exit(failed ? 1 : 0);
