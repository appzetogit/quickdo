import mongoose from 'mongoose';
import { sendResponse, sendError } from '../../utils/response.js';
import {
    REPORT_TIMEZONE,
    parseRange,
    normalizeGroupBy,
    listBuckets,
    cycleWindow,
    recentCycles,
    PeriodError,
} from '../documents/period.js';
import { toCsv, CSV_CONTENT_TYPE } from '../documents/csv.js';
import {
    renderPdf,
    drawHeader,
    drawSectionTitle,
    drawKeyValues,
    drawTable,
    money,
    amount,
    formatDate,
    round2,
    PDF_CONTENT_TYPE,
} from '../documents/pdf.js';

/**
 * Seller analytics, downloadable reports and settlement statements
 * (SOW plan 6.1, 6.2, 6.3), for any store vertical.
 *
 * One pipeline, parameterised by the vertical's own models: food restaurants
 * (modules/food) and quick-commerce stores (modules/quickCommerce) keep
 * separate order, ledger, outlet and withdrawal collections, so each vertical
 * builds its instance with createStoreReports({...}) and binds its own models.
 * Nothing here imports a vertical.
 *
 * Every rupee is one the order or the payout ledger already stores --
 * nothing is re-priced and no rate is assumed:
 *
 *   gross sales   item subtotal + the seller's own packaging (as listed)
 *   taxable value the items net of GST (pricing.commissionableAmount ?? subtotal)
 *   GST           food: inclusive menu subtotal - taxable; exclusive taxable x stored rate
 *                 (or the vertical's own `gst` source, e.g. QC's per-slab pricing.tax)
 *   commission    pricing.restaurantCommission (stamped at placement)
 *   payout        the ledger's restaurantShare when there is one, otherwise the
 *                 same formula the ledger uses
 *
 * The same definitions as the vertical's shared/restaurantPayout.js, which is
 * what the order screens show, so a report never disagrees with the order it
 * summarises.
 *
 * Money figures in analytics and reports count DELIVERED orders only (a
 * collected pickup order is delivered); counts cover every order the seller saw
 * (unpaid online orders excluded). Settlement statements follow the finance
 * screen instead: every captured or authorised ledger entry created in the
 * cycle, because that is what the balance and withdrawals are computed from.
 *
 * A multi-store checkout is one child order per store in the vertical's order
 * collection, each with its own restaurantId, so it counts once per store with
 * that store's share only -- no special handling needed.
 */

const EXCLUDED_STATUSES = ['pending_payment'];
const STATUS_GROUPS = Object.freeze({
    delivered: ['delivered'],
    preparing: ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup'],
    outForDelivery: ['picked_up', 'reached_drop'],
    cancelled: ['cancelled_by_user', 'cancelled_by_admin'],
    rejected: ['cancelled_by_restaurant'],
});
const PAYABLE_TX = ['captured', 'authorized'];
const MAX_REPORT_ROWS = 20000;

export const REPORT_TYPES = Object.freeze(['orders', 'sales', 'commission', 'gst', 'payouts']);
export const REPORT_FORMATS = Object.freeze(['csv', 'pdf']);

const statusGroupOf = (status) => {
    for (const [group, list] of Object.entries(STATUS_GROUPS)) {
        if (list.includes(status)) return group;
    }
    return 'other';
};

/**
 * The IST day / Monday-week / month an order falls in, as 'YYYY-MM-DD' of the
 * bucket's first day. $dateToString and $isoDayOfWeek take a timezone on every
 * MongoDB from 3.6, so this needs no $dateTrunc (5.0+). IST has no daylight
 * saving, so stepping back whole days to the Monday is exact.
 */
function bucketKeyExpr(unit) {
    if (unit === 'month') {
        return { $dateToString: { format: '%Y-%m-01', date: '$createdAt', timezone: REPORT_TIMEZONE } };
    }
    if (unit === 'week') {
        return {
            $dateToString: {
                format: '%Y-%m-%d',
                timezone: REPORT_TIMEZONE,
                date: {
                    $subtract: [
                        '$createdAt',
                        { $multiply: [{ $subtract: [{ $isoDayOfWeek: { date: '$createdAt', timezone: REPORT_TIMEZONE } }, 1] }, 86400000] },
                    ],
                },
            },
        };
    }
    return { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: REPORT_TIMEZONE } };
}

const deliveredSum = (field) => ({ $sum: { $cond: ['$_delivered', field, 0] } });
const statusCount = (list) => ({ $sum: { $cond: [{ $in: ['$orderStatus', list] }, 1, 0] } });

const moneyGroup = () => ({
    orders: { $sum: 1 },
    delivered: statusCount(STATUS_GROUPS.delivered),
    preparing: statusCount(STATUS_GROUPS.preparing),
    outForDelivery: statusCount(STATUS_GROUPS.outForDelivery),
    cancelled: statusCount(STATUS_GROUPS.cancelled),
    rejected: statusCount(STATUS_GROUPS.rejected),
    grossSales: deliveredSum({ $add: ['$_subtotal', '$_packaging'] }),
    taxableValue: deliveredSum('$_taxable'),
    packaging: deliveredSum('$_packaging'),
    gst: deliveredSum('$_gst'),
    commission: deliveredSum('$_commission'),
    payout: deliveredSum('$_payout'),
});

const roundRow = (row) => ({
    orders: row?.orders || 0,
    delivered: row?.delivered || 0,
    preparing: row?.preparing || 0,
    outForDelivery: row?.outForDelivery || 0,
    cancelled: row?.cancelled || 0,
    rejected: row?.rejected || 0,
    grossSales: round2(row?.grossSales),
    taxableValue: round2(row?.taxableValue),
    packaging: round2(row?.packaging),
    gst: round2(row?.gst),
    commission: round2(row?.commission),
    payout: round2(row?.payout),
});

const sumBy = (rows, key) => round2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));

const REPORT_TITLES = {
    orders: 'Orders report',
    sales: 'Sales report',
    commission: 'Commission report',
    gst: 'GST report',
    payouts: 'Payouts report',
};

const ORDER_COLUMNS = [
    { header: 'Order ID', key: 'orderId', width: 70 },
    { header: 'Date', key: 'date', width: 70 },
    { header: 'Status', key: 'status', width: 65 },
    { header: 'Payment', key: 'paymentMethod', width: 45 },
    { header: 'Item subtotal', key: 'itemSubtotal', width: 50, align: 'right' },
    { header: 'GST', key: 'gst', width: 40, align: 'right' },
    { header: 'Packaging', key: 'packaging', width: 45, align: 'right' },
    { header: 'Your discount', key: 'restaurantDiscount', width: 45, align: 'right' },
    { header: 'Commission', key: 'commission', width: 50, align: 'right' },
    { header: 'Payout', key: 'payout', width: 50, align: 'right' },
];

const SALES_COLUMNS = [
    { header: 'Period', key: 'label', width: 80 },
    { header: 'Orders', key: 'orders', width: 40, align: 'right' },
    { header: 'Delivered', key: 'delivered', width: 45, align: 'right' },
    { header: 'Cancelled', key: 'cancelled', width: 45, align: 'right' },
    { header: 'Rejected', key: 'rejected', width: 45, align: 'right' },
    { header: 'Gross sales', key: 'grossSales', width: 60, align: 'right' },
    { header: 'GST', key: 'gst', width: 50, align: 'right' },
    { header: 'Commission', key: 'commission', width: 60, align: 'right' },
    { header: 'Payout', key: 'payout', width: 60, align: 'right' },
];

const COMMISSION_COLUMNS = [
    { header: 'Order ID', key: 'orderId', width: 80 },
    { header: 'Date', key: 'date', width: 90 },
    { header: 'Billing', value: (r) => r.monetizationMode || 'commission', width: 60 },
    { header: 'Taxable value', key: 'taxableValue', width: 70, align: 'right' },
    { header: 'Commission %', value: (r) => (r.commissionPercent === null ? '' : r.commissionPercent), width: 60, align: 'right' },
    { header: 'Commission', key: 'commission', width: 70, align: 'right' },
];

const GST_COLUMNS = [
    { header: 'Order ID', key: 'orderId', width: 75 },
    { header: 'Date', key: 'date', width: 85 },
    { header: 'Prices incl. GST', value: (r) => (r.pricesIncludeGst ? 'Yes' : 'No'), width: 50 },
    { header: 'Taxable value', key: 'taxableValue', width: 60, align: 'right' },
    { header: 'GST %', key: 'gstRate', width: 40, align: 'right' },
    { header: 'CGST', key: 'cgst', width: 50, align: 'right' },
    { header: 'SGST', key: 'sgst', width: 50, align: 'right' },
    { header: 'Total GST', key: 'gst', width: 55, align: 'right' },
];

const PAYOUT_COLUMNS = [
    { header: 'Requested', key: 'requested', width: 90 },
    { header: 'Type', key: 'type', width: 70 },
    { header: 'Amount', key: 'amount', width: 70, align: 'right' },
    { header: 'Status', key: 'status', width: 70 },
    { header: 'Processed', key: 'processed', width: 90 },
    { header: 'Reference', key: 'reference', width: 125 },
];

const ORDER_FIELDS = 'order_id orderId createdAt orderStatus userId items pricing payment';

/**
 * Build the reports for one vertical.
 *
 * @param {object} src
 * @param {import('mongoose').Model} src.Order        the vertical's order model (restaurantId, orderStatus, pricing)
 * @param {import('mongoose').Model} src.Transaction  its payout ledger (orderId, restaurantId, amounts.restaurantShare, status)
 * @param {import('mongoose').Model} src.Restaurant   its outlet / store model
 * @param {import('mongoose').Model} src.Withdrawal   its seller withdrawals
 * @param {import('mongoose').Model} src.Settlement   its settlement records (entityType 'restaurant')
 * @param {Function} src.buildPayoutBreakdown         shared/restaurantPayout.js of that vertical
 * @param {Function} src.resolveFundedDiscounts       ditto
 * @param {object}  [src.gst]                         override where the GST figure comes from:
 *        { expr: <aggregation expression for one order's GST>, fromOrder(order, breakdown) => number }
 * @param {string}  [src.entityLabel='Restaurant']    "Restaurant" / "Store" on PDFs
 * @param {string}  [src.codePrefix='REST']           outlet code prefix on PDFs
 * @param {string}  [src.gstNote]                     footnote under the GST report summary
 * @param {string}  [src.statementGstLabel]           GST line label on the statement PDF
 * @param {string}  [src.extraOrderFields]            more order fields to load for extraRowFields
 * @param {Function}[src.extraRowFields]              (order) => extra keys on each order row
 * @param {Function}[src.extraAnalytics]              async (rid, range) => extra keys on the analytics body
 */
export function createStoreReports(src) {
    const {
        Order,
        Transaction,
        Restaurant,
        Withdrawal,
        Settlement,
        buildPayoutBreakdown,
        resolveFundedDiscounts,
        gst: gstSource = null,
        entityLabel = 'Restaurant',
        codePrefix = 'REST',
        gstNote = 'GST on food delivered through the platform is collected and paid by the platform under section 9(5) of the CGST Act.',
        statementGstLabel = 'GST on food (collected from customers, paid by the platform u/s 9(5))',
        extraOrderFields = '',
        extraRowFields = null,
        extraAnalytics = null,
    } = src;
    for (const [name, value] of Object.entries({ Order, Transaction, Restaurant, Withdrawal, Settlement, buildPayoutBreakdown, resolveFundedDiscounts })) {
        if (!value) throw new Error(`createStoreReports: ${name} is required`);
    }
    const orderFields = extraOrderFields ? `${ORDER_FIELDS} ${extraOrderFields}` : ORDER_FIELDS;
    const authLabel = entityLabel;

    const oid = (id) => {
        if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
            const err = new Error(`${authLabel} authentication required`);
            err.statusCode = 401;
            throw err;
        }
        return new mongoose.Types.ObjectId(String(id));
    };

    /** The GST of one order: the vertical's own source, else the breakdown's. */
    const gstOf = (order, b) => (gstSource?.fromOrder ? round2(gstSource.fromOrder(order, b)) : b.gstOnFood);
    /** The GST % shown beside it, derived from the rupees like the breakdown does. */
    const gstRateOf = (gstAmount, b) => {
        if (!gstSource?.fromOrder) return b.gstRate;
        return b.taxableFoodValue > 0 ? round2((gstAmount / b.taxableFoodValue) * 100) : 0;
    };

    /* -------------------------------------------------------------------- */
    /* 6.2 Sales analytics, aggregated in MongoDB                           */
    /* -------------------------------------------------------------------- */

    /** Pipeline stages that put the seller's money fields on each order. */
    function moneyStages() {
        const subtotal = { $ifNull: ['$pricing.subtotal', 0] };
        return [
            {
                $lookup: {
                    from: Transaction.collection.collectionName,
                    localField: '_id',
                    foreignField: 'orderId',
                    as: '_tx',
                },
            },
            {
                $addFields: {
                    _subtotal: subtotal,
                    _taxable: { $ifNull: ['$pricing.commissionableAmount', subtotal] },
                    _packaging: {
                        $cond: [
                            { $in: [{ $ifNull: ['$pricing.packagingMode', ''] }, ['', 'RESTAURANT']] },
                            { $ifNull: ['$pricing.netPackagingFee', { $ifNull: ['$pricing.packagingFee', 0] }] },
                            0,
                        ],
                    },
                    _commission: { $ifNull: ['$pricing.restaurantCommission', 0] },
                    _delivered: { $eq: ['$orderStatus', 'delivered'] },
                    _txShare: { $arrayElemAt: ['$_tx.amounts.restaurantShare', 0] },
                },
            },
            {
                $addFields: {
                    _gst: gstSource?.expr || {
                        $cond: [
                            { $eq: ['$pricing.pricesIncludeGst', true] },
                            { $max: [0, { $subtract: ['$_subtotal', '$_taxable'] }] },
                            { $multiply: ['$_taxable', { $divide: [{ $ifNull: ['$pricing.gstRate', 0] }, 100] }] },
                        ],
                    },
                    _payout: {
                        $ifNull: ['$_txShare', { $subtract: [{ $add: ['$_taxable', '$_packaging'] }, '$_commission'] }],
                    },
                },
            },
        ];
    }

    /**
     * GET /restaurant/analytics/sales?from&to&groupBy=day|week|month
     */
    async function getSalesAnalytics(restaurantId, query = {}) {
        const rid = oid(restaurantId);
        const groupBy = normalizeGroupBy(query.groupBy, 'day');
        const range = parseRange(query, { defaultDays: groupBy === 'month' ? 365 : 30, maxDays: 731 });

        const pipeline = [
            {
                $match: {
                    restaurantId: rid,
                    createdAt: { $gte: range.start, $lt: range.end },
                    orderStatus: { $nin: EXCLUDED_STATUSES },
                },
            },
            ...moneyStages(),
            {
                $facet: {
                    series: [{ $group: { _id: bucketKeyExpr(groupBy), ...moneyGroup() } }],
                    totals: [{ $group: { _id: null, ...moneyGroup() } }],
                    customers: [
                        { $group: { _id: '$userId', n: { $sum: 1 } } },
                        {
                            $group: {
                                _id: null,
                                unique: { $sum: 1 },
                                repeat: { $sum: { $cond: [{ $gt: ['$n', 1] }, 1, 0] } },
                            },
                        },
                    ],
                },
            },
        ];

        const [result] = await Order.aggregate(pipeline);
        const byKey = new Map((result?.series || []).map((r) => [r._id, r]));
        const series = listBuckets(range.start, range.end, groupBy).map((b) => ({
            period: b.key,
            label: b.label,
            start: b.start,
            end: b.end,
            ...roundRow(byKey.get(b.key)),
        }));
        const totals = roundRow(result?.totals?.[0]);
        const customers = result?.customers?.[0] || {};
        const unique = customers.unique || 0;
        const repeat = customers.repeat || 0;

        const body = {
            range: { from: range.from, to: range.to, groupBy, timezone: REPORT_TIMEZONE },
            totals: {
                ...totals,
                avgOrderValue: totals.delivered > 0 ? round2(totals.grossSales / totals.delivered) : 0,
                uniqueCustomers: unique,
                repeatCustomers: repeat,
                newCustomers: unique - repeat,
                repeatRate: unique > 0 ? round2((repeat / unique) * 100) : 0,
            },
            series,
            empty: totals.orders === 0,
        };
        if (extraAnalytics && query.__skipExtra !== true) {
            Object.assign(body, await extraAnalytics(rid, range, query));
        }
        return body;
    }

    /* -------------------------------------------------------------------- */
    /* Order-level rows (reports and statements)                            */
    /* -------------------------------------------------------------------- */

    async function restaurantHeader(rid) {
        const r = await Restaurant.findById(rid)
            .select('restaurantName ownerName ownerEmail location addressLine1 area city state pincode gstNumber gstLegalName fssaiNumber')
            .lean();
        if (!r) {
            const err = new Error(`${entityLabel} not found`);
            err.statusCode = 404;
            throw err;
        }
        const loc = r.location || {};
        const address = loc.formattedAddress
            || [loc.addressLine1 || r.addressLine1, loc.area || r.area, loc.city || r.city, loc.state || r.state, loc.pincode || r.pincode].filter(Boolean).join(', ');
        return {
            name: r.restaurantName || '',
            code: `${codePrefix}${String(r._id).slice(-6).padStart(6, '0')}`,
            address,
            gstin: r.gstNumber || '',
            legalName: r.gstLegalName || '',
            fssai: r.fssaiNumber || '',
            email: r.ownerEmail || '',
        };
    }

    /** One row per order, every figure from the order's stored pricing. */
    function orderRow(order, tx, fundedDiscount) {
        const b = buildPayoutBreakdown(order, { restaurantFundedDiscount: fundedDiscount });
        const delivered = order.orderStatus === 'delivered';
        const share = tx?.amounts?.restaurantShare;
        const payout = delivered ? round2(Number.isFinite(share) ? share : b.payout) : 0;
        const gst = gstOf(order, b);
        return {
            orderId: order.order_id || order.orderId || String(order._id),
            createdAt: order.createdAt,
            date: formatDate(order.createdAt, { time: true }),
            status: order.orderStatus,
            statusGroup: statusGroupOf(order.orderStatus),
            paymentMethod: order.payment?.method || tx?.paymentMethod || '',
            items: (order.items || []).reduce((n, i) => n + (Number(i.quantity) || 0), 0),
            itemSubtotal: b.subTotal,
            taxableValue: b.taxableFoodValue,
            gstRate: gstRateOf(gst, b),
            gst,
            cgst: round2(gst / 2),
            sgst: round2(gst - round2(gst / 2)),
            pricesIncludeGst: b.pricesIncludeGst,
            packaging: b.packagingCharge,
            restaurantDiscount: b.discountFundedByRestaurant,
            commission: b.commissionAmount,
            commissionPercent: b.commissionPercent,
            monetizationMode: order.pricing?.monetizationMode || '',
            payout,
            customerPaid: round2(order.pricing?.total),
            delivered,
            ...(extraRowFields ? extraRowFields(order) : {}),
        };
    }

    async function orderRows(rid, range) {
        const orders = await Order.find({
            restaurantId: rid,
            createdAt: { $gte: range.start, $lt: range.end },
            orderStatus: { $nin: EXCLUDED_STATUSES },
        })
            .select(orderFields)
            .sort({ createdAt: 1 })
            .limit(MAX_REPORT_ROWS)
            .lean();
        const [txs, funded] = await Promise.all([
            Transaction.find({ orderId: { $in: orders.map((o) => o._id) } })
                .select('orderId amounts.restaurantShare paymentMethod status')
                .lean(),
            resolveFundedDiscounts(orders),
        ]);
        const txByOrder = new Map(txs.map((t) => [String(t.orderId), t]));
        return orders.map((o) => orderRow(o, txByOrder.get(String(o._id)), funded.get(String(o._id)) || 0));
    }

    /* -------------------------------------------------------------------- */
    /* 6.1 Downloadable reports                                             */
    /* -------------------------------------------------------------------- */

    async function payoutRows(rid, range) {
        const [withdrawals, settlements] = await Promise.all([
            Withdrawal.find({ restaurantId: rid, createdAt: { $gte: range.start, $lt: range.end } })
                .sort({ createdAt: 1 })
                .lean(),
            Settlement.find({ entityType: 'restaurant', entityId: rid, createdAt: { $gte: range.start, $lt: range.end } })
                .sort({ createdAt: 1 })
                .lean(),
        ]);
        return [
            ...withdrawals.map((w) => ({
                at: w.createdAt,
                requested: formatDate(w.createdAt, { time: true }),
                type: 'Withdrawal',
                amount: round2(w.amount),
                status: String(w.status || '').toLowerCase(),
                processed: formatDate(w.processedAt, { time: true }),
                reference: w.transactionId || w.rejectionReason || '',
            })),
            ...settlements.map((s) => ({
                at: s.createdAt,
                requested: formatDate(s.createdAt, { time: true }),
                type: 'Settlement',
                amount: round2(s.amount),
                status: s.status,
                processed: formatDate(s.processedAt, { time: true }),
                reference: s.payoutRef || '',
            })),
        ].sort((a, b) => new Date(a.at) - new Date(b.at));
    }

    /**
     * Build a report file. Returns { filename, contentType, body }.
     *
     * GET /restaurant/reports?type=orders|sales|commission|gst|payouts
     *                        &from&to&format=csv|pdf[&groupBy=day|week|month]
     */
    async function buildRestaurantReport(restaurantId, query = {}) {
        const rid = oid(restaurantId);
        const type = String(query.type || 'orders').trim().toLowerCase();
        if (!REPORT_TYPES.includes(type)) throw new PeriodError(`type must be one of ${REPORT_TYPES.join(', ')}`);
        const format = String(query.format || 'csv').trim().toLowerCase();
        if (!REPORT_FORMATS.includes(format)) throw new PeriodError('format must be csv or pdf');
        const range = parseRange(query, { defaultDays: 30, maxDays: 366 });
        const header = await restaurantHeader(rid);

        let columns;
        let rows;
        let summary = [];
        if (type === 'sales') {
            const groupBy = normalizeGroupBy(query.groupBy, 'day');
            const analytics = await getSalesAnalytics(rid, { from: range.from, to: range.to, groupBy, __skipExtra: true });
            columns = SALES_COLUMNS;
            const t = analytics.totals;
            rows = [...analytics.series, { label: 'Total', ...t, __bold: true }];
            summary = [
                { label: 'Orders', value: t.orders },
                { label: 'Delivered', value: t.delivered },
                { label: 'Gross sales (delivered)', value: money(t.grossSales) },
                { label: 'GST', value: money(t.gst) },
                { label: 'Commission', value: money(t.commission) },
                { label: 'Payout', value: money(t.payout), bold: true },
            ];
            if (entityLabel === 'Restaurant') summary[3].label = 'GST on food';
        } else if (type === 'payouts') {
            columns = PAYOUT_COLUMNS;
            rows = await payoutRows(rid, range);
            const paid = rows.filter((r) => r.status === 'approved' || r.status === 'processed');
            summary = [
                { label: 'Requests', value: rows.length },
                { label: 'Paid out', value: money(sumBy(paid, 'amount')), bold: true },
                { label: 'Pending', value: money(sumBy(rows.filter((r) => r.status === 'pending' || r.status === 'processing'), 'amount')) },
            ];
        } else {
            const all = await orderRows(rid, range);
            if (type === 'orders') {
                columns = ORDER_COLUMNS;
                rows = all;
            } else {
                // Commission and GST are owed on delivered orders only.
                rows = all.filter((r) => r.delivered);
                columns = type === 'gst' ? GST_COLUMNS : COMMISSION_COLUMNS;
            }
            const delivered = all.filter((r) => r.delivered);
            const gstWord = entityLabel === 'Restaurant' ? 'GST on food' : 'GST';
            summary = type === 'gst'
                ? [
                    { label: 'Delivered orders', value: delivered.length },
                    { label: 'Taxable value', value: money(sumBy(delivered, 'taxableValue')) },
                    { label: 'CGST', value: money(sumBy(delivered, 'cgst')) },
                    { label: 'SGST', value: money(sumBy(delivered, 'sgst')) },
                    { label: `Total ${gstWord}`, value: money(sumBy(delivered, 'gst')), bold: true },
                    gstNote ? { label: gstNote, value: '', muted: true } : null,
                ].filter(Boolean)
                : [
                    { label: 'Orders', value: all.length },
                    { label: 'Delivered', value: delivered.length },
                    { label: 'Item sales (delivered)', value: money(sumBy(delivered, 'itemSubtotal')) },
                    { label: gstWord, value: money(sumBy(delivered, 'gst')) },
                    { label: 'Commission', value: money(sumBy(delivered, 'commission')) },
                    { label: 'Your discounts', value: money(sumBy(delivered, 'restaurantDiscount')) },
                    { label: 'Payout', value: money(sumBy(delivered, 'payout')), bold: true },
                ];
        }

        const base = `${type}-report_${range.from}_to_${range.to}`;
        if (format === 'csv') {
            const csvRows = rows.filter((r) => !r.__bold || type === 'sales');
            return { filename: `${base}.csv`, contentType: CSV_CONTENT_TYPE, body: Buffer.from(toCsv(columns, csvRows), 'utf8') };
        }

        const body = await renderPdf((doc) => {
            drawHeader(doc, {
                title: REPORT_TITLES[type],
                subtitle: [header.name, header.address, header.gstin ? `GSTIN: ${header.gstin}` : ''],
                right: [`${entityLabel} ID: ${header.code}`, `Period: ${range.from} to ${range.to}`, `Generated: ${formatDate(new Date(), { time: true })}`],
            });
            drawSectionTitle(doc, 'Summary');
            drawKeyValues(doc, summary);
            drawSectionTitle(doc, 'Details');
            drawTable(doc, {
                columns: columns.map((c) => ({
                    ...c,
                    value: (r) => {
                        const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
                        return c.align === 'right' && typeof v === 'number' && !Number.isInteger(v) ? amount(v) : v;
                    },
                })),
                rows,
            });
        }, { info: { Title: `${REPORT_TITLES[type]} ${range.from} to ${range.to}` } });
        return { filename: `${base}.pdf`, contentType: PDF_CONTENT_TYPE, body };
    }

    /* -------------------------------------------------------------------- */
    /* 6.3 Settlement statements                                            */
    /* -------------------------------------------------------------------- */

    async function computeStatement(rid, cycle, { withLines = true } = {}) {
        const txs = await Transaction.find({
            restaurantId: rid,
            status: { $in: PAYABLE_TX },
            createdAt: { $gte: cycle.start, $lt: cycle.end },
        })
            .select('orderId amounts.restaurantShare amounts.restaurantCommission paymentMethod status createdAt settlement')
            .sort({ createdAt: 1 })
            .lean();
        const orders = await Order.find({ _id: { $in: txs.map((t) => t.orderId) } }).select(orderFields).lean();
        const orderById = new Map(orders.map((o) => [String(o._id), o]));
        const funded = await resolveFundedDiscounts(orders);

        const lines = txs.map((tx) => {
            const order = orderById.get(String(tx.orderId)) || { _id: tx.orderId, pricing: {} };
            const b = buildPayoutBreakdown(order, { restaurantFundedDiscount: funded.get(String(order._id)) || 0 });
            const payout = round2(tx.amounts?.restaurantShare);
            const expected = round2(b.taxableFoodValue + b.packagingCharge - b.commissionAmount - b.discountFundedByRestaurant);
            return {
                orderId: order.order_id || order.orderId || String(tx.orderId),
                date: formatDate(tx.createdAt, { time: true }),
                createdAt: tx.createdAt,
                status: order.orderStatus || '',
                paymentMethod: tx.paymentMethod || order.payment?.method || '',
                itemSubtotal: b.subTotal,
                taxableValue: b.taxableFoodValue,
                gst: gstOf(order, b),
                packaging: b.packagingCharge,
                commission: b.commissionAmount,
                restaurantDiscount: b.discountFundedByRestaurant,
                adjustment: round2(payout - expected),
                payout,
                settled: tx.settlement?.isRestaurantSettled === true,
                ...(extraRowFields && order.orderStatus ? extraRowFields(order) : {}),
            };
        });

        const [refunded, withdrawals, settlements] = await Promise.all([
            Transaction.countDocuments({ restaurantId: rid, status: 'refunded', createdAt: { $gte: cycle.start, $lt: cycle.end } }),
            Withdrawal.find({
                restaurantId: rid,
                status: { $in: ['approved', 'Approved', 'APPROVED'] },
                $or: [
                    { processedAt: { $gte: cycle.start, $lt: cycle.end } },
                    { processedAt: { $exists: false }, updatedAt: { $gte: cycle.start, $lt: cycle.end } },
                    { processedAt: null, updatedAt: { $gte: cycle.start, $lt: cycle.end } },
                ],
            }).select('amount processedAt updatedAt transactionId').lean(),
            Settlement.find({
                entityType: 'restaurant',
                entityId: rid,
                status: 'processed',
                processedAt: { $gte: cycle.start, $lt: cycle.end },
            }).select('amount processedAt payoutRef').lean(),
        ]);

        const payoutsMade = [
            ...withdrawals.map((w) => ({ type: 'withdrawal', amount: round2(w.amount), at: w.processedAt || w.updatedAt, reference: w.transactionId || '' })),
            ...settlements.map((s) => ({ type: 'settlement', amount: round2(s.amount), at: s.processedAt, reference: s.payoutRef || '' })),
        ].sort((a, b) => new Date(a.at) - new Date(b.at));

        const commission = sumBy(lines, 'commission');
        const restaurantDiscounts = sumBy(lines, 'restaurantDiscount');
        const otherAdjustments = sumBy(lines, 'adjustment');
        const totals = {
            orders: lines.length,
            refundedOrders: refunded,
            itemSales: sumBy(lines, 'itemSubtotal'),
            taxableValue: sumBy(lines, 'taxableValue'),
            gstCollected: sumBy(lines, 'gst'),
            packaging: sumBy(lines, 'packaging'),
            commission,
            restaurantDiscounts,
            otherAdjustments,
            deductions: round2(commission + restaurantDiscounts),
            netPayout: sumBy(lines, 'payout'),
            settledOrders: lines.filter((l) => l.settled).length,
            paidOut: sumBy(payoutsMade, 'amount'),
        };

        return {
            cycle: {
                id: cycle.id,
                label: cycle.label,
                from: cycle.from,
                to: cycle.to,
                start: cycle.start,
                end: cycle.end,
                status: cycle.status,
            },
            totals,
            payoutsMade,
            ...(withLines ? { lines } : {}),
        };
    }

    /** GET /restaurant/settlements?limit=6 */
    async function listSettlementStatements(restaurantId, query = {}) {
        const rid = oid(restaurantId);
        const cycles = recentCycles(Number(query.limit) || 6);
        const statements = [];
        for (const cycle of cycles) {
            const s = await computeStatement(rid, cycle, { withLines: false });
            statements.push({ ...s.cycle, totals: s.totals });
        }
        return { statements };
    }

    /** GET /restaurant/settlements/:cycleId */
    async function getSettlementStatement(restaurantId, cycleId) {
        const rid = oid(restaurantId);
        const cycle = cycleWindow(cycleId);
        const [restaurant, statement] = await Promise.all([restaurantHeader(rid), computeStatement(rid, cycle)]);
        return { restaurant, ...statement };
    }

    /** GET /restaurant/settlements/:cycleId/download?format=pdf|csv */
    async function buildSettlementStatementFile(restaurantId, cycleId, { format = 'pdf' } = {}) {
        const fmt = String(format || 'pdf').toLowerCase();
        if (!REPORT_FORMATS.includes(fmt)) throw new PeriodError('format must be csv or pdf');
        const s = await getSettlementStatement(restaurantId, cycleId);
        const base = `settlement-statement_${s.cycle.id}`;
        const lineColumns = [
            { header: 'Order ID', key: 'orderId', width: 70 },
            { header: 'Date', key: 'date', width: 75 },
            { header: 'Payment', key: 'paymentMethod', width: 45 },
            { header: 'Item subtotal', key: 'itemSubtotal', width: 50, align: 'right' },
            { header: 'GST', key: 'gst', width: 40, align: 'right' },
            { header: 'Packaging', key: 'packaging', width: 45, align: 'right' },
            { header: 'Commission', key: 'commission', width: 50, align: 'right' },
            { header: 'Your discount', key: 'restaurantDiscount', width: 45, align: 'right' },
            { header: 'Adjustment', key: 'adjustment', width: 45, align: 'right' },
            { header: 'Payout', key: 'payout', width: 50, align: 'right' },
        ];
        if (fmt === 'csv') {
            return { filename: `${base}.csv`, contentType: CSV_CONTENT_TYPE, body: Buffer.from(toCsv(lineColumns, s.lines), 'utf8') };
        }
        const t = s.totals;
        const body = await renderPdf((doc) => {
            drawHeader(doc, {
                title: 'Settlement statement',
                subtitle: [s.restaurant.name, s.restaurant.address, s.restaurant.gstin ? `GSTIN: ${s.restaurant.gstin}` : ''],
                right: [
                    `${entityLabel} ID: ${s.restaurant.code}`,
                    `Cycle: ${s.cycle.label}`,
                    `Status: ${s.cycle.status === 'open' ? 'Open (in progress)' : s.cycle.status}`,
                    `Generated: ${formatDate(new Date(), { time: true })}`,
                ],
            });
            drawSectionTitle(doc, 'Summary');
            drawKeyValues(doc, [
                { label: 'Orders in this cycle', value: t.orders },
                { label: 'Item sales', value: money(t.itemSales) },
                { label: statementGstLabel, value: money(t.gstCollected), muted: true },
                { label: entityLabel === 'Restaurant' ? 'Taxable food value (A)' : 'Taxable item value (A)', value: money(t.taxableValue) },
                { label: 'Packaging charges (B)', value: money(t.packaging) },
                { label: 'Platform commission (C)', value: `- ${money(t.commission)}` },
                { label: 'Discounts you funded (D)', value: `- ${money(t.restaurantDiscounts)}` },
                { label: 'Other adjustments (E)', value: money(t.otherAdjustments) },
                { label: 'Net payout (A + B - C - D + E)', value: money(t.netPayout), bold: true },
                { label: 'Paid out to you during this cycle', value: money(t.paidOut) },
                t.refundedOrders ? { label: 'Refunded orders (not payable)', value: t.refundedOrders, muted: true } : null,
            ]);
            if (s.payoutsMade.length) {
                drawSectionTitle(doc, 'Payouts during this cycle');
                drawTable(doc, {
                    columns: [
                        { header: 'Date', value: (r) => formatDate(r.at, { time: true }), width: 120 },
                        { header: 'Type', key: 'type', width: 100 },
                        { header: 'Amount', value: (r) => amount(r.amount), width: 100, align: 'right' },
                        { header: 'Reference', key: 'reference', width: 195 },
                    ],
                    rows: s.payoutsMade,
                });
            }
            drawSectionTitle(doc, 'Orders');
            drawTable(doc, {
                columns: lineColumns.map((c) => ({
                    ...c,
                    value: (r) => (c.align === 'right' ? amount(r[c.key]) : r[c.key]),
                })),
                rows: s.lines,
            });
        }, { info: { Title: `Settlement statement ${s.cycle.id}` } });
        return { filename: `${base}.pdf`, contentType: PDF_CONTENT_TYPE, body };
    }

    return {
        REPORT_TYPES,
        REPORT_FORMATS,
        getSalesAnalytics,
        buildRestaurantReport,
        listSettlementStatements,
        getSettlementStatement,
        buildSettlementStatementFile,
    };
}

/**
 * Express handlers for one vertical's reports instance. Identical request and
 * response shapes on every vertical; the seller id is the signed-in user.
 */
export function createStoreReportsControllers(reports, { authMessage = 'Restaurant authentication required' } = {}) {
    const sendFile = (res, { filename, contentType, body }) => {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', body.length);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).end(body);
    };
    const ok = (res, message, data) => sendResponse(res, 200, message, data);
    const guard = (fn) => async (req, res, next) => {
        try {
            const id = req.user?.userId;
            if (!id) return sendError(res, 401, authMessage);
            return await fn(id, req, res);
        } catch (err) {
            return next(err);
        }
    };
    return {
        getSalesAnalyticsController: guard(async (id, req, res) => ok(res, 'Sales analytics', await reports.getSalesAnalytics(id, req.query || {}))),
        downloadReportController: guard(async (id, req, res) => sendFile(res, await reports.buildRestaurantReport(id, req.query || {}))),
        listSettlementStatementsController: guard(async (id, req, res) => ok(res, 'Settlement statements', await reports.listSettlementStatements(id, req.query || {}))),
        getSettlementStatementController: guard(async (id, req, res) => ok(res, 'Settlement statement', await reports.getSettlementStatement(id, req.params.cycleId))),
        downloadSettlementStatementController: guard(async (id, req, res) => sendFile(res, await reports.buildSettlementStatementFile(id, req.params.cycleId, { format: req.query?.format }))),
    };
}
