/**
 * Self-check for ride insurance plans.
 * Run: node src/modules/taxi/common/__checks__/rideInsurance.check.js
 */
import assert from 'node:assert/strict';
import { availablePlans, insuranceSnapshot, normalizeInsurancePlan, planApplies, premiumFor } from '../rideInsurance.js';

const all = { _id: 'a', name: 'Basic', premium_type: 'flat', premium_value: 10, vehicle_type_ids: [], zone_ids: [], sort_order: 2 };
const bikeOnly = { _id: 'b', name: 'Bike cover', premium_type: 'percent', premium_value: 5, vehicle_type_ids: ['bike'], zone_ids: [], sort_order: 1 };
const zoneOnly = { _id: 'z', name: 'Indore only', premium_type: 'flat', premium_value: 15, vehicle_type_ids: [], zone_ids: ['indore'] };
const off = { ...all, _id: 'o', active: false };

assert.equal(planApplies(all, { vehicleTypeId: 'auto', zoneId: 'x' }), true);
assert.equal(planApplies(bikeOnly, { vehicleTypeId: 'bike' }), true);
assert.equal(planApplies(bikeOnly, { vehicleTypeId: 'auto' }), false);
assert.equal(planApplies(zoneOnly, { vehicleTypeId: 'auto', zoneId: 'indore' }), true);
assert.equal(planApplies(zoneOnly, { vehicleTypeId: 'auto', zoneId: 'bhopal' }), false);
assert.equal(planApplies(zoneOnly, { vehicleTypeId: 'auto', zoneId: null }), false, 'no zone found = zone plans do not apply');
assert.equal(planApplies(off, {}), false);

assert.equal(premiumFor(all, 500), 10);
assert.equal(premiumFor(bikeOnly, 187), 9, '5% of 187 = 9.35 -> 9');

const bikeOptions = availablePlans([all, bikeOnly, zoneOnly, off], { vehicleTypeId: 'bike', zoneId: 'bhopal', fare: 200 });
assert.deepEqual(bikeOptions.map((p) => [p.id, p.premium]), [['b', 10], ['a', 10]], 'sorted by sort_order, priced for this fare');

assert.equal(insuranceSnapshot(bikeOnly, 200).premium, 10);

const valid = { name: 'Accident', premium_type: 'flat', premium_value: 20, cover_amount: 100000, all_vehicles: true };
assert.equal(normalizeInsurancePlan(valid).vehicle_type_ids.length, 0);
assert.throws(() => normalizeInsurancePlan({ ...valid, name: '' }), /name/);
assert.throws(() => normalizeInsurancePlan({ ...valid, premium_value: 0 }), /more than 0/);
assert.throws(() => normalizeInsurancePlan({ ...valid, premium_type: 'percent', premium_value: 80 }), /50%/);
assert.throws(() => normalizeInsurancePlan({ ...valid, all_vehicles: false }), /vehicles/);

console.log('rideInsurance: all checks passed');
