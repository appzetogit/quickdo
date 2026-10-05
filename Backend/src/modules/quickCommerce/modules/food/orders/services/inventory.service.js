import mongoose from 'mongoose';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodOrder } from '../models/order.model.js';
import { QCStockMovement } from '../../admin/models/stockMovement.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Stock reservation for quick commerce.
 *
 * Food delivery never tracked quantities: a dish was a boolean, and a kitchen
 * that runs out just toggles it off. Groceries are countable, so an order has
 * to claim units at creation or two customers can both buy the last one and the
 * second finds out only after paying.
 *
 * Stock lives on the variant when the variant tracks it (500 g and 1 kg run out
 * separately), else on the item. `null` at either level means untracked, which
 * is every document that existed before stock did: it sells as it always has.
 */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const STOCK_FIELDS = 'name restaurantId stockQty lowStockThreshold variants isAvailable stockOffMode';

/** Same item can appear on several lines; the shelf sees the sum. Kept for callers. */
export function totalQuantityByItem(items = []) {
  const totals = new Map();
  for (const item of items) {
    const id = String(item?.itemId || '');
    if (!id || !isId(id)) continue;
    const qty = Math.max(1, Number(item?.quantity) || 1);
    totals.set(id, (totals.get(id) || 0) + qty);
  }
  return totals;
}

/** Lines grouped by item + variant. */
function totalsByLine(items = []) {
  const totals = new Map();
  for (const item of items) {
    const itemId = String(item?.itemId || '');
    if (!itemId || !isId(itemId)) continue;
    const variantId = isId(item?.variantId) ? String(item.variantId) : '';
    const key = `${itemId}|${variantId}`;
    const qty = Math.max(1, Number(item?.quantity) || 1);
    const prev = totals.get(key);
    totals.set(key, { itemId, variantId, qty: (prev?.qty || 0) + qty });
  }
  return [...totals.values()];
}

const variantOf = (doc, variantId) =>
  variantId ? (doc?.variants || []).find((v) => String(v._id) === String(variantId)) : null;

/**
 * Out of stock = nothing left that can be sold: every variant tracked and at
 * zero, or (no variants) the item's own count at zero. Hides the item so the
 * listing and search filters, which key off isAvailable, keep working.
 * `revive` brings back an item that went dark by running out; a seller who
 * switched it off by hand set stockOffMode, and that outranks a restock.
 */
export async function syncAvailability(doc, { revive = false } = {}) {
  if (!doc?._id) return;
  const variants = doc.variants || [];
  const out = variants.length > 0
    ? variants.every((v) => v.stockQty !== null && v.stockQty !== undefined && Number(v.stockQty) <= 0)
      || (doc.stockQty !== null && doc.stockQty !== undefined && Number(doc.stockQty) <= 0)
    : doc.stockQty !== null && doc.stockQty !== undefined && Number(doc.stockQty) <= 0;

  if (out && doc.isAvailable !== false) {
    await FoodItem.updateOne({ _id: doc._id }, { $set: { isAvailable: false } });
  } else if (!out && revive && doc.isAvailable === false && !doc.stockOffMode) {
    await FoodItem.updateOne({ _id: doc._id, stockOffMode: { $in: [null, undefined] } }, { $set: { isAvailable: true } });
  }
}

/**
 * Tell the store when a count runs low or out.
 *
 * Fires on the CROSSING only -- the sale that takes a size from above its
 * "warn me at" level to at-or-below it, or from something to nothing -- so one
 * drop sends one alert, not one per sale while it stays low. In-app (the
 * notifications list) and push. Never throws, never blocks the sale.
 */
export async function alertIfStockCrossed(doc, { variantId = '', before, after }) {
  try {
    if (!doc?.restaurantId || after === null || after === undefined || before === null || before === undefined) return;
    const variant = variantOf(doc, variantId);
    const low = variant ? (variant.lowStockThreshold ?? doc.lowStockThreshold) : doc.lowStockThreshold;
    const ranOut = Number(before) > 0 && Number(after) <= 0;
    const wentLow = !ranOut && low !== null && low !== undefined
      && Number(before) > Number(low) && Number(after) <= Number(low);
    if (!ranOut && !wentLow) return;

    const label = variant ? `${doc.name} (${variant.name})` : doc.name;
    const title = ranOut ? 'Out of stock' : 'Running low on stock';
    const message = ranOut
      ? `${label} just sold out and is hidden from customers. Restock it to start selling again.`
      : `Only ${after} left of ${label}. Restock soon so it does not sell out.`;
    const data = {
      type: ranOut ? 'stock_out' : 'stock_low',
      itemId: String(doc._id),
      variantId: variantId ? String(variantId) : '',
      restaurantId: String(doc.restaurantId),
      left: String(after),
      link: '/restaurant/stock',
    };

    const { FoodNotification } = await import('../../../../core/notifications/models/notification.model.js');
    await FoodNotification.create({
      ownerType: 'RESTAURANT',
      ownerId: doc.restaurantId,
      title,
      message,
      link: '/restaurant/stock',
      source: 'STOCK_ALERT',
      category: 'inventory',
      metadata: data,
    }).catch((err) => logger.warn(`[stock] in-app alert not saved: ${err?.message || err}`));

    const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
    await notifyOwnersSafely([{ ownerType: 'RESTAURANT', ownerId: doc.restaurantId }], { title, body: message, data });
  } catch (err) {
    logger.warn(`[stock] alert failed for ${doc?._id}: ${err?.message || err}`);
  }
}

/*
 * What the customer app reads stock from is cached (store menu 10 min, product
 * list 5, search 30 s), so a count that changed in Mongo kept showing the old
 * number -- "3 left" on something that had just sold out. Every stock change
 * passes through recordMovement, so the clear hangs off it.
 *
 * Coalesced per store: an order of six lines is one clear, not six KEYS scans.
 * Quick-commerce URLs only; food's caches share these prefixes.
 */
const pendingCacheClears = new Set();
let cacheClearTimer = null;
export function invalidateStockCaches(restaurantId) {
  if (restaurantId) pendingCacheClears.add(String(restaurantId));
  if (cacheClearTimer) return;
  cacheClearTimer = setTimeout(async () => {
    const stores = [...pendingCacheClears];
    pendingCacheClears.clear();
    cacheClearTimer = null;
    try {
      const { invalidateCache } = await import('../../../../../../middleware/cache.js');
      await Promise.all([
        ...stores.map((id) => invalidateCache(`restaurant_menu:GET:/api/v1/qc/restaurant/restaurants/${id}/menu*`)),
        invalidateCache('public_foods:GET:/api/v1/qc/*'),
        invalidateCache('search_products:GET:/api/v1/qc/*'),
      ]);
    } catch (err) {
      logger.warn(`[stock] cache clear failed: ${err?.message || err}`);
    }
  }, 100);
  cacheClearTimer.unref?.();
}

/** One line in the stock record. Never throws. */
export async function recordMovement(doc, { variantId = '', delta, after, reason, orderId = null, actor = null, note = '' }) {
  invalidateStockCaches(doc?.restaurantId);
  try {
    const variant = variantOf(doc, variantId);
    await QCStockMovement.create({
      restaurantId: doc?.restaurantId || null,
      itemId: doc._id,
      variantId: variantId || '',
      itemName: doc?.name || '',
      variantName: variant?.name || '',
      delta,
      after: after ?? null,
      reason,
      orderId: orderId && isId(orderId) ? orderId : null,
      note,
      actor: actor || { role: 'system', id: '', name: '' },
    });
  } catch (err) {
    logger.warn(`[stock] movement not recorded for ${doc?._id}: ${err?.message || err}`);
  }
}

/**
 * Decrements stock for every tracked line on the order.
 *
 * Each decrement is a conditional update, so the check and the write are one
 * atomic operation and concurrent orders cannot both pass a "do we have enough"
 * read. If any line comes up short, the ones already taken are put back before
 * throwing — a rejected order must leave the shelf exactly as it found it.
 */
export async function reserveStockForItems(items = [], { orderId = null } = {}) {
  const lines = totalsByLine(items);
  if (lines.length === 0) return [];

  const docs = new Map(
    (await FoodItem.find({ _id: { $in: [...new Set(lines.map((l) => l.itemId))] } }).select(STOCK_FIELDS).lean())
      .map((d) => [String(d._id), d]),
  );

  const taken = [];
  const itemLevel = new Map();

  const fail = async (message) => {
    await releaseReservations(taken, { orderId });
    throw new ValidationError(message);
  };

  for (const line of lines) {
    const doc = docs.get(line.itemId);
    if (!doc) return fail('One or more items are no longer available');
    const variant = variantOf(doc, line.variantId);

    if (variant && variant.stockQty !== null && variant.stockQty !== undefined) {
      const res = await FoodItem.findOneAndUpdate(
        { _id: doc._id, variants: { $elemMatch: { _id: variant._id, stockQty: { $gte: line.qty } } } },
        { $inc: { 'variants.$.stockQty': -line.qty } },
        { new: true, projection: STOCK_FIELDS },
      ).lean();
      if (res) {
        taken.push({ itemId: line.itemId, variantId: line.variantId, qty: line.qty });
        const after = variantOf(res, line.variantId)?.stockQty;
        await recordMovement(res, { variantId: line.variantId, delta: -line.qty, after, reason: 'sale', orderId });
        await syncAvailability(res);
        void alertIfStockCrossed(res, { variantId: line.variantId, before: Number(after) + line.qty, after });
        continue;
      }
      const fresh = await FoodItem.findById(doc._id).select(STOCK_FIELDS).lean();
      const left = Number(variantOf(fresh, line.variantId)?.stockQty) || 0;
      const label = `${doc.name} (${variant.name})`;
      return fail(left > 0 ? `Only ${left} left of ${label}. Please reduce the quantity.` : `${label} just went out of stock`);
    }

    itemLevel.set(line.itemId, (itemLevel.get(line.itemId) || 0) + line.qty);
  }

  for (const [itemId, qty] of itemLevel) {
    const doc = docs.get(itemId);
    if (doc.stockQty === null || doc.stockQty === undefined) continue; // untracked

    // `$gte` never matches null, so an untracked item is never decremented into negatives.
    const res = await FoodItem.findOneAndUpdate(
      { _id: doc._id, stockQty: { $gte: qty } },
      { $inc: { stockQty: -qty } },
      { new: true, projection: STOCK_FIELDS },
    ).lean();

    if (res) {
      taken.push({ itemId, variantId: '', qty });
      await recordMovement(res, { delta: -qty, after: res.stockQty, reason: 'sale', orderId });
      await syncAvailability(res);
      void alertIfStockCrossed(res, { before: Number(res.stockQty) + qty, after: res.stockQty });
      continue;
    }

    const fresh = await FoodItem.findById(doc._id).select('name stockQty').lean();
    if (!fresh) return fail('One or more items are no longer available');
    if (fresh.stockQty === null || fresh.stockQty === undefined) continue;
    const left = Number(fresh.stockQty) || 0;
    return fail(left > 0 ? `Only ${left} left of ${fresh.name}. Please reduce the quantity.` : `${fresh.name} just went out of stock`);
  }

  return taken;
}

/** Puts back a partial reservation after a failed line. Never throws. */
export async function releaseReservations(taken = [], { orderId = null } = {}) {
  for (const entry of taken) {
    try {
      await incrementStock(entry.itemId, entry.qty, entry.variantId || '', { reason: 'cancel', orderId, note: 'Order not placed' });
    } catch (err) {
      logger.error(
        `[CRITICAL] stock rollback failed for item ${entry.itemId}/${entry.variantId || '-'} (+${entry.qty}): ${err?.message || err}`,
      );
    }
  }
}

/**
 * Put `qty` back on the shelf. On the variant when that variant tracks stock,
 * else on the item. Used by cancels, rollbacks and the returns flow, so the
 * "only revive an item that went dark by running out" rule lives in one place.
 */
export async function incrementStock(itemId, qty, variantId = '', meta = {}) {
  const id = new mongoose.Types.ObjectId(String(itemId));
  const n = Math.max(0, Number(qty) || 0);
  if (!n) return;

  let res = null;
  if (isId(variantId)) {
    res = await FoodItem.findOneAndUpdate(
      { _id: id, variants: { $elemMatch: { _id: new mongoose.Types.ObjectId(String(variantId)), stockQty: { $ne: null } } } },
      { $inc: { 'variants.$.stockQty': n } },
      { new: true, projection: STOCK_FIELDS },
    ).lean();
    if (res) {
      await recordMovement(res, { variantId: String(variantId), delta: n, after: variantOf(res, variantId)?.stockQty, reason: meta.reason || 'cancel', orderId: meta.orderId, actor: meta.actor, note: meta.note });
      await syncAvailability(res, { revive: true });
      return;
    }
  }

  res = await FoodItem.findOneAndUpdate(
    { _id: id, stockQty: { $ne: null } },
    { $inc: { stockQty: n } },
    { new: true, projection: STOCK_FIELDS },
  ).lean();
  if (res) {
    await recordMovement(res, { delta: n, after: res.stockQty, reason: meta.reason || 'cancel', orderId: meta.orderId, actor: meta.actor, note: meta.note });
    await syncAvailability(res, { revive: true });
  }
}

/**
 * Returns an order's reserved stock to the shelf.
 *
 * Safe to call from anywhere an order dies — cancellation by user, seller,
 * admin or the acceptance timeout, and the two delete paths. The claim on
 * `stockRestoredAt` is what makes that safe: several of those paths can fire
 * for the same order, and a double restock would quietly invent inventory.
 */
export async function restoreOrderStock(orderLike) {
  const orderId = orderLike?._id;
  if (!orderId) return false;
  if (!orderLike?.stockReservedAt) return false; // pre-inventory or never reserved

  const claimed = await FoodOrder.findOneAndUpdate(
    { _id: orderId, stockReservedAt: { $ne: null }, stockRestoredAt: null },
    { $set: { stockRestoredAt: new Date() } },
    { new: true, projection: { items: 1 } },
  ).lean();

  if (!claimed) return false; // already restored, or nothing to restore

  for (const line of totalsByLine(claimed.items)) {
    try {
      await incrementStock(line.itemId, line.qty, line.variantId, { reason: 'cancel', orderId });
    } catch (err) {
      logger.error(
        `[CRITICAL] restock failed for order ${orderId} item ${line.itemId} (+${line.qty}): ${err?.message || err}`,
      );
    }
  }

  return true;
}
