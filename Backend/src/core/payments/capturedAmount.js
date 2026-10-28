/**
 * Does the amount Razorpay captured actually match the order it claims to pay?
 *
 * The HMAC signature on a webhook proves the event came from Razorpay. It proves
 * nothing about the amount: `payment.captured` carries whatever was captured, and
 * a handler that marks an order paid without comparing accepts underpayment. A
 * Rs 1 capture against a Rs 900 order cleared it, and the restaurant was
 * dispatched an order nobody had paid for.
 *
 * The quick-commerce webhook has carried this comparison inline since it was
 * written; the food webhook never got it. Rather than copy the block a third
 * time when the two handlers merge, the rule lives here once.
 *
 * Money is compared in PAISE, as integers. Comparing rupees as floats would make
 * 899.99 + 0.01 !== 900 on some orders and reject a correct payment.
 */

/** An order total (rupees, possibly fractional) as whole paise. */
export const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);

/**
 * @param {number|string} capturedPaise  `payment.entity.amount` from the provider
 * @param {number} orderTotalRupees      the order's own `pricing.total`
 * @returns {{ matches: boolean, capturedPaise: number, expectedPaise: number, reason: string|null }}
 *
 * `matches: false` is never an error to return to the provider -- a non-200 makes
 * Razorpay retry an event that can never succeed. Callers acknowledge the event
 * and record the mismatch instead.
 */
export const capturedAmountMatches = (capturedPaise, orderTotalRupees) => {
    const expectedPaise = toPaise(orderTotalRupees);
    const paid = Number(capturedPaise);

    if (!Number.isFinite(paid)) {
        return { matches: false, capturedPaise: paid, expectedPaise, reason: 'captured_amount_missing' };
    }
    if (paid !== expectedPaise) {
        return {
            matches: false,
            capturedPaise: paid,
            expectedPaise,
            // Overpayment is as much a mismatch as underpayment: it means the
            // payment belongs to a different order, or the total changed after
            // checkout. Either way this event must not silently settle it.
            reason: paid < expectedPaise ? 'underpaid' : 'overpaid',
        };
    }
    return { matches: true, capturedPaise: paid, expectedPaise, reason: null };
};
