/**
 * A seller's earnings day by day, for the Earnings dashboard.
 *
 * Shared by restaurants (Food) and by stores and medical stores (quick
 * commerce): each caller hands in its own order and transaction models, which
 * read the same fields.
 *
 * Counted per Indian calendar day, by when the order was placed. Only orders
 * that reached the customer earn anything; cancelled ones are counted
 * separately so the owner sees what was lost. An order's earning is the
 * restaurantShare its ledger transaction recorded -- the figure payouts are
 * made from -- and, for an order with no transaction yet, its subtotal and
 * packaging less commission.
 */
import mongoose from 'mongoose';

const TZ = 'Asia/Kolkata';
const ALLOWED_DAYS = [7, 30, 90];
const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD

/** Midnight in India for the day `offset` days from today, as a Date. */
const istMidnight = (offset = 0) => {
    const key = dayKey(Date.now() + offset * DAY_MS);
    return new Date(`${key}T00:00:00+05:30`);
};

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lower = (v) => String(v || '').trim().toLowerCase();

const isCancelled = (order) => {
    const status = lower(order?.orderStatus || order?.status);
    return status.startsWith('cancel') || status === 'rejected' || status === 'refunded';
};

const isDelivered = (order) => {
    if (isCancelled(order)) return false;
    const status = lower(order?.orderStatus || order?.status);
    const phase = lower(order?.deliveryState?.currentPhase);
    return status === 'delivered' || status === 'completed' || phase === 'delivered' || phase === 'completed';
};

const emptyDay = (date) => ({ date, orders: 0, cancelled: 0, sales: 0, commission: 0, earnings: 0 });

const add = (bucket, row) => {
    bucket.orders += row.orders;
    bucket.cancelled += row.cancelled;
    bucket.sales += row.sales;
    bucket.commission += row.commission;
    bucket.earnings += row.earnings;
};

const round = (row) => ({
    ...row,
    sales: money(row.sales),
    commission: money(row.commission),
    earnings: money(row.earnings),
    averageOrder: row.orders ? money(row.sales / row.orders) : 0,
});

export const createSellerDailyEarnings = ({ Order, Transaction }) => async (sellerId, query = {}) => {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) return null;
    const rid = new mongoose.Types.ObjectId(String(sellerId));
    const days = ALLOWED_DAYS.includes(Number(query.days)) ? Number(query.days) : 30;

    const rangeStart = istMidnight(-(days - 1));
    const todayKey = dayKey(Date.now());
    const monthStart = new Date(`${todayKey.slice(0, 8)}01T00:00:00+05:30`);
    const from = rangeStart < monthStart ? rangeStart : monthStart;

    const orders = await Order.find({ restaurantId: rid, createdAt: { $gte: from } })
        .select('orderStatus status deliveryState pricing createdAt')
        .lean();

    const txs = orders.length
        ? await Transaction.find({ orderId: { $in: orders.map((o) => o._id) } })
            .select('orderId amounts.restaurantShare amounts.restaurantCommission')
            .lean()
        : [];
    const txByOrder = new Map(txs.map((t) => [String(t.orderId), t]));

    const byDay = new Map();
    for (const order of orders) {
        const key = dayKey(order.createdAt);
        if (!byDay.has(key)) byDay.set(key, emptyDay(key));
        const bucket = byDay.get(key);
        if (isCancelled(order)) {
            bucket.cancelled += 1;
            continue;
        }
        if (!isDelivered(order)) continue; // still on its way: not earned yet
        const pricing = order.pricing || {};
        const tx = txByOrder.get(String(order._id));
        const subtotal = Number(pricing.subtotal) || 0;
        const packaging = Number(pricing.packagingFee) || 0;
        const commission = Number(tx?.amounts?.restaurantCommission ?? pricing.restaurantCommission) || 0;
        const stored = Number(tx?.amounts?.restaurantShare);
        bucket.orders += 1;
        bucket.sales += subtotal + packaging;
        bucket.commission += commission;
        bucket.earnings += Number.isFinite(stored) ? stored : subtotal + packaging - commission;
    }

    // Every day of the range, oldest first, including days with no orders.
    const daily = [];
    for (let i = days - 1; i >= 0; i -= 1) {
        const key = dayKey(Date.now() - i * DAY_MS);
        daily.push(round(byDay.get(key) || emptyDay(key)));
    }

    const total = (keys) => {
        const sum = emptyDay(null);
        for (const key of keys) if (byDay.has(key)) add(sum, byDay.get(key));
        const { date, ...rest } = round(sum);
        return rest;
    };
    const lastN = (n) => Array.from({ length: n }, (_, i) => dayKey(Date.now() - i * DAY_MS));
    const monthKeys = [...byDay.keys()].filter((k) => k.slice(0, 7) === todayKey.slice(0, 7));

    return {
        days,
        timezone: TZ,
        summary: {
            today: total([todayKey]),
            yesterday: total([dayKey(Date.now() - DAY_MS)]),
            last7Days: total(lastN(7)),
            thisMonth: total(monthKeys),
            range: total(daily.map((d) => d.date)),
        },
        daily,
    };
};
