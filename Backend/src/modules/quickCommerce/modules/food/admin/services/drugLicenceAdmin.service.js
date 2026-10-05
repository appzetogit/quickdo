import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { MEDICAL_STORE_TYPE } from '../../shared/storeType.js';

/**
 * What state each pharmacy's drug licence is in, for the Medical panel's licence screen.
 *
 * assertMedicalOnboarding already refuses a pharmacy that cannot prove it may dispense,
 * but it only fires when someone writes. A licence that was current at onboarding goes
 * stale on its own, with nobody writing anything -- so the panel needs its own reading
 * of the same three fields, and this is it. Read-only: the write path stays the admin
 * seller update, which merges through mergeStoreTypeUpdate.
 */

/** How far ahead counts as "renew this now". Exported so the screen's copy and the
 *  classifier cannot drift -- a 30 hardcoded in two places is a 30 and a 45 later. */
export const LICENCE_EXPIRY_WARNING_DAYS = 30;

export const DRUG_LICENCE_STATES = Object.freeze(['missing', 'expired', 'expiring_soon', 'valid']);

const DAY_MS = 24 * 60 * 60 * 1000;

const toTrimmed = (value) => (value === undefined || value === null ? '' : String(value).trim());

const startOfDay = (value) => {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

/**
 * Whole days from today to the expiry date, negative once it is past.
 *
 * Compared date-to-date rather than instant-to-instant. A licence stored as
 * 2026-09-12T00:00:00 and read at 10am on the 12th is still valid for the rest of
 * that day, but a raw `expiry < now` calls it expired and the panel tells an operator
 * to suspend a shop whose licence runs out tonight. Rounded, not floored, because a
 * DST changeover makes one of these "days" 23 or 25 hours long.
 */
export const daysUntilExpiry = (expiry, now = new Date()) => {
    const date = expiry === undefined || expiry === null || expiry === '' ? null : new Date(expiry);
    if (!date || Number.isNaN(date.getTime())) return null;
    return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);
};

/**
 * The pure rule, kept free of Mongo so a test can hand it a plain object.
 *
 * A licence with no expiry date is 'missing', not 'valid'. It has nothing to check
 * against, and the only other honest answer would be to show it green -- which is how
 * a shop with a blank expiry field sits on the panel for a year looking compliant.
 *
 * @param {object} seller drugLicenseNumber / drugLicenseImage / drugLicenseExpiry
 * @param {Date}   now    injectable so the boundary days can be tested
 */
export const classifyDrugLicence = (seller = {}, now = new Date()) => {
    const hasNumber = toTrimmed(seller.drugLicenseNumber) !== '';
    const hasImage = toTrimmed(seller.drugLicenseImage) !== '';
    const daysRemaining = daysUntilExpiry(seller.drugLicenseExpiry, now);

    if (!hasNumber || !hasImage || daysRemaining === null) {
        return { state: 'missing', daysRemaining: null };
    }
    if (daysRemaining < 0) return { state: 'expired', daysRemaining };
    if (daysRemaining <= LICENCE_EXPIRY_WARNING_DAYS) return { state: 'expiring_soon', daysRemaining };
    return { state: 'valid', daysRemaining };
};

/** null for absent or "all"; an unknown value is refused rather than ignored, so a
 *  typo cannot answer "every pharmacy" to a request that asked for the expired ones. */
export const normalizeLicenceStateFilter = (value) => {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw || raw === 'all') return null;
    if (!DRUG_LICENCE_STATES.includes(raw)) {
        throw new ValidationError(`Unknown licence state: ${String(value).slice(0, 40)}`);
    }
    return raw;
};

const SELLER_FIELDS = 'restaurantName ownerName ownerPhone primaryContactNumber status storeType '
    + 'drugLicenseNumber drugLicenseExpiry drugLicenseImage createdAt';

/**
 * storeType is pinned here rather than taken from the query. Every other admin list
 * accepts a storeType parameter, and this screen only ever means pharmacies -- reading
 * it from the request is how a caller that forgets the parameter gets the whole
 * platform's sellers on a screen headed "Drug licences".
 */
const buildPharmacyFilter = (query = {}) => {
    const filter = { storeType: MEDICAL_STORE_TYPE };

    const search = toTrimmed(query.search).slice(0, 80);
    if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const phoneDigits = search.replace(/\D/g, '');
        const or = [
            { restaurantName: { $regex: escaped, $options: 'i' } },
            { ownerName: { $regex: escaped, $options: 'i' } },
        ];
        if (phoneDigits.length >= 4) {
            or.push({ ownerPhone: { $regex: phoneDigits } });
            or.push({ primaryContactNumber: { $regex: phoneDigits } });
        }
        filter.$or = or;
    }
    return filter;
};

const toRow = (seller, now) => {
    const { state, daysRemaining } = classifyDrugLicence(seller, now);
    return {
        id: String(seller._id),
        name: seller.restaurantName || '',
        ownerName: seller.ownerName || '',
        phone: seller.ownerPhone || seller.primaryContactNumber || '',
        status: seller.status || '',
        licenceNumber: seller.drugLicenseNumber || '',
        licenceExpiry: seller.drugLicenseExpiry ? new Date(seller.drugLicenseExpiry).toISOString() : null,
        licenceImage: seller.drugLicenseImage || '',
        licenceState: state,
        daysRemaining,
    };
};

const emptyCounts = () => ({ all: 0, missing: 0, expired: 0, expiring_soon: 0, valid: 0 });

const countByState = (rows) => rows.reduce((acc, row) => {
    acc[row.licenceState] += 1;
    acc.all += 1;
    return acc;
}, emptyCounts());

/**
 * Every pharmacy, newest registered first, classified and paged.
 *
 * The state filter and the paging are applied in memory on purpose. The state is a
 * date window, not a stored field, so expressing it a second time as a Mongo query
 * would mean two copies of the rule -- and the first time the window moves, the tab
 * says 4 while the badges show 6. There are tens of pharmacies on this platform, not
 * thousands; the search filter, which is indexable, still runs in Mongo.
 *
 * @param {object} query state, search, page, limit
 * @param {Date}   now   injectable for tests
 */
export async function listDrugLicences(query = {}, now = new Date()) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const state = normalizeLicenceStateFilter(query.state);

    const sellers = await FoodRestaurant.find(buildPharmacyFilter(query))
        .sort({ createdAt: -1 })
        .select(SELLER_FIELDS)
        .lean();

    const rows = sellers.map((seller) => toRow(seller, now));
    const counts = countByState(rows);
    const matching = state ? rows.filter((row) => row.licenceState === state) : rows;
    const skip = (page - 1) * limit;

    return {
        licences: matching.slice(skip, skip + limit),
        total: matching.length,
        page,
        limit,
        counts,
    };
}

/**
 * The tab counts on their own, so the screen can refresh them without pulling a page
 * of rows. Honours `search` and ignores `state` -- a tab that only counted the tab you
 * are already on would always read the same as the table under it.
 */
export async function getDrugLicenceSummary(query = {}, now = new Date()) {
    const sellers = await FoodRestaurant.find(buildPharmacyFilter(query))
        .select('drugLicenseNumber drugLicenseExpiry drugLicenseImage')
        .lean();

    return { counts: countByState(sellers.map((seller) => toRow(seller, now))) };
}
