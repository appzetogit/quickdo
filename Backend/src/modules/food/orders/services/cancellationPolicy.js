import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * How long a customer may cancel a food order after the restaurant accepts it.
 *
 * Before this, a customer could cancel only while the order was waiting for the
 * restaurant ('created'); the moment it was accepted the option was gone. The
 * admin can now open a short window after acceptance (Food panel -> Order
 * cancellation). Off by default, so nothing changes until an admin turns it on.
 *
 * Never once the rider has the food: that rule lives in the status update path
 * and is repeated here, because the rider would go unpaid for the trip.
 */

const rulesSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    allowAfterAccept: { type: Boolean, default: false },
    /** Minutes after the restaurant accepted. */
    windowMinutes: { type: Number, default: 5, min: 1, max: 120 },
    /** Stop as soon as the kitchen marks it Preparing, even inside the window. */
    stopWhenPreparing: { type: Boolean, default: true },
    updatedBy: { type: String, default: '' },
  },
  { collection: 'food_order_cancel_rules', timestamps: true },
);

export const FoodOrderCancelRules = mongoose.models.FoodOrderCancelRules
  || mongoose.model('FoodOrderCancelRules', rulesSchema);

const DEFAULTS = { allowAfterAccept: false, windowMinutes: 5, stopWhenPreparing: true };
const TTL_MS = 30_000;
let cache = null;

/** Food's own rules, from its Order cancellation screen. */
async function foodOwnRules() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rules;
  const doc = await FoodOrderCancelRules.findOne({ key: 'default' }).lean();
  const rules = {
    allowAfterAccept: doc?.allowAfterAccept ?? DEFAULTS.allowAfterAccept,
    windowMinutes: doc?.windowMinutes ?? DEFAULTS.windowMinutes,
    stopWhenPreparing: doc?.stopWhenPreparing ?? DEFAULTS.stopWhenPreparing,
    updatedAt: doc?.updatedAt || null,
  };
  cache = { at: Date.now(), rules };
  return rules;
}

const MASTER_KEYS = {
  allowAfterAccept: 'orders.cancelAfterAccept',
  windowMinutes: 'orders.cancelWindowMinutes',
  stopWhenPreparing: 'orders.cancelStopWhenPreparing',
};

/**
 * The rules in force for one service.
 *
 * Master > Cancellation Policy wins for anything set there (for every service
 * or this one). Otherwise each service keeps its own: Food's Order
 * cancellation screen, and for Quick & Medical the rule it always had --
 * cancel only before the store accepts. Quick runs the same order flow as Food
 * (it is a fork of it), so judgeUserCancel below applies to its orders as is.
 *
 * A Master read that fails falls back to the service's own rule rather than
 * blocking or allowing every cancellation.
 *
 * @param {'food'|'quickCommerce'} vertical
 * @param {string} [zoneId]  the order's zone: a zone's own rules beat the service's
 */
export async function getCancelRules(vertical = 'food', zoneId) {
  const own = vertical === 'food'
    ? await foodOwnRules()
    : { ...DEFAULTS, updatedAt: null, sellerWord: 'store' };
  try {
    const { getMany } = await import('../../../../core/config/resolver.service.js');
    const rows = await getMany(Object.values(MASTER_KEYS), { vertical, zoneId: zoneId ? String(zoneId) : undefined });
    const out = { ...own, source: {} };
    for (const [field, key] of Object.entries(MASTER_KEYS)) {
      const row = rows[key];
      const set = row && !row.isDefault && row.value !== null && row.value !== undefined;
      if (set) out[field] = row.value;
      out.source[field] = set ? 'master' : 'service';
    }
    return out;
  } catch {
    return { ...own, source: { allowAfterAccept: 'service', windowMinutes: 'service', stopWhenPreparing: 'service' } };
  }
}

export async function setCancelRules(body = {}, actorId = '') {
  const set = {};
  if (body.allowAfterAccept !== undefined) set.allowAfterAccept = body.allowAfterAccept === true;
  if (body.stopWhenPreparing !== undefined) set.stopWhenPreparing = body.stopWhenPreparing === true;
  if (body.windowMinutes !== undefined) {
    const n = Math.floor(Number(body.windowMinutes));
    if (!Number.isFinite(n) || n < 1 || n > 120) throw new ValidationError('Choose between 1 and 120 minutes');
    set.windowMinutes = n;
  }
  set.updatedBy = String(actorId || '');
  await FoodOrderCancelRules.updateOne({ key: 'default' }, { $set: set, $setOnInsert: { key: 'default' } }, { upsert: true });
  cache = null;
  return foodCancelRulesForAdmin();
}

/**
 * What Food's own Order cancellation screen shows: Food's saved rules, and which
 * of them Master > Cancellation Policy is currently overriding. Editing an
 * overridden field here saves it but changes nothing until Master's is cleared,
 * so the screen needs to say so.
 */
export async function foodCancelRulesForAdmin() {
  const [own, inForce] = await Promise.all([foodOwnRules(), getCancelRules('food')]);
  const overriddenByMaster = Object.entries(inForce.source || {})
    .filter(([, from]) => from === 'master')
    .map(([field]) => field);
  return { ...own, overriddenByMaster, inForce: { allowAfterAccept: inForce.allowAfterAccept, windowMinutes: inForce.windowMinutes, stopWhenPreparing: inForce.stopWhenPreparing } };
}

export const clearCancelRulesCache = () => { cache = null; };

/** When the restaurant accepted: the last move into 'confirmed'. */
export function acceptedAtOf(order) {
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.to === 'confirmed' && history[i]?.at) return new Date(history[i].at);
  }
  return null;
}

const riderHasTheFood = (order) =>
  ['picked_up', 'reached_drop', 'delivered'].includes(order?.orderStatus)
  || ['en_route_to_delivery', 'at_drop'].includes(order?.deliveryState?.currentPhase);

/**
 * Can this customer cancel this order now?
 *   { allowed, until, reason }  -- `until` is when the window closes (null if
 *   there is no deadline, i.e. still waiting for the restaurant).
 */
export function judgeUserCancel(order, rules, now = new Date()) {
  // 'store' for Quick & Medical (getCancelRules sets it), 'restaurant' for Food.
  const seller = rules?.sellerWord || 'restaurant';
  const status = String(order?.orderStatus || '');
  if (status === 'created') return { allowed: true, until: null, reason: '' };
  if (status.startsWith('cancelled')) return { allowed: false, until: null, reason: 'This order is already cancelled' };
  if (riderHasTheFood(order)) {
    return { allowed: false, until: null, reason: 'This order has been picked up and can no longer be cancelled' };
  }
  if (!rules?.allowAfterAccept) {
    return { allowed: false, until: null, reason: `This order can no longer be cancelled: the ${seller} has accepted it` };
  }
  const open = rules.stopWhenPreparing ? ['confirmed'] : ['confirmed', 'preparing'];
  if (!open.includes(status)) {
    return {
      allowed: false,
      until: null,
      reason: status === 'preparing'
        ? `This order can no longer be cancelled: the ${seller} has started preparing it`
        : 'This order can no longer be cancelled',
    };
  }
  const accepted = acceptedAtOf(order) || (order?.updatedAt ? new Date(order.updatedAt) : null);
  if (!accepted) return { allowed: false, until: null, reason: 'This order can no longer be cancelled' };
  const until = new Date(accepted.getTime() + Number(rules.windowMinutes) * 60_000);
  if (now > until) {
    return {
      allowed: false,
      until,
      reason: `This order can no longer be cancelled: the ${seller} accepted it more than ${rules.windowMinutes} minute${Number(rules.windowMinutes) === 1 ? '' : 's'} ago`,
    };
  }
  return { allowed: true, until, reason: '' };
}

/** What the customer app shows: can cancel, until when, seconds left. */
export function cancellationForClient(order, rules, now = new Date()) {
  const verdict = judgeUserCancel(order, rules, now);
  return {
    allowed: verdict.allowed,
    until: verdict.until ? verdict.until.toISOString() : null,
    secondsLeft: verdict.allowed && verdict.until ? Math.max(0, Math.floor((verdict.until - now) / 1000)) : null,
    reason: verdict.reason,
    /*
     * The cancellation hold (core/orders/orderHold.js): while it runs the order
     * has not reached the restaurant yet, so the app can say "Sending to the
     * restaurant in 45s" next to Cancel. Null when there is no hold.
     */
    hold: order?.restaurantReleaseAt && !order?.restaurantReleasedAt
      ? {
        releasesAt: new Date(order.restaurantReleaseAt).toISOString(),
        secondsLeft: Math.max(0, Math.ceil((new Date(order.restaurantReleaseAt) - now) / 1000)),
      }
      : null,
  };
}
