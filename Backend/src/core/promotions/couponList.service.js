import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { decideAdminAccess } from '../admin/adminAccessPolicy.js';
import { resolvePromoCeiling, tighten } from '../finance/promoLimits.service.js';

/**
 * One list of every coupon on the platform (Master > Coupons).
 *
 * Three systems hold them: Food's food_offers, Quick & Medical's qc_offers and
 * Taxi's promo codes. Their forms differ -- restaurant scope and cost sharing
 * in one, service locations and ride types in another -- so creating and
 * editing stay on each service's own screen. What an operator needs in one
 * place is the other half: which codes exist, which are live right now, how
 * far each has been used, and a way to pause one fast.
 *
 * Pausing is the one write, and each service's checkout already honours it:
 * Food and Quick redeem only status 'active' (order-pricing), Taxi only
 * `active: true`. Food and Quick had no pause button at all before this; their
 * admins could only delete a coupon to stop it.
 *
 * Usage limits are shown as ENFORCED: the code's own limit tightened by the
 * Master promo ceiling (promoLimits.service.js), so the number here is the one
 * checkout applies.
 */

export const COUPON_STATES = ['live', 'scheduled', 'paused', 'used_up', 'expired'];

const PER_SOURCE_LIMIT = 1000;

const SOURCES = {
  food: {
    label: 'Food',
    service: 'food',
    vertical: 'food',
    load: async () => (await import('../../modules/food/admin/models/offer.model.js')).FoodOffer,
    sellers: 'food_restaurants',
  },
  quick: {
    label: 'Quick & Medical',
    service: 'quickCommerce',
    vertical: 'quickCommerce',
    load: async () => (await import('../../modules/quickCommerce/modules/food/admin/models/offer.model.js')).FoodOffer,
    sellers: 'qc_restaurants',
  },
  taxi: {
    label: 'Taxi',
    service: 'taxi',
    vertical: 'taxi',
    load: async () => (await import('../../modules/taxi/admin/promotions/models/PromoCode.js')).PromoCode,
    sellers: null,
  },
};

export const COUPON_SOURCES = Object.entries(SOURCES).map(([key, s]) => ({ key, label: s.label, service: s.service }));

const canSee = (admin, source, write = false) =>
  decideAdminAccess(admin, { service: SOURCES[source].service, resource: 'promotions', write }).allowed;

const visibleSources = (admin) => Object.keys(SOURCES).filter((key) => canSee(admin, key));

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const date = (v) => (v ? new Date(v) : null);

/* ------------------------------------------------------------- one row */

function stateOf({ paused, off, start, end, used, limit }, now) {
  if (paused) return 'paused';
  if (end && end <= now) return 'expired';
  if (off) return 'paused';
  if (start && start > now) return 'scheduled';
  if (limit !== null && used >= limit) return 'used_up';
  return 'live';
}

function storeRow(source, doc, names, ceiling, now) {
  const pct = doc.discountType !== 'flat-price';
  const value = Number(doc.discountValue) || 0;
  const limit = tighten(doc.usageLimit, ceiling.total);
  const used = Number(doc.usedCount) || 0;
  const start = date(doc.startDate);
  const end = date(doc.endDate);
  const ids = [
    ...(Array.isArray(doc.restaurantIds) ? doc.restaurantIds : []),
    ...(doc.restaurantId ? [doc.restaurantId] : []),
  ].map(String);
  const uniqueIds = [...new Set(ids)];
  const sellerWord = source === 'food' ? 'restaurant' : 'store';
  let where = `All ${sellerWord}s`;
  if (doc.restaurantScope === 'selected' || uniqueIds.length) {
    const shown = uniqueIds.map((id) => names.get(id)).filter(Boolean);
    where = shown.length === 1
      ? shown[0]
      : shown.length
        ? `${shown.length} ${sellerWord}s`
        : `Selected ${sellerWord}s`;
  }
  return {
    key: `${source}:${doc._id}`,
    id: String(doc._id),
    source,
    sourceLabel: SOURCES[source].label,
    code: doc.couponCode,
    discount: pct
      ? `${value}% off${Number(doc.maxDiscount) > 0 ? ` up to ${money(doc.maxDiscount)}` : ''}`
      : `${money(value)} off`,
    minOrder: Number(doc.minOrderValue) || 0,
    audience: doc.customerScope === 'first-time' || doc.isFirstOrderOnly ? 'First order only' : 'Everyone',
    where,
    createdBy: doc.createdByRole === 'RESTAURANT' ? sellerWord : 'admin',
    used,
    limit,
    perUser: tighten(doc.perUserLimit, ceiling.perUser),
    startDate: start,
    endDate: end,
    shownInCart: doc.showInCart !== false,
    state: stateOf({ paused: doc.status === 'paused', off: doc.status === 'inactive', start, end, used, limit }, now),
    createdAt: doc.createdAt || null,
  };
}

function taxiRow(doc, ceiling, now) {
  const limit = tighten(doc.max_uses_total, ceiling.total);
  const used = Number(doc.usage_count) || 0;
  const start = date(doc.from_date);
  const end = date(doc.to_date);
  const locations = (doc.service_location_names || []).filter(Boolean);
  const where = locations.length > 1
    ? `${locations.length} cities`
    : locations[0] || doc.service_location_name || 'All cities';
  const ride = doc.transport_type && doc.transport_type !== 'all' ? ` · ${doc.transport_type.replace('_', ' ')}` : '';
  const audience = doc.audience_type === 'new_users'
    ? 'New users'
    : doc.audience_type === 'specific_user' || doc.user_specific
      ? `Only ${doc.user_name || 'one user'}`
      : 'Everyone';
  const pct = Number(doc.discount_percentage) || 0;
  return {
    key: `taxi:${doc._id}`,
    id: String(doc._id),
    source: 'taxi',
    sourceLabel: 'Taxi',
    code: doc.code,
    discount: `${pct}% off${Number(doc.maximum_discount_amount) > 0 ? ` up to ${money(doc.maximum_discount_amount)}` : ''}`,
    minOrder: Number(doc.minimum_trip_amount) || 0,
    audience,
    where: `${where}${ride}`,
    createdBy: 'admin',
    used,
    limit,
    perUser: tighten(doc.uses_per_user, ceiling.perUser),
    startDate: start,
    endDate: end,
    shownInCart: true,
    state: stateOf({ paused: doc.active === false, off: false, start, end, used, limit }, now),
    createdAt: doc.createdAt || null,
  };
}

async function sellerNames(collection, docs) {
  if (!collection) return new Map();
  const ids = new Set();
  for (const d of docs) {
    for (const id of [...(d.restaurantIds || []), d.restaurantId]) if (isId(id)) ids.add(String(id));
  }
  if (!ids.size) return new Map();
  const rows = await mongoose.connection
    .collection(collection)
    .find({ _id: { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) } })
    .project({ restaurantName: 1 })
    .toArray();
  return new Map(rows.map((r) => [String(r._id), r.restaurantName || '']));
}

async function rowsFor(source, filter = {}) {
  const def = SOURCES[source];
  const Model = await def.load();
  const [docs, ceiling] = await Promise.all([
    Model.find(filter).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT).lean(),
    resolvePromoCeiling({ vertical: def.vertical }),
  ]);
  const now = new Date();
  if (source === 'taxi') return docs.map((d) => taxiRow(d, ceiling, now));
  const names = await sellerNames(def.sellers, docs);
  return docs.map((d) => storeRow(source, d, names, ceiling, now));
}

/* ------------------------------------------------------------ reading */

/**
 * ponytail: states depend on today's date and the Master ceiling, so they are
 * worked out per row after loading (up to PER_SOURCE_LIMIT per service) rather
 * than queried. Coupon counts are in the tens; a stored state kept fresh by the
 * expiry job is the fix if they reach thousands.
 */
export async function listCoupons(admin, query = {}) {
  const allowed = visibleSources(admin);
  const wanted = String(query.source || '').trim();
  const sources = allowed.filter((s) => !wanted || s === wanted);
  const state = String(query.state || '').trim();
  const q = String(query.q || '').trim().toUpperCase();

  const all = (await Promise.all(sources.map((s) => rowsFor(s)))).flat();
  const counts = Object.fromEntries(COUPON_STATES.map((s) => [s, 0]));
  for (const r of all) counts[r.state] += 1;

  const rows = all
    .filter((r) => !state || r.state === state)
    .filter((r) => !q || r.code.includes(q) || r.where.toUpperCase().includes(q))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const page = Math.max(1, Number(query.page) || 1);
  return {
    items: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
    counts,
    sources: COUPON_SOURCES.filter((s) => allowed.includes(s.key)),
  };
}

/* ------------------------------------------------------------ writing */

/**
 * Pause or resume one coupon, in its own service.
 *
 * An expired coupon is not resumed from here: its end date has passed, so it
 * would not redeem anyway (and Food's expiry job would switch it off again).
 * Extending it is an edit, which belongs on the service's own screen.
 */
export async function setCouponLive(admin, source, id, live) {
  const def = SOURCES[source];
  if (!def) throw new ApiError(404, 'Unknown coupon source');
  if (!canSee(admin, source, true)) throw new ApiError(403, 'You can view these coupons but not change them');
  if (!isId(id)) throw new ApiError(404, 'Coupon not found');
  if (typeof live !== 'boolean') throw new ApiError(400, 'Say whether the coupon should be live');

  const Model = await def.load();
  const doc = await Model.findById(id).lean();
  if (!doc) throw new ApiError(404, 'Coupon not found');

  const end = date(source === 'taxi' ? doc.to_date : doc.endDate);
  if (live && end && end <= new Date()) {
    throw new ApiError(400, "This coupon's end date has passed. Change the dates on its own screen to bring it back.");
  }

  if (source === 'taxi') {
    // Taxi's own toggle, so anything it does on a change still happens.
    if (Boolean(doc.active) !== live) {
      const { togglePromoCodeStatus } = await import('../../modules/taxi/admin/promotions/services/promotionsService.js');
      await togglePromoCodeStatus(id);
    }
  } else {
    await Model.updateOne({ _id: doc._id }, { $set: { status: live ? 'active' : 'paused' } });
  }

  const [row] = await rowsFor(source, { _id: doc._id });
  return row;
}
