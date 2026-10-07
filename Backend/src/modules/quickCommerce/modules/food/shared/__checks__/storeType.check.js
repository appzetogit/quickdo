/**
 * Self-check for quick-commerce store types, including the legacy pharmacy type
 * left behind by the removed Medical vertical.
 * Run: node src/modules/quickCommerce/modules/food/shared/__checks__/storeType.check.js
 */
import assert from 'node:assert/strict';
import {
    DEFAULT_STORE_TYPE,
    LEGACY_PHARMACY_STORE_TYPE,
    QUICK_SHOP_SELLER_FILTER,
    STORED_STORE_TYPES,
    STORE_TYPES,
    isLegacyPharmacy,
    normalizeStoreTypeInput,
} from '../storeType.js';
import { normalizeStoreTypeFilter, storeTypeCondition } from '../storeScope.js';

const throws = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

// --- the types a seller may be given ---
assert.equal(DEFAULT_STORE_TYPE, 'grocery');
assert.ok(STORE_TYPES.includes('grocery'));
assert.ok(!STORE_TYPES.includes('pharmacy'), 'pharmacy is no longer assignable');
assert.ok(STORED_STORE_TYPES.includes(LEGACY_PHARMACY_STORE_TYPE), 'but stored pharmacies stay valid');

// --- normalizeStoreTypeInput ---
assert.equal(normalizeStoreTypeInput(undefined), undefined, 'absent leaves it alone');
assert.equal(normalizeStoreTypeInput(''), 'grocery');
assert.equal(normalizeStoreTypeInput(' Kirana '), 'kirana');
throws(() => normalizeStoreTypeInput('bakery'), /Store type must be one of/);
// No new pharmacy, from any path...
throws(() => normalizeStoreTypeInput('pharmacy'), /Store type must be one of/);
throws(() => normalizeStoreTypeInput('Pharmacy'), /Store type must be one of/);
// ...but an existing one may send its own type back unchanged.
assert.equal(normalizeStoreTypeInput('pharmacy', { allowLegacy: true }), 'pharmacy');

// --- legacy pharmacy detection, and the customer-facing filter ---
assert.equal(isLegacyPharmacy('pharmacy'), true);
assert.equal(isLegacyPharmacy(' PHARMACY '), true);
assert.equal(isLegacyPharmacy('grocery'), false);
assert.equal(isLegacyPharmacy(undefined), false);
assert.deepEqual(QUICK_SHOP_SELLER_FILTER, { storeType: { $ne: 'pharmacy' } });

// --- admin list scope: "quick" no longer hides anything ---
assert.equal(normalizeStoreTypeFilter(undefined), null);
assert.equal(normalizeStoreTypeFilter('all'), null);
assert.equal(normalizeStoreTypeFilter('quick'), null);
assert.equal(storeTypeCondition('quick'), null);
assert.equal(storeTypeCondition('kirana'), 'kirana');
// An admin can still narrow to the legacy type to find those stores.
assert.equal(storeTypeCondition('pharmacy'), 'pharmacy');
throws(() => normalizeStoreTypeFilter('bakery'), /Unknown store type/);

console.log('storeType.check: ok');
