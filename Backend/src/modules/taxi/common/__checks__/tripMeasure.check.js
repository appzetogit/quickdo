/**
 * Self-check for the server's trip measurement.
 * Run: node src/modules/taxi/common/__checks__/tripMeasure.check.js
 *
 * Replays real production rides: the pickup and drop each recorded, and the
 * distance and duration the rider app reported for it. The server's own
 * measurement must agree with an honest app, or every honest booking would be
 * repriced.
 */
import assert from 'node:assert/strict';
import { measureTrip, normalizeStops, MAX_STOPS } from '../tripMeasure.js';
import { computeRideFare } from '../rideFare.js';

const bike = { base_price: 20, base_distance: 2, price_per_distance: 8, time_price: 1, service_tax: 5, admin_commision: 5, admin_commision_type: 0 };
const plp = { base_price: 30, base_distance: 2, price_per_distance: 15, time_price: 5, service_tax: 5, admin_commision: 10, admin_commision_type: 2 };
const suv = { base_price: 100, base_distance: 2, price_per_distance: 22, time_price: 2.5, service_tax: 5, admin_commision: 6, admin_commision_type: 1 };

// Production rides (taxirides): coordinates, what the app reported, what was charged.
const rides = [
    { ride: '587c95', pickup: [75.8843773, 22.7282011], drop: [75.86755649999999, 22.69484], appMeters: 4095.7789703255994, appMinutes: 9.829869528781439, rule: suv, fare: 189 },
    { ride: 'd70da0', pickup: [76.4854548, 32.1019596], drop: [76.5364688, 32.1098101], appMeters: 4889.109183519704, appMinutes: 11.73386204044729, rule: bike, fare: 63 },
    { ride: 'd71f10', pickup: [76.535255, 32.1086969], drop: [76.557493, 32.1017875], appMeters: 2233.559805462946, appMinutes: 5.36054353311107, rule: plp, surge: 10, fare: 83 },
    { ride: '43f581', pickup: [83.9844267, 25.5728817], drop: [83.9810882, 25.5612101], appMeters: 1341.8315082168483, appMinutes: 3.220395619720436, rule: bike, fare: 26 },
    { ride: 'f65163', pickup: [76.5401079, 32.1098657], drop: [76.51052440000001, 32.0848779], appMeters: 3939.627344717386, appMinutes: 9.455105627321727 },
    { ride: '8a4a1c', pickup: [75.8843673, 22.728214], drop: [75.8968202, 22.75521], appMeters: 3265.8262949341342, appMinutes: 7.837983107841922 },
    { ride: '0b2154', pickup: [76.5401158, 32.1098016], drop: [76.53672125190496, 32.10936562058336], appMeters: 323.7349097227942, appMinutes: 0.7769637833347062 },
];

// --- the server measures what an honest app measured ----------------------
for (const r of rides) {
    const trip = measureTrip({ pickup: r.pickup, drop: r.drop });
    assert.ok(Math.abs(trip.distanceMeters - r.appMeters) < 0.5,
        `ride ${r.ride}: server ${trip.distanceMeters} m, app ${r.appMeters} m`);
    assert.ok(Math.abs(trip.durationMinutes - r.appMinutes) < 0.001,
        `ride ${r.ride}: server ${trip.durationMinutes} min, app ${r.appMinutes} min`);

    // ...and so charges exactly what that ride was charged.
    if (r.rule) {
        const fare = computeRideFare({ pricingRule: r.rule, ...trip, surgeAmount: r.surge || 0 });
        assert.equal(fare.total, r.fare, `ride ${r.ride}: ${fare.total} vs charged ${r.fare}`);
    }
}

// The 3.27 km bike ride billed Rs 113 at Sedan rates, measured and priced as a bike.
assert.equal(computeRideFare({ pricingRule: bike, ...measureTrip({ pickup: rides[5].pickup, drop: rides[5].drop }) }).total, 45);

// --- stops ----------------------------------------------------------------
const direct = measureTrip({ pickup: rides[5].pickup, drop: rides[5].drop });
// A stop on the way can only lengthen the trip: an invented stop costs the rider.
const detour = measureTrip({ pickup: rides[5].pickup, drop: rides[5].drop, stops: [{ lat: 22.70, lng: 75.90 }] });
assert.ok(detour.distanceMeters > direct.distanceMeters);
assert.equal(detour.stopCount, 1);
// Both shapes the apps send are read the same.
assert.deepEqual(normalizeStops([{ lat: 22.7, lng: 75.9 }, [75.9, 22.7], { latitude: 22.7, longitude: 75.9 }]),
    [{ lat: 22.7, lng: 75.9 }, { lat: 22.7, lng: 75.9 }, { lat: 22.7, lng: 75.9 }]);
// Junk stops are dropped, not measured as (0, 0).
assert.deepEqual(normalizeStops([null, { lat: 'x', lng: 1 }, [200, 10], {}]), []);
assert.equal(normalizeStops('nope').length, 0);
assert.equal(normalizeStops(Array.from({ length: 20 }, () => ({ lat: 22.7, lng: 75.9 }))).length, MAX_STOPS);

// --- edge cases -----------------------------------------------------------
assert.equal(measureTrip({ pickup: rides[0].pickup, drop: rides[0].pickup }).distanceMeters, 0);
assert.equal(measureTrip({ pickup: null, drop: rides[0].drop }), null);
assert.equal(measureTrip({ pickup: [1, 2, 3], drop: rides[0].drop }).distanceMeters > 0, true);
assert.equal(measureTrip({ pickup: ['a', 'b'], drop: rides[0].drop }), null);
assert.equal(measureTrip(), null);

console.log('All trip-measure checks passed.');
