// Ride requests stay inside the pickup's zone. Run: node tests/taxi-zone-dispatch.check.mjs
import assert from 'node:assert/strict';
const { pointInZoneGeometry } = await import('../src/modules/taxi/services/matchingService.js');
const square = { type: 'Polygon', coordinates: [[[75.8, 22.7], [75.9, 22.7], [75.9, 22.8], [75.8, 22.8], [75.8, 22.7]]] };
assert.equal(pointInZoneGeometry([75.85, 22.75], square), true, 'driver inside the zone');
assert.equal(pointInZoneGeometry([75.95, 22.75], square), false, 'driver just across the east edge');
assert.equal(pointInZoneGeometry([75.85, 22.85], square), false, 'driver north of the zone');
assert.equal(pointInZoneGeometry(undefined, square), false, 'driver with no location is not offered');
const multi = { type: 'MultiPolygon', coordinates: [square.coordinates, [[[76, 23], [76.1, 23], [76.1, 23.1], [76, 23.1], [76, 23]]]] };
assert.equal(pointInZoneGeometry([76.05, 23.05], multi), true, 'second part of a multi-part zone');
console.log('taxi zone dispatch checks passed');
