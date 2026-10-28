/**
 * Self-check for time-slot surge.
 * Run: node src/modules/taxi/common/__checks__/surgeSlot.check.js
 */
import assert from 'node:assert/strict';
import {
  findOverlappingSlot,
  localClock,
  normalizeSurgeSlot,
  pickSurgeSlot,
  surgeFromPercent,
} from '../surgeSlot.js';

// IST is UTC+5:30. 2026-09-21 is a Monday.
const ist = (isoLocal) => new Date(`${isoLocal}+05:30`);

assert.deepEqual(localClock(ist('2026-09-21T08:30:00')), { day: 1, minute: 510 });
assert.deepEqual(localClock(ist('2026-09-20T23:59:00')), { day: 0, minute: 1439 });

const zoneA = 'zoneA';
const zoneB = 'zoneB';
const bike = 'bike';
const auto = 'auto';

const morning = { _id: 'm', zone_ids: [zoneA], vehicle_type_ids: [], days: [1, 2, 3, 4, 5], start_time: '08:00', end_time: '11:00', percent: 20 };
const evening = { _id: 'e', zone_ids: [zoneA], vehicle_type_ids: [], days: [1, 2, 3, 4, 5], start_time: '17:00', end_time: '20:00', percent: 30 };
const nightBike = { _id: 'n', zone_ids: [zoneA], vehicle_type_ids: [bike], days: [6], start_time: '22:00', end_time: '02:00', percent: 50 };
const slots = [morning, evening, nightBike];
const pick = (zoneId, vehicleTypeId, at) => pickSurgeSlot(slots, { zoneId, vehicleTypeId, at })?._id ?? null;

// Several slots on one day.
assert.equal(pick(zoneA, auto, ist('2026-09-21T08:00:00')), 'm');
assert.equal(pick(zoneA, auto, ist('2026-09-21T10:59:00')), 'm');
assert.equal(pick(zoneA, auto, ist('2026-09-21T11:00:00')), null, 'end is exclusive');
assert.equal(pick(zoneA, auto, ist('2026-09-21T18:00:00')), 'e');
// Other zone, weekend.
assert.equal(pick(zoneB, auto, ist('2026-09-21T09:00:00')), null);
assert.equal(pick(zoneA, auto, ist('2026-09-20T09:00:00')), null);
// Selected vehicles only; overnight Saturday slot runs into Sunday.
assert.equal(pick(zoneA, bike, ist('2026-09-26T23:00:00')), 'n');
assert.equal(pick(zoneA, bike, ist('2026-09-27T01:30:00')), 'n');
assert.equal(pick(zoneA, bike, ist('2026-09-27T02:00:00')), null);
assert.equal(pick(zoneA, auto, ist('2026-09-26T23:00:00')), null);
// Switched off.
assert.equal(pickSurgeSlot([{ ...morning, active: false }], { zoneId: zoneA, vehicleTypeId: auto, at: ist('2026-09-21T09:00:00') }), null);

assert.equal(surgeFromPercent(187, 20), 37);
assert.equal(surgeFromPercent(100, 0), 0);

// Overlaps: same zone + shared vehicle + overlapping time clash; otherwise fine.
const slot = (over) => normalizeSurgeSlot({ zone_ids: [zoneA], all_vehicles: true, days: [1], start_time: '10:00', end_time: '12:00', percent: 10, ...over });
assert.equal(findOverlappingSlot(slot(), [morning])?._id, 'm');
assert.equal(findOverlappingSlot(slot({ start_time: '11:00' }), [morning]), null, 'back to back is fine');
assert.equal(findOverlappingSlot(slot({ zone_ids: [zoneB] }), [morning]), null);
assert.equal(findOverlappingSlot(slot({ all_vehicles: false, vehicle_type_ids: [auto], days: [6], start_time: '23:00', end_time: '23:30' }), [nightBike]), null, 'different vehicle');
assert.equal(findOverlappingSlot(slot({ days: [0], start_time: '01:00', end_time: '03:00' }), [nightBike])?._id, 'n', 'Saturday night spills into Sunday');

assert.throws(() => normalizeSurgeSlot({ zone_ids: [], days: [1], start_time: '08:00', end_time: '09:00', percent: 10, all_vehicles: true }), /zone/);
assert.throws(() => normalizeSurgeSlot({ zone_ids: [zoneA], days: [1], start_time: '8:00', end_time: '09:00', percent: 10, all_vehicles: true }), /HH:MM/);
assert.throws(() => normalizeSurgeSlot({ zone_ids: [zoneA], days: [1], start_time: '08:00', end_time: '09:00', percent: 0, all_vehicles: true }), /between/);
assert.throws(() => normalizeSurgeSlot({ zone_ids: [zoneA], days: [1], start_time: '08:00', end_time: '09:00', percent: 10 }), /vehicles/);

console.log('surgeSlot: all checks passed');
