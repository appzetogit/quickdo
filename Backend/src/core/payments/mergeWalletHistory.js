/**
 * One customer transaction history out of the two places it is currently kept.
 *
 * A customer's wallet history lives in two stores that nobody reconciled:
 *
 *   - `food_user_wallets.transactions[]`, an embedded array, which is also what
 *     `balance` is computed from, written by userWallet.service and cashback.service;
 *   - the `transactions` collection, the generic ledger, written by
 *     payment.service and refund.service through `recordTransaction`.
 *
 * `getUserWalletForFrontend` was written to merge them and carried the comment
 *     // Deduplicate by checking if an embedded txn has a matching new txn
 * followed by a plain concatenation. The deduplication was never written.
 *
 * That function turns out to be wired to no route today -- the live customer
 * endpoint reads the embedded array alone -- so this is prevention rather than
 * repair. It is still worth fixing rather than deleting, because a half-written
 * merge is exactly the kind of thing someone wires up later assuming it works.
 *
 * Kept pure and separate so the rule can be checked without a database, and so
 * the real fix (one ledger, Phase 3) has a single place to replace.
 */

/**
 * What makes two rows "the same transaction".
 *
 * NOT the id -- the two stores mint their own, so ids never match and matching on
 * them deduplicates nothing. The identity is the money event: same order, same
 * direction, same amount. Where there is no order to key on (a referral reward, a
 * manual credit) the row is kept, because collapsing two same-amount credits that
 * merely happen to be close together would DELETE a real transaction from the
 * customer's history -- a worse error than showing one twice.
 */
const identityOf = (row) => {
    const orderId = String(row?.orderId ?? row?.metadata?.orderId ?? '').trim();
    if (!orderId) return null;
    const direction = String(row?.type || '').toLowerCase() === 'credit' || row?.type === 'addition'
        ? 'credit'
        : 'debit';
    const amount = Math.round((Number(row?.amount) || 0) * 100);
    return `${orderId}:${direction}:${amount}`;
};

const toTime = (row) => {
    const t = new Date(row?.createdAt ?? row?.date ?? 0).getTime();
    return Number.isFinite(t) ? t : 0;
};

/**
 * @param {Array} ledgerRows    from the `transactions` collection (already shaped for the UI)
 * @param {Array} embeddedRows  from `food_user_wallets.transactions[]` (already shaped)
 * @returns {Array} newest first, each money event once
 *
 * The ledger row wins a tie: it carries `balanceAfter` and a category, so it is
 * strictly more informative than the embedded one it duplicates.
 */
export function mergeWalletHistory(ledgerRows = [], embeddedRows = []) {
    const out = [];
    const seen = new Set();

    for (const row of Array.isArray(ledgerRows) ? ledgerRows : []) {
        const key = identityOf(row);
        if (key) seen.add(key);
        out.push(row);
    }

    for (const row of Array.isArray(embeddedRows) ? embeddedRows : []) {
        const key = identityOf(row);
        // No key means "cannot prove it is a duplicate", and an unprovable
        // duplicate is kept. Losing a real transaction is the worse failure.
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        out.push(row);
    }

    return out.sort((a, b) => toTime(b) - toTime(a));
}

export const __testables = { identityOf, toTime };
