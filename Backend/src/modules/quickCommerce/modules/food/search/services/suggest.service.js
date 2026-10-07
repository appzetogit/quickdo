import mongoose from 'mongoose';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { QUICK_SHOP_SELLER_FILTER } from '../../shared/storeType.js';
import { serializeFoodVariants } from '../../admin/services/foodVariant.service.js';
import { suggest, listRecentSearches } from '../../../../../../core/search/suggest.service.js';
import { barcodeCandidates } from '../../../../../../core/catalog/barcode.js';

/**
 * Quick commerce's catalogue for the shared search suggestions (plan §5.5) and
 * barcode lookup (plan §5.6). The logic lives in core; this only says which
 * stores and products are live here.
 */

export const QC_VERTICAL = 'quickCommerce';

async function liveSellerIds(zoneId) {
  const filter = { status: 'approved', ...QUICK_SHOP_SELLER_FILTER };
  if (zoneId && mongoose.Types.ObjectId.isValid(String(zoneId))) filter.zoneId = new mongoose.Types.ObjectId(String(zoneId));
  const rows = await FoodRestaurant.find(filter).select('_id').lean();
  return rows.map((r) => r._id);
}

export async function suggestQc({ q, limit, zoneId, userId }) {
  const sellerIds = await liveSellerIds(zoneId);
  const result = await suggest({
    q,
    limit,
    ItemModel: FoodItem,
    CategoryModel: FoodCategory,
    OrderModel: FoodOrder,
    itemFilter: { restaurantId: { $in: sellerIds }, approvalStatus: 'approved', isAvailable: { $ne: false } },
    categoryFilter: { isActive: { $ne: false } },
  });
  return { ...result, recent: userId ? await listRecentSearches(userId, QC_VERTICAL) : [] };
}

/**
 * Products with this barcode from live stores (in the zone, when given),
 * in-stock first. The same product sold by several stores comes back once
 * per store, so the app can pick the nearest seller.
 */
export async function findProductsByBarcode(code, { zoneId } = {}) {
  const candidates = barcodeCandidates(code);
  if (!candidates.length) return { code: '', products: [] };
  const sellerIds = await liveSellerIds(zoneId);
  const sellers = await FoodRestaurant.find({ _id: { $in: sellerIds } })
    .select('restaurantName profileImage isAcceptingOrders zoneId')
    .lean();
  const sellerById = new Map(sellers.map((s) => [String(s._id), s]));
  const rows = await FoodItem.find({
    restaurantId: { $in: sellerIds },
    approvalStatus: 'approved',
    barcode: { $in: candidates },
  })
    .select('_id restaurantId name brand packSize image images price otherPrice mrp categoryId categoryName foodType isAvailable stockQty maxQtyPerOrder variants barcode sku gstRate')
    .limit(50)
    .lean();
  const products = rows
    .map((p) => {
      const seller = sellerById.get(String(p.restaurantId));
      return {
        ...p,
        id: String(p._id),
        storeId: String(p.restaurantId),
        variants: serializeFoodVariants ? serializeFoodVariants(p.variants || []) : p.variants || [],
        inStock: p.isAvailable !== false && (p.stockQty == null || Number(p.stockQty) > 0),
        store: seller
          ? { id: String(seller._id), name: seller.restaurantName, image: seller.profileImage || '', isAcceptingOrders: seller.isAcceptingOrders !== false }
          : null,
      };
    })
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || (Number(a.price) || 0) - (Number(b.price) || 0));
  return { code: candidates[0], products };
}
