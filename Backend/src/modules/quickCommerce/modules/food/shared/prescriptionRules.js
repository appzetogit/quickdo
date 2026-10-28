import { ValidationError } from '../../../../../core/auth/errors.js';
import { requiresPrescription } from './storeType.js';

/**
 * Prescription handling for medical-store orders.
 *
 * A pharmacy may not dispense against nothing, so an order placed with a medical
 * seller carries a prescription the customer uploads at checkout, and the seller --
 * who is the pharmacist -- reviews it before the order can be confirmed.
 *
 * Two separate gates, deliberately:
 *   1. at creation, the prescription must be present at all;
 *   2. at confirmation, it must have been approved.
 * Collapsing them would let an order sit in the seller's queue looking normal while
 * nobody had actually looked at the prescription.
 *
 * Pure, so the same rule serves order creation, the seller's accept action and the
 * admin panel without a database.
 */

export const PRESCRIPTION_STATUS = Object.freeze({
    NOT_REQUIRED: 'not_required',
    PENDING_REVIEW: 'pending_review',
    APPROVED: 'approved',
    REJECTED: 'rejected',
});

/** Order statuses that mean the seller has taken the order on. */
const ACCEPTANCE_STATUSES = Object.freeze(['confirmed', 'preparing', 'ready_for_pickup']);

const toTrimmed = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * The prescription block to stamp on a new order.
 *
 * @param {object} seller  the seller the order is placed with (needs storeType)
 * @param {object} body    the order request (may carry prescriptionImage)
 * @param {Date}   now
 */
export function buildOrderPrescription(seller, body = {}, now = new Date()) {
    if (!requiresPrescription(seller?.storeType)) {
        // Anything a customer sent for a non-medical order is ignored rather than
        // stored: it would be a medical document held for no lawful reason.
        return {
            required: false,
            imageUrl: '',
            uploadedAt: null,
            status: PRESCRIPTION_STATUS.NOT_REQUIRED,
            reviewedAt: null,
            reviewedBy: null,
            rejectionReason: '',
        };
    }

    const imageUrl = toTrimmed(body.prescriptionImage || body.prescriptionImageUrl);
    if (!imageUrl) {
        throw new ValidationError('This order includes medicine. Upload a prescription to continue.');
    }

    return {
        required: true,
        imageUrl,
        uploadedAt: now,
        status: PRESCRIPTION_STATUS.PENDING_REVIEW,
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: '',
    };
}

/**
 * May the seller move this order to an accepted state yet?
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canAcceptOrder(order, nextStatus) {
    if (!ACCEPTANCE_STATUSES.includes(String(nextStatus || ''))) return { ok: true };

    const rx = order?.prescription;
    if (!rx?.required) return { ok: true };

    if (rx.status === PRESCRIPTION_STATUS.APPROVED) return { ok: true };

    if (rx.status === PRESCRIPTION_STATUS.REJECTED) {
        return { ok: false, reason: 'The prescription on this order was rejected, so it cannot be accepted.' };
    }
    return { ok: false, reason: 'Review the customer\'s prescription before accepting this order.' };
}

/** Throwing form, for the order status write path. */
export function assertCanAcceptOrder(order, nextStatus) {
    const verdict = canAcceptOrder(order, nextStatus);
    if (!verdict.ok) throw new ValidationError(verdict.reason);
}

/**
 * Apply a seller's decision to the prescription block.
 *
 * @param {object} order     needs prescription
 * @param {'approved'|'rejected'} decision
 * @param {{ reviewerId?: any, reason?: string, now?: Date }} opts
 */
export function reviewPrescription(order, decision, opts = {}) {
    const rx = order?.prescription;
    if (!rx?.required) {
        throw new ValidationError('This order does not carry a prescription');
    }
    if (rx.status === PRESCRIPTION_STATUS.APPROVED || rx.status === PRESCRIPTION_STATUS.REJECTED) {
        throw new ValidationError('This prescription has already been reviewed');
    }

    const now = opts.now || new Date();
    // Spread the plain fields. `{...subdoc}` on a Mongoose subdocument copies its
    // internals, not bill/packet, and the save then failed with "Cast to Object
    // failed for value undefined at path prescription.bill" (a 500 to the store).
    const plain = typeof rx.toObject === 'function' ? rx.toObject() : rx;
    if (decision === PRESCRIPTION_STATUS.APPROVED) {
        return {
            ...plain,
            status: PRESCRIPTION_STATUS.APPROVED,
            reviewedAt: now,
            reviewedBy: opts.reviewerId || null,
            rejectionReason: '',
        };
    }
    if (decision === PRESCRIPTION_STATUS.REJECTED) {
        const reason = toTrimmed(opts.reason);
        if (!reason) {
            throw new ValidationError('Give a reason when rejecting a prescription, so the customer can fix it');
        }
        return {
            ...plain,
            status: PRESCRIPTION_STATUS.REJECTED,
            reviewedAt: now,
            reviewedBy: opts.reviewerId || null,
            rejectionReason: reason,
        };
    }
    throw new ValidationError('Decision must be approved or rejected');
}
