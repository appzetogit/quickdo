import { recordPayment } from '../../../core/payments/payments.facade.js';
import { logger } from '../../../utils/logger.js';

/**
 * Mirror a verified taxi gateway payment into the shared `payments` collection, so
 * taxi revenue appears in the cross-vertical totals alongside food, quick-commerce
 * and service-provider.
 *
 * Taxi is the odd one out of the four: it has no gateway-payment model of its own to
 * cut over. `WalletTransaction` is a driver-side ledger (it is what records the credit
 * to a driver's balance), not a record of the customer's payment. So this adds the
 * missing record rather than moving an existing one, and nothing taxi already does
 * changes.
 *
 * Taxi verifies inline in five handlers rather than through one choke point the way
 * service-provider does, so this exists to keep the call site down to a single line
 * and the shape identical across all five.
 *
 * NEVER THROWS. Every call site sits after the signature has been checked, the amount
 * has been read back from the gateway, and money has moved. A reporting write must not
 * be able to fail a payment that already succeeded.
 *
 * @param {object}  p
 * @param {string}  p.orderId          razorpay order id
 * @param {string}  p.paymentId        razorpay payment id
 * @param {number}  p.amount           amount in RUPEES, already verified against the gateway
 * @param {string}  p.userId           payer
 * @param {string} [p.subjectId]       ride / booking this relates to
 * @param {string}  p.purpose          'ride' | 'tip' | 'pooling' | 'wallet_topup' | 'driver_wallet_topup'
 * @param {boolean} [p.mock=false]     mock/dev order — skipped, never counted as revenue
 */
export const mirrorTaxiPayment = async ({
    orderId, paymentId, amount, userId, subjectId, purpose, mock = false,
}) => {
    try {
        if (mock) return;                       // dev bypass orders are not revenue
        if (!userId) {
            logger.warn(`[TaxiPayments] no payer for order ${orderId}; not recorded centrally`);
            return;
        }
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) {
            logger.warn(`[TaxiPayments] non-positive amount (${amount}) for order ${orderId}; not recorded`);
            return;
        }

        await recordPayment({
            vertical: 'taxi',
            userId,
            amount: value,
            method: 'razorpay',
            gateway: 'razorpay',
            status: 'success',                  // only called once the gateway confirmed
            gatewayOrderId: orderId,
            gatewayPaymentId: paymentId,
            ...(subjectId ? { subjectId } : {}),
            metadata: { purpose },
        });
    } catch (err) {
        logger.error(`[TaxiPayments] central record failed for ${orderId} (payment still valid): ${err.message}`);
    }
};
