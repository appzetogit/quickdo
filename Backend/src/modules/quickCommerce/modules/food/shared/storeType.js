import { ValidationError } from '../../../../../core/auth/errors.js';

/**
 * What kind of shop a quick-commerce seller is.
 *
 * The types differ in catalogue, not in what a seller must produce at
 * onboarding. Kept pure so onboarding, the admin panel and the order path all
 * get the same answer.
 *
 * 'pharmacy' is a LEGACY value. The Medical vertical (pharmacies, prescriptions,
 * drug licences) was removed (SOW decision D2). Sellers saved as pharmacies keep
 * their storeType so their documents still save, but:
 *   - no new seller can be created as one (normalizeStoreTypeInput refuses it);
 *   - nothing treats them as medical any more (no licence, no prescription);
 *   - they stay out of the customer Quick Shop (QUICK_SHOP_SELLER_FILTER), since
 *     their catalogue is medicines sold under rules this platform no longer
 *     enforces. An admin can still see, edit, reclassify or deactivate them.
 */

/** The types a seller may be created or switched to. */
export const STORE_TYPES = Object.freeze([
    'grocery',
    'kirana',
    'supermarket',
    'pet',
    'electronics',
    'stationery',
    'general',
]);

export const DEFAULT_STORE_TYPE = 'grocery';

/** Old pharmacy sellers. Still valid on a stored document; never assigned anew. */
export const LEGACY_PHARMACY_STORE_TYPE = 'pharmacy';

/** Every value a stored seller may carry (the model enum). */
export const STORED_STORE_TYPES = Object.freeze([...STORE_TYPES, LEGACY_PHARMACY_STORE_TYPE]);

/** Labels for the admin panel, so the copy lives with the rule rather than in a screen. */
export const STORE_TYPE_LABELS = Object.freeze({
    grocery: 'Grocery',
    kirana: 'Kirana',
    supermarket: 'Supermarket',
    pet: 'Pet Supplies',
    electronics: 'Electronics',
    stationery: 'Stationery',
    general: 'General Store',
    pharmacy: 'Pharmacy (legacy)',
});

/**
 * Mongo condition for "a Quick Shop seller": anything but a legacy pharmacy.
 * Every customer-facing Quick Shop query must say this, or medicines turn up
 * among the groceries. `$ne` also matches sellers saved before storeType
 * existed (they are grocery).
 */
export const QUICK_SHOP_SELLER_FILTER = Object.freeze({ storeType: { $ne: LEGACY_PHARMACY_STORE_TYPE } });

export const isLegacyPharmacy = (storeType) =>
    String(storeType || '').trim().toLowerCase() === LEGACY_PHARMACY_STORE_TYPE;

/**
 * Returns undefined when the caller sent nothing, so a partial update leaves it alone.
 *
 * `allowLegacy` lets an update of a seller that is ALREADY a legacy pharmacy
 * send its own type back unchanged (an admin edit form does). Creation never
 * passes it, so no new pharmacy can be made.
 */
export const normalizeStoreTypeInput = (value, { allowLegacy = false } = {}) => {
    if (value === undefined) return undefined;
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return DEFAULT_STORE_TYPE;
    if (raw === LEGACY_PHARMACY_STORE_TYPE && allowLegacy) return raw;
    if (!STORE_TYPES.includes(raw)) {
        throw new ValidationError(`Store type must be one of: ${STORE_TYPES.join(', ')}`);
    }
    return raw;
};
