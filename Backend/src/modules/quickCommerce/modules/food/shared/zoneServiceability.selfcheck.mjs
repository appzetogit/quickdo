// Standalone check of the point-in-polygon and address-reading helpers.
//   node src/modules/food/shared/zoneServiceability.selfcheck.mjs
//
// findZoneForPoint needs the zone collection and is checked against a real
// database; everything it decides with is checked here.
import assert from 'node:assert';
import { isPointInPolygon, readAddressPoint, toFiniteNumber } from './zoneServiceability.js';

const ring = (points) => points.map(([latitude, longitude]) => ({ latitude, longitude }));

// A unit square around the origin.
const square = ring([[0, 0], [0, 10], [10, 10], [10, 0]]);

assert.equal(isPointInPolygon(5, 5, square), true, 'centre is inside');
assert.equal(isPointInPolygon(15, 5, square), false, 'north of the ring is outside');
assert.equal(isPointInPolygon(5, 15, square), false, 'east of the ring is outside');
assert.equal(isPointInPolygon(-1, -1, square), false, 'southwest of the ring is outside');

// A concave zone: the notch must not count as served just because it sits
// between two arms of the same polygon.
const uShape = ring([[0, 0], [0, 10], [4, 10], [4, 4], [6, 4], [6, 10], [10, 10], [10, 0]]);
assert.equal(isPointInPolygon(2, 5, uShape), true, 'inside the base of the U');
assert.equal(isPointInPolygon(5, 8, uShape), false, 'the notch is not served');
assert.equal(isPointInPolygon(5, 2, uShape), true, 'below the notch is served');

// Too few points is not a zone. Serving everything on a malformed polygon would
// be worse than serving nothing.
assert.equal(isPointInPolygon(5, 5, ring([[0, 0], [0, 10]])), false);
assert.equal(isPointInPolygon(5, 5, []), false);
assert.equal(isPointInPolygon(5, 5, undefined), false);

// Addresses arrive in three shapes depending on which app version wrote them.
// GeoJSON is [lng, lat] -- reading it as [lat, lng] would silently test a
// mirrored point that lands in the wrong zone or none at all.
assert.deepEqual(readAddressPoint({ location: { coordinates: [77.5, 12.9] } }), { lat: 12.9, lng: 77.5 });
assert.deepEqual(readAddressPoint({ latitude: 12.9, longitude: 77.5 }), { lat: 12.9, lng: 77.5 });
assert.deepEqual(readAddressPoint({ lat: 12.9, lng: 77.5 }), { lat: 12.9, lng: 77.5 });

// An address with no usable point returns null, which the order path treats as
// "cannot test" rather than "not serviceable".
assert.equal(readAddressPoint({ street: 'somewhere' }), null);
assert.equal(readAddressPoint({ location: { coordinates: [] } }), null);
assert.equal(readAddressPoint(null), null);

// Zero is a real coordinate and must survive the finite check.
assert.equal(toFiniteNumber(0), 0);
assert.deepEqual(readAddressPoint({ latitude: 0, longitude: 0 }), { lat: 0, lng: 0 });
assert.equal(toFiniteNumber('abc'), null);
assert.equal(toFiniteNumber(null), null);

console.log('zone serviceability: all assertions passed');
