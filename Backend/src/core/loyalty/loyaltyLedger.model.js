import mongoose from 'mongoose';

/**
 * Loyalty points (plan §5.7). One append-only row per movement:
 *
 *   earn          points for a delivered order; `remaining` is what is left of
 *                 them, consumed oldest-first by burns, zeroed when they expire
 *   burn          points redeemed at checkout
 *   reverse_burn  points given back when an order that redeemed them is
 *                 cancelled (a fresh earn-like row with its own expiry)
 *   expire        the unspent part of an earn row that ran out
 *   adjust        an admin correction (+ adds an earn-like row)
 *
 * Every row has a unique idempotencyKey, so a retried earn, burn or reversal is
 * one row however often it runs. The account is the customer's platform user
 * (core/identity/platformUser.js): points earned on Quick spend on Food.
 */
const loyaltyLedgerSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        vertical: { type: String, default: '' },
        type: {
            type: String,
            required: true,
            enum: ['earn', 'burn', 'reverse_burn', 'expire', 'adjust'],
        },
        /** Always positive; `type` says which way it moved. */
        points: { type: Number, required: true, min: 0 },
        /** Earn-like rows only: points not yet spent or expired. */
        remaining: { type: Number, default: 0, min: 0 },
        expiresAt: { type: Date, default: null },
        orderId: { type: mongoose.Schema.Types.ObjectId, default: null },
        orderRef: { type: String, default: '' },
        /** Rupee value at the time (burns: the discount given). */
        amount: { type: Number, default: 0 },
        idempotencyKey: { type: String, required: true, unique: true },
        note: { type: String, default: '' },
    },
    { collection: 'loyalty_ledger', timestamps: true },
);

loyaltyLedgerSchema.index({ userId: 1, type: 1, remaining: 1, expiresAt: 1, createdAt: 1 });
loyaltyLedgerSchema.index({ userId: 1, createdAt: -1 });

export const LoyaltyLedger = mongoose.models.LoyaltyLedger || mongoose.model('LoyaltyLedger', loyaltyLedgerSchema);
