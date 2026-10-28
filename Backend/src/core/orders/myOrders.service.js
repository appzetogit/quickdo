import mongoose from 'mongoose';

/**
 * One "My Orders" for the customer, across every service.
 *
 * The app's Orders screen showed Food only; Quick kept its own list, rides
 * their own history and Services its own bookings, so a customer who ordered
 * groceries and took a cab looked in three places. This reads all of them for
 * the signed-in customer and returns one newest-first list in one shape, each
 * row carrying the app route of that service's own detail screen -- the detail
 * screens stay each service's.
 *
 * The customer is the platform account (`users`, the id in the token). Food
 * and Taxi key their records by it already; Quick and Services keep their own
 * customer rows, found by platformUserId, else the same phone.
 *
 * Read-only.
 */

const SERVICE_LABEL = {
  food: 'Food',
  quick: 'Quick',
  medical: 'Medical',
  taxi: 'Rides',
  parcel: 'Parcel',
  rental: 'Rental',
  services: 'Services',
};

const coll = (name) => mongoose.connection.collection(name);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const lastTen = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
const humanize = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/* ---------------------------------------------------------------- states */

// Checkouts the customer abandoned before paying are not orders they placed.
const HIDDEN_STORE_STATUSES = new Set(['pending_payment', 'payment_failed']);

function storeState(status) {
  if (status === 'delivered') return 'completed';
  if (String(status).startsWith('cancelled') || status === 'rejected' || status === 'refunded') return 'cancelled';
  return 'ongoing';
}
function rideState(status) {
  if (status === 'completed') return 'completed';
  if (String(status).startsWith('cancel') || status === 'expired' || status === 'no_driver_found') return 'cancelled';
  return 'ongoing';
}
function bookingState(status) {
  if (status === 'completed') return 'completed';
  if (['cancelled', 'rejected', 'expired', 'refunded'].includes(status)) return 'cancelled';
  return 'ongoing';
}

const STORE_LABEL = {
  created: 'Placed',
  confirmed: 'Accepted',
  preparing: 'Being prepared',
  ready_for_pickup: 'Ready for pickup',
  picked_up: 'On the way',
  reached_drop: 'Arriving',
  delivered: 'Delivered',
};
const storeLabel = (s) => STORE_LABEL[s] || (String(s).startsWith('cancelled') ? 'Cancelled' : humanize(s));

/* ------------------------------------------------------------- identity */

/** The customer's own ids in the services that keep their own customer rows. */
async function linkedIds(collection, platformId, phone) {
  const or = [{ platformUserId: oid(platformId) }];
  const ten = lastTen(phone);
  if (ten.length === 10) or.push({ phone: { $in: [ten, `+91${ten}`, `91${ten}`, `+91 ${ten}`] } });
  const rows = await coll(collection).find({ $or: or }).project({ _id: 1 }).toArray();
  return rows.map((r) => r._id);
}

/* -------------------------------------------------------------- sources */

const itemsSummary = (items = []) => {
  const real = items.filter((i) => !i?.isFreebie);
  if (!real.length) return '';
  const first = `${real[0].quantity || 1} × ${real[0].name || 'Item'}`;
  return real.length > 1 ? `${first}, +${real.length - 1} more` : first;
};

async function sellerNames(collection, ids) {
  const list = [...new Set(ids.map(String).filter(isId))];
  if (!list.length) return new Map();
  const rows = await coll(collection).find({ _id: { $in: list.map(oid) } }).project({ restaurantName: 1, storeType: 1 }).toArray();
  return new Map(rows.map((r) => [String(r._id), r]));
}

async function storeOrders({ collection, sellers, userIds, before, limit, key, route }) {
  if (!userIds.length) return [];
  const docs = await coll(collection)
    .find({ userId: { $in: userIds }, createdAt: { $lt: before }, orderStatus: { $nin: [...HIDDEN_STORE_STATUSES] } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({ orderStatus: 1, order_id: 1, orderId: 1, restaurantId: 1, items: 1, pricing: 1, createdAt: 1 })
    .toArray();
  const names = await sellerNames(sellers, docs.map((d) => d.restaurantId));
  return docs.map((d) => {
    const seller = names.get(String(d.restaurantId));
    const service = key === 'quick' && String(seller?.storeType || '').toLowerCase() === 'pharmacy' ? 'medical' : key;
    return {
      key: `${key}:${d._id}`,
      id: String(d._id),
      service,
      serviceLabel: SERVICE_LABEL[service],
      number: d.order_id || (typeof d.orderId === 'string' ? d.orderId : '') || String(d._id).slice(-6).toUpperCase(),
      title: seller?.restaurantName || 'Order',
      subtitle: itemsSummary(d.items),
      amount: Number(d.pricing?.total) || 0,
      state: storeState(d.orderStatus),
      statusLabel: storeLabel(d.orderStatus),
      createdAt: d.createdAt,
      route: route(String(d._id)),
    };
  });
}

const TAXI_SERVICE = (d) => {
  const t = String(d.serviceType || '').toLowerCase();
  if (t.includes('parcel') || t === 'delivery' || d.parcel) return 'parcel';
  if (t.includes('rental')) return 'rental';
  return 'taxi';
};

async function rides({ userId, before, limit }) {
  const docs = await coll('taxirides')
    .find({ userId: oid(userId), createdAt: { $lt: before } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({ status: 1, serviceType: 1, parcel: 1, pickupAddress: 1, dropAddress: 1, fare: 1, createdAt: 1, completedAt: 1 })
    .toArray();
  return docs.map((d) => {
    const service = TAXI_SERVICE(d);
    const to = String(d.dropAddress || '').split(',')[0].trim();
    return {
      key: `taxi:${d._id}`,
      id: String(d._id),
      service,
      serviceLabel: SERVICE_LABEL[service],
      number: String(d._id).slice(-6).toUpperCase(),
      title: to ? `${service === 'parcel' ? 'Parcel' : 'Ride'} to ${to}` : SERVICE_LABEL[service],
      subtitle: [d.pickupAddress, d.dropAddress].filter(Boolean).map((a) => String(a).split(',')[0].trim()).join(' → '),
      amount: Number(d.fare) || 0,
      state: rideState(d.status),
      statusLabel: d.status === 'completed' ? 'Completed' : String(d.status).startsWith('cancel') ? 'Cancelled' : humanize(d.status),
      createdAt: d.createdAt,
      route: `/taxi/rides/${d._id}`,
    };
  });
}

async function bookings({ userIds, before, limit }) {
  if (!userIds.length) return [];
  const docs = await coll('sp_bookings')
    .find({ userId: { $in: userIds }, createdAt: { $lt: before } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({ status: 1, bookingNumber: 1, serviceName: 1, serviceCategory: 1, finalAmount: 1, userPayableAmount: 1, scheduledDate: 1, timeSlot: 1, createdAt: 1 })
    .toArray();
  return docs.map((d) => ({
    key: `services:${d._id}`,
    id: String(d._id),
    service: 'services',
    serviceLabel: SERVICE_LABEL.services,
    number: d.bookingNumber || String(d._id).slice(-6).toUpperCase(),
    title: d.serviceName || d.serviceCategory || 'Booking',
    subtitle: d.scheduledDate
      ? `For ${new Date(d.scheduledDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${d.timeSlot?.start ? `, ${d.timeSlot.start}` : ''}`
      : '',
    amount: Number(d.userPayableAmount ?? d.finalAmount) || 0,
    state: bookingState(d.status),
    statusLabel: humanize(d.status),
    createdAt: d.createdAt,
    route: `/services/bookings/${d._id}`,
  }));
}

/* ------------------------------------------------------------------ list */

const SERVICE_FILTERS = ['food', 'quick', 'medical', 'taxi', 'parcel', 'rental', 'services'];

/**
 * @param {string} userId  the signed-in customer's platform id
 * @param {object} query   { service?, state?: 'ongoing'|'past', before?: ISO date, limit? }
 * @returns {{ items, nextBefore, ongoingCount }}
 */
export async function listMyOrders(userId, query = {}) {
  if (!isId(userId)) return { items: [], nextBefore: null, ongoingCount: 0 };
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
  const before = query.before && !Number.isNaN(Date.parse(query.before)) ? new Date(query.before) : new Date(Date.now() + 60_000);
  const service = SERVICE_FILTERS.includes(query.service) ? query.service : '';
  const state = query.state === 'ongoing' || query.state === 'past' ? query.state : '';

  const me = await coll('users').findOne({ _id: oid(userId) }, { projection: { phone: 1 } });
  const [qcIds, spIds] = await Promise.all([
    linkedIds('qc_users', userId, me?.phone),
    linkedIds('sp_users', userId, me?.phone),
  ]);

  // Each source is read one page deep; after merging, the page is exact.
  const want = (keys) => !service || keys.includes(service);
  const lists = await Promise.all([
    want(['food']) ? storeOrders({ collection: 'food_orders', sellers: 'food_restaurants', userIds: [oid(userId)], before, limit, key: 'food', route: (id) => `/food/orders/${id}` }) : [],
    want(['quick', 'medical']) ? storeOrders({ collection: 'qc_orders', sellers: 'qc_restaurants', userIds: qcIds, before, limit, key: 'quick', route: (id) => `/qc/order/${id}` }) : [],
    want(['taxi', 'parcel', 'rental']) ? rides({ userId, before, limit }) : [],
    want(['services']) ? bookings({ userIds: spIds, before, limit }) : [],
  ]);

  let rows = lists.flat();
  if (service) rows = rows.filter((r) => r.service === service);
  if (state === 'ongoing') rows = rows.filter((r) => r.state === 'ongoing');
  if (state === 'past') rows = rows.filter((r) => r.state !== 'ongoing');
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const items = rows.slice(0, limit);
  const full = rows.length > limit || lists.some((l) => l.length === limit);
  return {
    items,
    nextBefore: full && items.length ? new Date(items[items.length - 1].createdAt).toISOString() : null,
    ongoingCount: state === 'past' ? undefined : rows.filter((r) => r.state === 'ongoing').length,
  };
}
