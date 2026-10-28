import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { decideAdminAccess } from '../admin/adminAccessPolicy.js';

/**
 * Platform P&L (Master > Report Management > Platform Earnings).
 *
 * What the platform actually kept, per service and in total, for a date range.
 * Each service already records its own split of every order, ride or booking;
 * this reads those records rather than re-deriving the money, so the figures
 * here are the ones each service's own reports and payouts are built from:
 *
 *   Food, Quick & Medical  food_transactions / qc_transactions, on delivered
 *                          orders. platformNetProfit is platform fee + delivery
 *                          fee + surge + commission + admin packaging + round-off
 *                          - rider pay - any coupon the platform funded
 *                          (foodTransaction.service.js).
 *   Taxi                   completed rides: fare - what the driver was credited
 *                          - the insurance fee (the insurer's), which is
 *                          commission + recovered cancellation fees - the promo
 *                          the platform funds - the driver incentive
 *                          (driver/services/walletService.js).
 *   Services               paid vendor bills: companyRevenue less its GST, which
 *                          is the government's (models/VendorBill.js).
 *
 * GST is shown beside the income, never in it: it was collected for the
 * government. Orders are counted by the day they were placed (rides by the day
 * they completed, bills by the day they were paid), in India time.
 *
 * Not included yet: subscription income (Quick seller plans, Services worker
 * plans) and wallet top-ups, which are not per-order money.
 */

const TZ = 'Asia/Kolkata';

const SERVICES = {
  food: { label: 'Food', service: 'food', unit: 'orders' },
  quick: { label: 'Quick & Medical', service: 'quickCommerce', unit: 'orders' },
  taxi: { label: 'Taxi', service: 'taxi', unit: 'rides' },
  services: { label: 'Services', service: 'serviceProvider', unit: 'bookings' },
};

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 'YYYY-MM-DD' in India time -> the instant that day starts / ends. */
function parseRange({ from, to } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const toDay = day.test(String(to || '')) ? String(to) : today;
  let fromDay = day.test(String(from || '')) ? String(from) : null;
  if (!fromDay) {
    const d = new Date(`${toDay}T00:00:00+05:30`);
    d.setDate(d.getDate() - 29);
    fromDay = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  }
  const start = new Date(`${fromDay}T00:00:00+05:30`);
  const end = new Date(`${toDay}T23:59:59.999+05:30`);
  if (!(start <= end)) throw new ApiError(400, 'The start date must be on or before the end date');
  if (end - start > 400 * 24 * 3600 * 1000) throw new ApiError(400, 'Pick a range of at most 400 days');
  return { from: fromDay, to: toDay, start, end };
}

const coll = (name) => mongoose.connection.collection(name);
const dayOf = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });
const num = (path) => ({ $ifNull: [path, 0] });

/* ----------------------------------------------------- Food and Quick */

async function storeOrders(transactions, orders, { start, end }) {
  const [row] = await coll(transactions)
    .aggregate([
      { $lookup: { from: orders, localField: 'orderId', foreignField: '_id', as: 'order' } },
      { $unwind: '$order' },
      { $match: { 'order.orderStatus': 'delivered', 'order.createdAt': { $gte: start, $lte: end } } },
      {
        $project: {
          day: dayOf('$order.createdAt'),
          gross: num('$amounts.totalCustomerPaid'),
          gst: num('$amounts.taxAmount'),
          commission: num('$amounts.restaurantCommission'),
          platformFee: num('$pricing.platformFee'),
          deliveryMargin: {
            $subtract: [{ $add: [num('$pricing.deliveryFee'), num('$pricing.surgeAmount')] }, num('$amounts.riderShare')],
          },
          partners: { $add: [num('$amounts.restaurantShare'), num('$amounts.riderShare')] },
          net: num('$amounts.platformNetProfit'),
        },
      },
      {
        $facet: {
          total: [{
            $group: {
              _id: null, count: { $sum: 1 }, gross: { $sum: '$gross' }, gst: { $sum: '$gst' },
              commission: { $sum: '$commission' }, platformFee: { $sum: '$platformFee' },
              deliveryMargin: { $sum: '$deliveryMargin' }, partners: { $sum: '$partners' }, net: { $sum: '$net' },
            },
          }],
          daily: [{ $group: { _id: '$day', net: { $sum: '$net' } } }, { $sort: { _id: 1 } }],
        },
      },
    ])
    .toArray();
  const t = row?.total?.[0] || {};
  const known = (t.commission || 0) + (t.platformFee || 0) + (t.deliveryMargin || 0);
  return {
    count: t.count || 0,
    gross: t.gross || 0,
    gst: t.gst || 0,
    partners: t.partners || 0,
    net: t.net || 0,
    lines: [
      { key: 'commission', label: 'Commission from sellers', amount: t.commission || 0 },
      { key: 'platformFee', label: 'Platform fee', amount: t.platformFee || 0 },
      { key: 'deliveryMargin', label: 'Delivery fees less rider pay', amount: t.deliveryMargin || 0 },
      // Packaging kept in admin mode, round-off, less coupons the platform funded.
      { key: 'other', label: 'Packaging, round-off and platform-funded coupons', amount: (t.net || 0) - known },
    ],
    daily: (row?.daily || []).map((d) => ({ date: d._id, net: d.net })),
  };
}

/* --------------------------------------------------------------- Taxi */

async function taxiRides({ start, end }) {
  const [row] = await coll('taxirides')
    .aggregate([
      { $match: { status: 'completed' } },
      { $addFields: { doneAt: { $ifNull: ['$completedAt', '$updatedAt'] } } },
      { $match: { doneAt: { $gte: start, $lte: end } } },
      {
        $project: {
          day: dayOf('$doneAt'),
          gross: num('$fare'),
          driver: num('$driverEarnings'),
          insurance: num('$insurance_fee'),
          commission: num('$commissionAmount'),
          incentive: num('$driverIncentiveAmount'),
          promo: num('$pricingSnapshot.promo_discount_applied'),
        },
      },
      { $addFields: { net: { $subtract: [{ $subtract: ['$gross', '$driver'] }, '$insurance'] } } },
      {
        $facet: {
          total: [{
            $group: {
              _id: null, count: { $sum: 1 }, gross: { $sum: '$gross' }, driver: { $sum: '$driver' },
              commission: { $sum: '$commission' }, incentive: { $sum: '$incentive' }, promo: { $sum: '$promo' },
              insurance: { $sum: '$insurance' }, net: { $sum: '$net' },
            },
          }],
          daily: [{ $group: { _id: '$day', net: { $sum: '$net' } } }, { $sort: { _id: 1 } }],
        },
      },
    ])
    .toArray();
  const t = row?.total?.[0] || {};
  const known = (t.commission || 0) - (t.incentive || 0) - (t.promo || 0);
  return {
    count: t.count || 0,
    gross: t.gross || 0,
    gst: null, // Taxi's service tax is inside the fare and not recorded per ride.
    partners: t.driver || 0,
    net: t.net || 0,
    lines: [
      { key: 'commission', label: 'Commission from drivers', amount: t.commission || 0 },
      { key: 'incentive', label: 'Driver incentives paid', amount: -(t.incentive || 0) },
      { key: 'promo', label: 'Promo codes the platform funded', amount: -(t.promo || 0) },
      { key: 'other', label: 'Recovered cancellation fees', amount: (t.net || 0) - known },
    ],
    daily: (row?.daily || []).map((d) => ({ date: d._id, net: d.net })),
  };
}

/* ----------------------------------------------------------- Services */

async function serviceBills({ start, end }) {
  const [row] = await coll('sp_vendor_bills')
    .aggregate([
      { $match: { status: 'paid' } },
      { $addFields: { paidOn: { $ifNull: ['$paidAt', '$updatedAt'] } } },
      { $match: { paidOn: { $gte: start, $lte: end } } },
      {
        $project: {
          day: dayOf('$paidOn'),
          gross: num('$grandTotal'),
          gst: num('$totalGST'),
          vendor: num('$vendorTotalEarning'),
          serviceShare: { $subtract: [num('$totalServiceBase'), num('$vendorServiceEarning')] },
          partsShare: { $subtract: [num('$totalPartsBase'), num('$vendorPartsEarning')] },
          net: { $subtract: [num('$companyRevenue'), num('$totalGST')] },
        },
      },
      {
        $facet: {
          total: [{
            $group: {
              _id: null, count: { $sum: 1 }, gross: { $sum: '$gross' }, gst: { $sum: '$gst' }, vendor: { $sum: '$vendor' },
              serviceShare: { $sum: '$serviceShare' }, partsShare: { $sum: '$partsShare' }, net: { $sum: '$net' },
            },
          }],
          daily: [{ $group: { _id: '$day', net: { $sum: '$net' } } }, { $sort: { _id: 1 } }],
        },
      },
    ])
    .toArray();
  const t = row?.total?.[0] || {};
  const known = (t.serviceShare || 0) + (t.partsShare || 0);
  return {
    count: t.count || 0,
    gross: t.gross || 0,
    gst: t.gst || 0,
    partners: t.vendor || 0,
    net: t.net || 0,
    lines: [
      { key: 'serviceShare', label: 'Share of service charges', amount: t.serviceShare || 0 },
      { key: 'partsShare', label: 'Share of parts', amount: t.partsShare || 0 },
      { key: 'other', label: 'Visiting and transport charges', amount: (t.net || 0) - known },
    ],
    daily: (row?.daily || []).map((d) => ({ date: d._id, net: d.net })),
  };
}

const LOADERS = {
  food: (r) => storeOrders('food_transactions', 'food_orders', r),
  quick: (r) => storeOrders('qc_transactions', 'qc_orders', r),
  taxi: taxiRides,
  services: serviceBills,
};

/* ------------------------------------------------------------- report */

const roundResult = (s) => ({
  ...s,
  gross: round(s.gross),
  gst: s.gst === null ? null : round(s.gst),
  partners: round(s.partners),
  net: round(s.net),
  lines: s.lines.map((l) => ({ ...l, amount: round(l.amount) })),
  daily: s.daily.map((d) => ({ ...d, net: round(d.net) })),
});

/**
 * @param {object} admin  the caller; a sub-admin sees only services they have
 *                        Reports access for
 * @param {{from?: string, to?: string}} query  'YYYY-MM-DD', India time; the
 *                        last 30 days when omitted
 */
export async function platformPnl(admin, query = {}) {
  const range = parseRange(query);
  const keys = Object.keys(SERVICES).filter(
    (k) => decideAdminAccess(admin, { service: SERVICES[k].service, resource: 'reports', write: false }).allowed,
  );
  if (!keys.length) throw new ApiError(403, 'You do not have access to reports');

  const services = await Promise.all(
    keys.map(async (key) => ({ key, label: SERVICES[key].label, unit: SERVICES[key].unit, ...roundResult(await LOADERS[key](range)) })),
  );

  // Every day in the range, so the chart has no gaps on quiet days.
  const days = [];
  for (let d = new Date(`${range.from}T12:00:00+05:30`); d <= range.end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
  }
  const byDay = Object.fromEntries(days.map((date) => [date, { date, total: 0, byService: {} }]));
  for (const s of services) {
    for (const d of s.daily) {
      if (!byDay[d.date]) continue;
      byDay[d.date].byService[s.key] = d.net;
      byDay[d.date].total = round(byDay[d.date].total + d.net);
    }
  }

  return {
    range: { from: range.from, to: range.to },
    services: services.map(({ daily, ...rest }) => rest),
    totals: {
      gross: round(services.reduce((a, s) => a + s.gross, 0)),
      gst: round(services.reduce((a, s) => a + (s.gst || 0), 0)),
      partners: round(services.reduce((a, s) => a + s.partners, 0)),
      net: round(services.reduce((a, s) => a + s.net, 0)),
    },
    daily: days.map((d) => byDay[d]),
  };
}
