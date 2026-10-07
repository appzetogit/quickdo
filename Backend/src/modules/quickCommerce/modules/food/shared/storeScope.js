import { ValidationError } from '../../../../../core/auth/errors.js';
import { STORED_STORE_TYPES } from './storeType.js';

/**
 * Narrowing an admin list to one kind of shop.
 *
 * An unrecognised value is REFUSED rather than ignored. Ignoring it would
 * answer "every seller you have" to a request that asked for one type, and it
 * would look like the filter working.
 */

/**
 * "quick": what the Quick Commerce panel used to send to hide pharmacies, when
 * they had a Medical panel of their own. That panel is gone, so it now means
 * every seller -- legacy pharmacies included, so an admin can still find them.
 */
export const QUICK_SCOPE = 'quick';

/** No scope for an absent, "all" or "quick" value; otherwise a known type. */
export const normalizeStoreTypeFilter = (value) => {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw || raw === 'all' || raw === QUICK_SCOPE) return null;
    if (!STORED_STORE_TYPES.includes(raw)) {
        throw new ValidationError(`Unknown store type: ${String(value).slice(0, 40)}`);
    }
    return raw;
};

/** The Mongo condition on a seller's storeType for a scope, or null for none. */
export const storeTypeCondition = (value) => normalizeStoreTypeFilter(value);

/**
 * The sellers of one type, for scoping lists that hang off a seller (products,
 * orders) rather than carrying the type themselves.
 *
 * An empty result means "this platform has no shops of that type", which must
 * narrow the list to nothing. Callers that treat an empty array as "no filter"
 * would show every product on the platform.
 */
export async function sellerIdsOfStoreType(FoodRestaurant, storeType) {
    const condition = storeTypeCondition(storeType);
    if (!condition) return null;
    const rows = await FoodRestaurant.find({ storeType: condition }).select('_id').lean();
    return rows.map((row) => row._id);
}

/**
 * Apply the scope to a Mongo filter keyed on a seller reference.
 *
 * Mutates and returns `filter`, and narrows to nothing when no seller matches
 * -- see above. `field` is the filter's own name for the seller (`restaurantId`
 * on products and orders).
 */
export function applySellerScope(filter, sellerIds, field = 'restaurantId') {
    if (sellerIds === null) return filter;
    const inScope = new Set(sellerIds.map((id) => String(id)));
    const existing = filter[field];

    // Nothing else has narrowed the sellers yet.
    if (existing === undefined || existing === null) {
        filter[field] = { $in: sellerIds };
        return filter;
    }

    // A specific seller: a string id, or the ObjectId the order list builds.
    // Keep it only if it is in scope -- otherwise the answer is nothing, never
    // the wider list.
    if (typeof existing === 'string' || typeof existing?.toHexString === 'function') {
        // `{ $in: [] }` matches nothing. A bare null would match every document
        // whose seller field is null or missing -- the opposite of "no results".
        filter[field] = inScope.has(String(existing)) ? existing : { $in: [] };
        return filter;
    }

    /*
     * Another filter already restricted the sellers -- the zone filter does
     * this. Intersect rather than replace: a zone view narrowed to one type
     * must show that type's shops in that zone, not every shop in the zone
     * (replacing) and not every shop of that type (being replaced).
     */
    if (Array.isArray(existing.$in)) {
        filter[field] = { $in: existing.$in.filter((id) => inScope.has(String(id))) };
        return filter;
    }

    filter[field] = { $in: sellerIds };
    return filter;
}
