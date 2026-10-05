/**
 * Self-check for the ride platform fee.
 * Run: node src/modules/taxi/common/__checks__/platformFee.check.js
 */
import assert from 'node:assert/strict';
import { resolvePlatformFee } from '../platformFee.js';

// --- percentage (type 1) --------------------------------------------------
assert.equal(resolvePlatformFee({ admin_commision_type: 1, admin_commision: 10 }, 200), 20);
assert.equal(resolvePlatformFee({ admin_commision_type: 1, admin_commision: 2.5 }, 200), 5);
// Type defaults to percentage when absent, matching the schema default.
assert.equal(resolvePlatformFee({ admin_commision: 10 }, 200), 20);

// --- flat amount ----------------------------------------------------------
assert.equal(resolvePlatformFee({ admin_commision_type: 0, admin_commision: 15 }, 200), 15);
// Independent of the subtotal.
assert.equal(resolvePlatformFee({ admin_commision_type: 0, admin_commision: 15 }, 9999), 15);
// Rows saved by the old UI, which submitted 2 for "Fixed", are still flat.
assert.equal(resolvePlatformFee({ admin_commision_type: 2, admin_commision: 15 }, 200), 15);

// --- no fee configured: the fare must be exactly what it was before -------
assert.equal(resolvePlatformFee({ admin_commision_type: 1, admin_commision: 0 }, 200), 0);
assert.equal(resolvePlatformFee({}, 200), 0);
assert.equal(resolvePlatformFee(null, 200), 0);
assert.equal(resolvePlatformFee(undefined, 200), 0);
assert.equal(resolvePlatformFee({ admin_commision: null }, 200), 0);
assert.equal(resolvePlatformFee({ admin_commision: '' }, 200), 0);

// --- junk must never produce NaN or a negative charge ---------------------
assert.equal(resolvePlatformFee({ admin_commision: 'abc' }, 200), 0);
assert.equal(resolvePlatformFee({ admin_commision: -10 }, 200), 0);
assert.equal(resolvePlatformFee({ admin_commision_type: 1, admin_commision: 10 }, -5), 0);
assert.equal(resolvePlatformFee({ admin_commision_type: 1, admin_commision: 10 }, 'abc'), 0);
assert.equal(resolvePlatformFee({ admin_commision_type: 1, admin_commision: 10 }, null), 0);

// --- the whole fare, as rideService computes it ---------------------------
const fare = (rule, subtotal, taxPercent) =>
    Math.max(0, Math.round(subtotal + (subtotal * taxPercent) / 100 + resolvePlatformFee(rule, subtotal)));

// No fee: unchanged from the previous formula.
assert.equal(fare({}, 200, 5), 210);
// 10% platform fee on top of a 5% taxed subtotal: 200 + 10 + 20.
assert.equal(fare({ admin_commision_type: 1, admin_commision: 10 }, 200, 5), 230);
// Flat 15 on top of the same: 200 + 10 + 15.
assert.equal(fare({ admin_commision_type: 0, admin_commision: 15 }, 200, 5), 225);
// The fee is not itself taxed.
assert.equal(fare({ admin_commision_type: 0, admin_commision: 100 }, 100, 50), 250);

console.log('All platform-fee checks passed.');
