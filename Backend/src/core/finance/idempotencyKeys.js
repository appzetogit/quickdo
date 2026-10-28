/**
 * The name a money mutation goes by, so doing it twice does it once.
 *
 * Every financial write in this platform is retryable by something: Razorpay
 * redelivers webhooks, BullMQ retries failed jobs, a rider double-taps, a mobile
 * client resends on a flaky connection, an admin refreshes a form. Today most of
 * those paths protect themselves with `findOne(...)` then write -- two steps with
 * a gap, which two concurrent callers both walk through. (The cash-deposit path
 * is the exception, and the model for this file: it makes the WRITE the claim,
 * backed by a unique index.)
 *
 * This module does not do the writing. It decides the KEY, which is the harder
 * half, because the key is what defines "the same operation":
 *
 *   - too broad, and two legitimately different mutations collapse into one --
 *     a rider who genuinely earns twice on one order gets paid once;
 *   - too narrow, and a retry looks new -- the provider redelivers and the money
 *     moves twice.
 *
 * So there is no universal key. Each operation names itself after whatever the
 * business says makes it unique, which is usually the thing that is already
 * unique upstream: a provider event id, a ride, an order plus the ROLE being
 * paid. Where nothing upstream is unique -- an admin typing an adjustment -- the
 * caller must supply a client-generated id, because the platform genuinely
 * cannot tell a double-click from a deliberate second adjustment of the same
 * amount. Guessing there is worse than asking.
 *
 * Keys are opaque strings, stable across retries and across processes, and
 * carry a prefix so an operator reading the ledger can tell what produced a row.
 */

const clean = (value) => String(value ?? '').trim();

/** Every key this module can mint. Used by the checks and by the ledger's validation. */
export const KEY_KINDS = Object.freeze([
    'rzp_event',
    'rzp_payment',
    'rzp_refund',
    'ride_settlement',
    'ride_cancellation_fee',
    'order_rider_earning',
    'order_commission',
    'order_platform_fee',
    'cash_deposit',
    'withdrawal',
    'bonus',
    'admin_adjustment',
    'subscription_charge',
    'source_row',
]);

const build = (kind, ...parts) => {
    if (!KEY_KINDS.includes(kind)) {
        throw new Error(`Unknown idempotency key kind: ${kind}`);
    }
    const cleaned = parts.map(clean);
    if (cleaned.some((p) => !p)) {
        // A key with a blank segment would collide with every other key that has
        // a blank in the same position -- i.e. it would silently suppress real
        // mutations. Refuse to mint one.
        throw new Error(`Idempotency key "${kind}" is missing a required part (got: ${JSON.stringify(parts)})`);
    }
    return [kind, ...cleaned].join(':');
};

/**
 * A provider event. The outermost key: Razorpay redelivers the SAME event id, so
 * this alone makes a redelivery inert no matter what the event contains.
 */
export const forProviderEvent = (eventId) => build('rzp_event', eventId);

/**
 * A specific captured payment. Distinct from the event key on purpose: several
 * different events (`payment.captured`, `order.paid`) can carry one payment id,
 * and the money must move for the first of them only.
 */
export const forProviderPayment = (paymentId) => build('rzp_payment', paymentId);

/** A specific refund at the provider. */
export const forProviderRefund = (refundId) => build('rzp_refund', refundId);

/**
 * Settling a finished ride. Keyed on the ride, not on the driver: the same ride
 * settling twice is the bug, and it is the same bug whoever it pays.
 */
export const forRideSettlement = (rideId) => build('ride_settlement', rideId);

export const forRideCancellationFee = (rideId) => build('ride_cancellation_fee', rideId);

/**
 * Paying out an order.
 *
 * Keyed on order AND role. One delivered order produces three separate movements
 * -- the rider's earning, the restaurant's share, the platform's fee -- and they
 * are genuinely three mutations, not one. Keying on the order alone would let the
 * first of them suppress the other two, which is the "too broad" failure this
 * file exists to avoid.
 */
export const forOrderRiderEarning = (orderId) => build('order_rider_earning', orderId);
export const forOrderCommission = (orderId, restaurantId) => build('order_commission', orderId, restaurantId);
export const forOrderPlatformFee = (orderId) => build('order_platform_fee', orderId);

/**
 * A rider paying collected cash back in. Already protected by a unique index on
 * `razorpayPaymentId`; this mints the matching ledger key so the deposit row and
 * the ledger entry agree about what "the same deposit" means.
 */
export const forCashDeposit = (providerPaymentId) => build('cash_deposit', providerPaymentId);

/**
 * A withdrawal, keyed on the request AND the state being applied.
 *
 * A withdrawal moves money more than once in its life -- reserved on request,
 * released on rejection, paid on approval. Keying on the withdrawal id alone
 * would make the approval a duplicate of the request and silently skip the payout.
 */
export const forWithdrawal = (withdrawalId, status) => build('withdrawal', withdrawalId, status);

/** An admin-granted bonus, keyed on its own row. */
export const forBonus = (bonusTransactionId) => build('bonus', bonusTransactionId);

/**
 * An admin moving money by hand.
 *
 * `clientRequestId` MUST come from the admin panel (one per form submission), not
 * be generated here. Nothing about an adjustment is naturally unique: the same
 * admin may legitimately credit the same driver the same Rs 500 twice in a
 * minute, and the platform cannot distinguish that from a double-click. The
 * client knows, so the client says.
 */
export const forAdminAdjustment = (adminId, clientRequestId) =>
    build('admin_adjustment', adminId, clientRequestId);

export const forSubscriptionCharge = (subscriptionId, periodKey) =>
    build('subscription_charge', subscriptionId, periodKey);

/**
 * A row an EXISTING writer already committed, mirrored into the ledger during
 * dual-write.
 *
 * Keyed on the source row, not on the business event, and that is deliberate. The
 * mirror's job is to record what the old wallet actually did -- including a
 * settlement the old check-then-act dedupe credited twice. Keying on the ride
 * would fold that double credit into one entry and make the ledger agree with what
 * SHOULD have happened, hiding exactly the drift the reconciler exists to find.
 *
 * It is also what lets the Phase 3 backfill and the live mirror overlap safely:
 * both name a historical row the same way, so a row covered by both is written once.
 */
export const forSourceRow = (collection, rowId) => build('source_row', collection, rowId);

/** Which kind produced a key, for reading a ledger row back. */
export const kindOf = (key) => {
    const kind = clean(key).split(':')[0];
    return KEY_KINDS.includes(kind) ? kind : null;
};

export const __testables = { build, clean };
