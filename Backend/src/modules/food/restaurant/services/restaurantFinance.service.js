import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodRestaurantWithdrawal } from '../models/foodRestaurantWithdrawal.model.js';
import { getRestaurantWithdrawalSettings } from '../../admin/services/admin.service.js';
import { getRestaurantCommissionSnapshot } from '../../orders/services/foodTransaction.service.js';
import { COMMISSION_SOURCES } from '../../shared/commissionSchedule.js';

function toTwoDigitYearString(dateObj) {
    const y = String(dateObj.getFullYear());
    return y.slice(-2);
}

function monthShort(monthIndex) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthIndex] || 'Jan';
}

function getFixedCurrentCycleWindow(now = new Date()) {
    const startDay = 15;
    
    let year = now.getFullYear();
    let month = now.getMonth();

    // If before start day, settlement belongs to previous month cycle.
    if (now.getDate() < startDay) {
        month = month - 1;
        if (month < 0) {
            month = 11;
            year -= 1;
        }
    }

    const start = new Date(year, month, startDay, 0, 0, 0, 0);
    // End should be either fixed 21 or now, let's make it more inclusive for "Current Cycle"
    // Users want to see their active earnings, so we extend it to 'now'
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    return {
        start,
        end,
        startMeta: { day: String(startDay), month: monthShort(month), year: toTwoDigitYearString(new Date(year, month, startDay)) },
        endMeta: { day: String(now.getDate()), month: monthShort(now.getMonth()), year: toTwoDigitYearString(now) }
    };
}

function parseISODateParam(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

function parseISODateParamEnd(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
}

/**
 * What a restaurant has earned and what has been paid or queued against it.
 *
 * Split out of getRestaurantFinance so the admin's withdrawal approval can
 * re-check the balance from the same arithmetic the restaurant sees. It needs
 * `unpaid` (earned - approved), which the clamped `available` figure cannot
 * give back: a restaurant over-queued by a race reads available 0 either way.
 */
export async function getRestaurantPayoutPosition(restaurantId) {
    const rid = new mongoose.Types.ObjectId(String(restaurantId));

    // Global estimated payout (all unsettled transactions)
    const allUnsettledTransactions = await FoodTransaction.find({
        restaurantId: rid,
        status: { $in: ['captured', 'authorized'] },
        'settlement.isRestaurantSettled': { $ne: true }
    }).select('amounts.restaurantShare').lean();

    const globalEstimatedPayout = allUnsettledTransactions.reduce(
        (sum, tx) => sum + (Number(tx.amounts?.restaurantShare) || 0),
        0
    );

    /*
     * Money already paid out has to stay deducted.
     *
     * globalEstimatedPayout above is every unsettled transaction the restaurant
     * has ever earned on -- nothing marks a transaction settled, so it only
     * grows. Deducting pending requests alone meant the balance dropped while a
     * request sat in the queue and sprang back the moment an admin approved it:
     * a restaurant paid Rs 3000 saw Rs 3000 available again and could request
     * the same earnings indefinitely.
     *
     * Rejected requests are correctly excluded -- no money left, so nothing is
     * owed against them. This mirrors deliveryFinance.service.js, which has
     * always subtracted approved and pending separately.
     */
    const status = { $toLower: { $trim: { input: '$status' } } };
    const withdrawalsAgg = await FoodRestaurantWithdrawal.aggregate([
        { $match: { restaurantId: rid } },
        {
            $group: {
                _id: null,
                pending: { $sum: { $cond: [{ $eq: [status, 'pending'] }, '$amount', 0] } },
                approved: { $sum: { $cond: [{ $eq: [status, 'approved'] }, '$amount', 0] } },
            }
        }
    ]);
    const pending = Number(withdrawalsAgg?.[0]?.pending || 0);
    const approved = Number(withdrawalsAgg?.[0]?.approved || 0);
    const round2 = (n) => Math.round(n * 100) / 100;

    return {
        earned: round2(globalEstimatedPayout),
        pending: round2(pending),
        approved: round2(approved),
        available: Math.max(0, globalEstimatedPayout - pending - approved),
        unpaid: round2(globalEstimatedPayout - approved),
    };
}

export async function getRestaurantFinance(restaurantId, query = {}) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) return null;
    const rid = new mongoose.Types.ObjectId(restaurantId);

    // Fetch restaurant profile for header display.
    const restaurant = await FoodRestaurant.findById(rid)
        .select('restaurantName addressLine1 addressLine2 area city state pincode location')
        .lean();

    const address =
        restaurant?.location?.formattedAddress ||
        (restaurant?.addressLine1
            ? [restaurant.addressLine1, restaurant.addressLine2, restaurant.area].filter(Boolean).join(', ')
            : restaurant?.addressLine1 || '');

    const nowWindow = getFixedCurrentCycleWindow(new Date());

    // Current cycle: sum ledger payouts in the fixed window.
    const currentTransactions = await FoodTransaction.find({
        restaurantId: rid,
        status: { $in: ['captured', 'authorized'] },
        createdAt: { $gte: nowWindow.start, $lte: nowWindow.end }
    })
        .populate('orderId', 'orderId createdAt items pricing deliveryState orderStatus')
        .sort({ createdAt: -1 })
        .lean();

    const currentCycleOrders = currentTransactions.map((tx) => {
        const order = tx.orderId || {};
        const items = Array.isArray(order.items) ? order.items : [];
        const foodNames = items.map((it) => it?.name).filter(Boolean).join(', ');
        const orderTotalExclTax = Math.max(
            0,
            Number(order?.pricing?.total ?? 0) - Number(order?.pricing?.tax ?? 0) || 0
        );
        return {
            orderId: order?.orderId || tx.orderReadableId,
            createdAt: tx.createdAt,
            items,
            foodNames,
            orderTotal: orderTotalExclTax,
            totalAmount: tx.amounts?.totalCustomerPaid || 0,
            payout: tx.amounts?.restaurantShare || 0,
            commission: tx.amounts?.restaurantCommission || 0,
            paymentMethod: tx.paymentMethod || order?.payment?.method,
            orderStatus: order?.orderStatus || order?.deliveryState?.currentPhase || order?.deliveryState?.status,
            status: tx.status
        };
    });

    const currentCycleEstimatedPayout = currentCycleOrders.reduce(
        (sum, o) => sum + (Number(o.payout) || 0),
        0
    );

    // Counted from the same set getRestaurantPayoutPosition sums, so the
    // order count and the money it explains can never disagree.
    const allUnsettledOrderCount = await FoodTransaction.countDocuments({
        restaurantId: rid,
        status: { $in: ['captured', 'authorized'] },
        'settlement.isRestaurantSettled': { $ne: true },
    });

    const {
        earned: lifetimeEarnings,
        approved: totalApprovedWithdrawals,
        available: availableBalance,
    } = await getRestaurantPayoutPosition(rid);
    const withdrawalSettings = await getRestaurantWithdrawalSettings();
    const minimumWithdrawalAmount = Number(withdrawalSettings?.minimumWithdrawalAmount) || 0;

    // The rate new orders are charged, so the owner knows before the payout --
    // no live order to resolve it against here, so a bare {restaurantId} snapshot
    // stands in, same as the rate-preview usage this snapshot function already
    // supports (see its own comment on monetizationMode).
    const commissionSnapshot = await getRestaurantCommissionSnapshot({
        pricing: {},
        restaurantId: rid,
    }).catch(() => null);
    const commission = commissionSnapshot
        ? {
            type: commissionSnapshot.commissionType,
            value: commissionSnapshot.commissionValue,
            // The app only distinguishes "own" (this shop's own rate) from
            // everything else, which it labels as the platform standard.
            source:
                commissionSnapshot.commissionSource === COMMISSION_SOURCES.RESTAURANT_DEFAULT ||
                commissionSnapshot.commissionSource === COMMISSION_SOURCES.SCHEDULE_RESTAURANT
                    ? 'own'
                    : commissionSnapshot.commissionSource === COMMISSION_SOURCES.NONE
                        ? 'none'
                        : 'default',
        }
        : { type: 'percentage', value: 0, source: 'none' };

    const currentCycle = {
        start: { ...nowWindow.startMeta },
        end: { ...nowWindow.endMeta },
        totalEarnings: currentCycleEstimatedPayout, // We still show current cycle earnings label
        // Everything unsettled, ever -- which is what netAvailable below is
        // derived from. Without it the app shows a balance with no earnings
        // to account for it whenever the money was earned in an earlier
        // cycle, and a seller cannot tell a stale figure from a real one.
        lifetimeEarnings,
        lifetimeOrdersCounted: allUnsettledOrderCount,
        // Money actually paid out, not money queued for payout -- those are
        // opposite things and this line is labelled "withdrawn".
        totalWithdrawn: totalApprovedWithdrawals,
        estimatedPayout: availableBalance,
        // Same figure under the name quick-commerce uses, because the one
        // seller app reads both and must not get 0 from whichever module
        // happens to be serving it.
        withdrawableBalance: availableBalance,
        netAvailable: availableBalance,
        minimumWithdrawalAmount,
        totalOrders: currentCycleOrders.length,
        payoutDate: null,
        orders: currentCycleOrders
    };

    // Invoice Summary (derived from current cycle or broader if needed)
    const invoiceSummary = {
        count: currentCycleOrders.length,
        subtotal: currentCycleOrders.reduce((sum, o) => sum + (Number(o.orderTotal) || 0), 0),
        taxes: currentCycleOrders.reduce((sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.orderTotal) || 0)), 0),
        gross: currentCycleOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0)
    };

    // Past cycles: build from provided startDate/endDate query.
    const startDate = parseISODateParam(query.startDate);
    const endDate = parseISODateParamEnd(query.endDate);

    let pastCyclesResult = { orders: [], totalOrders: 0 };
    if (startDate && endDate) {
        const pastTransactions = await FoodTransaction.find({
            restaurantId: rid,
            status: { $in: ['captured', 'authorized'] },
            createdAt: { $gte: startDate, $lte: endDate }
        })
            .populate('orderId', 'orderId createdAt items pricing deliveryState orderStatus')
            .sort({ createdAt: -1 })
            .lean();

        const pastCycleOrders = pastTransactions.map((tx) => {
            const order = tx.orderId || {};
            const items = Array.isArray(order.items) ? order.items : [];
            const foodNames = items.map((it) => it?.name).filter(Boolean).join(', ');
            const orderTotalExclTax = Math.max(
                0,
                Number(order?.pricing?.total ?? 0) - Number(order?.pricing?.tax ?? 0) || 0
            );

            return {
                orderId: order?.orderId || tx.orderReadableId,
                createdAt: tx.createdAt,
                items,
                foodNames,
                orderTotal: orderTotalExclTax,
                totalAmount: tx.amounts?.totalCustomerPaid || 0,
                payout: tx.amounts?.restaurantShare || 0,
                commission: tx.amounts?.restaurantCommission || 0,
                paymentMethod: tx.paymentMethod || order?.payment?.method,
                orderStatus: order?.orderStatus || order?.deliveryState?.currentPhase || order?.deliveryState?.status,
                status: tx.status
            };
        });

        pastCyclesResult = {
            orders: pastCycleOrders,
            totalOrders: pastCycleOrders.length
        };
    }

    return {
        restaurant: {
            name: restaurant?.restaurantName || '',
            restaurantId: restaurant?._id ? `REST${restaurant._id.toString().slice(-6).padStart(6, '0')}` : 'N/A',
            address
        },
        // `wallet` is what the seller app parses; `currentCycle` is what this
        // module has always sent. One object, both names -- exactly the pairing
        // the quick-commerce service already publishes, and without it a food
        // seller was shown a zero balance they could not withdraw.
        wallet: currentCycle,
        currentCycle,
        invoiceSummary,
        pastCycles: pastCyclesResult,
        commission
    };
}

