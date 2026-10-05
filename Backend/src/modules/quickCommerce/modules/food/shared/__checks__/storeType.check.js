/**
 * Self-check for quick-commerce store types and the medical licence rule.
 * Run: node src/modules/quickCommerce/modules/food/shared/__checks__/storeType.check.js
 */
import assert from 'node:assert/strict';
import {
    DEFAULT_STORE_TYPE,
    MEDICAL_STORE_TYPE,
    STORE_TYPES,
    assertMedicalOnboarding,
    isMedicalStore,
    mergeStoreTypeUpdate,
    normalizeDrugLicenceInput,
    normalizeStoreTypeInput,
    requiresPrescription,
} from '../storeType.js';

const throws = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

const NOW = new Date('2026-08-25T00:00:00Z');
const FUTURE = new Date('2027-01-01T00:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');

const pharmacy = (over = {}) => ({
    storeType: 'pharmacy',
    drugLicenseNumber: 'DL-123',
    drugLicenseImage: 'https://cdn/licence.jpg',
    drugLicenseExpiry: FUTURE,
    ...over,
});

// --- type predicates ------------------------------------------------------
assert.equal(isMedicalStore('pharmacy'), true);
assert.equal(isMedicalStore('PHARMACY'), true);   // case-insensitive
assert.equal(isMedicalStore(' pharmacy '), true); // trimmed
assert.equal(isMedicalStore('grocery'), false);
assert.equal(isMedicalStore(undefined), false);
assert.equal(requiresPrescription('pharmacy'), true);
assert.equal(requiresPrescription('grocery'), false);
assert.equal(STORE_TYPES.includes(MEDICAL_STORE_TYPE), true);

// --- store type normalization --------------------------------------------
assert.equal(normalizeStoreTypeInput(undefined), undefined);     // partial update untouched
assert.equal(normalizeStoreTypeInput(''), DEFAULT_STORE_TYPE);
assert.equal(normalizeStoreTypeInput('Pharmacy'), 'pharmacy');
assert.equal(normalizeStoreTypeInput(' GROCERY '), 'grocery');
throws(() => normalizeStoreTypeInput('hospital'), /Store type must be one of/);
throws(() => normalizeStoreTypeInput('medical'), /Store type must be one of/); // not an enum member

// --- drug licence normalization ------------------------------------------
assert.equal(normalizeDrugLicenceInput({}), undefined);          // nothing sent
assert.deepEqual(normalizeDrugLicenceInput({ drugLicenseNumber: '  DL-9 ' }), { drugLicenseNumber: 'DL-9' });
assert.equal(normalizeDrugLicenceInput({ drugLicenseExpiry: '' }).drugLicenseExpiry, null);
assert.equal(normalizeDrugLicenceInput({ drugLicenseExpiry: null }).drugLicenseExpiry, null);
assert.equal(
    normalizeDrugLicenceInput({ drugLicenseExpiry: '2027-01-01' }).drugLicenseExpiry.toISOString().slice(0, 10),
    '2027-01-01'
);
throws(() => normalizeDrugLicenceInput({ drugLicenseExpiry: 'not-a-date' }), /not a valid date/);

// --- the rule: a non-medical store is never asked for a licence -----------
assertMedicalOnboarding({ storeType: 'grocery' }, NOW);
assertMedicalOnboarding({ storeType: 'kirana', drugLicenseNumber: '' }, NOW);
assertMedicalOnboarding({}, NOW);

// --- the rule: a medical store must prove all three ----------------------
assertMedicalOnboarding(pharmacy(), NOW); // complete and current: allowed
throws(() => assertMedicalOnboarding(pharmacy({ drugLicenseNumber: '' }), NOW), /licence number is required/);
throws(() => assertMedicalOnboarding(pharmacy({ drugLicenseNumber: '   ' }), NOW), /licence number is required/);
throws(() => assertMedicalOnboarding(pharmacy({ drugLicenseImage: '' }), NOW), /photo of the drug licence/);
throws(() => assertMedicalOnboarding(pharmacy({ drugLicenseExpiry: null }), NOW), /expiry date is required/);
throws(() => assertMedicalOnboarding(pharmacy({ drugLicenseExpiry: PAST }), NOW), /has expired/);
// Expiring exactly now counts as expired, not valid.
throws(() => assertMedicalOnboarding(pharmacy({ drugLicenseExpiry: NOW }), NOW), /has expired/);

// --- merge: an update cannot switch to pharmacy by omitting the licence ---
{
    const stored = { storeType: 'grocery', drugLicenseNumber: '', drugLicenseImage: '', drugLicenseExpiry: null };
    const merged = mergeStoreTypeUpdate(stored, { storeType: 'pharmacy' });
    assert.equal(merged.storeType, 'pharmacy');
    throws(() => assertMedicalOnboarding(merged, NOW), /licence number is required/);
}
// An existing pharmacy editing only its name keeps its licence and stays valid.
{
    const stored = pharmacy();
    const merged = mergeStoreTypeUpdate(stored, {});
    assert.equal(merged.storeType, 'pharmacy');
    assertMedicalOnboarding(merged, NOW);
}
// Switching a pharmacy away to grocery drops the obligation.
{
    const merged = mergeStoreTypeUpdate(pharmacy(), { storeType: 'grocery' });
    assertMedicalOnboarding(merged, NOW);
}
// Clearing the licence on a store that is still a pharmacy is refused.
{
    const merged = mergeStoreTypeUpdate(pharmacy(), { drugLicenseNumber: '' });
    throws(() => assertMedicalOnboarding(merged, NOW), /licence number is required/);
}
// Absent storeType on a fresh record falls back to the default, not pharmacy.
assert.equal(mergeStoreTypeUpdate({}, {}).storeType, DEFAULT_STORE_TYPE);

console.log('All store-type / medical-licence checks passed.');
