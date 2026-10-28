import assert from 'node:assert/strict';
import {
    assertClaimable,
    DEFAULT_REQUEST_RADIUS_KM,
    distanceKm,
    effectiveStatus,
    hasDeclined,
    MAX_REQUEST_RADIUS_KM,
    normalizeExpiryMinutes,
    normalizeRadiusKm,
    pharmaciesInRange,
    REQUEST_STATUS,
    sellerPoint,
    wasInvited,
} from '../medicalRequest.js';

/**
 * Who a prescription is shown to, and who may fill it.
 *
 * Run: node src/modules/quickCommerce/modules/food/shared/__checks__/medicalRequest.check.js
 *
 * Every rule here decides one of two things: which shops see a health record,
 * and which shop gets the work. Both are worth pinning exactly.
 */

// --- the admin's range -------------------------------------------------------
assert.equal(normalizeRadiusKm(undefined), DEFAULT_REQUEST_RADIUS_KM, 'unset means the default');
assert.equal(normalizeRadiusKm(''), DEFAULT_REQUEST_RADIUS_KM);
assert.equal(normalizeRadiusKm(12), 12);
assert.equal(normalizeRadiusKm('7.5'), 7.5, 'a form posts strings');
assert.throws(() => normalizeRadiusKm(0), /between/, 'zero km would broadcast to nobody, silently');
assert.throws(() => normalizeRadiusKm(MAX_REQUEST_RADIUS_KM + 1), /between/);
assert.throws(() => normalizeRadiusKm('abc'), /number/);
assert.equal(normalizeExpiryMinutes(undefined), 30);
assert.throws(() => normalizeExpiryMinutes(1), /between/, 'a minute is not long enough to answer');

// --- distance ----------------------------------------------------------------
{
    // Mandi, Himachal, and a point about 3.3 km away.
    const a = { lat: 31.7080, lng: 76.9320 };
    const b = { lat: 31.7380, lng: 76.9320 };
    const km = distanceKm(a, b);
    assert.ok(km > 3.2 && km < 3.5, `expected about 3.3 km, got ${km}`);
    assert.equal(distanceKm(a, a), 0);
    assert.equal(distanceKm(a, { lat: null, lng: 1 }), null, 'no answer rather than NaN');
    assert.equal(distanceKm(null, b), null);
}

// --- reading a seller's position --------------------------------------------
assert.deepEqual(
    sellerPoint({ location: { coordinates: [76.93, 31.70] } }),
    { lat: 31.70, lng: 76.93 },
    'GeoJSON is [lng, lat] and must not be read the other way round',
);
assert.deepEqual(sellerPoint({ location: { latitude: 31.7, longitude: 76.9 } }), { lat: 31.7, lng: 76.9 });
assert.equal(sellerPoint({ location: {} }), null);
assert.equal(sellerPoint({}), null);

// --- who a broadcast reaches -------------------------------------------------
const here = { lat: 31.7080, lng: 76.9320 };
const pharmacy = (over = {}) => ({
    _id: over._id || 'p',
    restaurantName: over.name || 'Chemist',
    storeType: 'pharmacy',
    status: 'approved',
    isAcceptingOrders: true,
    location: { coordinates: [76.9320, 31.7080] },
    ...over,
});

{
    const near = pharmacy({ _id: 'near', name: 'Near Chemist' });
    const far = pharmacy({
        _id: 'far',
        name: 'Far Chemist',
        // ~11 km north.
        location: { coordinates: [76.9320, 31.8080] },
    });
    const picked = pharmaciesInRange([near, far], here, 5);
    assert.deepEqual(picked.map((p) => p.pharmacyId), ['near'], 'only what is in range');
    assert.equal(picked[0].name, 'Near Chemist');
    assert.equal(picked[0].distanceKm, 0);

    // The admin widening the range is the whole point of the setting.
    assert.equal(pharmaciesInRange([near, far], here, 15).length, 2);
}

{
    // Sorted nearest first: the customer's medicine should come from the
    // closest shop that will take it, and the list is read in order.
    const mk = (id, lat) => pharmacy({ _id: id, location: { coordinates: [76.9320, lat] } });
    const picked = pharmaciesInRange([mk('c', 31.7380), mk('a', 31.7085), mk('b', 31.7180)], here, 10);
    assert.deepEqual(picked.map((p) => p.pharmacyId), ['a', 'b', 'c']);
}

{
    // Every exclusion, one at a time, at a distance that would otherwise pass.
    const grocery = pharmacy({ _id: 'g', storeType: 'grocery' });
    const pending = pharmacy({ _id: 'x', status: 'pending' });
    const offline = pharmacy({ _id: 'o', isAcceptingOrders: false });
    const nowhere = pharmacy({ _id: 'n', location: {} });
    const shut = pharmacy({ _id: 's' });

    assert.deepEqual(pharmaciesInRange([grocery], here, 5), [], 'a grocery may not see a prescription');
    assert.deepEqual(pharmaciesInRange([pending], here, 5), [], 'an unapproved shop is not a shop yet');
    assert.deepEqual(pharmaciesInRange([offline], here, 5), [], 'offline cannot fill it');
    assert.deepEqual(pharmaciesInRange([nowhere], here, 5), [], 'a shop with no location is not "near"');
    assert.deepEqual(
        pharmaciesInRange([shut], here, 5, { isOpen: () => false }),
        [],
        'closed cannot fill it either',
    );
    assert.equal(pharmaciesInRange([shut], here, 5, { isOpen: () => true }).length, 1);
}

{
    // Nonsense in, nobody invited -- never everybody.
    assert.deepEqual(pharmaciesInRange([pharmacy()], here, 0), []);
    assert.deepEqual(pharmaciesInRange([pharmacy()], here, null), []);
    assert.deepEqual(pharmaciesInRange([pharmacy()], { lat: null, lng: null }, 5), []);
    assert.deepEqual(pharmaciesInRange([], here, 5), []);
}

// --- what a stored request is right now --------------------------------------
const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);
assert.equal(effectiveStatus({ status: 'open', expiresAt: future }), REQUEST_STATUS.OPEN);
assert.equal(
    effectiveStatus({ status: 'open', expiresAt: past }),
    REQUEST_STATUS.EXPIRED,
    'the clock decides, not the stored word',
);
assert.equal(
    effectiveStatus({ status: 'claimed', expiresAt: past }),
    REQUEST_STATUS.CLAIMED,
    'a claimed request does not expire out from under the pharmacy that took it',
);
assert.equal(effectiveStatus({ status: 'cancelled', expiresAt: future }), REQUEST_STATUS.CANCELLED);

// --- who may take it ---------------------------------------------------------
const invitedTo = (ids, over = {}) => ({
    status: 'open',
    expiresAt: future,
    invited: ids.map((id) => ({ pharmacyId: id })),
    declinedBy: [],
    ...over,
});

assert.equal(wasInvited(invitedTo(['a', 'b']), 'b'), true);
assert.equal(wasInvited(invitedTo(['a']), 'b'), false);
assert.equal(wasInvited(invitedTo(['a']), ''), false, 'a missing id matches nothing');
assert.equal(hasDeclined(invitedTo(['a'], { declinedBy: ['a'] }), 'a'), true);
assert.equal(hasDeclined(invitedTo(['a']), 'a'), false);

assert.equal(assertClaimable(invitedTo(['a', 'b']), 'a'), true);
assert.throws(
    () => assertClaimable(invitedTo(['a']), 'stranger'),
    /not sent to your pharmacy/,
    'a shop that was never offered it cannot take it, even knowing the id',
);
assert.throws(
    () => assertClaimable(invitedTo(['a'], { status: 'claimed' }), 'a'),
    /already accepted/,
);
assert.throws(
    () => assertClaimable(invitedTo(['a'], { expiresAt: past }), 'a'),
    /expired/,
);
assert.throws(
    () => assertClaimable(invitedTo(['a'], { status: 'cancelled' }), 'a'),
    /cancelled/,
);
assert.throws(() => assertClaimable(null, 'a'), /no longer exists/);

console.log('All medical request checks passed.');
