import mongoose from 'mongoose';

/**
 * One row per night the ledger was reconciled.
 *
 * Two jobs. The unique `night` is the claim: several API instances share this
 * cluster, and the insert that wins is the one that runs, so the ledger is
 * projected and reconciled once per night however many processes are up.
 *
 * And it is the evidence. The plan moves no read to the ledger until reconciliation
 * has been clean for fourteen consecutive nights; `cleanStreak` is that number,
 * readable with one query instead of reconstructed from logs.
 */
const ledgerReconcileRunSchema = new mongoose.Schema(
    {
        /** IST calendar date, YYYY-MM-DD. */
        night: { type: String, required: true },
        status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
        startedAt: { type: Date, default: Date.now },
        finishedAt: { type: Date, default: null },
        host: { type: String, default: '' },

        clean: { type: Boolean, default: false },
        cleanStreak: { type: Number, default: 0 },

        /** What ran, and what it found. Shape documented in ledgerNightly.js. */
        report: { type: mongoose.Schema.Types.Mixed, default: {} },
        error: { type: String, default: '' },
    },
    { collection: 'ledger_reconcile_runs', timestamps: true },
);

ledgerReconcileRunSchema.index({ night: 1 }, { unique: true });

export const LedgerReconcileRun =
    mongoose.models.LedgerReconcileRun || mongoose.model('LedgerReconcileRun', ledgerReconcileRunSchema);
