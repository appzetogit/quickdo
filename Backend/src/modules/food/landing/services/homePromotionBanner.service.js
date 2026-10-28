import { HomePromotionBanner } from '../models/homePromotionBanner.model.js';
import {
    uploadMediaBufferDetailed,
    deleteStoredAsset,
} from '../../../../services/cloudinary.service.js';

export const listHomePromotionBanners = async () => {
    return HomePromotionBanner.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
};

export const getPublicHomePromotionBanners = async (zoneId = null) => {
    const now = new Date();
    const filter = {
        isActive: true,
        $and: [
            {
                $or: [
                    { startDate: { $lte: now } },
                    { startDate: null },
                    { startDate: "" },
                    { startDate: { $exists: false } }
                ]
            },
            {
                $or: [
                    { endDate: { $gte: now } },
                    { endDate: null },
                    { endDate: "" },
                    { endDate: { $exists: false } }
                ]
            }
        ]
    };

    if (zoneId) {
        filter.zoneId = zoneId;
    }

    return HomePromotionBanner.find(filter)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
};

export const createHomePromotionBanner = async (file, meta = {}) => {
    if (!file) return null;

    try {
        const uploadResult = await uploadMediaBufferDetailed(
            file.buffer,
            'food/home-promotion-banners',
        );

        return await HomePromotionBanner.create({
            imageUrl: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            title: meta.title,
            ctaLink: meta.ctaLink,
            zoneId: meta.zoneId || null,
            startDate: (meta.startDate && meta.startDate !== "") ? new Date(meta.startDate) : null,
            endDate: (meta.endDate && meta.endDate !== "") ? new Date(meta.endDate) : null,
            sortOrder: meta.sortOrder ?? 0,
            isActive: true
        });
    } catch (error) {
        throw new Error(`Banner creation failed: ${error.message}`);
    }
};

/**
 * Edit a promotional banner: its details, and its image when a new one is sent.
 *
 * The edit screen's new image used to be dropped (the edit never carried a
 * file), so a changed banner kept showing the old picture. And the whole body
 * was written as-is, which let a request set imageUrl/publicId/isActive or any
 * other field directly; only the editable fields are taken now.
 */
export const updateHomePromotionBanner = async (id, data = {}, file = null) => {
    const existing = await HomePromotionBanner.findById(id).lean();
    if (!existing) return null;

    const updateData = {};
    if (data.title !== undefined) updateData.title = String(data.title ?? '').trim();
    if (data.ctaLink !== undefined) updateData.ctaLink = String(data.ctaLink ?? '').trim();
    if (data.zoneId !== undefined) {
        updateData.zoneId = data.zoneId && data.zoneId !== 'null' && data.zoneId !== '' ? data.zoneId : null;
    }
    if (data.startDate !== undefined) updateData.startDate = (data.startDate && data.startDate !== "" && data.startDate !== 'null') ? new Date(data.startDate) : null;
    if (data.endDate !== undefined) updateData.endDate = (data.endDate && data.endDate !== "" && data.endDate !== 'null') ? new Date(data.endDate) : null;
    if (data.sortOrder !== undefined && Number.isFinite(Number(data.sortOrder))) updateData.sortOrder = Number(data.sortOrder);

    if (file?.buffer) {
        const uploadResult = await uploadMediaBufferDetailed(file.buffer, 'food/home-promotion-banners');
        updateData.imageUrl = uploadResult.secure_url;
        updateData.publicId = uploadResult.public_id;
    }

    const updated = await HomePromotionBanner.findByIdAndUpdate(id, updateData, { new: true }).lean();
    // The replaced picture is no longer used anywhere; best-effort, never blocks the edit.
    if (file?.buffer && existing.publicId && existing.publicId !== updateData.publicId) {
        await deleteStoredAsset(existing.publicId);
    }
    return updated;
};

export const deleteHomePromotionBanner = async (id) => {
    const doc = await HomePromotionBanner.findById(id);
    if (!doc) return { deleted: false };

    if (doc.publicId) {
        // Best-effort: a missing file must not block deleting the record.
        await deleteStoredAsset(doc.publicId);
    }

    await doc.deleteOne();
    return { deleted: true };
};

export const toggleHomePromotionBannerStatus = async (id, isActive) => {
    return HomePromotionBanner.findByIdAndUpdate(id, { isActive }, { new: true }).lean();
};

export const updateHomePromotionBannerOrder = async (id, sortOrder) => {
    return HomePromotionBanner.findByIdAndUpdate(id, { sortOrder }, { new: true }).lean();
};
