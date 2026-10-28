/**
 * An order is only ever offered to a rider in its own zone.
 *
 * Run: node tests/dispatch-stays-in-zone.smoke.mjs
 *
 * Reported live: food and quick-commerce requests reaching riders in other zones.
 * Production has two zones ~700km apart, Indore and Palampur, and two riders --
 * one standing in each. Dispatch had no zone test on any path, and the fallback
 * it takes when nobody is within 15km returned every online rider on the
 * platform, so with a single rider online he was offered every order from every
 * city.
 *
 * Real polygons and real rider coordinates, lifted from production.
 */
import assert from 'node:assert/strict';
import {
    isPointInPolygon,
    resolveZoneIdForPoint,
    filterCandidatesToZone,
} from '../src/modules/food/shared/zoneMatching.js';

let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

// Boxes around the two real zones, big enough to hold the live coordinates.
const INDORE = '6a89493996cac68db1382b13';
const PALAMPUR = '6a89575496cac68db1382e4a';
const zones = [
    {
        _id: INDORE,
        name: 'Indore',
        coordinates: [
            { latitude: 22.60, longitude: 75.75 },
            { latitude: 22.60, longitude: 76.00 },
            { latitude: 22.85, longitude: 76.00 },
            { latitude: 22.85, longitude: 75.75 },
        ],
    },
    {
        _id: PALAMPUR,
        name: 'Palampur',
        coordinates: [
            { latitude: 32.00, longitude: 76.45 },
            { latitude: 32.00, longitude: 76.65 },
            { latitude: 32.20, longitude: 76.65 },
            { latitude: 32.20, longitude: 76.45 },
        ],
    },
];

// The two riders, where production actually has them.
const RISHI = { partnerId: 'rishi', lat: 22.7282128, lng: 75.8843547 }; // Indore
const JK = { partnerId: 'jk', lat: 32.1100131, lng: 76.5401675 };       // Palampur

console.log('\nplacing a point in a zone');

check('a rider standing in Indore resolves to Indore', () => {
    assert.equal(resolveZoneIdForPoint(RISHI.lat, RISHI.lng, zones), INDORE);
});

check('a rider standing in Palampur resolves to Palampur', () => {
    assert.equal(resolveZoneIdForPoint(JK.lat, JK.lng, zones), PALAMPUR);
});

check('a point in neither resolves to nothing', () => {
    assert.equal(resolveZoneIdForPoint(19.0760, 72.8777, zones), null, 'Mumbai');
});

check('a missing position resolves to nothing rather than guessing', () => {
    assert.equal(resolveZoneIdForPoint(null, null, zones), null);
    assert.equal(resolveZoneIdForPoint(undefined, undefined, zones), null);
});

check('a degenerate polygon never swallows a point', () => {
    assert.equal(isPointInPolygon(22.7, 75.8, [{ latitude: 1, longitude: 1 }]), false);
});

console.log('\nthe reported bug: a Palampur order with only an Indore rider online');

check('the Indore rider is NOT offered the Palampur order', () => {
    const { kept, dropped, enforced } = filterCandidatesToZone([RISHI], PALAMPUR, zones);
    assert.equal(enforced, true);
    assert.equal(kept.length, 0, 'he was offered it anyway');
    assert.equal(dropped[0].resolvedZoneId, INDORE);
});

check('and an Indore order does reach him', () => {
    const { kept } = filterCandidatesToZone([RISHI], INDORE, zones);
    assert.deepEqual(kept.map((c) => c.partnerId), ['rishi']);
});

check('with both online, each order goes to its own rider', () => {
    assert.deepEqual(
        filterCandidatesToZone([RISHI, JK], INDORE, zones).kept.map((c) => c.partnerId),
        ['rishi'],
    );
    assert.deepEqual(
        filterCandidatesToZone([RISHI, JK], PALAMPUR, zones).kept.map((c) => c.partnerId),
        ['jk'],
    );
});

console.log('\nriders whose position is unknown');

check('a rider with no GPS is not assumed to be in the zone', () => {
    const ghost = { partnerId: 'ghost', lat: null, lng: null };
    const { kept } = filterCandidatesToZone([ghost], INDORE, zones);
    assert.equal(kept.length, 0, 'an unknown position is not a nearby one');
});

console.log('\nnot breaking a platform that has no zones');

check('with no zones configured, nobody is filtered out', () => {
    const { kept, enforced } = filterCandidatesToZone([RISHI, JK], INDORE, []);
    assert.equal(enforced, false, 'nothing to enforce');
    assert.equal(kept.length, 2, 'dispatch must not stop handing out work');
});

check('a restaurant with no zone still dispatches', () => {
    const { kept, enforced } = filterCandidatesToZone([RISHI, JK], null, zones);
    assert.equal(enforced, false);
    assert.equal(kept.length, 2);
});

console.log('\ntwo zones close together');

check('distance is not the same question as zone', () => {
    // Adjacent boxes: a rider 2km away can still be in the other zone, which is
    // why a radius test alone was never enough.
    const near = [
        { _id: 'A', name: 'A', coordinates: [
            { latitude: 22.70, longitude: 75.80 }, { latitude: 22.70, longitude: 75.85 },
            { latitude: 22.75, longitude: 75.85 }, { latitude: 22.75, longitude: 75.80 }] },
        { _id: 'B', name: 'B', coordinates: [
            { latitude: 22.70, longitude: 75.85 }, { latitude: 22.70, longitude: 75.90 },
            { latitude: 22.75, longitude: 75.90 }, { latitude: 22.75, longitude: 75.85 }] },
    ];
    const inB = { partnerId: 'b-rider', lat: 22.72, lng: 75.87 };
    assert.equal(filterCandidatesToZone([inB], 'A', near).kept.length, 0);
    assert.equal(filterCandidatesToZone([inB], 'B', near).kept.length, 1);
});

// ---------------------------------------------------------------- taxi
console.log('\ntaxi: the driver filter always carries the zone');

const { buildDriverMatchFilters } = await import('../src/modules/taxi/services/matchingService.js');

check('a zone is applied to the driver query', () => {
    const f = buildDriverMatchFilters({ zoneId: INDORE, transportType: 'taxi' });
    assert.equal(String(f.zoneId), INDORE, 'drivers must be restricted to the pickup zone');
});

check('online and not-on-a-ride are still required', () => {
    const f = buildDriverMatchFilters({ zoneId: INDORE, transportType: 'taxi' });
    assert.equal(f.isOnline, true);
    assert.equal(f.isOnRide, false);
});

check('a blocked wallet is still excluded', () => {
    const f = buildDriverMatchFilters({ zoneId: INDORE, transportType: 'taxi' });
    assert.deepEqual(f['wallet.isBlocked'], { $ne: true });
});

check('no zone means no zone clause, not a null one', () => {
    // A pickup outside every zone. `zoneId: null` would match only drivers whose
    // own zone is literally null, which is not the same as "do not filter".
    const f = buildDriverMatchFilters({ zoneId: null, transportType: 'taxi' });
    assert.ok(!('zoneId' in f), 'the clause should be absent entirely');
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
