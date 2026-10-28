import { FoodExploreIcon } from '../models/exploreIcon.model.js';
import { saveImageFile, deleteStoredFile } from '../../../../services/storage.service.js';

const ICON_FOLDER = 'food/explore-icons';

/**
 * List all explore icons (admin). Sorted by sortOrder.
 */
export const listExploreIcons = async () => {
    return FoodExploreIcon.find()
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
};

/**
 * Get next sortOrder for new item.
 */
const getNextSortOrder = async () => {
    const last = await FoodExploreIcon.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
    return (last?.sortOrder ?? -1) + 1;
};

/**
 * Create one explore icon from uploaded file + label + link.
 * @param {{ buffer: Buffer }} file - multer file (req.file)
 * @param {{ label: string, link?: string }} meta
 */
export const createExploreIcon = async (file, meta) => {
    if (!file?.buffer) {
        throw new Error('Image file is required');
    }
    const label = (meta?.label || '').trim();
    if (!label) {
        throw new Error('Label is required');
    }

    const saved = await saveImageFile(file, ICON_FOLDER);
    const sortOrder = await getNextSortOrder();

    const doc = await FoodExploreIcon.create({
        label,
        iconUrl: saved.url,
        publicId: saved.path,
        linkType: 'custom',
        targetPath: (meta?.link || '').trim() || undefined,
        sortOrder,
        isActive: true
    });

    return doc.toObject();
};

/**
 * Update explore icon: optional new image, optional label/link.
 * @param {string} id
 * @param {{ file?: { buffer: Buffer }, label?: string, link?: string }} payload
 */
export const updateExploreIcon = async (id, payload) => {
    const doc = await FoodExploreIcon.findById(id);
    if (!doc) {
        return null;
    }

    const updates = {};

    if (payload?.file?.buffer) {
        try {
            if (doc.publicId) {
                await deleteStoredFile(doc.publicId).catch(() => {});
            }
            const saved = await saveImageFile(payload.file, ICON_FOLDER);
            updates.iconUrl = saved.url;
            updates.publicId = saved.path;
        } catch {
            throw new Error('Image upload failed');
        }
    }

    if (payload?.label !== undefined) {
        updates.label = String(payload.label).trim();
    }
    if (payload?.link !== undefined) {
        updates.targetPath = String(payload.link).trim() || undefined;
    }

    if (Object.keys(updates).length === 0) {
        return doc.toObject();
    }

    const updated = await FoodExploreIcon.findByIdAndUpdate(id, updates, { new: true }).lean();
    return updated;
};

/**
 * Delete explore icon and stored asset.
 */
export const deleteExploreIcon = async (id) => {
    const doc = await FoodExploreIcon.findById(id);
    if (!doc) {
        return { deleted: false };
    }
    if (doc.publicId) {
        try {
            await deleteStoredFile(doc.publicId);
        } catch {
            // ignore
        }
    }
    await doc.deleteOne();
    return { deleted: true };
};

/**
 * Toggle isActive. Returns updated doc or null.
 */
export const toggleExploreIconStatus = async (id) => {
    const doc = await FoodExploreIcon.findById(id);
    if (!doc) return null;
    const isActive = !doc.isActive;
    const updated = await FoodExploreIcon.findByIdAndUpdate(id, { isActive }, { new: true }).lean();
    return updated;
};

/**
 * Update sortOrder. Body uses "order" for frontend compatibility.
 */
export const updateExploreIconOrder = async (id, order) => {
    const num = Number(order);
    if (Number.isNaN(num)) return null;
    const updated = await FoodExploreIcon.findByIdAndUpdate(id, { sortOrder: num }, { new: true }).lean();
    return updated;
};
