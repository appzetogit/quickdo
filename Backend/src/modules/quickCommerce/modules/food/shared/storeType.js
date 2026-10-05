import { ValidationError } from '../../../../../core/auth/errors.js';

/**
 * What kind of shop a quick-commerce seller is, and what that obliges them to prove.
 *
 * The seller model has carried `storeType` and the three drug-licence fields since the
 * vertical was forked, but nothing read them: a seller could be onboarded as a
 * pharmacy with no licence at all, because no write path looked. This is the rule that
 * was missing, kept pure so onboarding, the admin panel and the order path all get the
 * same answer.
 *
 * Only pharmacy is treated as "medical". The other types differ in catalogue and
 * pooling, not in what they must produce at onboarding.
 */

export const STORE_TYPES = Object.freeze([
    'grocery',
    'kirana',
    'supermarket',
    'pharmacy',
    'pet',
    'electronics',
    'stationery',
    'general',
]);

export const DEFAULT_STORE_TYPE = 'grocery';

/** The one type that dispenses medicine. */
export const MEDICAL_STORE_TYPE = 'pharmacy';

/** Labels for the admin panel, so the copy lives with the rule rather than in a screen. */
export const STORE_TYPE_LABELS = Object.freeze({
    grocery: 'Grocery',
    kirana: 'Kirana',
    supermarket: 'Supermarket',
    pharmacy: 'Medical / Pharmacy',
    pet: 'Pet Supplies',
    electronics: 'Electronics',
    stationery: 'Stationery',
    general: 'General Store',
});

/**
 * Mongo condition for "a Quick Shop seller": anything but a pharmacy. Quick Shop
 * and Medical share one seller collection, so every customer-facing Quick Shop
 * query must say this, or pharmacies and medicines turn up among the groceries.
 * `$ne` also matches sellers saved before storeType existed (they are grocery).
 */
export const QUICK_SHOP_SELLER_FILTER = Object.freeze({ storeType: { $ne: MEDICAL_STORE_TYPE } });

export const isMedicalStore = (storeType) => String(storeType || '').trim().toLowerCase() === MEDICAL_STORE_TYPE;

/**
 * A pharmacy may only dispense against a prescription the customer has uploaded.
 * Same predicate as isMedicalStore today, named separately because the order path
 * asks a different question than onboarding does, and the two could diverge (a
 * future 'wellness' type selling supplements needs no prescription).
 */
export const requiresPrescription = (storeType) => isMedicalStore(storeType);

/** Returns undefined when the caller sent nothing, so a partial update leaves it alone. */
export const normalizeStoreTypeInput = (value) => {
    if (value === undefined) return undefined;
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return DEFAULT_STORE_TYPE;
    if (!STORE_TYPES.includes(raw)) {
        throw new ValidationError(`Store type must be one of: ${STORE_TYPES.join(', ')}`);
    }
    return raw;
};

const toTrimmed = (value) => (value === undefined || value === null ? '' : String(value).trim());

/**
 * Normalize the drug-licence block a panel submitted.
 *
 * Returns undefined when nothing was sent. Never throws on its own -- whether the
 * licence is *required* depends on the store type, which assertMedicalOnboarding
 * decides against the values that will actually be stored.
 */
export const normalizeDrugLicenceInput = (body = {}) => {
    const touched = ['drugLicenseNumber', 'drugLicenseExpiry', 'drugLicenseImage']
        .some((key) => body?.[key] !== undefined);
    if (!touched) return undefined;

    const out = {};
    if (body.drugLicenseNumber !== undefined) out.drugLicenseNumber = toTrimmed(body.drugLicenseNumber);
    if (body.drugLicenseImage !== undefined) out.drugLicenseImage = toTrimmed(body.drugLicenseImage);
    if (body.drugLicenseExpiry !== undefined) {
        const raw = body.drugLicenseExpiry;
        if (raw === null || toTrimmed(raw) === '') {
            out.drugLicenseExpiry = null;
        } else {
            const parsed = new Date(raw);
            if (Number.isNaN(parsed.getTime())) {
                throw new ValidationError('Drug licence expiry is not a valid date');
            }
            out.drugLicenseExpiry = parsed;
        }
    }
    return out;
};

/**
 * Refuse a pharmacy that cannot prove it may dispense.
 *
 * Checked against the merged result of a partial update, not the request body, so a
 * seller cannot be switched to pharmacy by an update that simply omits the licence.
 *
 * @param {object} seller the values that will be stored: storeType + drug licence
 * @param {Date}   now    injectable for tests
 */
export const assertMedicalOnboarding = (seller = {}, now = new Date()) => {
    if (!isMedicalStore(seller.storeType)) return;

    if (!toTrimmed(seller.drugLicenseNumber)) {
        throw new ValidationError('A drug licence number is required for a medical store');
    }
    if (!toTrimmed(seller.drugLicenseImage)) {
        throw new ValidationError('A photo of the drug licence is required for a medical store');
    }

    const expiry = seller.drugLicenseExpiry ? new Date(seller.drugLicenseExpiry) : null;
    if (!expiry || Number.isNaN(expiry.getTime())) {
        throw new ValidationError('A drug licence expiry date is required for a medical store');
    }
    // An expired licence is worse than a missing one: it looks complete on screen.
    if (expiry.getTime() <= now.getTime()) {
        throw new ValidationError('This drug licence has expired. Upload a current one before approving the store.');
    }
};

/**
 * Merge a partial update over what is stored, so callers can validate the outcome
 * rather than the request. Only the fields this module owns.
 */
export const mergeStoreTypeUpdate = (existing = {}, updates = {}) => ({
    storeType: updates.storeType !== undefined ? updates.storeType : (existing.storeType || DEFAULT_STORE_TYPE),
    drugLicenseNumber: updates.drugLicenseNumber !== undefined ? updates.drugLicenseNumber : (existing.drugLicenseNumber || ''),
    drugLicenseImage: updates.drugLicenseImage !== undefined ? updates.drugLicenseImage : (existing.drugLicenseImage || ''),
    drugLicenseExpiry: updates.drugLicenseExpiry !== undefined ? updates.drugLicenseExpiry : (existing.drugLicenseExpiry || null),
});
