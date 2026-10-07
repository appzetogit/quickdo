import mongoose from 'mongoose';

/**
 * Customer analytics for a vendor (plan §5.9): who buys, how often, and who
 * the best customers are. Shared by every store vertical; each passes its own
 * order and customer models.
 *
 *   newCustomers        first order with this vendor falls inside the window
 *   returningCustomers  ordered from this vendor before the window too
 *   repeatCustomers     two or more orders inside the window
 *   topCustomers        by spend inside the window, with order count, first
 *                       and last order. Phone numbers are masked: the vendor
 *                       sees who, not how to reach them outside the platform.
 *
 * Delivered orders only, like the rest of the vendor's sales figures.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const maskPhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 4) return '';
    return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`.slice(-10);
};

export async function customerAnalytics({ OrderModel, UserModel = null, storeId, from, to, limit = 10 }) {
    const sid = new mongoose.Types.ObjectId(String(storeId));
    const base = { restaurantId: sid, orderStatus: 'delivered' };

    const perCustomer = await OrderModel.aggregate([
        { $match: { ...base, createdAt: { $gte: from, $lte: to }, userId: { $ne: null } } },
        {
            $group: {
                _id: '$userId',
                orders: { $sum: 1 },
                spend: { $sum: '$pricing.total' },
                firstOrderAt: { $min: '$createdAt' },
                lastOrderAt: { $max: '$createdAt' },
                name: { $last: '$customerName' },
                phone: { $last: '$customerPhone' },
            },
        },
    ]);

    const ids = perCustomer.map((r) => r._id);
    const returning = ids.length
        ? await OrderModel.distinct('userId', { ...base, userId: { $in: ids }, createdAt: { $lt: from } })
        : [];
    const returningSet = new Set(returning.map(String));

    const top = [...perCustomer].sort((a, b) => b.spend - a.spend || b.orders - a.orders).slice(0, Math.min(Math.max(Number(limit) || 10, 1), 50));
    let users = new Map();
    if (UserModel && top.length) {
        const rows = await UserModel.find({ _id: { $in: top.map((t) => t._id) } }).select('name fullName phone').lean();
        users = new Map(rows.map((u) => [String(u._id), u]));
    }

    const repeat = perCustomer.filter((r) => r.orders >= 2).length;
    const total = perCustomer.length;
    return {
        totalCustomers: total,
        newCustomers: total - returningSet.size,
        returningCustomers: returningSet.size,
        repeatCustomers: repeat,
        repeatRatePercent: total > 0 ? round2((repeat / total) * 100) : 0,
        topCustomers: top.map((r) => {
            const u = users.get(String(r._id));
            return {
                customerId: String(r._id),
                name: u?.name || u?.fullName || r.name || 'Customer',
                phone: maskPhone(u?.phone || r.phone),
                orders: r.orders,
                spend: round2(r.spend),
                averageOrderValue: r.orders > 0 ? round2(r.spend / r.orders) : 0,
                firstOrderAt: r.firstOrderAt,
                lastOrderAt: r.lastOrderAt,
                isNew: !returningSet.has(String(r._id)),
            };
        }),
    };
}
