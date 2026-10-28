import { sendResponse } from '../../../../utils/response.js';
import {
    getMedicalSettings,
    listRequestsForAdmin,
    updateMedicalSettings,
} from '../../orders/services/prescriptionRequest.service.js';

/** The range a prescription may travel, and how long a request stays open. */
export async function getMedicalSettingsController(req, res, next) {
    try {
        const settings = await getMedicalSettings();
        return sendResponse(res, 200, 'Medical settings', { settings });
    } catch (err) {
        next(err);
    }
}

export async function updateMedicalSettingsController(req, res, next) {
    try {
        const settings = await updateMedicalSettings(req.body || {}, req.user?.userId);
        return sendResponse(res, 200, 'Medical settings saved', { settings });
    } catch (err) {
        next(err);
    }
}

/** Every broadcast request: who it went to, who took it, what became of it. */
export async function listMedicalRequestsController(req, res, next) {
    try {
        const result = await listRequestsForAdmin({
            status: req.query?.status,
            limit: req.query?.limit,
            page: req.query?.page,
        });
        return sendResponse(res, 200, 'Prescription requests', result);
    } catch (err) {
        next(err);
    }
}
