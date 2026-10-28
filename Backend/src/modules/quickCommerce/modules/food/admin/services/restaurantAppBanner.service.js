import mongoose from 'mongoose';
import {
    FoodRestaurantAppBanner,
    RESTAURANT_APP_BANNER_SIZE
} from '../models/restaurantAppBanner.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';

const serialize = (doc) => {
    const b = doc?.toObject ? doc.toObject() : doc;
    return {
        id: String(b._id),
        imageUrl: b.imageUrl,
        title: b.title || '',
        ctaLink: b.ctaLink || '',
        sortOrder: Number(b.sortOrder) || 0,
        isActive: b.isActive !== false,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt
    };
};

const assertId = (id) => {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid banner id');
    }
};

/** Admin: every banner, active or not. */
export const listBannersAdmin = async () => {
    const docs = await FoodRestaurantAppBanner.find({})
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
    return {
        banners: docs.map(serialize),
        recommendedSize: RESTAURANT_APP_BANNER_SIZE
    };
};

/** Restaurant app: active banners only, in display order. */
export const listBannersForRestaurantApp = async () => {
    const docs = await FoodRestaurantAppBanner.find({ isActive: true })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
    return {
        banners: docs.map(serialize),
        recommendedSize: RESTAURANT_APP_BANNER_SIZE,
        aspectRatio: Number(
            (RESTAURANT_APP_BANNER_SIZE.width / RESTAURANT_APP_BANNER_SIZE.height).toFixed(2)
        )
    };
};

export const createBanner = async (file, body = {}) => {
    if (!file?.buffer) throw new ValidationError('Banner image file is required');

    const imageUrl = await uploadImageBuffer(file.buffer, 'food/restaurant-app-banners');
    if (!imageUrl) throw new ValidationError('Image upload failed');

    // Append to the end unless an explicit position was given.
    const last = await FoodRestaurantAppBanner.findOne({}).sort({ sortOrder: -1 }).select('sortOrder').lean();
    const sortOrder = body.sortOrder !== undefined
        ? Number(body.sortOrder) || 0
        : (Number(last?.sortOrder) || 0) + 1;

    const doc = await FoodRestaurantAppBanner.create({
        imageUrl,
        title: String(body.title || '').trim(),
        ctaLink: String(body.ctaLink || '').trim(),
        sortOrder,
        isActive: body.isActive === undefined ? true : !(body.isActive === false || body.isActive === 'false')
    });
    return serialize(doc);
};

export const updateBanner = async (id, body = {}, file = null) => {
    assertId(id);
    const doc = await FoodRestaurantAppBanner.findById(id);
    if (!doc) throw new ValidationError('Banner not found');

    if (file?.buffer) {
        const imageUrl = await uploadImageBuffer(file.buffer, 'food/restaurant-app-banners');
        if (imageUrl) doc.imageUrl = imageUrl;
    }
    if (body.title !== undefined) doc.title = String(body.title || '').trim();
    if (body.ctaLink !== undefined) doc.ctaLink = String(body.ctaLink || '').trim();
    if (body.sortOrder !== undefined) doc.sortOrder = Number(body.sortOrder) || 0;
    if (body.isActive !== undefined) {
        doc.isActive = !(body.isActive === false || body.isActive === 'false');
    }

    await doc.save();
    return serialize(doc);
};

export const deleteBanner = async (id) => {
    assertId(id);
    const res = await FoodRestaurantAppBanner.deleteOne({ _id: id });
    if (!res.deletedCount) throw new ValidationError('Banner not found');
    return { deleted: true, id: String(id) };
};

/** Toggle visibility without deleting the asset. */
export const toggleBannerStatus = async (id, isActive) => {
    assertId(id);
    const doc = await FoodRestaurantAppBanner.findByIdAndUpdate(
        id,
        { $set: { isActive: !(isActive === false || isActive === 'false') } },
        { new: true }
    ).lean();
    if (!doc) throw new ValidationError('Banner not found');
    return serialize(doc);
};

/** Reorder by id list; index in the array becomes sortOrder. */
export const reorderBanners = async (ids) => {
    const list = Array.isArray(ids) ? ids.map(String) : [];
    if (list.length === 0) throw new ValidationError('banners must be a non-empty array of ids');
    list.forEach(assertId);

    await Promise.all(
        list.map((id, index) =>
            FoodRestaurantAppBanner.updateOne({ _id: id }, { $set: { sortOrder: index } })
        )
    );
    return listBannersAdmin();
};
