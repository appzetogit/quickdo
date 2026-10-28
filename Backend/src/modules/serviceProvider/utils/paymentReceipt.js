const SpPaymentReceipt = require('../models/SpPaymentReceipt');

/**
 * Claim a gateway payment id for exactly one purpose and owner.
 *
 * Inserted BEFORE any money moves, and outside the crediting transaction on
 * purpose: the unique index must be visible to concurrent requests at once, not
 * only after a commit. If the crediting step then fails, call releasePaymentReceipt
 * so a genuine retry can go through.
 *
 * Returns one of:
 *   { status: 'claimed' }                 -- first use, go ahead and credit
 *   { status: 'duplicate', receipt }      -- same owner + purpose already consumed it
 *   { status: 'conflict',  receipt }      -- consumed by another purpose or account
 */
const claimPaymentReceipt = async ({ paymentId, orderId = null, purpose, ownerId, amount = null }) => {
  if (!paymentId || !purpose || !ownerId) {
    throw new Error('claimPaymentReceipt: paymentId, purpose and ownerId are required');
  }
  try {
    await SpPaymentReceipt.create({
      paymentId: String(paymentId),
      orderId: orderId ? String(orderId) : null,
      purpose,
      ownerId: String(ownerId),
      amount
    });
    return { status: 'claimed' };
  } catch (err) {
    if (err && err.code === 11000) {
      const receipt = await SpPaymentReceipt.findOne({ paymentId: String(paymentId) }).lean();
      if (receipt && receipt.purpose === purpose && String(receipt.ownerId) === String(ownerId)) {
        return { status: 'duplicate', receipt };
      }
      return { status: 'conflict', receipt };
    }
    throw err;
  }
};

/** Undo a claim whose crediting step failed. Never throws. */
const releasePaymentReceipt = async ({ paymentId, purpose, ownerId }) => {
  try {
    await SpPaymentReceipt.deleteOne({ paymentId: String(paymentId), purpose, ownerId: String(ownerId) });
  } catch (err) {
    console.error(`[PaymentReceipt] could not release ${paymentId}: ${err.message}`);
  }
};

module.exports = { claimPaymentReceipt, releasePaymentReceipt };
