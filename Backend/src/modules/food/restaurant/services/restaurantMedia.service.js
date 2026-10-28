import mongoose from 'mongoose';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';
import { invalidateCache } from '../../../../middleware/cache.js';

/**
 * The restaurant's own photography: one main cover image, plus a premises
 * gallery — the photos a rider uses to recognise the pickup point.
 *
 * Deliberately separate from `POST /profile/cover-images`, which resets the
 * restaurant's `status` to 'pending'. That is right for a document that changes
 * what was approved; it is not right for swapping a photo, because it takes a
 * live restaurant offline and forces re-approval. Nothing here touches `status`.
 */

const MAX_GALLERY = 10;

/** Entries may be plain strings or { url } objects — normalise to a string. */
const toUrl = (image) => {
    if (!image) return '';
    if (typeof image === 'string') return image.trim();
    return String(image.url || image.secure_url || '').trim();
};

const assertId = (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
};

/** These images are shown publicly, so refresh the cached restaurant reads. */
const bustPublicCaches = () => {
    void invalidateCache('restaurants:*');
    void invalidateCache('restaurant_detail:*');
};

const readCoverImages = (doc) =>
    (Array.isArray(doc?.coverImages) ? doc.coverImages : []).map(toUrl).filter(Boolean);

export const getRestaurantMedia = async (restaurantId) => {
    assertId(restaurantId);

    const doc = await FoodRestaurant.findById(restaurantId)
        .select('coverImage galleryImages coverImages profileImage')
        .lean();
    if (!doc) throw new ValidationError('Restaurant not found');

    const gallery = (Array.isArray(doc.galleryImages) ? doc.galleryImages : [])
        .map(toUrl)
        .filter(Boolean);

    return {
        // Falls back to the first legacy cover image so a restaurant that only
        // ever used /profile/cover-images still shows something here.
        coverImage: toUrl(doc.coverImage) || readCoverImages(doc)[0] || '',
        galleryImages: gallery,
        maxGalleryImages: MAX_GALLERY
    };
};

/** Replace the single main cover image. */
export const uploadRestaurantCoverImage = async (restaurantId, file) => {
    assertId(restaurantId);
    if (!file?.buffer) throw new ValidationError('Cover image file is required');

    const url = await uploadImageBuffer(file.buffer, 'food/restaurants/cover');
    if (!url) throw new ValidationError('Image upload failed');

    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { coverImage: url } });
    bustPublicCaches();
    return { coverImage: url };
};

/** Append premises photos, capped at MAX_GALLERY. */
export const uploadRestaurantGalleryImages = async (restaurantId, files = []) => {
    assertId(restaurantId);

    const valid = (Array.isArray(files) ? files : []).filter((f) => f?.buffer);
    if (valid.length === 0) throw new ValidationError('At least one image file is required');

    const doc = await FoodRestaurant.findById(restaurantId).select('galleryImages').lean();
    if (!doc) throw new ValidationError('Restaurant not found');

    const existing = (Array.isArray(doc.galleryImages) ? doc.galleryImages : [])
        .map(toUrl)
        .filter(Boolean);

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
    uploaded.forEach((u) => {
        if (!galleryImages.includes(u)) galleryImages.push(u);
    });

    await FoodRestaurant.findByIdAndUpdate(restaurantId, {
        $set: { galleryImages: galleryImages.slice(0, MAX_GALLERY) }
    });
    bustPublicCaches();

    // `skipped` is reported rather than silently dropped, so the app can tell the
    // owner that three of their five photos did not make it and why.
    return {
        galleryImages: galleryImages.slice(0, MAX_GALLERY),
        uploaded,
        skipped: Math.max(0, valid.length - room)
    };
};

/** Remove one gallery photo by exact URL. */
export const deleteRestaurantGalleryImage = async (restaurantId, imageUrl) => {
    assertId(restaurantId);

    const url = String(imageUrl || '').trim();
    if (!url) throw new ValidationError('imageUrl is required');

    const doc = await FoodRestaurant.findById(restaurantId).select('galleryImages').lean();
    if (!doc) throw new ValidationError('Restaurant not found');

    const existing = (Array.isArray(doc.galleryImages) ? doc.galleryImages : [])
        .map(toUrl)
        .filter(Boolean);
    if (!existing.includes(url)) throw new ValidationError('Image not found in this gallery');

    const galleryImages = existing.filter((u) => u !== url);
    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { galleryImages } });
    bustPublicCaches();
    return { galleryImages, deleted: url };
};
