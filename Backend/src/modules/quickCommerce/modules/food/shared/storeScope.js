import { ValidationError } from '../../../../../core/auth/errors.js';
import { STORE_TYPES, MEDICAL_STORE_TYPE } from './storeType.js';

/**
 * Narrowing an admin list to one kind of shop.
 *
 * The Medical panel is the shared quick-commerce admin pointed at pharmacies:
 * same screens, same API, one filter. That filter has to be honest in both
 * directions -- a grocery seller must never appear under Medical, and a
 * pharmacy must never be hidden from the unscoped quick-commerce lists.
 *
 * An unrecognised value is REFUSED rather than ignored. Ignoring it would
 * answer "every seller you have" to a request that asked for one type, which
 * is precisely the leak this exists to prevent, and it would look like the
 * filter working.
 */

/**
 * "quick": every store type except pharmacy. The Quick Commerce panel sends
 * it, so medical stores (which have their own panel) are not listed there.
 */
export const QUICK_SCOPE = 'quick';

/** No scope for an absent or explicitly "all" value; otherwise a known type, or QUICK_SCOPE. */
export const normalizeStoreTypeFilter = (value) => {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw || raw === 'all') return null;
    if (raw === QUICK_SCOPE) return QUICK_SCOPE;
    if (!STORE_TYPES.includes(raw)) {
        throw new ValidationError(`Unknown store type: ${String(value).slice(0, 40)}`);
    }
    return raw;
};

export const isMedicalScope = (value) => normalizeStoreTypeFilter(value) === MEDICAL_STORE_TYPE;

/** The Mongo condition on a seller's storeType for a scope, or null for none. */
export const storeTypeCondition = (value) => {
    const type = normalizeStoreTypeFilter(value);
    if (!type) return null;
    return type === QUICK_SCOPE ? { $ne: MEDICAL_STORE_TYPE } : type;
};

/**
 * The sellers of one type, for scoping lists that hang off a seller (products,
 * orders) rather than carrying the type themselves.
 *
 * Returns ids, not a sub-query: there are tens of pharmacies, not thousands,
 * and an `$in` of ids keeps the caller's own filter readable and indexable.
 *
 * An empty result means "this platform has no shops of that type", which must
 * narrow the list to nothing. Callers that treat an empty array as "no filter"
 * would show every product on the platform under Medical.
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
     * this. Intersect rather than replace: a zone view under Medical must show
     * the pharmacies in that zone, not every shop in the zone (replacing) and
     * not every pharmacy on the platform (being replaced).
     */
    if (Array.isArray(existing.$in)) {
        filter[field] = { $in: existing.$in.filter((id) => inScope.has(String(id))) };
        return filter;
    }

    filter[field] = { $in: sellerIds };
    return filter;
}
