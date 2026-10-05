import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { forBonus, forOrderRiderEarning, forSourceRow } from './idempotencyKeys.js';

/**
 * Project food and quick-commerce rider money into the master ledger.
 *
 * WHY A PROJECTOR AND NOT A DUAL-WRITE. Taxi has one writer that moves a stored
 * balance, so ledgerMirror copies each movement as it happens. Food and quick
 * commerce have no stored rider balance at all: riderFinance DERIVES it on every
 * read, from whatever state four collections are in right now --
 *
 *   earned     delivered orders' riderEarning
 *   cash       delivered cash orders' pricing.total, less Completed deposits
 *   bonus      bonus rows
 *   withdrawn  pending and approved withdrawals
 *
 * -- and that state is changed by dozens of status writes across both modules.
 * Hooking every one of them would be the "remember forever" problem the activity
 * feed already hit. So instead, this computes what the ledger SHOULD contain for a
 * partner from those same documents, compares it with what the ledger DOES contain,
 * and appends only the difference.
 *
 * CONVERGENT, NOT ONE-SHOT. Every source item has a target -- e.g. an order's target
 * is its riderEarning while delivered and 0 otherwise. The ledger holds a sum per
 * item. A run appends target - sum. So:
 *
 *   - running it twice appends nothing the second time;
 *   - an order that stops being delivered, a withdrawal that is rejected, an earning
 *     edited after delivery, an order reassigned to another rider -- each produces a
 *     correcting entry, never an edit to history;
 *   - two runs racing compute the same revision key, and the unique index lets one
 *     through. If they saw different source states, the next run corrects the loser.
 *
 * KEYS. `<business key>@<owner>` for an item's first entry, `#rev<n>` for each
 * correction. The owner is in the key because the same order can pay two riders over
 * its life (reassignment): the first rider's reversal and the second rider's earning
 * are different movements and must not collide.
 *
 * OWNER. The partner id on the source row, ownerType 'partner'. Stable -- unlike the
 * identity links between partner and driver ids, which can be added later. Merging
 * a person's owners is Phase 3's job.
 *
 * Nothing reads these entries. `reconcilePartner` proves they agree with
 * riderFinance, which stays authoritative.
 */

export const PROJECTOR = 'delivery';

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const EPSILON = 0.005;

/** Collection names used in source-row keys. Fixed strings, not read from models. */
export const SOURCE_COLLECTIONS = Object.freeze({
    food: { deposit: 'food_delivery_cash_deposits', withdrawal: 'food_delivery_withdrawals' },
    quickCommerce: { deposit: 'qc_delivery_cash_deposits', withdrawal: 'qc_delivery_withdrawals' },
});

/**
 * Each source document's target contribution to the ledger. Pure.
 *
 * Mirrors riderFinance's derivation term for term; the reconciler proves it.
 * @returns {Array<{ key, type, jobType, jobId, amount, cash }>}
 */
export const targetsFor = ({ ownerId, vertical, orders = [], deposits = [], bonuses = [], withdrawals = [] }) => {
    const owner = String(ownerId);
    const names = SOURCE_COLLECTIONS[vertical];
    if (!names) throw new Error(`Unknown delivery vertical: ${vertical}`);
    const at = (base) => `${base}@${owner}`;

    const out = [];

    for (const o of orders) {
        // Only orders this partner currently holds. An order moved to someone else
        // has no target here, so any entry it left behind is reversed below.
        if (String(o?.dispatch?.deliveryPartnerId) !== owner) continue;
        const delivered = o.orderStatus === 'delivered';
        out.push({
            key: at(forOrderRiderEarning(o._id)),
            type: 'EARNING',
            jobType: vertical === 'food' ? 'foodDelivery' : 'quickCommerceDelivery',
            jobId: String(o._id),
            amount: delivered ? round2(o.riderEarning) : 0,
            cash: delivered && o?.payment?.method === 'cash' ? round2(o?.pricing?.total) : 0,
        });
    }

    for (const d of deposits) {
        if (String(d.deliveryPartnerId) !== owner) continue;
        out.push({
            key: at(forSourceRow(names.deposit, d._id)),
            type: 'CASH_DEPOSITED',
            jobType: 'cashDeposit',
            jobId: String(d._id),
            amount: 0,
            cash: d.status === 'Completed' ? -round2(d.amount) : 0,
        });
    }

    for (const b of bonuses) {
        if (String(b.deliveryPartnerId) !== owner) continue;
        out.push({
            key: at(forBonus(b._id)),
            type: 'INCENTIVE',
            jobType: 'bonus',
            jobId: String(b._id),
            amount: round2(b.amount),
            cash: 0,
        });
    }

    for (const w of withdrawals) {
        if (String(w.deliveryPartnerId) !== owner) continue;
        // Pending is held as well as approved, exactly as riderFinance subtracts it.
        const held = w.status === 'pending' || w.status === 'approved';
        out.push({
            key: at(forSourceRow(names.withdrawal, w._id)),
            type: 'WITHDRAWAL',
            jobType: 'withdrawal',
            jobId: String(w._id),
            amount: held ? -round2(w.amount) : 0,
            cash: 0,
        });
    }

    return out;
};

/**
 * Compare targets with what the ledger holds, and plan the entries that close the
 * gap. Pure.
 *
 * @param {object} args
 * @param {Array}  args.targets   from targetsFor
 * @param {Array}  args.existing  this projector's ledger entries for the owner
 * @returns {{ entries: object[], items: number, corrections: number }}
 */
export const planProjection = ({ ownerId, vertical, targets, existing = [] }) => {
    const held = new Map();
    for (const e of existing) {
        const key = e?.metadata?.projectionKey;
        if (!key) continue;
        const cur = held.get(key) || { amount: 0, cash: 0, count: 0, type: e.type, jobType: e.jobType, jobId: e.jobId };
        cur.amount = round2(cur.amount + (Number(e.amount) || 0));
        cur.cash = round2(cur.cash + ((Number(e.cashAfter) || 0) - (Number(e.cashBefore) || 0)));
        cur.count += 1;
        held.set(key, cur);
    }

    const wanted = new Map(targets.map((t) => [t.key, t]));
    // Every key the ledger already holds is re-examined, including ones with no
    // target any more: that is how a reassigned order's earning gets reversed.
    const keys = new Set([...wanted.keys(), ...held.keys()]);

    const entries = [];
    let corrections = 0;
    for (const key of keys) {
        const want = wanted.get(key) || { ...held.get(key), key, amount: 0, cash: 0 };
        const have = held.get(key) || { amount: 0, cash: 0, count: 0 };
        const amount = round2(want.amount - have.amount);
        const cash = round2(want.cash - have.cash);
        if (Math.abs(amount) < EPSILON && Math.abs(cash) < EPSILON) continue;

        if (have.count > 0) corrections += 1;
        entries.push({
            ownerType: 'partner',
            ownerId: String(ownerId),
            vertical,
            jobType: want.jobType || '',
            jobId: want.jobId || '',
            type: want.type,
            amount,
            cashDelta: cash,
            idempotencyKey: have.count > 0 ? `${key}#rev${have.count}` : key,
            reason: have.count > 0 ? 'projection correction' : 'projection',
            metadata: { projector: PROJECTOR, projectionKey: key, revision: have.count },
        });
    }

    return { entries, items: keys.size, corrections };
};

/** The ledger's view of one partner in one vertical, from this projector's entries. */
export const foldProjected = (existing = []) => existing.reduce(
    (acc, e) => ({
        balance: round2(acc.balance + (Number(e.amount) || 0)),
        cash: round2(acc.cash + ((Number(e.cashAfter) || 0) - (Number(e.cashBefore) || 0))),
    }),
    { balance: 0, cash: 0 },
);

const toObjectId = (v) => (mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

const loadExisting = async (ownerId, vertical) => {
    const { LedgerEntry } = await import('./ledgerEntry.model.js');
    return LedgerEntry.find({
        ownerType: 'partner',
        ownerId: String(ownerId),
        vertical,
        'metadata.projector': PROJECTOR,
    }).lean();
};

/**
 * Plan -- and with `commit`, apply -- the projection for one partner.
 * Read-only unless commit is true.
 */
export async function projectPartner({ partnerId, vertical, commit = false }) {
    const id = toObjectId(partnerId);
    if (!id) throw new Error(`Invalid partner id: ${partnerId}`);

    const { loadDeliveryModels } = await import('./riderFinance.service.js');
    const { Order, CashDeposit, Withdrawal, Bonus } = await loadDeliveryModels(vertical);

    const [orders, deposits, bonuses, withdrawals, existing] = await Promise.all([
        Order.find({ 'dispatch.deliveryPartnerId': id })
            .select('_id orderStatus riderEarning payment.method pricing.total dispatch.deliveryPartnerId')
            .lean(),
        CashDeposit.find({ deliveryPartnerId: id }).select('_id amount status deliveryPartnerId').lean(),
        Bonus.find({ deliveryPartnerId: id }).select('_id amount deliveryPartnerId').lean(),
        Withdrawal.find({ deliveryPartnerId: id }).select('_id amount status deliveryPartnerId').lean(),
        loadExisting(id, vertical),
    ]);

    const targets = targetsFor({ ownerId: id, vertical, orders, deposits, bonuses, withdrawals });
    const plan = planProjection({ ownerId: id, vertical, targets, existing });

    const result = { partnerId: String(id), vertical, ...plan, appended: 0, duplicates: 0 };
    if (!commit || !plan.entries.length) return result;

    const { append } = await import('./ledger.service.js');
    for (const entry of plan.entries) {
        const r = await append(entry);
        if (r.duplicate) result.duplicates += 1;
        else result.appended += 1;
    }
    return result;
}

/**
 * Does the projected ledger agree with riderFinance for this partner?
 * `pocket` is earned + bonus - withdrawn - pending; `cash` is collected - deposited.
 */
export async function reconcilePartner({ partnerId, vertical }) {
    const { sumDeliveryMoneyForVertical } = await import('./riderFinance.service.js');
    const [derived, existing] = await Promise.all([
        sumDeliveryMoneyForVertical(vertical, [partnerId]),
        loadExisting(partnerId, vertical),
    ]);
    const folded = foldProjected(existing);

    const pocketDrift = round2(folded.balance - derived.pocketBalanceRaw);
    const cashDrift = round2(folded.cash - derived.cashInHandRaw);
    return {
        partnerId: String(partnerId),
        vertical,
        ledger: folded,
        derived: { pocket: derived.pocketBalanceRaw, cash: derived.cashInHandRaw },
        pocketDrift,
        cashDrift,
        clean: Math.abs(pocketDrift) < EPSILON && Math.abs(cashDrift) < EPSILON,
    };
}

/** Every partner id with any delivery money in a vertical. */
export async function listPartnersWithMoney(vertical) {
    const { loadDeliveryModels } = await import('./riderFinance.service.js');
    const { Order, CashDeposit, Withdrawal, Bonus } = await loadDeliveryModels(vertical);
    const { LedgerEntry } = await import('./ledgerEntry.model.js');
    const lists = await Promise.all([
        Order.distinct('dispatch.deliveryPartnerId', { 'dispatch.deliveryPartnerId': { $ne: null } }),
        CashDeposit.distinct('deliveryPartnerId'),
        Withdrawal.distinct('deliveryPartnerId'),
        Bonus.distinct('deliveryPartnerId'),
        // Partners the ledger already holds, so one whose last order moved away is
        // still visited and reversed.
        LedgerEntry.distinct('ownerId', { vertical, 'metadata.projector': PROJECTOR }),
    ]);
    return [...new Set(lists.flat().filter(Boolean).map(String))];
}

export async function projectVertical({ vertical, commit = false, onPartner = () => {} }) {
    const partners = await listPartnersWithMoney(vertical);
    const totals = { vertical, partners: partners.length, entries: 0, corrections: 0, appended: 0, duplicates: 0, failed: 0 };
    for (const partnerId of partners) {
        try {
            const r = await projectPartner({ partnerId, vertical, commit });
            totals.entries += r.entries.length;
            totals.corrections += r.corrections;
            totals.appended += r.appended;
            totals.duplicates += r.duplicates;
            onPartner(r);
        } catch (err) {
            totals.failed += 1;
            logger.error(`[DeliveryLedgerProjector] ${vertical} partner ${partnerId} failed: ${err.message}`);
        }
    }
    return totals;
}
