import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodAddon } from '../models/foodAddon.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { logger } from '../../../../utils/logger.js';

const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Drops the cached public add-on responses.
 *
 * `GET /restaurants/:id/addons` is cached for 600s and NOTHING was clearing it, so a
 * newly created, edited, approved or deleted add-on could take ten minutes to appear
 * in the user app. Keyed per foodId as well, so a targeted delete would have to know
 * every item id; wiping the whole prefix is both simpler and complete, and add-on
 * edits are far too rare for the extra misses to matter.
 */
export async function invalidatePublicAddonCache() {
    try {
        const { invalidateCache } = await import('../../../../middleware/cache.js');
        await invalidateCache('restaurant_addons:*');
    } catch (err) {
        logger.warn(`Add-on cache invalidation failed: ${err?.message || err}`);
    }
}

/**
 * Keeps only ids that are real menu items of THIS restaurant.
 *
 * Without this check a restaurant could attach its add-ons to another restaurant's
 * menu items, and those add-ons would then surface on that restaurant's item sheet
 * at a price its owner never set.
 */
async function sanitizeFoodIds(restaurantId, foodIds) {
    const ids = [...new Set((Array.isArray(foodIds) ? foodIds : []).map((v) => String(v || '').trim()))]
        .filter((v) => mongoose.Types.ObjectId.isValid(v));
    if (!ids.length) return [];

    const owned = await FoodItem.find({
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        _id: { $in: ids.map((v) => new mongoose.Types.ObjectId(v)) }
    })
        .select('_id')
        .lean();

    if (owned.length !== ids.length) {
        throw new ValidationError('One or more selected menu items do not belong to this restaurant');
    }
    return owned.map((doc) => doc._id);
}

const normalizeAddonDoc = (doc) => {
    if (!doc) return null;
    const draft = doc.draft || {};
    const published = doc.published || null;
    return {
        _id: doc._id,
        id: doc._id,
        restaurantId: doc.restaurantId,
        approvalStatus: doc.approvalStatus || 'pending',
        rejectionReason: doc.rejectionReason || '',
        requestedAt: doc.requestedAt,
        approvedAt: doc.approvedAt,
        rejectedAt: doc.rejectedAt,
        isAvailable: doc.isAvailable !== false,
        // Empty => applies to the whole menu.
        foodIds: (Array.isArray(doc.foodIds) ? doc.foodIds : []).map((v) => String(v)),
        isItemSpecific: Array.isArray(doc.foodIds) && doc.foodIds.length > 0,
        group: {
            name: doc.group?.name || '',
            minSelect: Number(doc.group?.minSelect) || 0,
            maxSelect: Number(doc.group?.maxSelect) || 1,
            sortOrder: Number(doc.group?.sortOrder) || 0
        },
        // Draft fields (what restaurant edits)
        name: draft.name || '',
        description: draft.description || '',
        foodType: draft.foodType === 'non-veg' ? 'non-veg' : 'veg',
        isVeg: draft.foodType !== 'non-veg',
        price: Number(draft.price) || 0,
        image: draft.image || '',
        images: Array.isArray(draft.images) ? draft.images : [],
        // Published snapshot (what user app sees)
        published: published
            ? {
                name: published.name || '',
                description: published.description || '',
                foodType: published.foodType === 'non-veg' ? 'non-veg' : 'veg',
                isVeg: published.foodType !== 'non-veg',
                price: Number(published.price) || 0,
                image: published.image || '',
                images: Array.isArray(published.images) ? published.images : []
            }
            : null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
    };
};

export async function listRestaurantAddons(restaurantId, query = {}) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const includeDeleted = query.includeDeleted === true;
    const status = String(query.status || '').trim();
    const search = typeof query.search === 'string' ? query.search.trim().slice(0, 80) : '';

    const filter = {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        ...(includeDeleted ? {} : { isDeleted: { $ne: true } })
    };
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
        filter.approvalStatus = status;
    }
    if (search) {
        const term = escapeRegex(search);
        filter.$or = [{ 'draft.name': { $regex: term, $options: 'i' } }];
    }

    const [list, total] = await Promise.all([
        FoodAddon.find(filter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodAddon.countDocuments(filter)
    ]);

    return {
        addons: list.map(normalizeAddonDoc),
        total,
        page,
        limit
    };
}

export async function createRestaurantAddon(restaurantId, body) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const rid = new mongoose.Types.ObjectId(String(restaurantId));
    const name = String(body?.name || '').trim();
    if (!name) throw new ValidationError('Add-on name is required');

    // Prevent duplicates per restaurant among non-deleted docs (case-insensitive exact).
    const exact = `^${escapeRegex(name)}$`;
    const exists = await FoodAddon.findOne({
        restaurantId: rid,
        isDeleted: { $ne: true },
        'draft.name': { $regex: exact, $options: 'i' }
    })
        .select('_id')
        .lean();
    if (exists?._id) {
        throw new ValidationError('Add-on already exists');
    }

    const doc = await FoodAddon.create({
        restaurantId: rid,
        draft: {
            name,
            description: String(body.description || '').trim(),
            foodType: body?.foodType === 'non-veg' ? 'non-veg' : 'veg',
            price: Number(body.price) || 0,
            image: String(body.image || '').trim(),
            images: Array.isArray(body.images) ? body.images.filter(Boolean).slice(0, 10) : []
        },
        foodIds: await sanitizeFoodIds(rid, body?.foodIds),
        group: {
            name: String(body?.group?.name || '').trim(),
            minSelect: Number(body?.group?.minSelect) || 0,
            maxSelect: Number(body?.group?.maxSelect) || 1,
            sortOrder: Number(body?.group?.sortOrder) || 0
        },
        published: null,
        approvalStatus: 'pending',
        rejectionReason: '',
        requestedAt: new Date(),
        approvedAt: null,
        rejectedAt: null,
        isAvailable: true,
        isDeleted: false
    });

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'New Addon Approval Request 🍟',
            body: `Restaurant has submitted a new addon "${name}" for approval.`,
            data: {
                type: 'approval_request',
                subType: 'addon',
                id: String(doc._id)
            }
        });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to notify admins of new addon approval request:', e);
    }

    await invalidatePublicAddonCache();
    return normalizeAddonDoc(doc.toObject());
}

export async function updateRestaurantAddon(restaurantId, addonId, updateDto) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    if (!addonId || !mongoose.Types.ObjectId.isValid(String(addonId))) {
        throw new ValidationError('Invalid add-on id');
    }
    const rid = new mongoose.Types.ObjectId(String(restaurantId));
    const _id = new mongoose.Types.ObjectId(String(addonId));

    const set = {};

    if (updateDto?.isAvailable !== undefined) {
        set.isAvailable = updateDto.isAvailable !== false;
    }

    // Re-linking to menu items is not a content change, so this deliberately does
    // NOT reset approvalStatus the way a draft edit below does.
    if (updateDto?.foodIds !== undefined) {
        set.foodIds = await sanitizeFoodIds(rid, updateDto.foodIds);
    }

    // Also presentation, not content — no re-approval.
    if (updateDto?.group !== undefined) {
        const g = updateDto.group || {};
        set['group.name'] = String(g.name || '').trim();
        set['group.minSelect'] = Number(g.minSelect) || 0;
        set['group.maxSelect'] = Number(g.maxSelect) || 1;
        set['group.sortOrder'] = Number(g.sortOrder) || 0;
    }

    if (updateDto?.draft) {
        const d = updateDto.draft;
        if (d.name !== undefined) {
            const name = String(d.name || '').trim();
            if (!name) throw new ValidationError('Add-on name is required');
            if (name.length > 200) throw new ValidationError('Add-on name is too long');

            // Duplicate check excluding current doc.
            const exact = `^${escapeRegex(name)}$`;
            const exists = await FoodAddon.findOne({
                restaurantId: rid,
                isDeleted: { $ne: true },
                _id: { $ne: _id },
                'draft.name': { $regex: exact, $options: 'i' }
            })
                .select('_id')
                .lean();
            if (exists?._id) throw new ValidationError('Add-on already exists');

            set['draft.name'] = name;
        }
        if (d.description !== undefined) set['draft.description'] = String(d.description || '').trim();
        if (d.foodType !== undefined) {
            const ft = String(d.foodType || '').trim().toLowerCase();
            if (ft !== 'veg' && ft !== 'non-veg') {
                throw new ValidationError('Food type must be veg or non-veg');
            }
            set['draft.foodType'] = ft;
        }
        if (d.price !== undefined) {
            const price = Number(d.price);
            if (!Number.isFinite(price) || price < 0) throw new ValidationError('Price must be >= 0');
            set['draft.price'] = price;
        }
        if (d.image !== undefined) set['draft.image'] = String(d.image || '').trim();
        if (d.images !== undefined) {
            const imgs = Array.isArray(d.images) ? d.images.filter(Boolean).slice(0, 10) : [];
            set['draft.images'] = imgs;
        }

        // Any draft content change must go through admin approval again.
        set.approvalStatus = 'pending';
        set.rejectionReason = '';
        set.requestedAt = new Date();
        set.approvedAt = null;
        set.rejectedAt = null;
    }

    if (Object.keys(set).length === 0) {
        const existing = await FoodAddon.findOne({ _id, restaurantId: rid, isDeleted: { $ne: true } }).lean();
        return existing ? normalizeAddonDoc(existing) : null;
    }

    const updated = await FoodAddon.findOneAndUpdate(
        { _id, restaurantId: rid, isDeleted: { $ne: true } },
        { $set: set },
        { new: true }
    ).lean();
    if (updated) await invalidatePublicAddonCache();
    return updated ? normalizeAddonDoc(updated) : null;
}

export async function deleteRestaurantAddon(restaurantId, addonId) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    if (!addonId || !mongoose.Types.ObjectId.isValid(String(addonId))) {
        throw new ValidationError('Invalid add-on id');
    }
    const rid = new mongoose.Types.ObjectId(String(restaurantId));
    const _id = new mongoose.Types.ObjectId(String(addonId));
    const updated = await FoodAddon.findOneAndUpdate(
        { _id, restaurantId: rid, isDeleted: { $ne: true } },
        { $set: { isDeleted: true } },
        { new: true }
    ).lean();
    if (updated) await invalidatePublicAddonCache();
    return updated ? { id: updated._id } : null;
}
