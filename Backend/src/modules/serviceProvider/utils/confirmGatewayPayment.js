const { razorpayKeyId, razorpayKeySecret } = require('../../../core/settings/platformCredentials.cjs');
const { getPaymentDetails, getOrderDetails } = require('../services/razorpayService');

/**
 * Confirm a Razorpay payment against the gateway.
 *
 * WHY THIS EXISTS
 * A valid razorpay_signature only proves that `order_id|payment_id` came from
 * Razorpay. It says nothing about how much was paid or what was being bought.
 * Every verify endpoint that read the amount — or a planId — out of req.body was
 * therefore exploitable: pay for the ₹99 plan, claim the ₹9999 one.
 *
 * So the amount and the purchase details are read back from the gateway instead.
 * `notes` are set by us at order-creation time and cannot be influenced by the
 * client, which makes them the authoritative record of what the order was for.
 *
 * Returns either:
 *   { ok: true,  amount, notes, payment, mock }
 *   { ok: false, status, message }
 */

/**
 * Dev/mock escape hatch, mirroring verifyPayment()'s existing behaviour of
 * accepting `order_mock_*` ids. Fail-closed: never active in production, so a
 * misconfigured live server rejects payments instead of trusting the client.
 */
const isDevMockOrder = (orderId) => {
  if (process.env.NODE_ENV === 'production') return false;
  const noCredentials = !razorpayKeyId() || !razorpayKeySecret();
  return noCredentials || String(orderId || '').startsWith('order_mock_');
};

/**
 * Mirror a confirmed gateway payment into the shared `payments` collection, so
 * service-provider revenue appears in the cross-vertical totals alongside food and
 * quick-commerce.
 *
 * This is deliberately NOT a move of `sp_transactions`. That collection is a wallet
 * LEDGER -- balanceBefore/balanceAfter, and 17 type values of which most are internal
 * movements (commission, settlement, tds_deduction, earnings_credit). Only a handful
 * are gateway events. The ledger keeps its own collection and is untouched here; this
 * records the gateway payment, which is a different aggregate.
 *
 * Never throws. A reporting write must not be able to fail a payment the customer has
 * already made and the gateway has already captured -- the money moved regardless.
 */
const mirrorToSharedPayments = async ({ orderId, paymentId, amount, notes }) => {
  try {
    const userId = notes?.userId;
    if (!userId) {
      // Nothing to attribute it to. Worth knowing about rather than silently dropping.
      console.warn(`[Payments] no userId in order notes for ${orderId}; not recorded centrally`);
      return;
    }

    // CommonJS module reaching the ESM core.
    const { recordPayment } = await import('../../../core/payments/payments.facade.js');

    await recordPayment({
      vertical: 'serviceProvider',
      userId,
      amount,
      method: 'razorpay',
      gateway: 'razorpay',
      status: 'success',            // only reached once the gateway reports `captured`
      gatewayOrderId: orderId,
      gatewayPaymentId: paymentId,
      ...(notes?.bookingId ? { subjectId: notes.bookingId } : {}),
      metadata: { notes },
    });
  } catch (err) {
    console.error(`[Payments] central record failed for ${orderId} (payment still valid): ${err.message}`);
  }
};

const confirmGatewayPayment = async ({ orderId, paymentId }) => {
  if (isDevMockOrder(orderId)) {
    console.warn(`[Payments] DEV: skipping gateway confirmation for mock order ${orderId}`);
    return { ok: true, mock: true, amount: null, notes: {}, payment: null };
  }

  const paymentRes = await getPaymentDetails(paymentId);
  if (!paymentRes.success || !paymentRes.payment) {
    return { ok: false, status: 502, message: 'Could not confirm payment with the gateway. Please try again.' };
  }

  const payment = paymentRes.payment;

  if (payment.order_id !== orderId) {
    return { ok: false, status: 400, message: 'Payment does not belong to this order' };
  }

  if (payment.status !== 'captured') {
    return { ok: false, status: 400, message: `Payment is not captured (status: ${payment.status})` };
  }

  const amount = Number(payment.amount) / 100; // Razorpay reports paise
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, message: 'Invalid payment amount' };
  }

  // Order notes carry what the server recorded the order was for.
  const orderRes = await getOrderDetails(orderId);
  if (!orderRes.success || !orderRes.order) {
    return { ok: false, status: 502, message: 'Could not confirm the order with the gateway. Please try again.' };
  }

  const notes = orderRes.order.notes || {};

  // Awaited so a failure is logged in request context, but it cannot throw.
  // Mock orders are skipped above -- no real money moved, nothing to report on.
  await mirrorToSharedPayments({ orderId, paymentId, amount, notes });

  return { ok: true, mock: false, amount, notes, payment };
};

module.exports = { confirmGatewayPayment, isDevMockOrder };
