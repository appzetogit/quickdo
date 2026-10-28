/**
 * Pure-logic checks for admin-set driver capabilities.
 *
 * Run: node Backend/src/modules/food/shared/__checks__/driverCapabilities.check.js
 *
 * Only the pure helpers are exercised here -- the DB-touching functions are
 * verified against a live server after deploy.
 */
import assert from 'node:assert/strict';
import {
    normalizeCapabilities,
    coerceWorkMode,
    SERVICE_CAPABILITIES,
} from '../../../../core/identity/driverCapabilities.service.js';

const throws = (fn, re) => assert.throws(fn, re);

// --- normalizeCapabilities ------------------------------------------------

assert.deepEqual(normalizeCapabilities(['delivery']), ['delivery']);
assert.deepEqual(normalizeCapabilities(['taxi', 'delivery', 'quickCommerce']), ['taxi', 'delivery', 'quickCommerce']);

// Stable order regardless of how the boxes were ticked.
assert.deepEqual(normalizeCapabilities(['quickCommerce', 'taxi']), ['taxi', 'quickCommerce']);

// Dedupes, trims, tolerates case, accepts a comma string.
assert.deepEqual(normalizeCapabilities(['delivery', ' delivery ', 'DELIVERY']), ['delivery']);
assert.deepEqual(normalizeCapabilities('taxi, delivery'), ['taxi', 'delivery']);

// Refuses an empty selection -- an admin must not strip every stream.
throws(() => normalizeCapabilities([]), /at least one/);
throws(() => normalizeCapabilities(''), /at least one/);
throws(() => normalizeCapabilities(null), /at least one/);

// Refuses unknown values rather than silently dropping them.
throws(() => normalizeCapabilities(['delivery', 'drone']), /Unknown capability "drone"/);

// Error is a 400, not a 500.
try {
    normalizeCapabilities(['bogus']);
    assert.fail('should have thrown');
} catch (err) {
    assert.equal(err.statusCode, 400);
}

// The exported list is the source of truth for the enum.
assert.deepEqual([...SERVICE_CAPABILITIES], ['taxi', 'delivery', 'quickCommerce']);

// --- coerceWorkMode --------------------------------------------------------

// A still-valid choice is left alone.
assert.equal(coerceWorkMode('all', ['taxi', 'delivery']), 'all');
assert.equal(coerceWorkMode('taxi', ['taxi', 'delivery']), 'taxi');
assert.equal(coerceWorkMode('delivery', ['taxi', 'delivery']), 'delivery');

// Single capability: 'all' is illegal (setWorkMode requires two), so it collapses.
assert.equal(coerceWorkMode('all', ['taxi']), 'taxi');
assert.equal(coerceWorkMode('all', ['delivery']), 'delivery');
assert.equal(coerceWorkMode('all', ['quickCommerce']), 'delivery');

// Revoked stream: a driver parked on it is moved somewhere they can work.
assert.equal(coerceWorkMode('taxi', ['delivery']), 'delivery');
assert.equal(coerceWorkMode('delivery', ['taxi']), 'taxi');

// The retired 'quickCommerce' mode maps onto the shared delivery toggle.
assert.equal(coerceWorkMode('quickCommerce', ['quickCommerce']), 'delivery');
assert.equal(coerceWorkMode('quickCommerce', ['taxi', 'quickCommerce']), 'delivery');

// Grocery alone still satisfies the delivery toggle (one toggle covers both).
assert.equal(coerceWorkMode('delivery', ['quickCommerce']), 'delivery');

// Nothing stored yet: widest legal mode.
assert.equal(coerceWorkMode(undefined, ['taxi', 'delivery']), 'all');
assert.equal(coerceWorkMode(undefined, ['delivery']), 'delivery');

console.log('All driver-capability checks passed.');
