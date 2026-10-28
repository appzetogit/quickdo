import mongoose from 'mongoose';
import { FoodRestaurantCommission } from '../models/restaurantCommission.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { MEDICAL_STORE_TYPE } from '../../shared/storeType.js';
import { ValidationError } from '../../../../../../core/auth/errors.js';

/**
 * Commission for medical shops (admin: Medical, Commission).
 *
 * A pharmacy's own rate lives in the same qc_restaurant_commissions table every
 * quick-commerce seller uses, so order pricing, pharmacy earnings and
 * settlements pick it up unchanged. What medical adds is a default: a pharmacy
 * with no rate of its own pays the default instead of nothing.
 *
 * Rates apply to orders placed after they are saved; an order keeps the
 * commission it was priced with.
 */

const defaultSchema = new mongoose.Schema(
    {
        _id: { type: String, default: 'medical' },
        type: { type: String, enum: ['percentage', 'amount'], default: 'percentage' },
        value: { type: Number, default: 0 },
        updatedBy: { type: String, default: '' },
    },
    { collection: 'qc_medical_commission_default', timestamps: true },
);
export const QCMedicalCommissionDefault =
    mongoose.models.QCMedicalCommissionDefault || mongoose.model('QCMedicalCommissionDefault', defaultSchema);

const CACHE_MS = 30 * 1000;
let cached = null;
let cachedAt = 0;
const storeTypeCache = new Map();

export const clearMedicalCommissionCache = () => { cached = null; cachedAt = 0; };

const normalizeRate = (body = {}) => {
    const type = body.type === 'amount' ? 'amount' : 'percentage';
    const value = Number(body.value);
    if (!Number.isFinite(value) || value < 0) throw new ValidationError('Enter a commission of 0 or more');
    if (type === 'percentage' && value > 100) throw new ValidationError('A percentage cannot be more than 100');
    if (type === 'amount' && value > 100000) throw new ValidationError('That amount is too high');
    return { type, value: Math.round(value * 100) / 100 };
};

export async function getMedicalDefaultCommission() {
    if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
    const doc = await QCMedicalCommissionDefault.findById('medical').lean();
    cached = { type: doc?.type || 'percentage', value: Number(doc?.value) || 0 };
    cachedAt = Date.now();
    return cached;
}

export async function setMedicalDefaultCommission(body, adminId) {
    const rate = normalizeRate(body);
    await QCMedicalCommissionDefault.updateOne(
        { _id: 'medical' },
        { $set: { ...rate, updatedBy: String(adminId || '') } },
        { upsert: true },
    );
    clearMedicalCommissionCache();
    return rate;
}

/** The default rule for this seller when it is a pharmacy, else null. */
export async function medicalFallbackRule(restaurantId) {
    const id = String(restaurantId || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    let type = storeTypeCache.get(id);
    if (type === undefined) {
        const r = await FoodRestaurant.findById(id).select('storeType').lean();
        type = r?.storeType || '';
        storeTypeCache.set(id, type);
        if (storeTypeCache.size > 5000) storeTypeCache.clear();
    }
    if (type !== MEDICAL_STORE_TYPE) return null;
    const rate = await getMedicalDefaultCommission();
    return rate.value > 0 ? { defaultCommission: rate } : null;
}

/** Every pharmacy with the rate it pays and where that rate comes from. */
export async function listMedicalCommissions({ search = '', status = '' } = {}) {
    const q = { storeType: MEDICAL_STORE_TYPE };
    if (['pending', 'approved', 'rejected'].includes(status)) q.status = status;
    const s = String(search || '').trim();
    if (s) q.restaurantName = { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const shops = await FoodRestaurant.find(q)
        .select('restaurantName status zoneId ownerPhone city')
        .populate({ path: 'zoneId', select: 'name zoneName' })
        .sort({ restaurantName: 1 })
        .limit(1000)
        .lean();
    const rules = await FoodRestaurantCommission.find({ restaurantId: { $in: shops.map((x) => x._id) } }).lean();
    const byShop = new Map(rules.map((r) => [String(r.restaurantId), r]));
    const def = await getMedicalDefaultCommission();
    return {
        default: def,
        shops: shops.map((shop) => {
            const rule = byShop.get(String(shop._id));
            const own = rule && rule.status !== false;
            return {
                id: String(shop._id),
                name: shop.restaurantName || '',
                status: shop.status,
                zone: shop.zoneId?.name || shop.zoneId?.zoneName || '',
                rate: own ? { type: rule.defaultCommission?.type || 'percentage', value: Number(rule.defaultCommission?.value) || 0 } : def,
                source: own ? 'own' : 'default',
            };
        }),
    };
}

async function assertPharmacy(restaurantId) {
    if (!mongoose.Types.ObjectId.isValid(String(restaurantId || ''))) throw new ValidationError('Unknown pharmacy');
    const shop = await FoodRestaurant.findById(restaurantId).select('storeType').lean();
    if (!shop || shop.storeType !== MEDICAL_STORE_TYPE) {
        const err = new ValidationError('That shop is not a pharmacy');
        err.statusCode = 404;
        throw err;
    }
}

export async function setShopCommission(restaurantId, body) {
    await assertPharmacy(restaurantId);
    const rate = normalizeRate(body);
    await FoodRestaurantCommission.updateOne(
        { restaurantId },
        { $set: { restaurantId, defaultCommission: rate, status: true } },
        { upsert: true },
    );
    return { id: String(restaurantId), rate, source: 'own' };
}

/** Back to the default. */
export async function clearShopCommission(restaurantId) {
    await assertPharmacy(restaurantId);
    await FoodRestaurantCommission.deleteOne({ restaurantId });
    return { id: String(restaurantId), rate: await getMedicalDefaultCommission(), source: 'default' };
}

/**
 * The rate this seller pays on new orders, for its own finance screen:
 * { type, value, source: 'own' | 'default' | 'none' }.
 */
export async function currentCommissionFor(restaurantId) {
    if (!mongoose.Types.ObjectId.isValid(String(restaurantId || ''))) return { type: 'percentage', value: 0, source: 'none' };
    const rule = await FoodRestaurantCommission.findOne({ restaurantId, status: { $ne: false } }).lean();
    if (rule) {
        return { type: rule.defaultCommission?.type || 'percentage', value: Number(rule.defaultCommission?.value) || 0, source: 'own' };
    }
    const fallback = await medicalFallbackRule(restaurantId);
    if (fallback) return { ...fallback.defaultCommission, source: 'default' };
    return { type: 'percentage', value: 0, source: 'none' };
}
