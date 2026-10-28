/**
 * Self-check for the ride fare.
 * Run: node src/modules/taxi/common/__checks__/rideFare.check.js
 *
 * The first block replays real production rides: the price rows as they stand,
 * the distance and duration each ride recorded, and the fare the server charged
 * it. computeRideFare replaced an inline calculation in createRideRecord, and
 * these pin that it charges exactly what that calculation did.
 */
import assert from 'node:assert/strict';
import { computeRideFare } from '../rideFare.js';

// Production price rows (taxisetprices), trimmed to the fields that price a ride.
const bike = { base_price: 20, base_distance: 2, price_per_distance: 8, time_price: 1, service_tax: 5, admin_commision: 5, admin_commision_type: 0 };
const plp = { base_price: 30, base_distance: 2, price_per_distance: 15, time_price: 5, service_tax: 5, admin_commision: 10, admin_commision_type: 2 };
const suv = { base_price: 100, base_distance: 2, price_per_distance: 22, time_price: 2.5, service_tax: 5, admin_commision: 6, admin_commision_type: 1 };

const fare = (rule, meters, minutes, surgeAmount = 0) =>
    computeRideFare({ pricingRule: rule, distanceMeters: meters, durationMinutes: minutes, surgeAmount });

// --- real rides, real charges ---------------------------------------------
// Bike, inside the 2 km base: base 20 + 5% tax + flat fee 5. No time charge.
assert.equal(fare(bike, 1341.8315082168483, 3.220395619720436).total, 26);   // ride 43f581
assert.equal(fare(bike, 1479.8918431095249, 3.55174042346286).total, 26);    // ride 0fdac4
// Bike, past the base.
assert.equal(fare(bike, 4889.109183519704, 11.73386204044729).total, 63);    // ride d70da0
// The palampur row with its Rs 10 surge on top of the rounded fare.
let f = fare(plp, 2233.559805462946, 5.36054353311107, 10);                  // ride d71f10
assert.equal(f.fareBeforeSurge, 73);
assert.equal(f.total, 83);
f = fare(plp, 4888.706074262477, 11.732894578229946, 10);                    // ride d710c2
assert.equal(f.fareBeforeSurge, 149);
assert.equal(f.total, 159);
// SUV, whose platform fee is 6% of the subtotal.
assert.equal(fare(suv, 4095.7789703255994, 9.829869528781439).total, 189);   // ride 587c95

// --- the bike rides billed at Sedan rates, priced as a bike --------------
// 3.27 km was charged 113 from the app's Sedan-rate figure. As a bike:
f = fare(bike, 3265.5576841561756, 7.837338441974822);
assert.equal(f.total, 45);

// --- inside the base distance nothing but the base is charged ------------
f = fare(bike, 500, 30);
assert.equal(f.distanceFare, 0);
assert.equal(f.timeFare, 0);
assert.equal(f.baseFare, 20);

// --- the printed rows add up to the total, to the paisa -------------------
for (const [rule, m, min, s] of [[bike, 4889.1, 11.73, 0], [plp, 2233.6, 5.36, 10], [suv, 4095.8, 9.83, 0], [bike, 1341.8, 3.22, 0]]) {
    const q = fare(rule, m, min, s);
    const rows = q.baseFare + q.distanceFare + q.timeFare + q.serviceTax + q.platformFee + q.roundOff + q.surge;
    assert.equal(Math.round(rows * 100) / 100, q.total, `rows ${rows} vs total ${q.total}`);
}

// --- outstation rides use the outstation rates -----------------------------
const auto = { base_price: 30, base_distance: 2, price_per_distance: 12, time_price: 1, service_tax: 5,
    outstation_base_price: 75, outstation_base_distance: 10, outstation_price_per_distance: 10.2, outstation_time_price: 1 };
assert.equal(computeRideFare({ pricingRule: auto, transportType: 'intercity', distanceMeters: 8000, durationMinutes: 20 }).baseFare, 75);

// --- nothing to charge from: the caller must refuse, not guess ------------
assert.equal(computeRideFare({ pricingRule: null, distanceMeters: 5000, durationMinutes: 10 }), null);
assert.equal(computeRideFare({ pricingRule: {}, distanceMeters: 5000, durationMinutes: 10 }), null);
// A row with no outstation prices cannot price an outstation ride.
assert.equal(computeRideFare({ pricingRule: bike, transportType: 'intercity', distanceMeters: 5000, durationMinutes: 10 }), null);

// --- junk never produces NaN or a negative fare ----------------------------
f = fare(bike, 'abc', -5);
assert.equal(f.total, 26);
assert.ok(Number.isFinite(fare(bike, 4000, 'x').total));

console.log('All ride-fare checks passed.');
