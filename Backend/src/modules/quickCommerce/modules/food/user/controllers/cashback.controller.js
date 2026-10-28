import { sendResponse } from '../../../../utils/response.js';
import {
    getCashbackHistory,
    getUserRefundHistory,
    getActiveCashbackSettings
} from '../services/cashback.service.js';

export async function getCashbackHistoryController(req, res, next) {
    try {
        const data = await getCashbackHistory(req.user?.userId, req.query || {});
        return sendResponse(res, 200, 'Cashback history fetched', data);
    } catch (e) {
        next(e);
    }
}

export async function getRefundHistoryController(req, res, next) {
    try {
        const data = await getUserRefundHistory(req.user?.userId, req.query || {});
        return sendResponse(res, 200, 'Refund history fetched', data);
    } catch (e) {
        next(e);
    }
}

/** Public-ish: lets the app show "Earn X% cashback" before/while ordering. */
export async function getCashbackSettingsPublicController(_req, res, next) {
    try {
        const s = await getActiveCashbackSettings();
        return sendResponse(res, 200, 'Cashback settings fetched', {
            cashbackSettings: {
                isEnabled: Boolean(s.isEnabled),
                cashbackType: s.cashbackType,
                cashbackValue: Number(s.cashbackValue) || 0,
                minOrderValue: Number(s.minOrderValue) || 0,
                maxCashback: Number(s.maxCashback) || 0,
                firstOrderOnly: Boolean(s.firstOrderOnly),
                perUserLimit: Number(s.perUserLimit) || 0
            }
        });
    } catch (e) {
        next(e);
    }
}
