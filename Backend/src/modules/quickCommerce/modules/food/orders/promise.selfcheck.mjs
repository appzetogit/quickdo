// Standalone check of the delivery promise — no DB, no server.
//   node src/modules/food/orders/promise.selfcheck.mjs
import assert from 'node:assert';
import { buildLiveEta, PACKING_MINUTES } from './services/order.helpers.js';
import { estimateDeliveryPromiseMinutes } from './services/order-pricing.service.js';

// Quoted before ordering: packing plus the ride, never just the ride.
const quoted = estimateDeliveryPromiseMinutes(2);
assert.ok(quoted > PACKING_MINUTES, 'the quote includes travel');
assert.ok(quoted > estimateDeliveryPromiseMinutes(1), 'further away is quoted longer');
assert.equal(estimateDeliveryPromiseMinutes(0), PACKING_MINUTES, 'next door is still packed');

// No distance means no promise, rather than a confident wrong one.
assert.equal(estimateDeliveryPromiseMinutes(null), null);
assert.equal(estimateDeliveryPromiseMinutes('abc'), null);
assert.equal(estimateDeliveryPromiseMinutes(-1), null);

const order = (overrides = {}) => ({
    orderStatus: 'confirmed',
    pricing: { roadDurationMins: 8 },
    ...overrides,
});

// Before a rider is assigned the promise is packing and the ride to the door.
assert.equal(buildLiveEta(order()).promiseMinutes, PACKING_MINUTES + 8);

// Packing and the rider's approach overlap: a rider riding while the order is
// packed costs whichever leg is longer, not the sum of both. Adding them would
// quote every order minutes later than it will actually arrive.
const withRider = order({
    lastRiderLocation: { coordinates: [77.5, 12.9] },
    restaurantId: { latitude: 12.9, longitude: 77.5 },
});
assert.equal(
    buildLiveEta(withRider).promiseMinutes,
    Math.max(PACKING_MINUTES, buildLiveEta(withRider).minutes) + 8,
);

// Once packed, only the riding is left to wait for.
const packed = order({ orderStatus: 'ready_for_pickup' });
assert.equal(buildLiveEta(packed).promiseMinutes, 8);

// Once picked up the promise is the rider's remaining journey, with no packing
// left to count.
const pickedUp = order({
    orderStatus: 'picked_up',
    deliveryState: { pickedUpAt: '2026-01-01T00:00:00Z' },
    lastRiderLocation: { coordinates: [77.5, 12.9] },
    deliveryAddress: { latitude: 12.95, longitude: 77.55 },
});
const pickedUpEta = buildLiveEta(pickedUp);
assert.equal(pickedUpEta.promiseMinutes, pickedUpEta.minutes);
assert.equal(pickedUpEta.target, 'customer');

// A finished order promises nothing.
assert.equal(buildLiveEta(order({ orderStatus: 'delivered' })).promiseMinutes, undefined);

// Without a trip estimate there is no promise to make.
assert.equal(buildLiveEta({ orderStatus: 'confirmed' }).promiseMinutes, null);

console.log('delivery promise: all assertions passed');
