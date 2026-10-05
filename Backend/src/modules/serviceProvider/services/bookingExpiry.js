const Booking = require('../models/Booking');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { BOOKING_STATUS, PAYMENT_STATUS, PREPAID_PAYMENT_METHODS, refundableAmountOf } = require('../utils/constants');
const { withTransaction, abort } = require('../utils/withTransaction');

/**
 * Cancel a booking nobody accepted in time, and refund a prepaid customer.
 *
 * Moved out of bookingScheduler so it can be tested, and rewritten because the
 * refund inside it had never once run:
 *
 *  - It checked `paymentStatus === 'SUCCESS'`. The stored value is 'success'
 *    (PAYMENT_STATUS.SUCCESS), so the condition was always false: every prepaid
 *    booking that timed out was cancelled and its customer kept nothing.
 *  - Its method list also omitted 'online', what a Razorpay payment stores.
 *  - Had it matched, it would have failed worse: it credited the wallet by
 *    read-modify-save, wrote the refund row, and THEN set paymentStatus 'REFUNDED'
 *    -- not in the enum -- so the final save threw after the money had moved,
 *    leaving a booking still marked paid and refundable again next tick.
 *
 * Now one transaction claims the booking (still searching, still unassigned, so a
 * partner accepting at the same moment wins cleanly), credits the wallet with
 * $inc, and writes the refund row with before/after. The claim makes it safe to
 * run from every scheduler tick and every instance.
 *
 * @returns {Promise<{ cancelled: boolean, refundAmount: number }>}
 */
const expireTimedOutBooking = async (bookingId, { bookingModel = 'vendor' } = {}) => {
    return withTransaction(async (session) => {
        const current = await Booking.findById(bookingId)
            .select('paymentStatus paymentMethod finalAmount paidAmount userId bookingNumber')
            .session(session)
            .lean();
        if (!current) abort({ cancelled: false, refundAmount: 0 });

        const refundAmount =
            current.paymentStatus === PAYMENT_STATUS.SUCCESS && PREPAID_PAYMENT_METHODS.includes(current.paymentMethod)
                ? refundableAmountOf(current)
                : 0;

        const set = {
            status: BOOKING_STATUS.NO_VENDORS,
            cancellationReason: `No ${bookingModel} accepted within time limit`,
            cancelledAt: new Date(),
            cancelledBy: 'system',
        };
        if (refundAmount > 0) {
            set.paymentStatus = PAYMENT_STATUS.REFUNDED;
            set.refundedAmount = refundAmount;
        }

        const claimed = await Booking.findOneAndUpdate(
            {
                _id: bookingId,
                status: { $in: [BOOKING_STATUS.SEARCHING, BOOKING_STATUS.CONFIRMED] },
                vendorId: null,
                workerId: null,
                // The refund decision was made on this payment state; if it changed
                // since the read, the claim fails and the next tick decides again.
                paymentStatus: current.paymentStatus,
            },
            { $set: set },
            { new: true, session }
        );
        if (!claimed) abort({ cancelled: false, refundAmount: 0 });

        if (refundAmount > 0) {
            const user = await User.findByIdAndUpdate(
                current.userId,
                { $inc: { 'wallet.balance': refundAmount } },
                { new: true, session }
            );
            // No user means nowhere to put the money. Roll the cancellation back too,
            // rather than cancel a paid booking with no refund; it stays visible.
            if (!user) abort({ cancelled: false, refundAmount: 0, userMissing: true });

            const balanceAfter = Number(user.wallet?.balance) || 0;
            await Transaction.create([{
                userId: user._id,
                type: 'refund',
                amount: refundAmount,
                status: 'completed',
                paymentMethod: 'wallet',
                description: `Auto-refund for timed-out booking #${current.bookingNumber}`,
                bookingId,
                balanceBefore: Math.round((balanceAfter - refundAmount) * 100) / 100,
                balanceAfter,
                metadata: { reason: 'search_timeout', originalPaymentMethod: current.paymentMethod },
            }], { session });
        }

        return { cancelled: true, refundAmount };
    });
};

/**
 * Which past bookings were owed a refund they never got, and how much. Pure.
 *
 * Before the fix, two kinds of prepaid booking ended with the customer's money kept:
 *   - timed out  (status no_vendors, cancelledBy system): owed the full amount
 *   - cancelled by the user before the journey started, paid 'online': owed the
 *     full amount -- the cancel policy for that case is a full refund
 *
 * Anything else that looks unrefunded -- cancelled after the journey started (a fee
 * applies), or cancelled by a vendor or admin -- is NOT decided here. The amount
 * depends on policy at the time, so it is returned for a person to review.
 *
 * @returns {{ action: 'refund', amount } | { action: 'review', reason } | { action: 'skip', reason }}
 */
const classifyMissedRefund = (booking, { hasRefundRow = false } = {}) => {
    if (!booking) return { action: 'skip', reason: 'missing' };
    if (booking.paymentStatus !== PAYMENT_STATUS.SUCCESS) return { action: 'skip', reason: 'not marked paid' };
    if (!PREPAID_PAYMENT_METHODS.includes(booking.paymentMethod)) return { action: 'skip', reason: 'not prepaid' };
    if (![BOOKING_STATUS.NO_VENDORS, BOOKING_STATUS.CANCELLED].includes(booking.status)) {
        return { action: 'skip', reason: 'not cancelled' };
    }
    if (hasRefundRow) return { action: 'review', reason: 'marked paid but a refund row exists' };

    const amount = refundableAmountOf(booking);
    if (!amount) return { action: 'skip', reason: 'nothing paid' };

    if (booking.status === BOOKING_STATUS.NO_VENDORS) return { action: 'refund', amount };
    if (booking.cancelledBy === 'user' && !booking.journeyStartedAt) return { action: 'refund', amount };
    return { action: 'review', reason: `cancelled by ${booking.cancelledBy || 'unknown'}${booking.journeyStartedAt ? ' after journey start' : ''}` };
};

/**
 * Pay one missed refund. Same shape as the live paths: claim the booking on
 * 'success', credit with $inc, write the row -- one transaction, so running the
 * backfill twice refunds once.
 */
const refundMissedBooking = async (bookingId) => {
    return withTransaction(async (session) => {
        const booking = await Booking.findById(bookingId).session(session).lean();
        const hasRefundRow = !!(await Transaction.exists({ bookingId, type: 'refund' }).session(session));
        const decision = classifyMissedRefund(booking, { hasRefundRow });
        if (decision.action !== 'refund') abort({ refunded: false, ...decision });

        const claimed = await Booking.findOneAndUpdate(
            { _id: bookingId, paymentStatus: PAYMENT_STATUS.SUCCESS, status: booking.status },
            { $set: { paymentStatus: PAYMENT_STATUS.REFUNDED, refundedAmount: decision.amount } },
            { new: true, session }
        );
        if (!claimed) abort({ refunded: false, action: 'skip', reason: 'changed while refunding' });

        const user = await User.findByIdAndUpdate(
            booking.userId,
            { $inc: { 'wallet.balance': decision.amount } },
            { new: true, session }
        );
        if (!user) abort({ refunded: false, action: 'review', reason: 'user not found' });

        const balanceAfter = Number(user.wallet?.balance) || 0;
        await Transaction.create([{
            userId: user._id,
            type: 'refund',
            amount: decision.amount,
            status: 'completed',
            paymentMethod: 'wallet',
            description: `Refund for booking #${booking.bookingNumber} (missed at the time; backfilled)`,
            bookingId,
            balanceBefore: Math.round((balanceAfter - decision.amount) * 100) / 100,
            balanceAfter,
            metadata: { reason: 'missed_refund_backfill', originalStatus: booking.status, originalPaymentMethod: booking.paymentMethod },
        }], { session });

        return { refunded: true, action: 'refund', amount: decision.amount };
    });
};

module.exports = { expireTimedOutBooking, classifyMissedRefund, refundMissedBooking };
