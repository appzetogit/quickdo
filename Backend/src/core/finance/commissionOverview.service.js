import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { decideAdminAccess } from '../admin/adminAccessPolicy.js';

/**
 * What the platform takes, from every partner, in one view
 * (Master > Report Management > Commission Overview).
 *
 * Four places set it, each on its own screen:
 *   Food              per restaurant, with dated schedules, or none in plan mode
 *   Quick & Medical   per store; a pharmacy with no rate pays the Medical default
 *   Taxi              per vehicle type and city, on each fare row
 *   Services          the vendor's payout share; the platform keeps the rest
 *
 * The rate shown for a seller is the one its next order would be charged:
 * each service's own rate function (getRestaurantCommissionSnapshot) is asked
 * with a sample order, so schedules, the Medical fallback and plan mode are
 * applied exactly as payout applies them -- there is no second copy of the
 * rules here to drift. Beside it, what each seller actually paid over the last
 * 30 days, so a rate set but never charged (or charged but never set) shows.
 *
 * Read-only. Editing stays on each service's screen, linked from the page.
 */

const DAYS = 30;
const SAMPLE = 100;

const SERVICES = {
  food: { label: 'Food', service: 'food', resource: 'restaurants', editPath: '/admin/food/restaurants/commission' },
  quick: { label: 'Quick & Medical', service: 'quickCommerce', resource: 'restaurants', editPath: '/admin/quick-commerce/restaurants/commission' },
  taxi: { label: 'Taxi', service: 'taxi', resource: 'fee_settings', editPath: '/taxi/admin/pricing/set-price' },
  services: { label: 'Services', service: 'serviceProvider', resource: 'settings', editPath: '/admin/sp/settings' },
};

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const coll = (name) => mongoose.connection.collection(name);
const canSee = (admin, key) =>
  decideAdminAccess(admin, { service: SERVICES[key].service, resource: SERVICES[key].resource, write: false }).allowed;

/** Commission and commissionable value per seller over the window, from the ledger. */
async function paidBySeller(transactions, orders, since) {
  const rows = await coll(transactions)
    .aggregate([
      { $lookup: { from: orders, localField: 'orderId', foreignField: '_id', as: 'o' } },
      { $unwind: '$o' },
      { $match: { 'o.orderStatus': 'delivered', 'o.createdAt': { $gte: since } } },
      {
        $group: {
          _id: '$restaurantId',
          orders: { $sum: 1 },
          commission: { $sum: { $ifNull: ['$amounts.restaurantCommission', 0] } },
          base: { $sum: { $ifNull: ['$o.pricing.commissionableAmount', { $ifNull: ['$o.pricing.subtotal', 0] }] } },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((r) => [String(r._id), r]));
}

function rateRow(seller, snap, paid, extra = {}) {
  const p = paid.get(String(seller._id));
  return {
    id: String(seller._id),
    name: seller.restaurantName || 'Unnamed',
    status: seller.status || '',
    rate: { type: snap.commissionType === 'amount' ? 'amount' : 'percentage', value: round(snap.commissionValue) },
    source: snap.commissionSource || (Number(snap.commissionValue) > 0 ? 'restaurant_default' : 'none'),
    label: snap.commissionLabel || '',
    last30: p
      ? {
        orders: p.orders,
        commission: round(p.commission),
        effectivePct: p.base > 0 ? round((p.commission / p.base) * 100) : null,
      }
      : { orders: 0, commission: 0, effectivePct: null },
    ...extra,
  };
}

async function foodOverview(since) {
  const { getRestaurantCommissionSnapshot } = await import('../../modules/food/orders/services/foodTransaction.service.js');
  const sellers = await coll('food_restaurants').find({}).project({ restaurantName: 1, status: 1 }).toArray();
  const paid = await paidBySeller('food_transactions', 'food_orders', since);
  const rows = [];
  let mode = 'commission';
  for (const s of sellers) {
    const snap = await getRestaurantCommissionSnapshot({ restaurantId: s._id, pricing: { subtotal: SAMPLE, commissionableAmount: SAMPLE } });
    mode = snap.monetizationMode || mode;
    rows.push(rateRow(s, snap, paid));
  }
  return { mode, rows };
}

async function quickOverview(since) {
  const { getRestaurantCommissionSnapshot } = await import('../../modules/quickCommerce/modules/food/orders/services/foodTransaction.service.js');
  const { getMedicalDefaultCommission } = await import('../../modules/quickCommerce/modules/food/admin/services/medicalCommission.service.js');
  const [sellers, own, medicalDefault] = await Promise.all([
    coll('qc_restaurants').find({}).project({ restaurantName: 1, status: 1, storeType: 1 }).toArray(),
    coll('qc_restaurant_commissions').find({ status: { $ne: false } }).project({ restaurantId: 1 }).toArray(),
    getMedicalDefaultCommission().catch(() => null),
  ]);
  const hasOwn = new Set(own.map((r) => String(r.restaurantId)));
  const paid = await paidBySeller('qc_transactions', 'qc_orders', since);
  const rows = [];
  for (const s of sellers) {
    const snap = await getRestaurantCommissionSnapshot({ restaurantId: s._id, pricing: { subtotal: SAMPLE } });
    const pharmacy = String(s.storeType || '').toLowerCase() === 'pharmacy';
    const source = hasOwn.has(String(s._id))
      ? 'restaurant_default'
      : pharmacy && Number(snap.commissionValue) > 0
        ? 'medical_default'
        : 'none';
    rows.push(rateRow(s, { ...snap, commissionSource: source }, paid, { kind: pharmacy ? 'pharmacy' : 'store' }));
  }
  return {
    rows,
    medicalDefault: medicalDefault ? { type: medicalDefault.type || 'percentage', value: round(medicalDefault.value) } : null,
  };
}

async function taxiOverview() {
  const rows = await coll('taxisetprices').find({}).toArray();
  const ids = (field) => [...new Set(rows.map((r) => String(r[field] || '')).filter((v) => mongoose.Types.ObjectId.isValid(v)))];
  const names = async (collection, list) => {
    if (!list.length) return new Map();
    const docs = await coll(collection)
      .find({ _id: { $in: list.map((i) => new mongoose.Types.ObjectId(i)) } })
      .project({ name: 1, service_location_name: 1, zone_name: 1 })
      .toArray();
    return new Map(docs.map((d) => [String(d._id), d.name || d.service_location_name || d.zone_name || '']));
  };
  const [vehicles, locations, zones] = await Promise.all([
    names('taxivehicles', ids('vehicle_type')),
    names('taxiservicelocations', ids('service_location_id')),
    names('taxizones', ids('zone_id')),
  ]);
  return {
    rows: rows.map((r) => ({
      id: String(r._id),
      vehicle: vehicles.get(String(r.vehicle_type)) || 'Vehicle',
      where: locations.get(String(r.service_location_id)) || zones.get(String(r.zone_id)) || 'Every city',
      transport: r.transport_type || '',
      active: r.active !== false && r.status !== 'inactive',
      rate: {
        type: Number(r.admin_commission_type_from_driver ?? 1) === 1 ? 'percentage' : 'amount',
        value: round(r.admin_commission_from_driver),
      },
    })),
  };
}

async function servicesOverview() {
  const settings = await coll('sp_settings').findOne({ type: 'global' });
  // Defaults from modules/serviceProvider/utils/commission.js and the bill controller.
  const servicePayout = Number(settings?.servicePayoutPercentage ?? 90);
  const partsPayout = Number(settings?.partsPayoutPercentage ?? 10);
  return {
    platformShare: {
      service: round(100 - servicePayout),
      parts: round(100 - partsPayout),
    },
    vendorShare: { service: round(servicePayout), parts: round(partsPayout) },
    fromSettings: Boolean(settings && (settings.servicePayoutPercentage !== undefined || settings.partsPayoutPercentage !== undefined)),
  };
}

const LOADERS = { food: foodOverview, quick: quickOverview, taxi: taxiOverview, services: servicesOverview };

/** How many sellers pay nothing because no rate is set -- the misconfiguration to look for. */
function summarise(rows = []) {
  const paying = rows.filter((r) => r.rate?.value > 0);
  return {
    sellers: rows.length,
    withRate: paying.length,
    withoutRate: rows.filter((r) => !(r.rate?.value > 0) && r.source === 'none').length,
    commissionLast30: round(rows.reduce((a, r) => a + (r.last30?.commission || 0), 0)),
  };
}

export async function commissionOverview(admin) {
  const keys = Object.keys(SERVICES).filter((k) => canSee(admin, k));
  if (!keys.length) throw new ApiError(403, 'You do not have access to commission settings');
  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
  const services = [];
  for (const key of keys) {
    const data = await LOADERS[key](since);
    services.push({
      key,
      label: SERVICES[key].label,
      editPath: SERVICES[key].editPath,
      ...(data.rows && key !== 'taxi' ? { summary: summarise(data.rows) } : {}),
      ...data,
    });
  }
  return { windowDays: DAYS, services };
}
