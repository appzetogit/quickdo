/**
 * Return eligibility and lifecycle rules for quick-commerce.
 *
 * Pure rules, no database — the same reason returnRefund.service.js is pure. What a
 * customer is allowed to return, and which state a return may move to next, are the
 * two things most likely to be quietly wrong, so they are kept where they can be
 * exhaustively tested.
 *
 * Grocery is not restaurant food: an unopened carton of detergent is genuinely
 * returnable days later, a punnet of strawberries is not returnable at all, and
 * "damaged on arrival" has to be reportable even for the strawberries. That is why
 * this file exists rather than a single global return window.
 */

/**
 * Return windows in hours, by how perishable the goods are.
 *
 * `NON_RETURNABLE` is not zero-hours-by-another-name: a zero window would still let
 * a request be filed and then auto-expire, whereas these categories must be refused
 * outright with a reason the customer can read.
 */
export const PERISHABILITY = Object.freeze({
    /** Ambient packaged goods: staples, household, personal care. */
    AMBIENT: 'ambient',
    /** Chilled or frozen but sealed: dairy, ice cream, frozen peas. */
    CHILLED: 'chilled',
    /** Fresh produce, bakery, meat, cut fruit. Quality cannot be re-verified. */
    FRESH: 'fresh',
});

export const RETURN_WINDOW_HOURS = Object.freeze({
    [PERISHABILITY.AMBIENT]: 7 * 24,
    [PERISHABILITY.CHILLED]: 24,
    [PERISHABILITY.FRESH]: 0,
});

/**
 * Why the customer is returning. The fault attribution attached to each reason is
 * what decides whether delivery and platform fees come back, so it is fixed here
 * rather than chosen per-request by whoever calls the API.
 */
export const RETURN_REASONS = Object.freeze({
    DAMAGED: { code: 'damaged', fault: 'seller', allowsPerishable: true, restockable: false },
    EXPIRED: { code: 'expired', fault: 'seller', allowsPerishable: true, restockable: false },
    WRONG_ITEM: { code: 'wrong_item', fault: 'seller', allowsPerishable: true, restockable: true },
    MISSING_ITEM: { code: 'missing_item', fault: 'seller', allowsPerishable: true, restockable: false },
    QUALITY: { code: 'quality', fault: 'seller', allowsPerishable: true, restockable: false },
    CHANGED_MIND: { code: 'changed_mind', fault: 'customer', allowsPerishable: false, restockable: true },
    ORDERED_BY_MISTAKE: { code: 'ordered_by_mistake', fault: 'customer', allowsPerishable: false, restockable: true },
});

export const getReason = (code) => Object.values(RETURN_REASONS)
    .find((r) => r.code === String(code || '').toLowerCase()) || null;

/**
 * Return lifecycle.
 *
 * `inspected` is deliberately a separate state from `picked_up`. Refunding at pickup
 * means refunding before anyone has confirmed what came back in the bag, and for
 * customer-fault returns that is the whole point of the inspection. Seller-fault
 * returns can be fast-tracked by the caller; the graph still records both hops.
 */
export const RETURN_STATUS = Object.freeze({
    REQUESTED: 'requested',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    PICKUP_SCHEDULED: 'pickup_scheduled',
    PICKED_UP: 'picked_up',
    INSPECTED: 'inspected',
    REFUNDED: 'refunded',
    CANCELLED: 'cancelled',
});

const TRANSITIONS = Object.freeze({
    [RETURN_STATUS.REQUESTED]: [RETURN_STATUS.APPROVED, RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED],
    [RETURN_STATUS.APPROVED]: [RETURN_STATUS.PICKUP_SCHEDULED, RETURN_STATUS.CANCELLED],
    [RETURN_STATUS.PICKUP_SCHEDULED]: [RETURN_STATUS.PICKED_UP, RETURN_STATUS.CANCELLED],
    [RETURN_STATUS.PICKED_UP]: [RETURN_STATUS.INSPECTED],
    // A return can still be refused after inspection — the bag came back empty, or
    // holding a different product than the one that was approved.
    [RETURN_STATUS.INSPECTED]: [RETURN_STATUS.REFUNDED, RETURN_STATUS.REJECTED],
    [RETURN_STATUS.REFUNDED]: [],
    [RETURN_STATUS.REJECTED]: [],
    [RETURN_STATUS.CANCELLED]: [],
});

export const TERMINAL_STATUSES = Object.freeze([
    RETURN_STATUS.REFUNDED, RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED,
]);

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

export const assertTransition = (from, to) => {
    if (!canTransition(from, to)) {
        throw new Error(`Illegal return transition: ${from} -> ${to}`);
    }
    return true;
};

/**
 * Is this order returnable at all, and for how long?
 *
 * @param {object} order            needs orderStatus and deliveredAt
 * @param {string} reasonCode       one of RETURN_REASONS
 * @param {string} perishability    PERISHABILITY.*, from the product's category
 * @param {Date}   now
 */
export const checkEligibility = ({ order, reasonCode, perishability = PERISHABILITY.AMBIENT, now = new Date() } = {}) => {
    const deny = (message) => ({ eligible: false, reason: message });

    if (!order) return deny('Order not found');

    // Only a delivered order can be returned. An undelivered one is a cancellation
    // and refunds through a different path — conflating the two would refund goods
    // the customer never received while also restocking them.
    if (order.orderStatus !== 'delivered') {
        return deny('Only delivered orders can be returned. Cancel the order instead.');
    }

    const reason = getReason(reasonCode);
    if (!reason) return deny('Unknown return reason');

    // A stored order keeps the delivery time under deliveryState -- the order schema
    // has no top-level deliveredAt -- so reading only order.deliveredAt refused every
    // real return as "no delivery time on record". The top-level name is still read
    // first for callers that pass a plain object.
    const deliveredAtRaw = order.deliveredAt || order.deliveryState?.deliveredAt;
    const deliveredAt = deliveredAtRaw ? new Date(deliveredAtRaw) : null;
    if (!deliveredAt || Number.isNaN(deliveredAt.getTime())) {
        return deny('Order has no delivery time on record; contact support');
    }

    const windowHours = RETURN_WINDOW_HOURS[perishability];
    if (windowHours === undefined) return deny('Unknown product category');

    // Fresh goods are non-returnable on customer remorse but must still be reportable
    // when they arrive damaged, expired or simply wrong — that is a seller failure and
    // refusing it would make the policy a way to sell spoiled stock without recourse.
    if (windowHours === 0 && !reason.allowsPerishable) {
        return deny('Fresh items cannot be returned for this reason. Report a quality issue instead.');
    }

    // Perishable seller-fault reports get a short fixed window rather than the
    // category's (zero) one: the customer needs time to open the bag, not days.
    const effectiveHours = windowHours === 0 ? 4 : windowHours;
    const expiresAt = new Date(deliveredAt.getTime() + effectiveHours * 3600 * 1000);

    if (now > expiresAt) {
        return deny(`The ${effectiveHours}-hour return window for these items closed on ${expiresAt.toISOString()}`);
    }

    return {
        eligible: true,
        fault: reason.fault,
        restockable: reason.restockable,
        windowHours: effectiveHours,
        expiresAt,
    };
};

/**
 * Should returned stock go back on the shelf?
 *
 * Two independent gates, because either one alone gets it wrong: a sealed pack of
 * strawberries is still unsellable, and an opened box of detergent is unsellable even
 * though detergent keeps. Both the reason and the physical condition must permit it.
 */
export const shouldRestock = ({ reasonCode, perishability, condition }) => {
    const reason = getReason(reasonCode);
    if (!reason || !reason.restockable) return false;
    if (perishability !== PERISHABILITY.AMBIENT) return false;
    return condition === 'sealed';
};
