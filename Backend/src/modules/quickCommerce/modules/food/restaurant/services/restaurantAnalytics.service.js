import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Sales figures for one seller over a date range.
 *
 * This used to be computed in the app from `GET /orders?status=delivered&
 * limit=200`, which meant every figure quietly went wrong once a seller passed
 * 200 delivered orders -- the oldest simply fell off the end and the totals
 * shrank. It also could not answer a date range, because it only ever fetched
 * the most recent page.
 *
 * Aggregated here instead: the database already has the index for it
 * (`restaurantId, orderStatus, createdAt`), and no row limit applies.
 *
 * Delivered orders only. A cancelled order is not revenue, and counting one
 * flatters every number on the screen.
 */

const MAX_RANGE_DAYS = 366;

/** Bucketing is by order placement, not delivery.
 *
 * `deliveredAt` lives on the dispatch subdocument, is null for anything not
 * dispatched through a rider, and is not part of any index -- so a range query
 * on it would both scan the collection and silently drop orders. `createdAt` is
 * always set and is the third key of the index this query already uses.
 */
const DATE_FIELD = '$createdAt';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Start of day / end of day in IST.
 *
 * The sellers are in India and a report labelled "13 Aug" has to mean their
 * 13th. Bucketing in UTC would file every order placed after 05:30 IST under
 * the previous day, which is most of the trading day.
 */
const IST_OFFSET_MINUTES = 330;
const TIMEZONE = '+05:30';

function parseBoundary(value, fallback, { endOfDay = false } = {}) {
    if (value === undefined || value === null || value === '') return fallback;

    const raw = String(value).trim();
    // A bare date means the whole of that day in IST, not midnight UTC.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const parsed = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${TIMEZONE}`);
        if (Number.isNaN(parsed.getTime())) throw new ValidationError('Invalid date');
        return parsed;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) throw new ValidationError('Invalid date');
    return parsed;
}

export async function getRestaurantAnalytics(restaurantId, query = {}) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const rId = new mongoose.Types.ObjectId(String(restaurantId));

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 29 * 86400000);
    const from = parseBoundary(query.from, new Date(defaultFrom.setUTCHours(0, 0, 0, 0)));
    const to = parseBoundary(query.to, now, { endOfDay: true });

    if (from > to) throw new ValidationError('`from` must be before `to`');

    const rangeMs = to.getTime() - from.getTime();
    if (rangeMs > MAX_RANGE_DAYS * 86400000) {
        throw new ValidationError(`Range cannot exceed ${MAX_RANGE_DAYS} days`);
    }

    // The equally-long window immediately before, for the trend percentages.
    const priorFrom = new Date(from.getTime() - rangeMs);

    const delivered = { restaurantId: rId, orderStatus: 'delivered' };

    const [facets] = await FoodOrder.aggregate([
        { $match: { ...delivered, createdAt: { $gte: priorFrom, $lte: to } } },
        {
            $addFields: {
                // Which window each order falls in, decided once rather than in
                // every branch below.
                _window: { $cond: [{ $gte: [DATE_FIELD, from] }, 'current', 'prior'] },
            },
        },
        {
            $facet: {
                totals: [
                    {
                        $group: {
                            _id: '$_window',
                            sales: { $sum: '$pricing.total' },
                            orders: { $sum: 1 },
                            itemsSold: { $sum: { $sum: '$items.quantity' } },
                        },
                    },
                ],
                daily: [
                    { $match: { _window: 'current' } },
                    {
                        $group: {
                            _id: {
                                $dateToString: { format: '%Y-%m-%d', date: DATE_FIELD, timezone: TIMEZONE },
                            },
                            sales: { $sum: '$pricing.total' },
                            orders: { $sum: 1 },
                            itemsSold: { $sum: { $sum: '$items.quantity' } },
                        },
                    },
                    { $sort: { _id: 1 } },
                ],
                categories: [
                    { $match: { _window: 'current' } },
                    { $unwind: '$items' },
                    {
                        $group: {
                            // Grouped on the id when the line has one, so a
                            // category renamed since the sale still aggregates
                            // as one row. Falls back to the snapshotted name for
                            // orders placed before the id was recorded.
                            _id: { $ifNull: ['$items.categoryId', '$items.categoryName'] },
                            categoryName: { $first: '$items.categoryName' },
                            quantity: { $sum: '$items.quantity' },
                            sales: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                        },
                    },
                    { $sort: { sales: -1 } },
                    { $limit: 10 },
                ],
                products: [
                    { $match: { _window: 'current' } },
                    { $unwind: '$items' },
                    {
                        $group: {
                            _id: '$items.itemId',
                            name: { $first: '$items.name' },
                            quantity: { $sum: '$items.quantity' },
                            sales: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                        },
                    },
                    { $sort: { sales: -1 } },
                    { $limit: 10 },
                ],
                customers: [
                    { $match: { _window: 'current' } },
                    { $group: { _id: '$userId' } },
                ],
            },
        },
    ]);

    const byWindow = new Map((facets?.totals || []).map((row) => [row._id, row]));
    const current = byWindow.get('current') || { sales: 0, orders: 0, itemsSold: 0 };
    const prior = byWindow.get('prior') || { sales: 0, orders: 0 };

    const customerIds = (facets?.customers || []).map((row) => row._id).filter(Boolean);

    // Returning means "ordered from this seller before the window opened", which
    // needs a look further back than the window itself. Doing it as a count of
    // distinct ids rather than fetching the orders keeps it one indexed query
    // however long the seller has been trading.
    const returningIds = customerIds.length
        ? await FoodOrder.distinct('userId', {
              ...delivered,
              userId: { $in: customerIds },
              createdAt: { $lt: from },
          })
        : [];

    const returningCustomers = returningIds.length;
    const newCustomers = customerIds.length - returningCustomers;

    return {
        from,
        to,
        totalSales: round2(current.sales),
        totalOrders: current.orders,
        // Guarded rather than computed: an empty window would otherwise divide
        // by zero and return NaN, which serialises to null and renders blank.
        averageOrderValue: current.orders > 0 ? round2(current.sales / current.orders) : 0,
        itemsSold: current.itemsSold || 0,
        newCustomers,
        returningCustomers,
        totalCustomers: customerIds.length,
        // null, not zero, when there is nothing to compare against: growth from
        // zero is not a percentage, and rendering it as one prints an infinity.
        salesTrendPercent: prior.sales > 0 ? round2(((current.sales - prior.sales) / prior.sales) * 100) : null,
        ordersTrendPercent: prior.orders > 0 ? round2(((current.orders - prior.orders) / prior.orders) * 100) : null,
        daily: fillDailyGaps(facets?.daily || [], from, to),
        topCategories: (facets?.categories || []).map((row) => ({
            categoryId: mongoose.Types.ObjectId.isValid(row._id) ? String(row._id) : null,
            categoryName: row.categoryName || 'Uncategorised',
            quantity: row.quantity || 0,
            sales: round2(row.sales),
        })),
        topProducts: (facets?.products || []).map((row) => ({
            itemId: String(row._id),
            name: row.name || '',
            quantity: row.quantity || 0,
            sales: round2(row.sales),
        })),
    };
}

/**
 * Emits a row for every day in the range, including the ones with no orders.
 *
 * A chart fed only the days that had sales draws a continuous line across the
 * quiet ones, which reads as steady trade rather than none.
 */
function fillDailyGaps(rows, from, to) {
    const byDate = new Map(rows.map((row) => [row._id, row]));
    const out = [];

    const dayKey = (date) =>
        new Date(date.getTime() + IST_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);

    const cursor = new Date(from.getTime());
    // Guard rather than trust the range: a malformed boundary that slipped
    // through would otherwise spin here.
    for (let i = 0; cursor <= to && i <= MAX_RANGE_DAYS; i += 1) {
        const key = dayKey(cursor);
        const row = byDate.get(key);
        out.push({
            date: key,
            sales: round2(row?.sales || 0),
            orders: row?.orders || 0,
            itemsSold: row?.itemsSold || 0,
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return out;
}
