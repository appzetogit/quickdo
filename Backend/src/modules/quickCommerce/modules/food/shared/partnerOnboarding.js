/**
 * What a partner has to hand over before it can be approved, in one list.
 *
 * The /partner website, the partner app and the admin review page all show this
 * same list, and registration and approval enforce it, so the three can never
 * disagree about what is missing. Pure -- no database -- so it can be tested on
 * its own.
 *
 * Three partner types:
 *   restaurant  -- the food vertical, which has its own onboarding; listed here
 *                  only so /partner can route to it
 *   store       -- a quick-commerce seller (grocery, supermarket, ...)
 *   medical     -- a quick-commerce seller with storeType 'pharmacy'
 *
 * Only the medical list is enforced. A store's list is shown as a checklist but
 * not refused on, because store sign-ups already in the field (and older app
 * builds) send less than this, and blocking them is not what anyone asked for.
 */
import { ValidationError } from '../../../../../core/auth/errors.js';
import { isMedicalStore } from './storeType.js';

export const PARTNER_TYPES = Object.freeze(['restaurant', 'store', 'medical']);

export const normalizePartnerType = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'pharmacy' || raw === 'medical-store') return 'medical';
    if (raw === 'quick' || raw === 'qc' || raw === 'grocery') return 'store';
    return PARTNER_TYPES.includes(raw) ? raw : null;
};

/** Which partner type an existing quick-commerce seller is. */
export const partnerTypeOfSeller = (seller) => (isMedicalStore(seller?.storeType) ? 'medical' : 'store');

/** Licences expiring within this many days are flagged to the admin. */
export const LICENCE_WARNING_DAYS = 30;

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const has = (v) => text(v) !== '';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The drug licence's standing today.
 * `missing` has no expiry date to judge; `expired` is on or before now.
 */
export function drugLicenceStatus(seller, now = new Date()) {
    const raw = seller?.drugLicenseExpiry;
    const expiry = raw ? new Date(raw) : null;
    if (!expiry || Number.isNaN(expiry.getTime())) {
        return { state: 'missing', expiresAt: null, daysLeft: null };
    }
    const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS);
    if (expiry.getTime() <= now.getTime()) return { state: 'expired', expiresAt: expiry, daysLeft };
    if (daysLeft <= LICENCE_WARNING_DAYS) return { state: 'expiring', expiresAt: expiry, daysLeft };
    return { state: 'valid', expiresAt: expiry, daysLeft };
}

/**
 * Does an expired licence take this seller offline?
 *
 * Only a pharmacy, and only when an expiry is recorded and has passed. A
 * pharmacy with no expiry on file (the ones onboarded before this) is flagged
 * on the review page, not switched off -- that was the agreed rule for existing
 * shops.
 */
export const isLicenceExpired = (seller, now = new Date()) =>
    isMedicalStore(seller?.storeType) && drugLicenceStatus(seller, now).state === 'expired';

/** Mongo clause: sellers not taken offline by an expired licence. */
export const notExpiredLicenceClause = (now = new Date()) => ({
    $or: [
        { storeType: { $ne: 'pharmacy' } },
        { drugLicenseExpiry: null },
        { drugLicenseExpiry: { $exists: false } },
        { drugLicenseExpiry: { $gt: now } },
    ],
});

const BASIC = [
    { key: 'restaurantName', section: 'basic', label: 'Store name', done: (s) => has(s.restaurantName) },
    { key: 'ownerName', section: 'basic', label: 'Owner name', done: (s) => has(s.ownerName) },
    { key: 'ownerPhone', section: 'basic', label: 'Mobile number', done: (s) => has(s.ownerPhone) },
    { key: 'ownerEmail', section: 'basic', label: 'Email', optional: true, done: (s) => has(s.ownerEmail) },
    {
        key: 'address',
        section: 'basic',
        label: 'Store address',
        done: (s) => has(s.location?.addressLine1 || s.addressLine1 || s.location?.formattedAddress)
            && has(s.location?.city || s.city),
    },
    {
        key: 'location',
        section: 'basic',
        label: 'Location on map',
        done: (s) => {
            const c = s.location?.coordinates;
            return Array.isArray(c) && c.length === 2 && c.every((n) => Number.isFinite(Number(n)))
                && !(Number(c[0]) === 0 && Number(c[1]) === 0);
        },
    },
];

const BANK = [
    { key: 'accountHolderName', section: 'bank', label: 'Account holder name', done: (s) => has(s.accountHolderName) },
    { key: 'accountNumber', section: 'bank', label: 'Account number', done: (s) => has(s.accountNumber) },
    { key: 'ifscCode', section: 'bank', label: 'IFSC code', done: (s) => /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(text(s.ifscCode)) },
    { key: 'upiId', section: 'bank', label: 'UPI ID', optional: true, done: (s) => has(s.upiId) },
];

const PHOTOS = (frontRequired) => [
    { key: 'storePhotos.front', section: 'photos', label: 'Front / entrance photo', optional: !frontRequired, done: (s) => has(s.storePhotos?.front) },
    { key: 'storePhotos.inside', section: 'photos', label: 'Inside the store photo', optional: true, done: (s) => has(s.storePhotos?.inside) },
    { key: 'storePhotos.signboard', section: 'photos', label: 'Signboard photo', optional: true, done: (s) => has(s.storePhotos?.signboard) },
];

const MEDICAL_DOCUMENTS = [
    { key: 'drugLicenseNumber', section: 'documents', label: 'Drug licence number', done: (s) => has(s.drugLicenseNumber) },
    { key: 'drugLicenseImage', section: 'documents', label: 'Drug licence document', done: (s) => has(s.drugLicenseImage) },
    {
        key: 'drugLicenseExpiry',
        section: 'documents',
        label: 'Drug licence expiry date (not expired)',
        done: (s, now) => ['valid', 'expiring'].includes(drugLicenceStatus(s, now).state),
    },
    {
        key: 'gstImage',
        section: 'documents',
        label: 'GST certificate',
        // "If applicable": only a GST-registered pharmacy has one to give.
        optional: true,
        requiredWhen: (s) => s.gstRegistered === true,
        done: (s) => has(s.gstImage) && has(s.gstNumber),
    },
    { key: 'panNumber', section: 'documents', label: 'PAN number', done: (s) => /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(text(s.panNumber)) },
    { key: 'panImage', section: 'documents', label: 'PAN card photo', done: (s) => has(s.panImage) },
    { key: 'businessRegistrationImage', section: 'documents', label: 'Store / business registration document', done: (s) => has(s.businessRegistrationImage) },
    { key: 'pharmacist.name', section: 'documents', label: 'Pharmacist name', done: (s) => has(s.pharmacist?.name) },
    { key: 'pharmacist.registrationNumber', section: 'documents', label: 'Pharmacist registration number', done: (s) => has(s.pharmacist?.registrationNumber) },
    { key: 'pharmacist.certificateImage', section: 'documents', label: 'Pharmacist registration certificate', done: (s) => has(s.pharmacist?.certificateImage) },
];

const STORE_DOCUMENTS = [
    { key: 'panNumber', section: 'documents', label: 'PAN number', optional: true, done: (s) => /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(text(s.panNumber)) },
    { key: 'panImage', section: 'documents', label: 'PAN card photo', optional: true, done: (s) => has(s.panImage) },
    { key: 'fssaiImage', section: 'documents', label: 'FSSAI licence', optional: true, done: (s) => has(s.fssaiImage) },
    {
        key: 'gstImage',
        section: 'documents',
        label: 'GST certificate',
        optional: true,
        requiredWhen: (s) => s.gstRegistered === true,
        done: (s) => has(s.gstImage) && has(s.gstNumber),
    },
];

export const SECTION_LABELS = Object.freeze({
    basic: 'Basic details',
    documents: 'Documents',
    photos: 'Store photos',
    bank: 'Bank details',
});

const listFor = (type) => {
    if (type === 'medical') return [...BASIC, ...MEDICAL_DOCUMENTS, ...PHOTOS(true), ...BANK];
    if (type === 'store') return [...BASIC, ...STORE_DOCUMENTS, ...PHOTOS(false), ...BANK];
    return [];
};

/** Is this list enforced at registration and approval? */
export const isEnforced = (type) => type === 'medical';

/**
 * Every item on the list for this partner type, with whether it is done.
 * `missing` holds the labels of required items not yet done.
 */
export function evaluateApplication(type, seller = {}, now = new Date()) {
    const s = seller || {};
    const items = listFor(type).map((item) => {
        const required = item.requiredWhen ? item.requiredWhen(s) : !item.optional;
        return {
            key: item.key,
            section: item.section,
            label: item.label,
            required,
            done: Boolean(item.done(s, now)),
        };
    });
    const missing = items.filter((i) => i.required && !i.done).map((i) => i.label);
    return { type, items, missing, complete: missing.length === 0 };
}

/** Refuse an application missing something required. Names what is missing. */
export function assertApplicationComplete(type, seller, now = new Date()) {
    if (!isEnforced(type)) return;
    const { missing } = evaluateApplication(type, seller, now);
    if (missing.length === 0) return;
    const shown = missing.slice(0, 4).join(', ');
    const more = missing.length > 4 ? ` and ${missing.length - 4} more` : '';
    throw new ValidationError(`Still needed before this pharmacy can be approved: ${shown}${more}.`);
}

/**
 * Where a partner stands, for routing: `new` has no account, the rest follow
 * the seller's status.
 */
export function partnerStateOf(seller) {
    if (!seller) return 'new';
    const status = String(seller.status || 'pending');
    return ['pending', 'rejected', 'approved'].includes(status) ? status : 'pending';
}
