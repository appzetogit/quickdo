/**
 * Self-check for the order ETA.
 * Run: node src/modules/food/orders/services/__checks__/orderEta.check.js
 */
import assert from 'node:assert/strict';
import { buildOrderEta, roadKm, straightLineKm } from '../orderEta.service.js';

// Indore landmarks, ~2.5km apart in a straight line.
const RESTAURANT = { lat: 22.7196, lng: 75.8577 };
const CUSTOMER = { lat: 22.7405, lng: 75.8735 };

const order = ({ status = 'confirmed', rider = null, customer = CUSTOMER, restaurant = RESTAURANT } = {}) => ({
    orderStatus: status,
    restaurantId: restaurant ? { location: restaurant } : null,
    deliveryAddress: customer ? { location: customer } : null,
    deliveryState: rider ? { currentLocation: rider } : {},
});

// --- the maths ------------------------------------------------------------
{
    const straight = straightLineKm(RESTAURANT, CUSTOMER);
    assert.ok(straight > 2 && straight < 4, `unexpected straight line: ${straight}`);
    // Roads are longer than the crow flies.
    assert.ok(roadKm(RESTAURANT, CUSTOMER) > straight);
}
assert.equal(straightLineKm(null, CUSTOMER), null);
assert.equal(roadKm(RESTAURANT, null), null);

// --- nothing to say -------------------------------------------------------
assert.equal(buildOrderEta({}).source, 'unavailable');
assert.equal(buildOrderEta(order({ customer: null })).source, 'unavailable');

// --- finished -------------------------------------------------------------
for (const status of ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant']) {
    assert.equal(buildOrderEta(order({ status })).source, 'completed');
}

// --- no rider yet: estimate, including the cooking ------------------------
{
    const eta = buildOrderEta(order(), { prepMinutes: 15 });
    assert.equal(eta.source, 'estimate');
    assert.equal(eta.target, 'customer');
    assert.ok(eta.minutes > 15, 'the estimate has to include the ride as well as the prep');
    assert.ok(eta.distanceKm > 0);
}

// --- rider on the way to the restaurant -----------------------------------
{
    // Sitting a little way from the restaurant.
    const rider = { lat: 22.7100, lng: 75.8500 };
    const eta = buildOrderEta(order({ status: 'confirmed', rider }));
    assert.equal(eta.source, 'live');
    assert.equal(eta.target, 'restaurant');
    // The customer is waiting for BOTH legs, so this must exceed the leg to
    // the restaurant on its own.
    const legOnly = roadKm(rider, RESTAURANT);
    assert.ok(eta.minutes > Math.round((legOnly / 20) * 60), 'both legs must count before pickup');
    assert.equal(eta.distanceKm, legOnly);
}

// --- rider carrying the food ----------------------------------------------
{
    const rider = { lat: 22.7300, lng: 75.8650 };
    const eta = buildOrderEta(order({ status: 'picked_up', rider }));
    assert.equal(eta.source, 'live');
    assert.equal(eta.target, 'customer');
    assert.equal(eta.distanceKm, roadKm(rider, CUSTOMER));
}

// --- the whole trip is reported for the rider's offer ----------------------
{
    const eta = buildOrderEta(order());
    assert.ok(eta.tripDistanceKm > 0);
}

// --- a minute is the floor, never zero ------------------------------------
{
    const rider = { ...CUSTOMER };
    const eta = buildOrderEta(order({ status: 'picked_up', rider }));
    assert.ok(eta.minutes >= 1, 'an arriving rider is "1 min", not "0 min"');
}

console.log('orderEta.check.js OK');
