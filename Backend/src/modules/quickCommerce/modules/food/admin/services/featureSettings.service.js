import { FoodFeatureSetting } from '../models/featureSetting.model.js';

export const FEATURE_KEYS = {
    RESTAURANT_SUBSCRIPTION: 'restaurant_subscription',
    COD_CONTROL: 'cod_control',
    ADMIN_ACCESS_SECTION: 'admin_access_section',
    ROOT_LANDING_AND_UNREGISTERED_CONTROL: 'root_landing_and_unregistered_control'
};

const DEFAULT_FEATURES = [
    {
        key: FEATURE_KEYS.RESTAURANT_SUBSCRIPTION,
        name: 'Restaurant Subscription',
        description: 'Controls monthly GMV-based subscription billing, wallet locking against dues, and subscription UI. Never blocks restaurant login.',
        isEnabled: true
    },
    {
        key: FEATURE_KEYS.COD_CONTROL,
        name: 'Cash On Delivery (COD)',
        description: 'Controls COD option visibility and delivery cash-limit related UI sections.',
        isEnabled: true
    },
    {
        key: FEATURE_KEYS.ADMIN_ACCESS_SECTION,
        name: 'Admin Access Section',
        description: 'Controls visibility of the Admin Access section (including Sub Admin List) in admin panel sidebar.',
        isEnabled: true
    },
    {
        key: FEATURE_KEYS.ROOT_LANDING_AND_UNREGISTERED_CONTROL,
        name: 'Root Landing & Unregistered Restaurants',
        description: 'Controls root URL behavior and Unregistered Restaurants visibility. When disabled, root redirects to /food/user and Unregistered Restaurants is hidden.',
        isEnabled: true
    }
];

export async function ensureDefaultFeatureSettings() {
    for (const feature of DEFAULT_FEATURES) {
        await FoodFeatureSetting.updateOne(
            { key: feature.key },
            { $setOnInsert: feature },
            { upsert: true }
        );
    }
}

export async function listFeatureSettings() {
    await ensureDefaultFeatureSettings();
    const docs = await FoodFeatureSetting.find({}).sort({ createdAt: 1 }).lean();
    return docs.map((doc) => ({
        key: doc.key,
        name: doc.name,
        description: doc.description || '',
        isEnabled: Boolean(doc.isEnabled),
        updatedAt: doc.updatedAt
    }));
}

export async function updateFeatureSetting(key, payload = {}) {
    await ensureDefaultFeatureSettings();
    const nextEnabled = Boolean(payload?.isEnabled);
    const updated = await FoodFeatureSetting.findOneAndUpdate(
        { key: String(key || '').trim() },
        { $set: { isEnabled: nextEnabled } },
        { new: true }
    ).lean();

    return updated
        ? {
            key: updated.key,
            name: updated.name,
            description: updated.description || '',
            isEnabled: Boolean(updated.isEnabled),
            updatedAt: updated.updatedAt
        }
        : null;
}

export async function isFeatureEnabled(key, fallback = true) {
    if (!key) return fallback;
    await ensureDefaultFeatureSettings();
    const doc = await FoodFeatureSetting.findOne({ key: String(key).trim() }).select('isEnabled').lean();
    if (!doc) return fallback;
    return Boolean(doc.isEnabled);
}
