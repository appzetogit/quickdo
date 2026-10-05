import mongoose from 'mongoose';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';
import { invalidateCache } from '../../../../middleware/cache.js';

const MAX_BANNERS = 10;

/** coverImages entries may be plain strings or { url } objects — normalise to a string. */
const toUrl = (image) => {
    if (!image) return '';
    if (typeof image === 'string') return image.trim();
    return String(image.url || image.secure_url || '').trim();
};

const readBanners = (doc) =>
    (Array.isArray(doc?.coverImages) ? doc.coverImages : []).map(toUrl).filter(Boolean);

const loadRestaurant = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const doc = await FoodRestaurant.findById(restaurantId).select('coverImages profileImage').lean();
    if (!doc) throw new ValidationError('Restaurant not found');
    return doc;
};

/** Banners are shown publicly, so refresh the cached restaurant reads after any change. */
const bustPublicCaches = () => {
    void invalidateCache('restaurants:*');
    void invalidateCache('restaurant_detail:*');
};

export const listRestaurantBanners = async (restaurantId) => {
    const doc = await loadRestaurant(restaurantId);
    const banners = readBanners(doc);
    return { banners, primaryBanner: banners[0] || null, maxBanners: MAX_BANNERS };
};

const MAX_GALLERY = 10;

/** Main cover image + premises gallery (the photos the rider sees at pickup). */
export const getRestaurantMedia = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const doc = await FoodRestaurant.findById(restaurantId)
        .select('coverImage galleryImages coverImages profileImage')
        .lean();
    if (!doc) throw new ValidationError('Restaurant not found');

    const gallery = (Array.isArray(doc.galleryImages) ? doc.galleryImages : []).map(toUrl).filter(Boolean);
    return {
        coverImage: toUrl(doc.coverImage) || readBanners(doc)[0] || '',
        galleryImages: gallery,
        maxGalleryImages: MAX_GALLERY
    };
};

/** Replace the single main cover image. */
export const uploadRestaurantCoverImage = async (restaurantId, file) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    if (!file?.buffer) throw new ValidationError('Cover image file is required');

    const url = await uploadImageBuffer(file.buffer, 'food/restaurants/cover');
    if (!url) throw new ValidationError('Image upload failed');

    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { coverImage: url } });
    bustPublicCaches();
    return { coverImage: url };
};

/** Append premises photos, capped at MAX_GALLERY. */
export const uploadRestaurantGalleryImages = async (restaurantId, files = []) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const valid = (Array.isArray(files) ? files : []).filter((f) => f?.buffer);
    if (valid.length === 0) throw new ValidationError('At least one image file is required');

    const doc = await FoodRestaurant.findById(restaurantId).select('galleryImages').lean();
    if (!doc) throw new ValidationError('Restaurant not found');

    const existing = (Array.isArray(doc.galleryImages) ? doc.galleryImages : []).map(toUrl).filter(Boolean);
    const room = MAX_GALLERY - existing.length;
    if (room <= 0) {
        throw new ValidationError(`Gallery limit reached (${MAX_GALLERY}). Delete one before uploading.`);
    }

    const uploaded = (
        await Promise.all(
            valid.slice(0, room).map((f) => uploadImageBuffer(f.buffer, 'food/restaurants/gallery'))
        )
    ).filter(Boolean);

    const galleryImages = [...existing];
    uploaded.forEach((u) => { if (!galleryImages.includes(u)) galleryImages.push(u); });

    await FoodRestaurant.findByIdAndUpdate(restaurantId, {
        $set: { galleryImages: galleryImages.slice(0, MAX_GALLERY) }
    });
    bustPublicCaches();

    return {
        galleryImages: galleryImages.slice(0, MAX_GALLERY),
        uploaded,
        skipped: Math.max(0, valid.length - room)
    };
};

/** Remove one gallery photo by exact URL. */
export const deleteRestaurantGalleryImage = async (restaurantId, imageUrl) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const url = String(imageUrl || '').trim();
    if (!url) throw new ValidationError('imageUrl is required');

    const doc = await FoodRestaurant.findById(restaurantId).select('galleryImages').lean();
    if (!doc) throw new ValidationError('Restaurant not found');

    const existing = (Array.isArray(doc.galleryImages) ? doc.galleryImages : []).map(toUrl).filter(Boolean);
    if (!existing.includes(url)) throw new ValidationError('Image not found in this gallery');

    const galleryImages = existing.filter((u) => u !== url);
    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { galleryImages } });
    bustPublicCaches();
    return { galleryImages, deleted: url };
};

/**
 * Append uploaded banner images.
 *
 * Deliberately does NOT touch `status`. The legacy /profile/cover-images route resets the
 * restaurant to 'pending', taking a live restaurant offline and forcing re-approval just
 * for changing a picture — that is not acceptable for routine banner edits.
 */
export const uploadRestaurantBanners = async (restaurantId, files = []) => {
    const doc = await loadRestaurant(restaurantId);

    const validFiles = (Array.isArray(files) ? files : []).filter((f) => f?.buffer);
    if (validFiles.length === 0) throw new ValidationError('At least one image file is required');

    const existing = readBanners(doc);
    const room = MAX_BANNERS - existing.length;
    if (room <= 0) {
        throw new ValidationError(`Banner limit reached (${MAX_BANNERS}). Delete one before uploading.`);
    }

    const uploaded = await Promise.all(
        validFiles.slice(0, room).map((file) => uploadImageBuffer(file.buffer, 'food/restaurants/cover'))
    );

    const banners = [...existing];
    uploaded.filter(Boolean).forEach((url) => {
        if (!banners.includes(url)) banners.push(url);
    });

    const update = { coverImages: banners.slice(0, MAX_BANNERS) };
    // Only seed the logo if the restaurant genuinely has none — never overwrite one.
    if (!toUrl(doc.profileImage) && uploaded[0]) update.profileImage = uploaded[0];

    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: update });
    bustPublicCaches();

    return {
        banners: update.coverImages,
        primaryBanner: update.coverImages[0] || null,
        uploaded: uploaded.filter(Boolean),
        skipped: Math.max(0, validFiles.length - room)
    };
};

/** Remove one banner by its exact URL. */
export const deleteRestaurantBanner = async (restaurantId, bannerUrl) => {
    const doc = await loadRestaurant(restaurantId);
    const url = String(bannerUrl || '').trim();
    if (!url) throw new ValidationError('bannerUrl is required');

    const existing = readBanners(doc);
    if (!existing.includes(url)) throw new ValidationError('Banner not found on this restaurant');

    const banners = existing.filter((b) => b !== url);
    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { coverImages: banners } });
    bustPublicCaches();

    return { banners, primaryBanner: banners[0] || null, deleted: url };
};

/**
 * Reorder banners. The first entry is the primary banner shown as the page header.
 * The payload must be a permutation of the current set — no additions, no omissions —
 * so a stale client can't silently drop a banner it never knew about.
 */
export const reorderRestaurantBanners = async (restaurantId, orderedUrls) => {
    const doc = await loadRestaurant(restaurantId);
    const existing = readBanners(doc);

    const next = (Array.isArray(orderedUrls) ? orderedUrls : []).map((u) => String(u || '').trim()).filter(Boolean);
    if (next.length === 0) throw new ValidationError('banners must be a non-empty array of URLs');

    const unknown = next.find((u) => !existing.includes(u));
    if (unknown) throw new ValidationError('Cannot reorder: one or more banners do not belong to this restaurant');
    if (new Set(next).size !== next.length) throw new ValidationError('Duplicate banners in the order');
    if (next.length !== existing.length) {
        throw new ValidationError(`Send all ${existing.length} banners in the desired order`);
    }

    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { coverImages: next } });
    bustPublicCaches();

    return { banners: next, primaryBanner: next[0] || null };
};
