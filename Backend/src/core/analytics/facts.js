import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';

/**
 * One row shape for every order, ride and booking on the platform.
 *
 * Food (food_orders), Quick Commerce (qc_orders), Taxi (taxirides) and Services
 * (sp_bookings) each store an order differently. The Master dashboard, the
 * cross-vertical reports, the GST report and the nightly insights all need the
 * same handful of fields from all four, so this is the one place that knows where
 * each field lives:
 *
 *   at           when it was placed (createdAt)
 *   zoneId       food / quick: the order's zoneId; taxi: the zone the pickup was
 *                priced in (pricingSnapshot.surge_zone_id); services: the city
 *                name, because Services has cities, not zones
 *   userId       the customer, in that vertical's customer collection
 *   partnerId    restaurant / store / Services vendor (taxi: none)
 *   driverId     rider / taxi driver / Services worker
 *   amount       what the customer was charged
 *   commission   platform commission on it (as each vertical recorded it)
 *   platformFee  platform fee charged to the customer (food / quick)
 *   tax          GST the order carried (taxi: not recorded per ride -- see tax.service.js)
 *   driverPay    what the rider or driver was paid for it, where recorded
 *   status       completed | cancelled | active
 *   lat, lng     delivery point / pickup / service address, where known
 *
 * Read only, and straight from the collections, so nothing here can change how a
 * vertical records its own money.
 */

export const TZ = 'Asia/Kolkata';

const num = (path) => ({ $convert: { input: path, to: 'double', onError: 0, onNull: 0 } });

const storeOrderProjection = {
    at: '$createdAt',
    zoneId: { $ifNull: ['$zoneId', null] },
    userId: '$userId',
    partnerId: { $ifNull: ['$restaurantId', null] },
    driverId: { $ifNull: ['$dispatch.deliveryPartnerId', null] },
    amount: num('$pricing.total'),
    commission: num('$pricing.restaurantCommission'),
    platformFee: num('$pricing.platformFee'),
    tax: { $add: [num('$pricing.tax'), num('$pricing.platformFeeGst')] },
    driverPay: num('$riderTotalPayout'),
    status: {
        $switch: {
            branches: [
                { case: { $in: ['$orderStatus', ['delivered', 'completed']] }, then: 'completed' },
                {
                    case: { $regexMatch: { input: { $toString: { $ifNull: ['$orderStatus', ''] } }, regex: '^(cancel|reject|payment_failed)' } },
                    then: 'cancelled',
                },
            ],
            default: 'active',
        },
    },
    lat: { $arrayElemAt: ['$deliveryAddress.location.coordinates', 1] },
    lng: { $arrayElemAt: ['$deliveryAddress.location.coordinates', 0] },
};

export const SOURCES = {
    food: {
        label: 'Food',
        collection: 'food_orders',
        customerSpace: 'users',
        partnerCollection: 'food_restaurants',
        partnerName: ['restaurantName', 'name'],
        driverCollection: 'food_delivery_partners',
        unit: 'orders',
        match: {},
        project: storeOrderProjection,
    },
    quickCommerce: {
        label: 'Quick Commerce',
        collection: 'qc_orders',
        customerSpace: 'qc_users',
        partnerCollection: 'qc_restaurants',
        partnerName: ['restaurantName', 'name'],
        driverCollection: 'qc_delivery_partners',
        unit: 'orders',
        match: {},
        project: storeOrderProjection,
    },
    taxi: {
        label: 'Taxi',
        collection: 'taxirides',
        customerSpace: 'users',
        partnerCollection: null,
        driverCollection: 'taxidrivers',
        unit: 'rides',
        // Trips an admin deleted stay in the collection, hidden.
        match: { adminHiddenAt: null },
        project: {
            at: '$createdAt',
            zoneId: { $ifNull: ['$pricingSnapshot.surge_zone_id', null] },
            userId: '$userId',
            partnerId: null,
            driverId: { $ifNull: ['$driverId', null] },
            amount: num('$fare'),
            commission: num('$commissionAmount'),
            platformFee: { $literal: 0 },
            tax: { $literal: 0 },
            driverPay: num('$driverEarnings'),
            status: {
                $switch: {
                    branches: [
                        { case: { $eq: ['$status', 'completed'] }, then: 'completed' },
                        { case: { $eq: ['$status', 'cancelled'] }, then: 'cancelled' },
                    ],
                    default: 'active',
                },
            },
            lat: { $arrayElemAt: ['$pickupLocation.coordinates', 1] },
            lng: { $arrayElemAt: ['$pickupLocation.coordinates', 0] },
        },
    },
    serviceProvider: {
        label: 'Services',
        collection: 'sp_bookings',
        customerSpace: 'sp_users',
        partnerCollection: 'sp_vendors',
        partnerName: ['businessName', 'name'],
        driverCollection: 'sp_workers',
        unit: 'bookings',
        match: {},
        project: {
            at: '$createdAt',
            zoneId: { $ifNull: ['$address.city', null] },
            userId: '$userId',
            partnerId: { $ifNull: ['$vendorId', null] },
            driverId: { $ifNull: ['$workerId', null] },
            amount: num('$finalAmount'),
            commission: num('$commissionSnapshot.amount'),
            platformFee: { $literal: 0 },
            tax: num('$tax'),
            driverPay: { $literal: 0 },
            status: {
                $switch: {
                    branches: [
                        { case: { $eq: ['$status', 'completed'] }, then: 'completed' },
                        { case: { $in: ['$status', ['cancelled', 'rejected', 'no_vendors']] }, then: 'cancelled' },
                    ],
                    default: 'active',
                },
            },
            lat: '$address.lat',
            lng: '$address.lng',
        },
    },
};

export const coll = (name) => mongoose.connection.collection(name);

const day = /^\d{4}-\d{2}-\d{2}$/;
export const istToday = (now = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const shiftDay = (d, days) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + days);
    return x.toISOString().slice(0, 10);
};
export const dayStart = (d) => new Date(`${d}T00:00:00+05:30`);
export const dayEnd = (d) => new Date(`${d}T23:59:59.999+05:30`);

/** 'YYYY-MM-DD' (India time) range; the last `defaultDays` days when omitted. */
export function parseRange({ from, to } = {}, { defaultDays = 30, maxDays = 400 } = {}) {
    const toDay = day.test(String(to || '')) ? String(to) : istToday();
    const fromDay = day.test(String(from || '')) ? String(from) : shiftDay(toDay, -(defaultDays - 1));
    const start = dayStart(fromDay);
    const end = dayEnd(toDay);
    if (!(start <= end)) throw new ApiError(400, 'The start date must be on or before the end date');
    if (end - start > maxDays * 24 * 3600 * 1000) throw new ApiError(400, `Pick a range of at most ${maxDays} days`);
    return { from: fromDay, to: toDay, start, end };
}

/** Every day in a range, so charts have no gaps on quiet days. */
export function daysOf({ from, to }) {
    const out = [];
    for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
    return out;
}

const zoneMatch = (zoneId) => {
    if (!zoneId) return null;
    const z = String(zoneId);
    return mongoose.Types.ObjectId.isValid(z) && /^[0-9a-f]{24}$/i.test(z)
        ? { zoneId: { $in: [new mongoose.Types.ObjectId(z), z] } }
        : { zoneId: z };
};

/**
 * Aggregation for one vertical's facts in a range, ready for more stages.
 * @param {string} vertical  food | quickCommerce | taxi | serviceProvider
 * @param {{start?: Date, end?: Date, zoneId?: string, status?: string, extraProject?: object}} opts
 */
export function factsPipeline(vertical, { start, end, zoneId, status, extraProject = {} } = {}) {
    const src = SOURCES[vertical];
    if (!src) throw new ApiError(400, `Unknown vertical: ${vertical}`);
    const createdAt = {};
    if (start) createdAt.$gte = start;
    if (end) createdAt.$lte = end;
    const pipeline = [];
    pipeline.push({ $match: { ...src.match, ...(start || end ? { createdAt } : {}) } });
    pipeline.push({ $project: { ...src.project, ...extraProject } });
    const zm = zoneMatch(zoneId);
    if (zm) pipeline.push({ $match: zm });
    if (status) pipeline.push({ $match: { status } });
    return pipeline;
}

export async function aggregateFacts(vertical, opts, stages = []) {
    const src = SOURCES[vertical];
    return coll(src.collection).aggregate([...factsPipeline(vertical, opts), ...stages], { allowDiskUse: true }).toArray();
}

export const dayExpr = (field = '$at') => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });
export const monthExpr = (field = '$at') => ({ $dateToString: { format: '%Y-%m', date: field, timezone: TZ } });

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** id -> name for a set of ids in one collection. */
export async function namesFor(collection, ids, fields = ['name']) {
    if (!collection) return new Map();
    const valid = [...new Set(ids.filter(Boolean).map(String))]
        .filter((id) => /^[0-9a-f]{24}$/i.test(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    if (!valid.length) return new Map();
    const projection = Object.fromEntries([...fields, 'phone', 'name'].map((f) => [f, 1]));
    const rows = await coll(collection).find({ _id: { $in: valid } }, { projection }).toArray();
    return new Map(rows.map((r) => {
        const name = fields.map((f) => r[f]).find((v) => typeof v === 'string' && v.trim()) || r.name || '';
        return [String(r._id), { name: String(name || '').trim(), phone: r.phone || '' }];
    }));
}
