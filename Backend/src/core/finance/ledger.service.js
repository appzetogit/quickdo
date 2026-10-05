import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { LedgerEntry } from './ledgerEntry.model.js';
import { PartnerBalance } from './partnerBalance.model.js';
import { kindOf } from './idempotencyKeys.js';

/**
 * Move money, once, and record why.
 *
 * The single financial mutation path the audit asked for. Nothing writes through
 * it yet: it is built so the cutover is a matter of pointing existing writers at
 * it, one at a time, while the reconciler below proves the two agree.
 *
 * ---------------------------------------------------------------------------
 * HOW `append` IS MADE ATOMIC, and what that depends on.
 *
 * Two things must happen together or not at all: the balance moves, and a row
 * explains the movement. Split them and either a balance changes with no reason
 * recorded, or a reason is recorded for money that never moved. Both are worse
 * than failing.
 *
 * So both happen inside one MongoDB transaction. **That requires a replica set.**
 * A standalone mongod will throw `Transaction numbers are only allowed on a
 * replica set member or mongos`, and this does not silently fall back to a
 * non-atomic path -- a financial primitive that quietly degrades to "probably
 * fine" is worse than one that refuses to start. The repo already runs
 * transactions in `recordTransaction` and the service-provider wallet flows, so
 * this is the same requirement those already carry.
 *
 * Within the transaction the order is deliberate:
 *
 *   1. `$inc` the balance and read the result back. The increment is applied by
 *      the server, so two concurrent appends cannot lose each other's update --
 *      the read-compute-write that `adminService.adjustDriverWallet` used to do is
 *      exactly the bug this avoids.
 *   2. Insert the entry, with before/after taken from that same increment. The
 *      unique index on `idempotencyKey` means a replay loses here, aborts the
 *      transaction, and the balance change is rolled back with it.
 *
 * Doing it the other way round -- claim the key first, then move the balance --
 * would leave a claimed key with no money moved if step 2 failed, and the retry
 * would then be refused as a duplicate. Money would be permanently lost to a
 * successful-looking no-op.
 */

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const ownerKey = (ownerType, ownerId) => ({ ownerType, ownerId: String(ownerId) });

/**
 * Apply one movement.
 *
 * @param {object} entry
 * @param {string} entry.ownerType   'partner' | 'user' | 'merchant' | 'platform'
 * @param {any}    entry.ownerId
 * @param {string} entry.vertical
 * @param {string} entry.type        a LEDGER_ENTRY_TYPES value
 * @param {number} entry.amount      SIGNED. negative debits. never clamped.
 * @param {number} [entry.cashDelta] change to cash-in-hand, if any
 * @param {string} entry.idempotencyKey  from core/finance/idempotencyKeys.js
 * @param {object} [entry.actor]     { kind, id }
 * @param {string} [entry.reason]
 * @returns {Promise<{applied: boolean, entry: object, duplicate: boolean}>}
 *
 * `applied: false, duplicate: true` is a SUCCESS. It means this exact movement
 * already happened and the caller is holding the original result -- which is what
 * a retry should get, not an error.
 */
export async function append({
    ownerType,
    ownerId,
    vertical,
    jobType = '',
    jobId = '',
    type,
    amount,
    cashDelta = 0,
    idempotencyKey,
    actor = { kind: 'system', id: '' },
    reason = '',
    metadata = {},
} = {}) {
    if (!idempotencyKey) {
        // Without a key there is nothing to make a retry safe, so this is refused
        // rather than written. A ledger row that cannot be deduplicated is a
        // future double-credit with a timestamp on it.
        throw new Error('ledger.append requires an idempotencyKey');
    }
    if (!ownerType || ownerId === undefined || ownerId === null || !vertical || !type) {
        throw new Error('ledger.append requires ownerType, ownerId, vertical and type');
    }

    const signedAmount = round2(amount);
    const signedCash = round2(cashDelta);

    const session = await mongoose.startSession();
    try {
        let result = null;

        await session.withTransaction(async () => {
            const balance = await PartnerBalance.findOneAndUpdate(
                ownerKey(ownerType, ownerId),
                {
                    $inc: { balance: signedAmount, cashInHand: signedCash, version: 1 },
                    $set: { lastEntryAt: new Date() },
                    $setOnInsert: ownerKey(ownerType, ownerId),
                },
                { upsert: true, new: true, session },
            );

            // Derived from the post-increment figure rather than a prior read, so
            // they are correct even when another append committed in between.
            const balanceAfter = round2(balance.balance);
            const balanceBefore = round2(balanceAfter - signedAmount);
            const cashAfter = round2(balance.cashInHand);
            const cashBefore = round2(cashAfter - signedCash);

            const [created] = await LedgerEntry.create(
                [{
                    ownerType,
                    ownerId: String(ownerId),
                    vertical,
                    jobType,
                    jobId: String(jobId || ''),
                    type,
                    amount: signedAmount,
                    balanceBefore,
                    balanceAfter,
                    cashBefore,
                    cashAfter,
                    idempotencyKey,
                    keyKind: kindOf(idempotencyKey) || 'legacy',
                    actor,
                    reason,
                    metadata,
                }],
                { session },
            );

            result = { applied: true, entry: created.toObject(), duplicate: false };
        });

        return result;
    } catch (err) {
        if (err?.code === 11000) {
            /*
             * Somebody already applied this exact movement. The transaction rolled
             * the balance change back with the failed insert, so nothing was double
             * counted -- and the caller gets the ORIGINAL row, because a retry
             * asking "did this happen?" deserves the answer, not an error.
             */
            const existing = await LedgerEntry.findOne({ idempotencyKey }).lean();
            return { applied: false, entry: existing, duplicate: true };
        }
        throw err;
    } finally {
        await session.endSession();
    }
}

/**
 * The truth: what the ledger says this owner's balance is.
 *
 * `version` is returned alongside so the reconciler can compare COUNTS as well as
 * sums -- two errors of opposite sign cancel in a total but not in a count.
 */
export async function foldBalance(ownerType, ownerId) {
    const [row] = await LedgerEntry.aggregate([
        { $match: ownerKey(ownerType, ownerId) },
        {
            $group: {
                _id: null,
                balance: { $sum: '$amount' },
                entries: { $sum: 1 },
                lastEntryAt: { $max: '$createdAt' },
            },
        },
    ]);
    return {
        balance: round2(row?.balance),
        entries: Number(row?.entries) || 0,
        lastEntryAt: row?.lastEntryAt || null,
    };
}

/**
 * Does the stored snapshot still agree with the ledger?
 *
 * This is the gate on the whole cutover. Nothing reads `PartnerBalance` as
 * authoritative until this has come back clean for every owner, on consecutive
 * nights -- because a ledger that disagrees with the balance it is supposed to
 * explain is worse than the five inconsistent sources it replaces: it looks
 * authoritative.
 *
 * Reports the DIFFERENCE, not just a boolean, because the size and sign of a
 * discrepancy is what identifies which writer is missing.
 */
export async function reconcileOwner(ownerType, ownerId) {
    const [folded, snapshot] = await Promise.all([
        foldBalance(ownerType, ownerId),
        PartnerBalance.findOne(ownerKey(ownerType, ownerId)).lean(),
    ]);

    const snapshotBalance = round2(snapshot?.balance);
    const drift = round2(snapshotBalance - folded.balance);
    const versionDrift = (Number(snapshot?.version) || 0) - folded.entries;

    return {
        ownerType,
        ownerId: String(ownerId),
        foldedBalance: folded.balance,
        snapshotBalance,
        drift,
        entries: folded.entries,
        version: Number(snapshot?.version) || 0,
        versionDrift,
        clean: drift === 0 && versionDrift === 0,
    };
}

/**
 * Reconcile every owner that has ledger activity. Returns only the dirty ones --
 * a report nobody reads is a report nobody acts on, so it is short by design.
 */
export async function reconcileAll({ limit = 5000 } = {}) {
    const owners = await LedgerEntry.aggregate([
        { $group: { _id: { ownerType: '$ownerType', ownerId: '$ownerId' } } },
        { $limit: limit },
    ]);

    const dirty = [];
    for (const { _id } of owners) {
        const report = await reconcileOwner(_id.ownerType, _id.ownerId);
        if (!report.clean) dirty.push(report);
    }

    if (dirty.length) {
        logger.error(`LEDGER RECONCILE: ${dirty.length} of ${owners.length} owners disagree with their ledger`);
    } else {
        logger.info(`LEDGER RECONCILE: all ${owners.length} owners agree`);
    }

    return { checked: owners.length, dirty };
}

export const __testables = { round2, ownerKey };
