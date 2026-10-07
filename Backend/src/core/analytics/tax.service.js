import { ApiError } from '../../utils/ApiError.js';
import { pickVerticals, VERTICAL_LABELS } from '../admin/adminVerticals.js';
import { cached } from '../admin/shortCache.js';
import { coll, aggregateFacts, parseRange, dayExpr, monthExpr, round2, TZ } from './facts.js';

/**
 * Master > Tax: one GST report across Food, Quick Commerce, Taxi and Services.
 *
 *   Food, Quick   completed orders: the GST each order carried (item GST +
 *                 GST on the platform fee, from the order's frozen pricing).
 *   Taxi          completed rides. Taxi fares are GST-inclusive and the tax was
 *                 never stored per ride, so it is worked out from the fare:
 *                 tax = fare x rate / (100 + rate). The rate is the one frozen on
 *                 the ride at booking (pricingSnapshot.service_tax_percent, recorded
 *                 from now on); for older rides it is the ride's fare rule's
 *                 current service_tax, and those rides are counted as "estimated".
 *                 Nothing is written to old rides.
 *   Services      paid vendor bills (sp_vendor_bills.totalGST). Services keeps its
 *                 detailed GSTR and TDS reports in its own admin.
 *
 * CGST / SGST are shown as an even split of the GST (intra-state supply). An
 * inter-state supply would be IGST; no vertical records the place of supply, so
 * the split is indicative and the GST total is the figure to file against.
 */

const CACHE_SECONDS = 300;

const num = (path) => ({ $convert: { input: path, to: 'double', onError: 0, onNull: 0 } });

async function storeTax(vertical, range, zoneId, groupExpr) {
    const rows = await aggregateFacts(vertical, { start: range.start, end: range.end, zoneId, status: 'completed' }, [
        { $group: { _id: groupExpr('$at'), invoices: { $sum: 1 }, gross: { $sum: '$amount' }, gst: { $sum: '$tax' } } },
    ]);
    return rows.map((r) => ({ period: r._id, invoices: r.invoices, gross: r.gross, gst: r.gst, estimated: 0 }));
}

async function taxiTax(range, zoneId, groupExpr) {
    const rows = await aggregateFacts('taxi', {
        start: range.start,
        end: range.end,
        zoneId,
        status: 'completed',
        extraProject: {
            snapPct: '$pricingSnapshot.service_tax_percent',
            setPriceId: '$pricingSnapshot.setPriceId',
        },
    }, [
        { $lookup: { from: 'taxisetprices', localField: 'setPriceId', foreignField: '_id', as: 'rule' } },
        {
            $addFields: {
                rulePct: num({ $arrayElemAt: ['$rule.service_tax', 0] }),
                hasSnap: { $ne: [{ $ifNull: ['$snapPct', null] }, null] },
            },
        },
        { $addFields: { pct: { $cond: ['$hasSnap', num('$snapPct'), '$rulePct'] } } },
        { $addFields: { gst: { $cond: [{ $gt: ['$pct', 0] }, { $divide: [{ $multiply: ['$amount', '$pct'] }, { $add: [100, '$pct'] }] }, 0] } } },
        {
            $group: {
                _id: groupExpr('$at'),
                invoices: { $sum: 1 },
                gross: { $sum: '$amount' },
                gst: { $sum: '$gst' },
                estimated: { $sum: { $cond: ['$hasSnap', 0, 1] } },
            },
        },
    ]);
    return rows.map((r) => ({ period: r._id, invoices: r.invoices, gross: r.gross, gst: r.gst, estimated: r.estimated }));
}

async function servicesTax(range, zoneId, groupExpr) {
    const match = { status: 'paid' };
    const rows = await coll('sp_vendor_bills').aggregate([
        { $match: match },
        { $addFields: { paidOn: { $ifNull: ['$paidAt', '$updatedAt'] } } },
        { $match: { paidOn: { $gte: range.start, $lte: range.end } } },
        ...(zoneId
            ? [
                { $lookup: { from: 'sp_bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
                { $match: { 'booking.address.city': zoneId } },
            ]
            : []),
        { $group: { _id: groupExpr('$paidOn'), invoices: { $sum: 1 }, gross: { $sum: num('$grandTotal') }, gst: { $sum: num('$totalGST') } } },
    ]).toArray();
    return rows.map((r) => ({ period: r._id, invoices: r.invoices, gross: r.gross, gst: r.gst, estimated: 0 }));
}

const LOADERS = {
    food: (r, z, g) => storeTax('food', r, z, g),
    quickCommerce: (r, z, g) => storeTax('quickCommerce', r, z, g),
    taxi: taxiTax,
    serviceProvider: servicesTax,
};

const BASIS = {
    food: 'Item GST + GST on platform fee, per delivered order',
    quickCommerce: 'Item GST + GST on platform fee, per delivered order',
    taxi: 'Fare-inclusive service tax at the ride\'s rate',
    serviceProvider: 'GST on paid vendor bills',
};

async function build(verticals, range, zoneId, group) {
    const groupExpr = group === 'day' ? dayExpr : monthExpr;
    const per = await Promise.all(verticals.map(async (v) => [v, await LOADERS[v](range, zoneId, groupExpr)]));
    const rows = [];
    const summary = [];
    for (const [v, list] of per) {
        const s = { vertical: v, label: VERTICAL_LABELS[v], invoices: 0, gross: 0, taxableValue: 0, gst: 0, estimated: 0, basis: BASIS[v] };
        for (const r of list.sort((a, b) => String(a.period).localeCompare(String(b.period)))) {
            const gst = round2(r.gst);
            const taxable = round2(r.gross - r.gst);
            rows.push({
                period: r.period,
                vertical: VERTICAL_LABELS[v],
                invoices: r.invoices,
                grossValue: round2(r.gross),
                taxableValue: taxable,
                gst,
                cgst: round2(gst / 2),
                sgst: round2(gst - round2(gst / 2)),
                estimatedInvoices: r.estimated,
            });
            s.invoices += r.invoices;
            s.gross += r.gross;
            s.gst += r.gst;
            s.estimated += r.estimated;
        }
        s.gross = round2(s.gross);
        s.gst = round2(s.gst);
        s.taxableValue = round2(s.gross - s.gst);
        summary.push(s);
    }
    rows.sort((a, b) => String(a.period).localeCompare(String(b.period)) || a.vertical.localeCompare(b.vertical));
    const estimatedRides = summary.find((s) => s.vertical === 'taxi')?.estimated || 0;
    return {
        title: 'GST',
        columns: [
            { key: 'period', label: group === 'day' ? 'Date' : 'Month', type: 'text' },
            { key: 'vertical', label: 'Service', type: 'text' },
            { key: 'invoices', label: 'Invoices', type: 'number' },
            { key: 'grossValue', label: 'Gross value', type: 'money' },
            { key: 'taxableValue', label: 'Taxable value', type: 'money' },
            { key: 'gst', label: 'GST', type: 'money' },
            { key: 'cgst', label: 'CGST (indicative)', type: 'money' },
            { key: 'sgst', label: 'SGST (indicative)', type: 'money' },
            { key: 'estimatedInvoices', label: 'Estimated', type: 'number' },
        ],
        rows,
        summary,
        totals: {
            invoices: summary.reduce((a, s) => a + s.invoices, 0),
            gst: round2(summary.reduce((a, s) => a + s.gst, 0)),
            taxableValue: round2(summary.reduce((a, s) => a + s.taxableValue, 0)),
        },
        notes: [
            'CGST/SGST is an even split for intra-state supply; inter-state supplies are IGST. File against the GST total.',
            ...(estimatedRides ? [`${estimatedRides} taxi ride(s) were booked before the GST rate was recorded on the ride; their GST uses the fare rule's current rate.`] : []),
            ...(verticals.includes('serviceProvider') ? ['Services also has detailed GSTR and TDS reports in its own admin (Services > Reports).'] : []),
        ],
        timezone: TZ,
    };
}

export async function gstReport(admin, query = {}) {
    const verticals = pickVerticals(admin, query.vertical, { resource: 'reports' });
    if (!verticals.length) throw new ApiError(403, 'You do not have access to reports');
    const range = parseRange(query, { defaultDays: 90, maxDays: 400 });
    const group = query.group === 'day' ? 'day' : 'month';
    const zoneId = String(query.zoneId || '').trim().slice(0, 64);
    const key = `gst:${verticals.join(',')}:${range.from}:${range.to}:${zoneId}:${group}`;
    const report = await cached(key, CACHE_SECONDS, () => build(verticals, range, zoneId, group));
    return { kind: 'gst', range: { from: range.from, to: range.to }, verticals, group, zoneId: zoneId || null, ...report };
}
