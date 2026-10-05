import { ValidationError } from '../../../../../core/auth/errors.js';
import { isMedicalStore } from './storeType.js';

/**
 * Rules for a prescription-only order — the one a customer places by
 * photographing a doctor's prescription, with no items and no price.
 *
 * The ordinary order path cannot express this. It builds an order from catalogue
 * lines and prices it before the customer confirms; here nobody knows what is
 * being sold until the pharmacist has read the photograph. So the order is
 * created empty and priced later, by the seller, in a second step:
 *
 *   customer  photo + address        -> order, no items, total 0
 *   pharmacist reads the photo       -> approves or rejects the prescription
 *   pharmacist enters what they will dispense -> items + price land on the order
 *   pharmacist accepts               -> normal lifecycle from here on
 *
 * Two consequences fall out of that and are enforced below. The order is cash on
 * delivery, because there is nothing to charge at placement. And it may not be
 * accepted until it has been priced, or the customer would be committed to an
 * order whose cost nobody has told them.
 *
 * Pure, so the same rules serve the customer path, the seller path and the admin
 * panel without a database.
 */

/** Statuses that mean the seller has taken the order on. */
const ACCEPTANCE_STATUSES = Object.freeze(['confirmed', 'preparing', 'ready_for_pickup']);

/**
 * Where the pharmacist may still add items and a price.
 *
 * Was `['created']` only -- pricing had to happen before the pharmacist could
 * accept at all. The seller-facing flow now accepts first ("Order Receive" /
 * Accept, no price yet -- the pharmacist is only confirming they will read
 * and fill it), then prices and bills from the order-details screen, which
 * is what actually moves it on to 'preparing'. `created` is kept too so an
 * order from before this shipped, or a pharmacy still mid-review, still
 * prices the old way.
 */
const FILLABLE_STATUSES = Object.freeze(['created', 'confirmed']);

export const MAX_QUOTE_ITEMS = 40;
export const MAX_QUOTE_LINE_TOTAL = 100000;

const toTrimmed = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Refuse a prescription order aimed at a seller that does not dispense medicine. */
export function assertSellerDispensesMedicine(seller) {
    if (!isMedicalStore(seller?.storeType)) {
        throw new ValidationError('This store is not a medical store, so it cannot take a prescription order.');
    }
}

/**
 * Validate and normalise the lines a pharmacist entered.
 *
 * These are not catalogue products — a pharmacist dispenses against what the
 * prescription says, which may be a brand the shop never listed. The order item
 * schema takes `itemId` as a plain string, so each line gets a synthetic id
 * scoped to this order rather than a fake catalogue reference that later joins
 * would silently follow to nothing.
 */
export function normalizeQuoteItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new ValidationError('Add at least one medicine before pricing this order.');
    }
    if (rawItems.length > MAX_QUOTE_ITEMS) {
        throw new ValidationError(`An order cannot carry more than ${MAX_QUOTE_ITEMS} lines.`);
    }

    return rawItems.map((raw, index) => {
        const name = toTrimmed(raw?.name);
        if (!name) throw new ValidationError(`Line ${index + 1}: enter the medicine name.`);
        if (name.length > 200) throw new ValidationError(`Line ${index + 1}: name is too long.`);

        const price = Number(raw?.price);
        if (!Number.isFinite(price) || price < 0) {
            throw new ValidationError(`Line ${index + 1}: enter a valid price.`);
        }

        const quantity = Number(raw?.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) {
            throw new ValidationError(`Line ${index + 1}: quantity must be a whole number of at least 1.`);
        }

        // Caught here rather than at the total, so the pharmacist is told which
        // line carries the typo instead of being refused with one opaque number.
        if (price * quantity > MAX_QUOTE_LINE_TOTAL) {
            throw new ValidationError(`Line ${index + 1}: that line total looks wrong. Check the price.`);
        }

        // The line's own GST slab, when the pharmacist gives one. Omitted, the line is
        // taxed at the order-wide rate, exactly like an untagged catalogue product.
        let gstRate = null;
        if (raw?.gstRate !== undefined && raw?.gstRate !== null && raw?.gstRate !== '') {
            gstRate = Number(raw.gstRate);
            if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
                throw new ValidationError(`Line ${index + 1}: enter a valid GST rate.`);
            }
        }

        return {
            itemId: `rx-${index + 1}`,
            name,
            price: Math.round(price * 100) / 100,
            quantity,
            gstRate,
            packSize: toTrimmed(raw?.packSize).slice(0, 60),
            notes: toTrimmed(raw?.notes).slice(0, 200),
            // A pharmacy line is not food. Left explicitly rather than defaulted,
            // because the schema's default of true would put a green veg dot on
            // a box of antibiotics.
            isVeg: false,
        };
    });
}

export function computeQuoteSubtotal(items = []) {
    const total = items.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
    return Math.round(total * 100) / 100;
}

/** True once a pharmacist has entered what they will dispense. */
export function isPriced(order) {
    return Boolean(
        order?.prescriptionOnly &&
        Array.isArray(order.items) &&
        order.items.length > 0 &&
        Number(order?.pricing?.total) > 0,
    );
}

/**
 * May the seller still change what this order contains?
 *
 * Only before acceptance. After that the customer has been told a price and a
 * rider may already be on the way, so a silent re-price would be a different
 * order than the one everyone agreed to.
 */
export function assertFillable(order) {
    if (!order?.prescriptionOnly) {
        throw new ValidationError('This order was not placed from a prescription photo.');
    }
    const status = String(order.orderStatus || '');
    if (!FILLABLE_STATUSES.includes(status)) {
        throw new ValidationError(
            status === 'created'
                ? 'This order can no longer be priced.'
                : `This order is already ${status.replace(/_/g, ' ')} and can no longer be priced.`,
        );
    }
}


export const BILL_STATUS = Object.freeze({
    NONE: 'none',
    SUBMITTED: 'submitted',
    APPROVED: 'approved',
    REJECTED: 'rejected',
});

/** The most a pharmacy bill may come to, as a guard against a typo of zeros. */
export const MAX_BILL_AMOUNT = 200000;

/**
 * What the pharmacist typed off the paper bill, checked before it becomes the
 * price of anything.
 *
 * Hand-typed, so the guards are the ones that catch a slip rather than an
 * attack: a missing amount, a negative one, and a figure large enough to be a
 * mistyped row of zeros. The bill image is required with it because the amount
 * is otherwise one person's word -- a disputed charge needs the document.
 */
export function normalizeBillSubmission(dto = {}) {
    const imageUrl = toTrimmed(dto.billImageUrl || dto.imageUrl);
    if (!imageUrl) {
        throw new ValidationError('Upload a photo of the pharmacy bill.');
    }
    const amount = Number(dto.billAmount ?? dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Enter the bill amount.');
    }
    if (amount > MAX_BILL_AMOUNT) {
        throw new ValidationError(`A bill over Rs ${MAX_BILL_AMOUNT} has to be raised with support.`);
    }
    return { imageUrl, amount: Math.round(amount * 100) / 100 };
}

/** True once the customer has agreed to the pharmacy's bill. */
export function isBillApproved(order) {
    return String(order?.prescription?.bill?.status || '') === BILL_STATUS.APPROVED;
}

/**
 * The customer has to answer the bill before the order moves.
 *
 * Priced is not the same as agreed. The pharmacist reads the prescription and
 * names a figure the customer has never seen; letting the order be prepared and
 * dispatched on that alone would deliver medicines at a price nobody accepted,
 * and leave the platform collecting it on delivery. Cancelling stays open
 * throughout, so an unaffordable bill is never a trap.
 */
export function assertBillApproved(order, nextStatus) {
    if (!order?.prescriptionOnly) return;
    if (!ACCEPTANCE_STATUSES.includes(String(nextStatus || ''))) return;
    const status = String(order?.prescription?.bill?.status || BILL_STATUS.NONE);
    if (status === BILL_STATUS.APPROVED) return;
    /*
     * No bill was ever sent: either an order placed before bills existed, or a
     * pharmacy still on an app build that prices through fill(). Both are
     * already covered by assertPrescriptionOrderPriced, which refuses an
     * unpriced order, so refusing here as well would strand live orders on the
     * day this ships and every order from an un-updated pharmacy after it.
     * Once a bill HAS been sent, the customer's answer is required.
     */
    if (status === BILL_STATUS.NONE) return;
    throw new ValidationError(
        status === BILL_STATUS.SUBMITTED
            ? 'The customer has not approved the bill for this order yet.'
            : 'The customer declined the bill for this order.',
    );
}

/**
 * May a delivery partner be handed this order yet?
 *
 * Unlike [assertBillApproved]/[assertPrescriptionOrderPriced], this has no
 * `nextStatus` to gate on: assigning a rider doesn't move `orderStatus` by
 * itself (see `assignRider` in core/delivery/manualAssign.js), so it has to run unconditionally
 * for a prescription order rather than only when a status transition happens
 * to be one of [ACCEPTANCE_STATUSES]. Without this, an admin's manual "assign
 * a rider" action was the one path in the whole order lifecycle that could
 * hand a medical order to a driver before the customer had actually agreed
 * to pay for it — every other path already runs through the generic
 * status-update function these two guards are wired into.
 */
export function assertDeliveryPartnerAssignable(order) {
    if (!order?.prescriptionOnly) return;
    if (!isPriced(order)) {
        throw new ValidationError(
            'This prescription order has not been priced yet.',
        );
    }
    const status = String(order?.prescription?.bill?.status || BILL_STATUS.NONE);
    if (status === BILL_STATUS.APPROVED || status === BILL_STATUS.NONE) return;
    throw new ValidationError(
        status === BILL_STATUS.SUBMITTED
            ? 'The customer has not approved the bill for this order yet.'
            : 'The customer declined the bill for this order.',
    );
}

/**
 * Once packed ('preparing') or handed off, a prescription order must be
 * priced -- but NOT to reach 'confirmed' itself. Accepting is now the
 * pharmacist's "I will read and fill this", not a promise about a price;
 * the price comes from the bill they submit afterward (submitPrescriptionOrderBill
 * moves 'confirmed' -> 'preparing' the moment that happens), so gating
 * 'confirmed' on a price that cannot exist yet would make Accept impossible.
 */
const PRICE_REQUIRED_STATUSES = Object.freeze(
    ACCEPTANCE_STATUSES.filter((status) => status !== 'confirmed'),
);

/**
 * A prescription order may not go past acceptance until it has been priced.
 *
 * Without this the pharmacist could pack and hand off an empty order, and
 * the customer would be committed to a delivery whose cost nobody had told
 * them. Cancelling stays available, so an unreadable prescription is never
 * stuck.
 */
export function assertPrescriptionOrderPriced(order, nextStatus) {
    if (!order?.prescriptionOnly) return;
    if (!PRICE_REQUIRED_STATUSES.includes(String(nextStatus || ''))) return;
    if (!isPriced(order)) {
        throw new ValidationError(
            'Enter the medicines and price for this prescription before accepting the order.',
        );
    }
}
