import { sendResponse } from '../../../../utils/response.js';
import * as svc from '../services/driverRegistrationField.service.js';

// ── Admin ──
export async function listFieldsController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Registration fields fetched', await svc.listFields());
    } catch (e) { next(e); }
}

export async function createFieldController(req, res, next) {
    try {
        return sendResponse(res, 201, 'Field created', { field: await svc.createField(req.body || {}) });
    } catch (e) { next(e); }
}

export async function updateFieldController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Field updated', { field: await svc.updateField(req.params.id, req.body || {}) });
    } catch (e) { next(e); }
}

export async function deleteFieldController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Field deleted', await svc.deleteField(req.params.id));
    } catch (e) { next(e); }
}

// ── Public (Flutter app) ──
export async function getPublicFormSchemaController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Registration form fetched', await svc.getPublicFormSchema());
    } catch (e) { next(e); }
}
