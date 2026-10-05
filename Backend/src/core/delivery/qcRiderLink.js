import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * One rider, two rider records.
 *
 * Food and Quick & Medical keep separate rider pools (food_delivery_partners,
 * qc_delivery_partners). The delivery app only ever signs in, goes online and
 * sends its location through the FOOD side, so the Quick pool stayed offline
 * and Quick / Medical orders were never offered to anyone.
 *
 * This links the two records of the same person (same phone, or the same
 * unified driver) so that:
 *   - Quick dispatch can find riders who are online on the Food side,
 *   - Quick offers reach the rider where the app listens (Food socket + push),
 *   - the Food rider endpoints can act on a Quick order as the linked Quick rider.
 */

const last10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

const cache = new Map(); // key -> { value, at }
const TTL_MS = 60 * 1000;
const cached = async (key, load) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await load();
  if (value) cache.set(key, { value, at: Date.now() });
  return value;
};

const models = async () => {
  const [{ FoodDeliveryPartner: FoodRider }, { FoodDeliveryPartner: QcRider }] = await Promise.all([
    import('../../modules/food/delivery/models/deliveryPartner.model.js'),
    import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js'),
  ]);
  return { FoodRider, QcRider };
};

/**
 * The Quick rider record for a Food rider, created when missing (same name,
 * phone, vehicle and approval). Returns its id as a string, or null.
 */
export async function qcRiderIdForFoodRider(foodRiderId) {
  if (!foodRiderId || !mongoose.Types.ObjectId.isValid(String(foodRiderId))) return null;
  return cached(`f2q:${foodRiderId}`, async () => {
    try {
      const { FoodRider, QcRider } = await models();
      const food = await FoodRider.findById(foodRiderId)
        .select('name phone countryCode email vehicleType vehicleName vehicleNumber status driverId')
        .lean();
      if (!food) return null;
      const phone = last10(food.phone);
      let qc = null;
      if (food.driverId) qc = await QcRider.findOne({ driverId: food.driverId }).select('_id').lean();
      if (!qc && phone) qc = await QcRider.findOne({ phone: { $regex: `${phone}$` } }).select('_id').lean();
      if (!qc) {
        const created = await QcRider.create({
          name: food.name || 'Rider',
          phone: food.phone,
          countryCode: food.countryCode || '+91',
          ...(food.email ? { email: food.email } : {}),
          vehicleType: food.vehicleType || '',
          vehicleName: food.vehicleName || '',
          ...(food.vehicleNumber ? { vehicleNumber: food.vehicleNumber } : {}),
          status: food.status === 'approved' ? 'approved' : 'pending',
          ...(food.driverId ? { driverId: food.driverId } : {}),
        });
        qc = { _id: created._id };
        logger.info(`[qcRiderLink] created Quick rider ${created._id} for Food rider ${foodRiderId}`);
      }
      return String(qc._id);
    } catch (err) {
      logger.warn(`[qcRiderLink] link failed for Food rider ${foodRiderId}: ${err.message}`);
      return null;
    }
  });
}

/** The Food rider record for a Quick rider (same driver or phone), or null. */
export async function foodRiderIdForQcRider(qcRiderId) {
  if (!qcRiderId || !mongoose.Types.ObjectId.isValid(String(qcRiderId))) return null;
  return cached(`q2f:${qcRiderId}`, async () => {
    try {
      const { FoodRider, QcRider } = await models();
      const qc = await QcRider.findById(qcRiderId).select('phone driverId').lean();
      if (!qc) return null;
      let food = null;
      if (qc.driverId) food = await FoodRider.findOne({ driverId: qc.driverId }).select('_id').lean();
      const phone = last10(qc.phone);
      if (!food && phone) food = await FoodRider.findOne({ phone: { $regex: `${phone}$` } }).select('_id').lean();
      return food ? String(food._id) : null;
    } catch (err) {
      logger.warn(`[qcRiderLink] reverse link failed for Quick rider ${qcRiderId}: ${err.message}`);
      return null;
    }
  });
}

/**
 * Riders online on the Food side, as Quick rider candidates: Quick rider id
 * plus the Food rider's live status and position. Used by Quick dispatch.
 */
export async function onlineFoodRidersAsQcCandidates() {
  const { FoodRider } = await models();
  const online = await FoodRider.find({ availabilityStatus: 'online' })
    .select('_id status lastLat lastLng lastLocationAt name')
    .lean();
  const out = [];
  for (const r of online) {
    // eslint-disable-next-line no-await-in-loop
    const qcId = await qcRiderIdForFoodRider(r._id);
    if (!qcId) continue;
    out.push({ ...r, _id: new mongoose.Types.ObjectId(qcId), foodRiderId: String(r._id) });
  }
  return out;
}

/** Whether an order id (mongo id or display id) is a Quick / Medical order. */
export async function isQcOrderId(orderId) {
  const raw = String(orderId || '').trim();
  if (!raw) return false;
  const [{ FoodOrder }, { FoodOrder: QcOrder }] = await Promise.all([
    import('../../modules/food/orders/models/order.model.js'),
    import('../../modules/quickCommerce/modules/food/orders/models/order.model.js'),
  ]);
  const filter = mongoose.Types.ObjectId.isValid(raw)
    ? { _id: new mongoose.Types.ObjectId(raw) }
    : { $or: [{ order_id: raw }, { orderId: raw }, { previousOrderIds: raw }] };
  if (await FoodOrder.exists(filter)) return false;
  return Boolean(await QcOrder.exists(filter));
}

/**
 * Send a Quick offer to the linked Food rider too: the Food socket room the
 * delivery app joins, and the Food rider's push tokens. Never throws.
 */
export async function mirrorQcOfferToFoodRider(qcRiderId, { event, payload, push } = {}) {
  try {
    const foodRiderId = await foodRiderIdForQcRider(qcRiderId);
    if (!foodRiderId) return false;
    const { getIO, rooms } = await import('../../config/socket.js');
    const io = getIO?.();
    // The app knows only its Food rider id: name the rider by that in the offer.
    const forApp = payload == null ? payload
      : JSON.parse(JSON.stringify(payload).split(String(qcRiderId)).join(String(foodRiderId)));
    if (io && event) io.to(rooms?.delivery ? rooms.delivery(foodRiderId) : `delivery:${foodRiderId}`).emit(event, forApp);
    if (push) {
      const { notifyOwnersActionableAlert } = await import('../notifications/firebase.service.js');
      await notifyOwnersActionableAlert([{ ownerType: 'DELIVERY_PARTNER', ownerId: foodRiderId }], push);
    }
    return true;
  } catch (err) {
    logger.warn(`[qcRiderLink] mirror offer to Food rider failed (${qcRiderId}): ${err.message}`);
    return false;
  }
}

/**
 * Copy a Food rider's online status and position to their Quick rider record,
 * so Quick's own distance checks (available list, accept) see where they are.
 * Called on every go-online / heartbeat. Never throws.
 */
export async function syncQcRiderFromFood(foodRiderId, { availabilityStatus, lat, lng, status } = {}) {
  try {
    const qcId = await qcRiderIdForFoodRider(foodRiderId);
    if (!qcId) return false;
    const { QcRider } = await models();
    const set = {};
    if (availabilityStatus) set.availabilityStatus = availabilityStatus;
    // Approval state follows the Food record: a rider deleted, rejected or
    // re-approved there was left "approved" on the Quick side, so the Quick
    // rider list kept counting people who no longer work.
    if (status) set.status = status;
    if (typeof lat === 'number' && typeof lng === 'number') {
      Object.assign(set, {
        lastLat: lat, lastLng: lng, lastLocationAt: new Date(),
        lastLocation: { type: 'Point', coordinates: [lng, lat] },
      });
    }
    if (Object.keys(set).length) await QcRider.updateOne({ _id: qcId }, { $set: set });
    return true;
  } catch (err) {
    logger.warn(`[qcRiderLink] sync to Quick rider failed for ${foodRiderId}: ${err.message}`);
    return false;
  }
}

/*
 * One rider, one job across Food and Quick/Medical.
 *
 * Each side's busy check only looked at its own orders, and the cross-service
 * busy-lock is a no-op for riders with no unified driver record -- which is
 * every rider who signed up through the Food app. So a rider carrying a Food
 * order could be offered and accept a Medical order, and the reverse.
 */
const activeJobFilter = (partnerIds) => ({
  'dispatch.status': 'accepted',
  'dispatch.deliveryPartnerId': { $in: partnerIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
  orderStatus: { $nin: ['delivered', 'completed', 'rejected'], $not: /^cancel/ },
});

const orderModels = async () => {
  const [{ FoodOrder }, { FoodOrder: QcOrder }] = await Promise.all([
    import('../../modules/food/orders/models/order.model.js'),
    import('../../modules/quickCommerce/modules/food/orders/models/order.model.js'),
  ]);
  return { FoodOrder, QcOrder };
};

/** Whether this Food rider is carrying a Quick/Medical order. */
export async function foodRiderHasQcJob(foodRiderId) {
  const qcId = await qcRiderIdForFoodRider(foodRiderId);
  if (!qcId) return false;
  const { QcOrder } = await orderModels();
  return Boolean(await QcOrder.exists(activeJobFilter([qcId])));
}

/** Whether this Quick rider's Food record is carrying a Food order. */
export async function qcRiderHasFoodJob(qcRiderId) {
  const foodId = await foodRiderIdForQcRider(qcRiderId);
  if (!foodId) return false;
  const { FoodOrder } = await orderModels();
  return Boolean(await FoodOrder.exists(activeJobFilter([foodId])));
}

/** Of these Food riders, the ids (strings) carrying a Quick/Medical order. */
export async function foodRidersOnQcJobs(foodRiderIds = []) {
  const pairs = (await Promise.all(foodRiderIds.map(async (f) => [String(f), await qcRiderIdForFoodRider(f)])))
    .filter(([, q]) => q);
  if (!pairs.length) return new Set();
  const { QcOrder } = await orderModels();
  const rows = await QcOrder.find(activeJobFilter(pairs.map(([, q]) => q))).select('dispatch.deliveryPartnerId').lean();
  const busyQc = new Set(rows.map((r) => String(r.dispatch.deliveryPartnerId)));
  return new Set(pairs.filter(([, q]) => busyQc.has(q)).map(([f]) => f));
}

/** Of these Quick riders, the ids (strings) whose Food record is carrying a Food order. */
export async function qcRidersOnFoodJobs(qcRiderIds = []) {
  const pairs = (await Promise.all(qcRiderIds.map(async (q) => [String(q), await foodRiderIdForQcRider(q)])))
    .filter(([, f]) => f);
  if (!pairs.length) return new Set();
  const { FoodOrder } = await orderModels();
  const rows = await FoodOrder.find(activeJobFilter(pairs.map(([, f]) => f))).select('dispatch.deliveryPartnerId').lean();
  const busyFood = new Set(rows.map((r) => String(r.dispatch.deliveryPartnerId)));
  return new Set(pairs.filter(([, f]) => busyFood.has(f)).map(([q]) => q));
}
