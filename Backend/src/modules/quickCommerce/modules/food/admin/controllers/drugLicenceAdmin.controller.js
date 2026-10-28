import { sendResponse } from '../../../../utils/response.js';
import * as svc from '../services/drugLicenceAdmin.service.js';

export async function listDrugLicencesController(req, res, next) {
    try {
        const data = await svc.listDrugLicences(req.query || {});
        return sendResponse(res, 200, 'Drug licences fetched successfully', data);
    } catch (error) {
        next(error);
    }
}

export async function getDrugLicenceSummaryController(req, res, next) {
    try {
        const data = await svc.getDrugLicenceSummary(req.query || {});
        return sendResponse(res, 200, 'Drug licence summary fetched successfully', data);
    } catch (error) {
        next(error);
    }
}
