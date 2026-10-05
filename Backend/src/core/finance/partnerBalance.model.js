import mongoose from 'mongoose';

/**
 * The current balance, as a stored number rather than a nightly recomputation.
 *
 * A fold of `ledger_entries` is the TRUTH, but it is not something to run on every
 * dispatch: `riderFinance` already answers this question with four aggregations
 * per call, and that is on the hot path of every candidate query. So the fold is
 * the authority and this is the answer -- with the reconciler's job being to prove
 * they still agree.
 *
 * `version` increments on every applied entry. It is not optimistic locking (the
 * `$inc` is atomic on its own); it is a cheap way for the reconciler to say "this
 * snapshot has seen N movements" and compare against the ledger's own count, which
 * catches a missing entry that a balance comparison alone would not -- two errors
 * of opposite sign cancel in a sum but not in a count.
 */
const partnerBalanceSchema = new mongoose.Schema(
    {
        ownerType: { type: String, required: true },
        ownerId: { type: String, required: true },

        /** SIGNED, never clamped. Negative means the partner owes the platform. */
        balance: { type: Number, default: 0 },
        /** Platform cash physically in their pocket, across every vertical. */
        cashInHand: { type: Number, default: 0 },

        version: { type: Number, default: 0 },
        lastEntryAt: { type: Date, default: null },
    },
    { collection: 'partner_balances', timestamps: true },
);

partnerBalanceSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });

export const PartnerBalance =
    mongoose.models.PartnerBalance || mongoose.model('PartnerBalance', partnerBalanceSchema);
