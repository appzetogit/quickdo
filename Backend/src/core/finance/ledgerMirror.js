import { logger } from '../../utils/logger.js';
import { recordFailedFinancialOperation } from './deadLetter.js';
import { forSourceRow } from './idempotencyKeys.js';

/**
 * Phase 0 dual-write: copy a movement an EXISTING wallet writer already committed
 * into the master ledger.
 *
 * The old writer stays authoritative. Nothing reads the ledger. The point is to
 * accumulate evidence -- every source row has exactly one ledger entry with the
 * same amount -- before any read is moved over.
 *
 * Three rules, each a way this could otherwise make things worse:
 *
 * 1. IT CANNOT FAIL THE SOURCE. The mirror runs after the wallet write, is not
 *    awaited by the caller, and swallows its own errors into the dead letter. A
 *    rider's settlement must never fail because its copy could not be written.
 *
 * 2. IT NEVER RECORDS A MOVEMENT THAT DID NOT HAPPEN. Most taxi wallet writes run
 *    inside the caller's transaction, and the caller can still abort after the
 *    wallet row is created. Mirroring at that point would put money in the ledger
 *    that the wallet rolled back. So inside a transaction the mirror is queued on
 *    the session and written only when THAT transaction's commit succeeds. An
 *    attempt withTransaction aborted and retried is a different Transaction object,
 *    so its entries are dropped, not written.
 *
 * 3. A REPLAY IS HARMLESS. The key names the source row (forSourceRow), so a
 *    dead-letter replay, or a Phase 3 backfill that overlaps the live mirror, lands
 *    on the unique index and returns the original entry.
 *
 * WHAT THE LEDGER BALANCE MEANS DURING DUAL-WRITE: net movement since mirroring
 * began, not the wallet balance. Opening balances arrive with the Phase 3 backfill.
 * Compare rows with reconcileTaxiWalletMirror below, not balances.
 *
 * Off unless LEDGER_DUAL_WRITE_ENABLED=true. append() needs a replica set, which
 * Atlas always is -- but confirm before enabling.
 */

export const isLedgerDualWriteEnabled = () =>
    String(process.env.LEDGER_DUAL_WRITE_ENABLED || '').toLowerCase() === 'true';

/** Taxi wallettransactions.type -> ledger entry type. */
export const TAXI_WALLET_TYPE_TO_LEDGER = Object.freeze({
    ride_earning: 'EARNING',
    commission_deduction: 'COMMISSION',
    top_up: 'TOPUP',
    adjustment: 'ADJUSTMENT',
});

const PENDING = Symbol('ledgerMirrorPending');

/**
 * Build the ledger entry for a taxi wallet transaction row. Pure, for the checks.
 * Returns null for a row that moved nothing -- a cash tip records amount 0 and is
 * not a wallet movement.
 */
export const taxiWalletRowToEntry = (row) => {
    if (!row?._id) return null;
    const amount = Math.round((Number(row.amount) || 0) * 100) / 100;
    if (!amount) return null;
    return {
        ownerType: 'partner',
        ownerId: String(row.driverId),
        vertical: 'taxi',
        jobType: row.rideId ? 'ride' : '',
        jobId: row.rideId ? String(row.rideId) : '',
        type: TAXI_WALLET_TYPE_TO_LEDGER[row.type] || 'ADJUSTMENT',
        amount,
        idempotencyKey: forSourceRow('wallettransactions', row._id),
        reason: row.description || '',
        metadata: {
            source: 'wallettransactions',
            sourceRowId: String(row._id),
            sourceType: row.type,
            sourceBalanceAfter: row.balanceAfter,
        },
    };
};

const write = async (entry) => {
    try {
        // Imported lazily so the writers that call this do not load the ledger
        // models -- or need a replica set -- while the flag is off.
        const { append } = await import('./ledger.service.js');
        return await append(entry);
    } catch (err) {
        await recordFailedFinancialOperation({
            operation: 'ledger_mirror',
            vertical: entry.vertical,
            entityType: entry.ownerType,
            entityId: entry.ownerId,
            amount: entry.amount,
            orderId: entry.jobId,
            payload: entry,
            error: err,
            consequence: 'UNMIRRORED',
        });
        return null;
    }
};

/*
 * Flush on COMMIT, not on session end, and never infer the outcome from state.
 *
 * Both obvious alternatives were tried against a real replica set and were wrong:
 *
 *   - Reading `transaction.isCommitted` at session end mirrored an ABORTED
 *     transaction. That getter is deprecated and counts TRANSACTION_ABORTED as
 *     "committed"; the driver also resets a finished transaction's state to
 *     NO_TRANSACTION when the session is next used outside one.
 *   - Flushing only the final transaction at session end dropped an earlier
 *     transaction that committed on the same session.
 *
 * So the session's commitTransaction is wrapped on first use. When it resolves,
 * entries queued by THAT transaction are written; entries left over from any other
 * transaction on the session belonged to one that aborted (a new startTransaction
 * replaces the Transaction object) and are dropped. withTransaction commits through
 * this.commitTransaction(), so it is covered, retries included. Whatever is still
 * queued when the session ends was never committed.
 */
const drop = (items, why) => {
    for (const { entry } of items) {
        logger.info(`[LedgerMirror] dropped ${entry.idempotencyKey}: ${why}`);
    }
};

const hookSession = (session) => {
    session[PENDING] = [];
    const originalCommit = session.commitTransaction.bind(session);

    session.commitTransaction = async (...args) => {
        const committing = session.transaction;
        const result = await originalCommit(...args);
        const queued = session[PENDING] || [];
        session[PENDING] = [];
        const mine = queued.filter((q) => q.transaction === committing);
        drop(queued.filter((q) => q.transaction !== committing), 'its transaction was aborted');
        // Kept on the session only so tests can wait for the writes.
        session.__ledgerMirrorFlush = Promise.all(mine.map((q) => write(q.entry)));
        return result;
    };

    session.once('ended', () => {
        drop(session[PENDING] || [], 'its transaction never committed');
        session[PENDING] = [];
    });
};

/**
 * Mirror one entry. Returns a promise the CALLER SHOULD NOT AWAIT on a hot path;
 * it resolves to the append result, or null when queued, skipped or failed.
 */
export const mirrorToLedger = (entry, { session = null } = {}) => {
    if (!entry || !isLedgerDualWriteEnabled()) return Promise.resolve(null);

    if (session && session.inTransaction?.()) {
        if (!session[PENDING]) hookSession(session);
        session[PENDING].push({ entry, transaction: session.transaction });
        return Promise.resolve(null);
    }

    return write(entry);
};

/**
 * The dual-write's own reconciler: every source row in the window has exactly one
 * ledger entry, with the same owner and amount. Row-by-row rather than by balance,
 * because the ledger has no opening balances yet -- and because two errors of
 * opposite sign cancel in a sum but not in a list.
 *
 * @returns {{ checked, missing: object[], mismatched: object[], clean: boolean }}
 */
export async function reconcileTaxiWalletMirror({ since, until = new Date(), limit = 5000 } = {}) {
    if (!since) throw new Error('reconcileTaxiWalletMirror requires since: the date mirroring was enabled');

    const { WalletTransaction } = await import('../../modules/taxi/driver/models/WalletTransaction.js');
    const { LedgerEntry } = await import('./ledgerEntry.model.js');

    const rows = await WalletTransaction.find({ createdAt: { $gte: since, $lte: until }, amount: { $ne: 0 } })
        .sort({ createdAt: 1 })
        .limit(limit)
        .lean();

    const expected = rows.map(taxiWalletRowToEntry).filter(Boolean);
    const entries = await LedgerEntry.find({ idempotencyKey: { $in: expected.map((e) => e.idempotencyKey) } }).lean();
    const byKey = new Map(entries.map((e) => [e.idempotencyKey, e]));

    const missing = [];
    const mismatched = [];
    for (const want of expected) {
        const got = byKey.get(want.idempotencyKey);
        if (!got) { missing.push(want); continue; }
        if (got.amount !== want.amount || got.ownerId !== want.ownerId) {
            mismatched.push({ key: want.idempotencyKey, expected: want.amount, recorded: got.amount });
        }
    }

    const clean = missing.length === 0 && mismatched.length === 0;
    const summary = `LEDGER MIRROR (taxi): ${expected.length} rows, ${missing.length} missing, ${mismatched.length} mismatched`;
    if (clean) logger.info(summary); else logger.error(summary);

    return { checked: expected.length, missing, mismatched, clean };
}

export const __testables = { PENDING, hookSession };
