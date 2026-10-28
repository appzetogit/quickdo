/**
 * A seller's compliance documents -- PAN, GST, FSSAI and, for a pharmacy, the
 * drug licence -- and the review of changes to them.
 *
 * Shared by restaurants (Food) and by stores and medical stores (quick
 * commerce): each caller hands in its own seller model.
 *
 * A seller's edit does not change the documents on file. It is held as a
 * change request (`documentReview`) until an admin approves it, and the
 * outlet keeps trading on what was approved before. Editing these used to set
 * the whole outlet to `pending`, which took it offline until someone noticed;
 * a corrected GST number is no reason to stop taking orders.
 *
 *   documentReview: {
 *     status: 'pending' | 'approved' | 'rejected',
 *     changes:  { field: newValue },   what the seller asked for
 *     previous: { field: oldValue },   what was on file when they asked
 *     requestedAt, reviewedAt, rejectionReason
 *   }
 *
 * An admin editing the documents directly is not a request: it goes straight
 * on file (see the admin services).
 */
import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from './auth/errors.js';

const KINDS = {
    panNumber: 'pan',
    nameOnPan: 'text',
    panImage: 'url',
    gstRegistered: 'bool',
    gstNumber: 'gstin',
    gstLegalName: 'text',
    gstAddress: 'text',
    gstImage: 'url',
    fssaiNumber: 'fssai',
    fssaiExpiry: 'date',
    fssaiImage: 'url',
    drugLicenseNumber: 'upper',
    drugLicenseExpiry: 'date',
    drugLicenseImage: 'url',
};

export const DOCUMENT_LABELS = {
    panNumber: 'PAN number',
    nameOnPan: 'Name on PAN',
    panImage: 'PAN card photo',
    gstRegistered: 'GST registered',
    gstNumber: 'GST number',
    gstLegalName: 'GST legal name',
    gstAddress: 'GST address',
    gstImage: 'GST certificate',
    fssaiNumber: 'FSSAI licence number',
    fssaiExpiry: 'FSSAI expiry',
    fssaiImage: 'FSSAI licence photo',
    drugLicenseNumber: 'Drug licence number',
    drugLicenseExpiry: 'Drug licence expiry',
    drugLicenseImage: 'Drug licence photo',
};

export const BASE_DOCUMENT_FIELDS = [
    'panNumber', 'nameOnPan', 'panImage',
    'gstRegistered', 'gstNumber', 'gstLegalName', 'gstAddress', 'gstImage',
    'fssaiNumber', 'fssaiExpiry', 'fssaiImage',
];
export const PHARMACY_DOCUMENT_FIELDS = ['drugLicenseNumber', 'drugLicenseExpiry', 'drugLicenseImage'];
export const ALL_DOCUMENT_FIELDS = [...BASE_DOCUMENT_FIELDS, ...PHARMACY_DOCUMENT_FIELDS];

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/;
const FSSAI_RE = /^[0-9]{14}$/;

/** A field's value as stored, or a ValidationError naming what is wrong. */
export function normalizeDocumentValue(field, raw) {
    const kind = KINDS[field];
    const label = DOCUMENT_LABELS[field] || field;
    if (kind === 'bool') {
        if (typeof raw === 'boolean') return raw;
        const s = String(raw ?? '').trim().toLowerCase();
        if (['true', '1', 'yes'].includes(s)) return true;
        if (['false', '0', 'no', ''].includes(s)) return false;
        throw new ValidationError(`${label} must be yes or no`);
    }
    if (kind === 'date') {
        const s = String(raw ?? '').trim();
        if (!s) return null;
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) throw new ValidationError(`${label} is not a valid date`);
        return d;
    }
    if (kind === 'url') {
        const value = raw && typeof raw === 'object' ? raw.url : raw;
        return String(value ?? '').trim();
    }
    const text = String(raw ?? '').trim();
    if (kind === 'text') return text;
    const upper = text.toUpperCase().replace(/\s+/g, '');
    if (!upper) return '';
    if (kind === 'pan' && !PAN_RE.test(upper)) {
        throw new ValidationError('PAN number should look like ABCDE1234F (5 letters, 4 digits, 1 letter).');
    }
    if (kind === 'gstin' && !GSTIN_RE.test(upper)) {
        throw new ValidationError('GST number should be the 15-character GSTIN, like 22ABCDE1234F1Z5.');
    }
    if (kind === 'fssai' && !FSSAI_RE.test(upper)) {
        throw new ValidationError('FSSAI licence number should be 14 digits.');
    }
    return upper;
}

const comparable = (field, value) => {
    if (KINDS[field] === 'date') {
        if (!value) return '';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    }
    if (KINDS[field] === 'bool') return value === true ? 'true' : 'false';
    return String(value ?? '');
};

/** The fields this seller files: the drug licence only for a pharmacy. */
export const documentFieldsFor = (seller) =>
    seller?.storeType === 'pharmacy' ? ALL_DOCUMENT_FIELDS : BASE_DOCUMENT_FIELDS;

/** Just the document fields out of a request body or a profile update. */
export const pickDocumentFields = (source = {}, fields = ALL_DOCUMENT_FIELDS) => {
    const out = {};
    for (const f of fields) if (source[f] !== undefined) out[f] = source[f];
    return out;
};

const valuesOf = (seller, fields) => {
    const out = {};
    for (const f of fields) out[f] = seller?.[f] ?? (KINDS[f] === 'bool' ? false : KINDS[f] === 'date' ? null : '');
    return out;
};

export const createSellerDocuments = ({ Model }) => {
    const load = async (sellerId) => {
        if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
            throw new ValidationError('Invalid account');
        }
        const seller = await Model.findById(sellerId).lean();
        if (!seller) throw new NotFoundError('Account not found');
        return seller;
    };

    const view = (seller) => {
        const fields = documentFieldsFor(seller);
        return {
            fields,
            labels: Object.fromEntries(fields.map((f) => [f, DOCUMENT_LABELS[f]])),
            values: valuesOf(seller, fields),
            review: seller.documentReview?.status ? seller.documentReview : null,
        };
    };

    return {
        async get(sellerId) {
            return view(await load(sellerId));
        },

        /**
         * The seller asks to change documents. Only fields that actually differ
         * from what is on file are kept; a request already waiting is merged
         * into, keeping what was on file before the first one.
         * `quiet` returns null instead of refusing when nothing changed (the
         * profile save sends the whole form).
         */
        async requestChange(sellerId, body = {}, { quiet = false } = {}) {
            const seller = await load(sellerId);
            const fields = documentFieldsFor(seller);
            const asked = pickDocumentFields(body, fields);

            const pending = seller.documentReview?.status === 'pending' ? seller.documentReview : null;
            const changes = { ...(pending?.changes || {}) };
            const previous = { ...(pending?.previous || {}) };
            let touched = false;
            for (const [field, raw] of Object.entries(asked)) {
                const onFile = seller[field];
                // Unchanged values are not re-checked: an outlet onboarded with a
                // placeholder ("11") must still be able to save its other fields.
                const loose = (v) => String(v && typeof v === 'object' && !(v instanceof Date) ? v.url : v ?? '').trim().toUpperCase().replace(/\s+/g, '');
                // A value equal to what is on file withdraws a waiting change to
                // it -- except from the profile save (`quiet`), whose form always
                // sends every field with the values on file.
                const sameAsFile = () => {
                    if (!quiet && field in changes) { delete changes[field]; delete previous[field]; touched = true; }
                };
                if (KINDS[field] !== 'date' && KINDS[field] !== 'bool' && loose(raw) === loose(onFile)) {
                    sameAsFile();
                    continue;
                }
                const value = normalizeDocumentValue(field, raw);
                if (comparable(field, value) === comparable(field, onFile)) {
                    sameAsFile();
                    continue;
                }
                if (!(field in previous)) previous[field] = onFile ?? null;
                changes[field] = value;
                touched = true;
            }

            if (!touched) {
                if (quiet) return null;
                throw new ValidationError('Nothing changed. Edit a document before sending it for review.');
            }

            const documentReview = Object.keys(changes).length
                ? {
                    status: 'pending',
                    changes,
                    previous,
                    requestedAt: new Date(),
                    reviewedAt: null,
                    rejectionReason: '',
                }
                : null; // every change undone
            await Model.updateOne(
                { _id: seller._id },
                documentReview ? { $set: { documentReview } } : { $unset: { documentReview: 1 } },
            );
            return view({ ...seller, documentReview: documentReview || undefined });
        },

        /** Change requests for the admin, newest first. */
        async listForAdmin({ status = 'pending' } = {}) {
            const wanted = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
            const rows = await Model.find({ 'documentReview.status': wanted })
                .select(`restaurantName ownerName ownerPhone storeType status documentReview ${ALL_DOCUMENT_FIELDS.join(' ')}`)
                .sort({ 'documentReview.requestedAt': -1 })
                .limit(500)
                .lean();
            return rows.map((s) => ({
                id: String(s._id),
                name: s.restaurantName || '',
                ownerName: s.ownerName || '',
                ownerPhone: s.ownerPhone || '',
                storeType: s.storeType || null,
                outletStatus: s.status || '',
                review: s.documentReview,
                labels: DOCUMENT_LABELS,
            }));
        },

        /** Puts the requested values on file. The outlet's own status is not touched. */
        async approve(sellerId) {
            const seller = await load(sellerId);
            const review = seller.documentReview;
            if (review?.status !== 'pending') throw new ValidationError('There is no document change waiting for review.');
            const set = { 'documentReview.status': 'approved', 'documentReview.reviewedAt': new Date() };
            for (const [field, value] of Object.entries(review.changes || {})) {
                if (ALL_DOCUMENT_FIELDS.includes(field)) set[field] = KINDS[field] === 'date' && value ? new Date(value) : value;
            }
            await Model.updateOne({ _id: seller._id }, { $set: set });
            return view(await load(sellerId));
        },

        /** Discards the request with a reason the seller sees; what is on file stays. */
        async reject(sellerId, reason) {
            const text = String(reason || '').trim();
            if (!text) throw new ValidationError('Give a reason, so the outlet knows what to fix.');
            const seller = await load(sellerId);
            if (seller.documentReview?.status !== 'pending') {
                throw new ValidationError('There is no document change waiting for review.');
            }
            await Model.updateOne(
                { _id: seller._id },
                { $set: { 'documentReview.status': 'rejected', 'documentReview.reviewedAt': new Date(), 'documentReview.rejectionReason': text.slice(0, 500) } },
            );
            return view(await load(sellerId));
        },
    };
};
