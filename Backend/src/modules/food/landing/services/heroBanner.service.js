import { FoodHeroBanner } from '../models/heroBanner.model.js';
import {
    uploadMediaBufferDetailed,
    deleteStoredAsset,
} from '../../../../services/cloudinary.service.js';

/**
 * The set of sections a banner can head. Kept beside the schema enum so a new
 * section is added in one place.
 */
export const HERO_BANNER_MODULES = ['food', 'taxi', 'quick_commerce', 'medical', 'porter', 'rental', 'services'];

/**
 * Normalises whatever a caller sent into a module key, or null when they sent
 * nothing usable.
 *
 * Tolerates the spellings already floating around the platform ('quick', 'qc',
 * 'parcel', 'ride') so the admin panel and the app do not have to agree on one
 * before this is useful.
 */
export const normalizeHeroBannerModule = (value) => {
    const raw = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
    if (!raw) return null;

    const aliases = {
        food: 'food',
        restaurant: 'food',
        taxi: 'taxi',
        ride: 'taxi',
        cab: 'taxi',
        quick_commerce: 'quick_commerce',
        quick: 'quick_commerce',
        qc: 'quick_commerce',
        grocery: 'quick_commerce',
        medical: 'medical',
        pharmacy: 'medical',
        medicine: 'medical',
        porter: 'porter',
        parcel: 'porter',
        rental: 'rental',
        services: 'services',
        sp: 'services'
    };

    return aliases[raw] || null;
};

export const listHeroBanners = async (module) => {
    const filter = {};
    const normalized = normalizeHeroBannerModule(module);
    if (normalized) {
        // Banners saved before the field existed are food's, so a request for
        // food has to include them or the admin list would look empty after
        // this ships.
        filter.$or = normalized === 'food'
            ? [{ module: 'food' }, { module: { $exists: false } }, { module: null }]
            : [{ module: normalized }];
    }
    return FoodHeroBanner.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
};

export const createHeroBannersFromFiles = async (files, meta = {}) => {
    if (!files || !files.length) {
        return [];
    }

    const results = [];
    const module = normalizeHeroBannerModule(meta.module) || 'food';

    for (const file of files) {
        try {
            // Media, not image: a hero banner may be a video, and the home page
            // renders <video> instead of <img> based on the resource type
            // recorded below. The store sniffs the buffer and writes video
            // through untouched.
            const uploadResult = await uploadMediaBufferDetailed(
                file.buffer,
                // Food keeps its original folder so existing assets and any
                // cached URLs are untouched; new sections get their own.
                module === 'food' ? 'food/hero-banners' : `${module}/hero-banners`,
            );

            const banner = await FoodHeroBanner.create({
                imageUrl: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                // Recorded at upload so deletion can target the right resource
                // type; Cloudinary cannot infer it from the public id alone.
                resourceType: uploadResult.resource_type === 'video' ? 'video' : 'image',
                title: meta.title,
                ctaText: meta.ctaText,
                ctaLink: meta.ctaLink,
                linkedRestaurantIds: meta.linkedRestaurantIds || [],
                module,
                sortOrder: meta.sortOrder ?? 0,
                isActive: true
            });

            results.push({ success: true, banner: banner.toObject() });
        } catch (error) {
            // Cloudinary rejects with a bare string or a plain object as often as
            // with an Error, so error.message alone reports "undefined" to the admin
            // and hides why the upload failed.
            const reason =
                typeof error === 'string'
                    ? error
                    : error?.message || error?.error?.message || 'Upload failed';
            results.push({ success: false, error: reason });
        }
    }

    return results;
};

export const deleteHeroBanner = async (id) => {
    const doc = await FoodHeroBanner.findById(id);
    if (!doc) {
        return { deleted: false };
    }

    if (doc.publicId) {
        // Best-effort: a missing file must not block deleting the record.
        await deleteStoredAsset(doc.publicId);
    }

    await doc.deleteOne();
    return { deleted: true };
};

export const updateHeroBannerOrder = async (id, sortOrder) => {
    const updated = await FoodHeroBanner.findByIdAndUpdate(
        id,
        { sortOrder },
        { new: true }
    ).lean();
    return updated;
};

export const toggleHeroBannerStatus = async (id, isActive) => {
    const updated = await FoodHeroBanner.findByIdAndUpdate(
        id,
        { isActive },
        { new: true }
    ).lean();
    return updated;
};

export const linkRestaurantsToHeroBanner = async (id, restaurantIds) => {
    const updated = await FoodHeroBanner.findByIdAndUpdate(
        id,
        { linkedRestaurantIds: restaurantIds },
        { new: true }
    ).lean();
    return updated;
};


