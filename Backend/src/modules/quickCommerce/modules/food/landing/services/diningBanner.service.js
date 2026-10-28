import { FoodDiningBanner } from '../models/diningBanner.model.js';
import { saveImageFile, deleteStoredFile } from '../../../../services/storage.service.js';

const BANNER_FOLDER = 'food/dining-banners';

export const listDiningBanners = async () => {
    return FoodDiningBanner.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
};

export const createDiningBannersFromFiles = async (files, meta = {}) => {
    if (!files || !files.length) {
        return [];
    }

    const results = [];

    for (const file of files) {
        try {
            const saved = await saveImageFile(file, BANNER_FOLDER);

            const banner = await FoodDiningBanner.create({
                imageUrl: saved.url,
                publicId: saved.path,
                title: meta.title,
                ctaText: meta.ctaText,
                ctaLink: meta.ctaLink,
                diningType: meta.diningType,
                sortOrder: meta.sortOrder ?? 0,
                isActive: true,
            });

            results.push({ success: true, banner: banner.toObject() });
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
    }

    return results;
};

export const deleteDiningBanner = async (id) => {
    const doc = await FoodDiningBanner.findById(id);
    if (!doc) {
        return { deleted: false };
    }

    if (doc.publicId) {
        try {
            await deleteStoredFile(doc.publicId);
        } catch {
            // ignore storage deletion errors
        }
    }

    await doc.deleteOne();
    return { deleted: true };
};

export const updateDiningBannerOrder = async (id, sortOrder) => {
    const updated = await FoodDiningBanner.findByIdAndUpdate(
        id,
        { sortOrder },
        { new: true }
    ).lean();
    return updated;
};

export const toggleDiningBannerStatus = async (id, isActive) => {
    const updated = await FoodDiningBanner.findByIdAndUpdate(
        id,
        { isActive },
        { new: true }
    ).lean();
    return updated;
};
