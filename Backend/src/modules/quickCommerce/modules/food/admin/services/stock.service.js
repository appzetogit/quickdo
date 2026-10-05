import mongoose from 'mongoose';
import { FoodItem } from '../models/food.model.js';
import { QCStockMovement } from '../models/stockMovement.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { recordMovement, syncAvailability, alertIfStockCrossed, invalidateStockCaches } from '../../orders/services/inventory.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { ApiError } from '../../../../../../utils/ApiError.js';
import { sellerIdsOfStoreType, applySellerScope } from '../../shared/storeScope.js';

/**
 * Stock management for quick-commerce and medical stores: one row per product
 * variant (or per product when it has none), per store.
 *
 * `restaurantId` scopes every call: a store passes its own id and can touch
 * nothing else; the admin may pass one or none.
 */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const tracked = (v) => v !== null && v !== undefined;

function statusOf(qty, low) {
  if (!tracked(qty)) return 'untracked';
  if (Number(qty) <= 0) return 'out';
  if (tracked(low) && Number(qty) <= Number(low)) return 'low';
  return 'in';
}

function rowsOf(doc, storeNames) {
  const base = {
    itemId: String(doc._id),
    restaurantId: String(doc.restaurantId),
    storeName: storeNames.get(String(doc.restaurantId)) || '',
    itemName: doc.name,
    image: doc.image || (Array.isArray(doc.images) ? doc.images[0] : '') || '',
    categoryName: doc.categoryName || '',
    isAvailable: doc.isAvailable !== false,
    manuallyOff: doc.isAvailable === false && Boolean(doc.stockOffMode),
  };
  const variants = doc.variants || [];
  if (!variants.length) {
    return [{
      ...base,
      variantId: '',
      variantName: '',
      sku: doc.sku || doc.skuCode || '',
      price: doc.price,
      stockQty: doc.stockQty ?? null,
      lowStockThreshold: doc.lowStockThreshold ?? null,
      status: statusOf(doc.stockQty, doc.lowStockThreshold),
    }];
  }
  return variants.map((v) => ({
    ...base,
    variantId: String(v._id),
    variantName: v.name,
    sku: v.sku || '',
    price: v.price,
    stockQty: v.stockQty ?? null,
    lowStockThreshold: v.lowStockThreshold ?? doc.lowStockThreshold ?? null,
    status: statusOf(v.stockQty, v.lowStockThreshold ?? doc.lowStockThreshold),
  }));
}

/*
 * The panel's storeType goes through the shared scope: Quick Commerce sends
 * "quick" (every type but pharmacy), which no store literally has, so matching
 * it as a type listed nothing. A picked store is kept only if it is in scope.
 */
async function storeFilter({ restaurantId, storeType }) {
  const filter = {};
  if (restaurantId) {
    if (!isId(restaurantId)) throw new ValidationError('Pick a valid store');
    filter.restaurantId = oid(restaurantId);
  }
  return applySellerScope(filter, await sellerIdsOfStoreType(FoodRestaurant, storeType));
}

export async function listStock(query = {}) {
  const filter = await storeFilter(query);
  const q = String(query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { 'variants.name': rx }, { 'variants.sku': rx }, { categoryName: rx }];
  }
  if (query.categoryId && isId(query.categoryId)) filter.categoryId = oid(query.categoryId);

  const docs = await FoodItem.find(filter)
    .select('name restaurantId image images categoryName price sku skuCode stockQty lowStockThreshold variants isAvailable stockOffMode')
    .sort({ name: 1 })
    .limit(3000)
    .lean();

  const storeIds = [...new Set(docs.map((d) => String(d.restaurantId)))];
  const storeDocs = storeIds.length
    ? await FoodRestaurant.find({ _id: { $in: storeIds } }).select('restaurantName name storeType').lean()
    : [];
  const storeNames = new Map(storeDocs.map((s) => [String(s._id), s.restaurantName || s.name || 'Store']));

  const all = docs.flatMap((d) => rowsOf(d, storeNames));
  const summary = {
    rows: all.length,
    tracked: all.filter((r) => r.status !== 'untracked').length,
    low: all.filter((r) => r.status === 'low').length,
    out: all.filter((r) => r.status === 'out').length,
    units: all.reduce((n, r) => n + (tracked(r.stockQty) ? Number(r.stockQty) : 0), 0),
  };

  const status = String(query.status || '').trim();
  let rows = all;
  if (status === 'attention') rows = rows.filter((r) => r.status === 'low' || r.status === 'out');
  else if (status) rows = rows.filter((r) => r.status === status);

  const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
  const page = Math.max(1, Number(query.page) || 1);
  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    summary,
    stores: storeDocs.map((st) => ({ id: String(st._id), name: storeNames.get(String(st._id)) })).sort((a, b) => a.name.localeCompare(b.name)),
    pagination: { page, limit, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / limit)) },
  };
}

/**
 * Change one count.
 *   mode 'set'   stock becomes `value` (null = stop tracking)
 *   mode 'add'   stock changes by `value` (may be negative, never below 0)
 * An `add` is one atomic $inc, so it cannot lose a sale that lands at the same
 * moment. A `set` is the seller's physical count and deliberately overwrites.
 */
export async function adjustStock({ itemId, variantId = '', mode = 'set', value, lowStockThreshold, restaurantId = null, actor, reason = 'manual', note = '' }) {
  if (!isId(itemId)) throw new ValidationError('Unknown product');
  const doc = await FoodItem.findById(itemId).select('name restaurantId stockQty lowStockThreshold variants isAvailable stockOffMode').lean();
  if (!doc) throw new ApiError(404, 'Product not found');
  if (restaurantId && String(doc.restaurantId) !== String(restaurantId)) throw new ApiError(403, 'This product belongs to another store');

  const onVariant = Boolean(variantId);
  const variant = onVariant ? (doc.variants || []).find((v) => String(v._id) === String(variantId)) : null;
  if (onVariant && !variant) throw new ValidationError('That variant no longer exists');

  const path = onVariant ? 'variants.$.stockQty' : 'stockQty';
  const lowPath = onVariant ? 'variants.$.lowStockThreshold' : 'lowStockThreshold';
  const match = onVariant ? { _id: doc._id, 'variants._id': variant._id } : { _id: doc._id };
  const current = onVariant ? variant.stockQty : doc.stockQty;

  const $set = {};
  if (lowStockThreshold !== undefined) {
    const low = lowStockThreshold === null || lowStockThreshold === '' ? null : Math.floor(Number(lowStockThreshold));
    if (low !== null && (!Number.isFinite(low) || low < 0)) throw new ValidationError('Low-stock level must be 0 or more');
    $set[lowPath] = low;
  }

  let update;
  let delta = 0;
  if (mode === 'add') {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n === 0) throw new ValidationError('Enter how many to add or remove');
    if (!tracked(current)) {
      // Adding to an untracked product starts tracking it at that number.
      if (n < 0) throw new ValidationError('This product is not tracked yet. Set a count first.');
      $set[path] = n;
      delta = n;
    } else {
      delta = Math.max(n, -Number(current));
      update = { $inc: { [path]: delta } };
    }
  } else if (value !== undefined) {
    if (value === null || value === '') {
      $set[path] = null;
    } else {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n < 0) throw new ValidationError('Stock must be 0 or more');
      $set[path] = n;
      delta = n - (Number(current) || 0);
    }
  }

  update = { ...(update || {}), ...(Object.keys($set).length ? { $set } : {}) };
  if (!Object.keys(update).length) throw new ValidationError('Nothing to change');

  const res = await FoodItem.findOneAndUpdate(match, update, {
    new: true,
    projection: 'name restaurantId stockQty lowStockThreshold variants isAvailable stockOffMode',
  }).lean();

  const after = onVariant ? (res.variants || []).find((v) => String(v._id) === String(variantId))?.stockQty : res.stockQty;
  if (delta !== 0 || (value === null && tracked(current)) || (!tracked(current) && tracked(after))) {
    await recordMovement(res, {
      variantId: onVariant ? String(variantId) : '',
      delta,
      after: after ?? null,
      reason: tracked(after) ? reason : 'tracking',
      actor,
      note: tracked(after) ? note : 'Stopped tracking stock',
    });
  }
  await syncAvailability(res, { revive: true });
  invalidateStockCaches(res.restaurantId);
  // A count lowered by hand (a damaged box, a miscount) warns like a sale does.
  if (tracked(current) && tracked(after) && Number(after) < Number(current)) {
    void alertIfStockCrossed(res, { variantId: onVariant ? String(variantId) : '', before: current, after });
  }
  return rowsOf(res, new Map()).find((r) => r.variantId === (onVariant ? String(variantId) : ''));
}

/** Several rows at once (bulk edit and sheet upload). Reports each row. */
export async function bulkAdjust(rows = [], { restaurantId = null, actor, reason = 'bulk' } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new ValidationError('Nothing to update');
  if (rows.length > 2000) throw new ValidationError('Upload at most 2000 rows at a time');
  const results = [];
  for (const [i, row] of rows.entries()) {
    try {
      let { itemId, variantId } = row;
      // A sheet may name the row by SKU alone.
      if (!itemId && row.sku) {
        const sku = String(row.sku).trim();
        const scope = restaurantId ? { restaurantId: oid(restaurantId) } : {};
        const doc = await FoodItem.findOne({ ...scope, $or: [{ 'variants.sku': sku }, { sku }, { skuCode: sku }] }).select('variants').lean();
        if (!doc) throw new ValidationError(`No product with SKU ${sku}`);
        itemId = String(doc._id);
        variantId = String((doc.variants || []).find((v) => v.sku === sku)?._id || '');
      }
      const out = await adjustStock({
        itemId,
        variantId: variantId || '',
        mode: row.mode === 'add' ? 'add' : 'set',
        value: row.value,
        lowStockThreshold: row.lowStockThreshold,
        restaurantId,
        actor,
        reason,
      });
      results.push({ row: i + 1, ok: true, stockQty: out?.stockQty ?? null });
    } catch (err) {
      results.push({ row: i + 1, ok: false, error: err.message });
    }
  }
  return { updated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

export async function stockHistory({ itemId, variantId = '', restaurantId = null, limit = 50 }) {
  if (!isId(itemId)) throw new ValidationError('Unknown product');
  const filter = { itemId: oid(itemId), variantId: variantId || '' };
  if (restaurantId) filter.restaurantId = oid(restaurantId);
  const rows = await QCStockMovement.find(filter).sort({ createdAt: -1 }).limit(Math.min(200, Number(limit) || 50)).lean();
  return rows.map((r) => ({
    id: String(r._id),
    at: r.createdAt,
    delta: r.delta,
    after: r.after,
    reason: r.reason,
    orderId: r.orderId ? String(r.orderId) : null,
    note: r.note,
    by: r.actor?.name || (r.actor?.role === 'system' ? 'Automatic' : r.actor?.role || ''),
  }));
}
