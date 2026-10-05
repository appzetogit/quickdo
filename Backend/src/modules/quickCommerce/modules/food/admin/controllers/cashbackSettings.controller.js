import { sendResponse } from '../../../../utils/response.js';
import { FoodCashbackSettings } from '../models/cashbackSettings.model.js';
import { getActiveCashbackSettings } from '../../user/services/cashback.service.js';

export async function getCashbackSettingsController(_req, res, next) {
    try {
        const cashbackSettings = await getActiveCashbackSettings();
        return sendResponse(res, 200, 'Cashback settings fetched', { cashbackSettings });
    } catch (e) { next(e); }
}

export async function upsertCashbackSettingsController(req, res, next) {
    try {
        const b = req.body || {};
        const $set = {};
        if (b.isEnabled !== undefined) $set.isEnabled = Boolean(b.isEnabled);
        if (b.cashbackType !== undefined) {
            $set.cashbackType = ['percentage', 'flat'].includes(b.cashbackType) ? b.cashbackType : 'percentage';
        }
        if (b.cashbackValue !== undefined) $set.cashbackValue = Math.max(0, Number(b.cashbackValue) || 0);
        if (b.minOrderValue !== undefined) $set.minOrderValue = Math.max(0, Number(b.minOrderValue) || 0);
        if (b.maxCashback !== undefined) $set.maxCashback = Math.max(0, Number(b.maxCashback) || 0);
        if (b.firstOrderOnly !== undefined) $set.firstOrderOnly = Boolean(b.firstOrderOnly);
        if (b.perUserLimit !== undefined) $set.perUserLimit = Math.max(0, Number(b.perUserLimit) || 0);

        const existing = await FoodCashbackSettings.findOne({ isActive: true }).sort({ createdAt: -1 });
        const cashbackSettings = existing
            ? await FoodCashbackSettings.findByIdAndUpdate(existing._id, { $set }, { new: true }).lean()
            : (await FoodCashbackSettings.create({ ...$set, isActive: true })).toObject();

        return sendResponse(res, 200, 'Cashback settings saved', { cashbackSettings });
    } catch (e) { next(e); }
}
