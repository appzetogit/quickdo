const mongoose = require('mongoose');

/**
 * One row per Razorpay payment id consumed by ANY service-provider money flow.
 *
 * WHY THIS EXISTS
 * Each verify endpoint used to guard replays with its own ledger lookup
 * (`Transaction.findOne({ referenceId, type: 'credit' })` etc). Those checks are
 * scoped to ONE flow's ledger type, so a payment already consumed by another
 * flow -- a booking payment, a plan purchase, a dues settlement -- sailed past
 * them and was credited a second time. A unique index on the payment id makes
 * "this payment has been used" a single platform-wide fact: whichever flow
 * inserts the receipt first owns the payment, and every other flow is refused.
 */
const spPaymentReceiptSchema = new mongoose.Schema({
  paymentId: { type: String, required: true, unique: true },
  orderId: { type: String, default: null },
  // What the payment was consumed for: 'wallet_topup', 'worker_dues', ...
  purpose: { type: String, required: true },
  // The account the payment was applied to (SP user / worker id).
  ownerId: { type: String, required: true },
  amount: { type: Number, default: null }
}, { timestamps: true });

module.exports = mongoose.models.SpPaymentReceipt
  || mongoose.model('SpPaymentReceipt', spPaymentReceiptSchema, 'sp_payment_receipts');
