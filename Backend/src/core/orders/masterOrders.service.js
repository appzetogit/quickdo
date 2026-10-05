import mongoose from 'mongoose';
import { ValidationError } from '../auth/errors.js';

/**
 * Master > Orders: every order on the platform, in one list.
 *
 * Food (food_orders), Quick and Medical (qc_orders; Medical = an MED- order or a
 * pharmacy store) and Taxi/Parcel (rides) live in separate collections with
 * separate admin screens. This reads them side by side and hands back one row
 * shape, so the Master panel can show them together, per tab, and assign a
 * rider to a Food / Quick / Medical order without leaving the page (the assign
 * calls themselves go to each vertical's own admin API).
 *
 * Read only. Status changes and refunds stay on each vertical's screen, whose
 * rules (refunds, ledgers, stock) this list does not duplicate.
 */

export const MASTER_ORDER_TABS = ['all', 'food', 'quick', 'medical', 'taxi', 'parcel'];

/** Order states, grouped the way the filter offers them. */
const ORDER_STATUS_GROUPS = {
    active: ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'ready', 'reached_pickup', 'picked_up', 'reached_drop'],
    delivered: ['delivered', 'completed'],
    cancelled: { $regex: '^cancel' },
};
const RIDE_STATUS_GROUPS = {
    active: { $in: ['searching', 'accepted', 'arriving', 'started', 'arrived'] },
    delivered: 'completed',
    cancelled: 'cancelled',
};

const models = async () => {
    const [{ FoodOrder }, { FoodOrder: QcOrder }, { Ride }] = await Promise.all([
        import('../../modules/food/orders/models/order.model.js'),
        import('../../modules/quickCommerce/modules/food/orders/models/order.model.js'),
        import('../../modules/taxi/user/models/Ride.js'),
    ]);
    return { FoodOrder, QcOrder, Ride };
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Filters per source for one tab; null = the tab does not read that source. */
const filtersFor = (tab, { status, search }) => {
    const orderStatus = status && ORDER_STATUS_GROUPS[status];
    const rideStatus = status && RIDE_STATUS_GROUPS[status];
    const term = String(search || '').trim().slice(0, 40);
    const idMatch = term
        ? { $or: [{ order_id: { $regex: escapeRegex(term), $options: 'i' } }, { orderId: { $regex: escapeRegex(term), $options: 'i' } }] }
        : {};
    const withStatus = (base) => ({
        ...base,
        ...idMatch,
        ...(orderStatus ? { orderStatus: Array.isArray(orderStatus) ? { $in: orderStatus } : orderStatus } : {}),
    });
    const rideBase = (serviceType) => ({
        ...(serviceType === 'parcel' ? { serviceType: 'parcel' } : { serviceType: { $ne: 'parcel' } }),
        adminHiddenAt: null, // deleted by an admin (taxi keeps the record, hidden)
        ...(rideStatus ? { liveStatus: rideStatus } : {}),
        ...(term && mongoose.Types.ObjectId.isValid(term) ? { _id: new mongoose.Types.ObjectId(term) } : {}),
        ...(term && !mongoose.Types.ObjectId.isValid(term) ? { _id: null } : {}),
    });
    const medical = { $or: [{ order_id: /^MED-/ }, { prescriptionOnly: true }, { 'prescription.required': true }] };
    const notMedical = { $nor: medical.$or };
    const out = {
        food: ['all', 'food'].includes(tab) ? withStatus({}) : null,
        quick: ['all', 'quick'].includes(tab) ? withStatus(notMedical) : null,
        medical: ['all', 'medical'].includes(tab) ? withStatus(medical) : null,
        taxi: ['all', 'taxi'].includes(tab) ? rideBase('ride') : null,
        parcel: ['all', 'parcel'].includes(tab) ? rideBase('parcel') : null,
    };
    // An order-number search never matches a ride (rides have no order number).
    if (term && !mongoose.Types.ObjectId.isValid(term)) { out.taxi = null; out.parcel = null; }
    return out;
};

const pickName = (doc, ...keys) => {
    for (const k of keys) {
        const v = doc?.[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
};

/** id -> doc for a set of ids in one collection. */
const byIds = async (collection, ids, projection) => {
    const valid = [...new Set(ids.filter(Boolean).map(String))]
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    if (!valid.length) return new Map();
    const rows = await mongoose.connection.db.collection(collection).find({ _id: { $in: valid } }, { projection }).toArray();
    return new Map(rows.map((r) => [String(r._id), r]));
};

const orderRow = (o, source, maps) => {
    const user = maps.users.get(String(o.userId || ''));
    const store = maps.stores.get(String(o.restaurantId || ''));
    const riderId = o.dispatch?.deliveryPartnerId ? String(o.dispatch.deliveryPartnerId) : '';
    const rider = maps.riders.get(riderId);
    return {
        _id: String(o._id),
        orderId: o.order_id || o.orderId || String(o._id),
        source, // food | quick | medical
        vertical: source === 'food' ? 'food' : 'quickCommerce', // what the assign API calls it
        orderStatus: o.orderStatus || '',
        status: o.orderStatus || '',
        customerName: pickName(user, 'name', 'fullName') || pickName(o.deliveryAddress, 'fullName', 'name') || 'Customer',
        customerPhone: user?.phone || o.deliveryAddress?.phone || '',
        storeName: pickName(store, 'restaurantName', 'name'),
        riderName: pickName(rider, 'name', 'fullName'),
        riderPhone: rider?.phone || '',
        total: Number(o.pricing?.total) || 0,
        paymentMethod: o.payment?.method || o.paymentMethod || '',
        paymentStatus: o.payment?.status || '',
        address: [o.deliveryAddress?.street, o.deliveryAddress?.city].filter(Boolean).join(', '),
        dispatch: o.dispatch ? {
            status: o.dispatch.status || '',
            assignMode: o.dispatch.assignMode || '',
            manualDeadlineAt: o.dispatch.manualDeadlineAt || null,
            deliveryPartnerId: riderId ? { _id: riderId, name: pickName(rider, 'name') } : null,
            assignedBy: o.dispatch.assignedBy || null,
        } : null,
        statusHistory: Array.isArray(o.statusHistory) ? o.statusHistory.slice(-6) : [],
        createdAt: o.createdAt,
    };
};

const rideRow = (r, maps) => {
    const user = maps.taxiUsers.get(String(r.userId || ''));
    const driver = maps.drivers.get(String(r.driverId || ''));
    const parcel = String(r.serviceType || '').toLowerCase() === 'parcel';
    return {
        _id: String(r._id),
        orderId: `${parcel ? 'PCL' : 'RIDE'}-${String(r._id).slice(-8).toUpperCase()}`,
        source: parcel ? 'parcel' : 'taxi',
        vertical: 'taxi',
        orderStatus: r.liveStatus || r.status || '',
        status: r.liveStatus || r.status || '',
        customerName: pickName(user, 'name', 'fullName') || 'Customer',
        customerPhone: user?.phone || '',
        storeName: '',
        riderName: pickName(driver, 'name'),
        riderPhone: driver?.phone || '',
        total: Number(r.fare) || 0,
        paymentMethod: r.paymentMethod || '',
        paymentStatus: r.paymentStatus || '',
        address: [r.pickupAddress, r.dropAddress].filter(Boolean).join(' → '),
        pickupAddress: r.pickupAddress || '',
        dropAddress: r.dropAddress || '',
        dispatch: null,
        statusHistory: [],
        createdAt: r.createdAt,
    };
};

/** An order still being worked on: deleting it would strand its rider, store and customer. */
const ORDER_IN_PROGRESS = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'ready', 'reached_pickup', 'picked_up', 'reached_drop'];
const RIDE_IN_PROGRESS = ['searching', 'accepted', 'ongoing', 'arriving', 'started', 'arrived'];

/**
 * Delete one order from Master > All Orders, through the service that owns it.
 *
 * Food, Quick and Medical go to their own admin delete, which returns stock and
 * refuses an order that was delivered or paid (its payment and payouts stay on
 * record). Taxi and parcel trips use taxi's own delete, which hides the trip
 * and keeps its fare records. An order still in progress is refused here:
 * cancel it first.
 */
export async function deleteMasterOrder({ source, id, adminId = '' } = {}) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) throw new ValidationError('Invalid order id');
    const { FoodOrder, QcOrder, Ride } = await models();

    if (source === 'taxi' || source === 'parcel') {
        const ride = await Ride.findById(id).select('status liveStatus adminHiddenAt').lean();
        if (!ride || ride.adminHiddenAt) return null;
        const state = String(ride.liveStatus || ride.status || '').toLowerCase();
        if (RIDE_IN_PROGRESS.includes(state)) {
            throw new ValidationError('This trip is still in progress. Cancel it first, then delete it.');
        }
        const { removeRideFromTrips } = await import('../../modules/taxi/admin/services/adminService.js');
        return removeRideFromTrips(id, adminId);
    }

    const isQc = source === 'quick' || source === 'medical';
    if (!isQc && source !== 'food') throw new ValidationError(`Unknown order type: ${source}`);
    const order = await (isQc ? QcOrder : FoodOrder).findById(id).select('orderStatus').lean();
    if (!order) return null;
    if (ORDER_IN_PROGRESS.includes(String(order.orderStatus))) {
        throw new ValidationError('This order is still in progress. Cancel it first, then delete it.');
    }
    const service = isQc
        ? await import('../../modules/quickCommerce/modules/food/orders/services/order.service.js')
        : await import('../../modules/food/orders/services/order.service.js');
    await service.deleteOrderAdmin(String(id), adminId);
    return { id: String(id), deleted: true };
}

/**
 * @param {{tab?, page?, limit?, status?, search?}} query
 * @returns {{ orders, total, page, limit, counts }}
 */
export async function listMasterOrders(query = {}) {
    const tab = String(query.tab || 'all').toLowerCase();
    if (!MASTER_ORDER_TABS.includes(tab)) throw new ValidationError(`Unknown tab: ${tab}`);
    const status = ['active', 'delivered', 'cancelled'].includes(String(query.status)) ? String(query.status) : '';
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
    const search = query.search;

    const { FoodOrder, QcOrder, Ride } = await models();
    const sources = {
        food: { model: FoodOrder },
        quick: { model: QcOrder },
        medical: { model: QcOrder },
        taxi: { model: Ride },
        parcel: { model: Ride },
    };
    const filters = filtersFor(tab, { status, search });

    // Newest page*limit of each source is enough to know the merged page.
    const need = page * limit;
    const results = await Promise.all(Object.entries(filters).map(async ([key, filter]) => {
        if (!filter) return [key, { rows: [], total: 0 }];
        const coll = sources[key].model.collection;
        const [rows, total] = await Promise.all([
            coll.find(filter).sort({ createdAt: -1 }).limit(need).toArray(),
            coll.countDocuments(filter),
        ]);
        return [key, { rows, total }];
    }));
    const bySource = Object.fromEntries(results);

    const merged = Object.entries(bySource)
        .flatMap(([key, { rows }]) => rows.map((row) => ({ key, row })))
        .sort((a, b) => new Date(b.row.createdAt || 0) - new Date(a.row.createdAt || 0))
        .slice((page - 1) * limit, page * limit);

    // Names for just this page.
    const pick = (keys, field) => merged.filter((m) => keys.includes(m.key)).map((m) => m.row[field]);
    const foodRows = merged.filter((m) => m.key === 'food');
    const qcRows = merged.filter((m) => m.key === 'quick' || m.key === 'medical');
    const [foodUsers, qcUsers, foodStores, qcStores, foodRiders, qcRiders, taxiUsers, drivers] = await Promise.all([
        byIds('users', foodRows.map((m) => m.row.userId), { name: 1, phone: 1 }),
        byIds('qc_users', qcRows.map((m) => m.row.userId), { name: 1, phone: 1 }),
        byIds('food_restaurants', foodRows.map((m) => m.row.restaurantId), { restaurantName: 1 }),
        byIds('qc_restaurants', qcRows.map((m) => m.row.restaurantId), { restaurantName: 1 }),
        byIds('food_delivery_partners', foodRows.map((m) => m.row.dispatch?.deliveryPartnerId), { name: 1, phone: 1 }),
        byIds('qc_delivery_partners', qcRows.map((m) => m.row.dispatch?.deliveryPartnerId), { name: 1, phone: 1 }),
        byIds('users', pick(['taxi', 'parcel'], 'userId'), { name: 1, phone: 1 }),
        byIds('taxidrivers', pick(['taxi', 'parcel'], 'driverId'), { name: 1, phone: 1 }),
    ]);

    const orders = merged.map(({ key, row }) => {
        if (key === 'taxi' || key === 'parcel') return rideRow(row, { taxiUsers, drivers });
        const food = key === 'food';
        return orderRow(row, key, {
            users: food ? foodUsers : qcUsers,
            stores: food ? foodStores : qcStores,
            riders: food ? foodRiders : qcRiders,
        });
    });

    const counts = Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.total]));
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    return { orders, total, page, limit, counts };
}
