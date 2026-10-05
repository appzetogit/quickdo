import mongoose from 'mongoose';
import { KEY_KINDS } from './idempotencyKeys.js';

/**
 * One row per movement of money. The thing the platform does not currently have.
 *
 * Today a partner's balance is answered five different ways -- derived from orders
 * (food), from a stored field (quick commerce), from a signed embedded number
 * (taxi), from SP's own Transaction collection, and from `core/payments`' generic
 * ledger which only runs when BullMQ is on. None of them can answer "why did this
 * change?", because none of them records the movement, only the result.
 *
 * The shape here is deliberately NOT new. It is `WalletTransaction` -- the best
 * ledger in the repo, taxi's -- with the three fields it was missing:
 *
 *     vertical         which business the money came from
 *     idempotencyKey   what makes a retry harmless (UNIQUE)
 *     actor            who or what caused it
 *
 * and one rule it did not enforce.
 *
 * ---------------------------------------------------------------------------
 * THE RULE: amount is SIGNED, and `balanceAfter - balanceBefore === amount`.
 *
 * That equation is the entire value of a ledger. It is what makes the balance
 * reconstructible, which is what makes a discrepancy findable. The repo already
 * contains a row that breaks it -- a cash tip written with a non-zero amount and
 * identical before/after -- and folding that collection would have overstated
 * every driver's balance by their lifetime tips, with the Phase 3 reconciler
 * flagging every tipped driver and no way to tell a real problem from the noise.
 * So it is enforced in a pre-save hook rather than trusted.
 *
 * A movement that genuinely does not touch the wallet -- cash handed over in
 * person -- records amount 0 and carries its figure in metadata. It is still a
 * fact worth recording; it is just not a wallet movement.
 *
 * ---------------------------------------------------------------------------
 * NEGATIVE BALANCES ARE NORMAL HERE.
 *
 * Nothing in this model clamps. `balanceAfter` may be negative, and a debit that
 * takes a partner below zero is recorded rather than refused -- unlike
 * `transaction.service.recordTransaction`, which throws and therefore declines to
 * record a debt that really exists. Whether a negative balance stops a partner
 * WORKING is a different question, asked of eligibilityRules, not of this table.
 */

export const LEDGER_OWNER_TYPES = Object.freeze(['partner', 'user', 'merchant', 'platform']);

export const LEDGER_VERTICALS = Object.freeze(['food', 'quickCommerce', 'taxi', 'serviceProvider', 'platform']);

export const LEDGER_ENTRY_TYPES = Object.freeze([
    'EARNING',
    'CASH_COLLECTED',
    'CASH_DEPOSITED',
    'SETTLEMENT',
    'WITHDRAWAL',
    'REFUND',
    'COMMISSION',
    'PLATFORM_FEE',
    'ADJUSTMENT',
    'PENALTY',
    'INCENTIVE',
    'TOPUP',
    'NON_WALLET',
]);

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const ledgerEntrySchema = new mongoose.Schema(
    {
        ownerType: { type: String, enum: LEDGER_OWNER_TYPES, required: true },
        /** String, not ObjectId: 'platform' is a legitimate owner and has no id. */
        ownerId: { type: String, required: true },

        vertical: { type: String, enum: LEDGER_VERTICALS, required: true },
        jobType: { type: String, default: '' },
        jobId: { type: String, default: '' },

        type: { type: String, enum: LEDGER_ENTRY_TYPES, required: true },

        /** SIGNED. Negative is a debit. Never clamped, at any layer. */
        amount: { type: Number, required: true },
        currency: { type: String, default: 'INR' },

        balanceBefore: { type: Number, required: true },
        /**
         * The invariant lives here, as a path validator rather than a
         * `pre('validate')` hook.
         *
         * Hooks are async middleware and `validateSync()` skips them entirely -- so
         * a hook would have looked like enforcement while quietly validating
         * nothing on any synchronous path. A path validator runs in both.
         */
        balanceAfter: {
            type: Number,
            required: true,
            validate: {
                validator(value) {
                    // `this` is the document inside a validator. It is NOT inside a
                    // message function, so the numbers are folded into the message
                    // here rather than recomputed there.
                    const delta = round2(Number(value) - Number(this.balanceBefore));
                    const amount = round2(this.amount);
                    if (delta === amount) return true;
                    this.$locals.balanceDeltaDetail = `delta ${delta} !== amount ${amount}`;
                    return false;
                },
                message: (props) =>
                    `Ledger invariant violated on balanceAfter=${props.value}: the balance delta does not equal `
                    + `amount. A movement that does not touch the wallet must record amount 0 and carry its `
                    + `figure in metadata.`,
            },
        },

        /** Cash in hand, tracked alongside the wallet because they move separately. */
        cashBefore: { type: Number, default: 0 },
        cashAfter: { type: Number, default: 0 },

        /**
         * What makes a retry harmless. Unique, and the reason this collection can be
         * written from a webhook, a queue retry and a double-tapped button without
         * the money moving three times. Minted by core/finance/idempotencyKeys.js.
         */
        idempotencyKey: { type: String, required: true },
        keyKind: { type: String, enum: [...KEY_KINDS, 'legacy', 'legacy_ref'], default: 'legacy' },

        actor: {
            kind: { type: String, enum: ['system', 'admin', 'partner', 'user', 'provider'], default: 'system' },
            id: { type: String, default: '' },
        },
        reason: { type: String, default: '' },

        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { collection: 'ledger_entries', timestamps: true },
);

/*
 * The uniqueness that does the work.
 *
 * Application-level "check then write" is two steps with a gap that two concurrent
 * callers both walk through -- which is exactly how the existing
 * `applyDriverWalletAdjustmentByReference` can double-credit a settlement. Here
 * the WRITE is the claim: the loser of a race gets E11000 and reads back the
 * winner's row.
 *
 * NOT created automatically on an existing collection: the backfill has to stamp
 * every historical row first, and it must report zero collisions, or this index
 * will refuse to build. See scripts/backfill-wallet-idempotency-keys.js.
 */
ledgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
ledgerEntrySchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
ledgerEntrySchema.index({ vertical: 1, createdAt: -1 });
ledgerEntrySchema.index({ jobId: 1 });

export const LedgerEntry =
    mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', ledgerEntrySchema);

export const __testables = { round2 };
