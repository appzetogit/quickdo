import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    getPublicPageByKey,
    getAdminPageByKey,
    upsertLegalPage,
    upsertAboutPage
} from '../services/pageContent.service.js';

const parseKeyFromParam = (req) => String(req.params?.key || '').trim().toLowerCase();

export const getPublicPageController = async (req, res, next) => {
    try {
        const key = parseKeyFromParam(req);
        const module = req.query.module || 'ALL';
        console.log(`[CMS] Public Request - Key: ${key}, Module: ${module}`);
        const result = await getPublicPageByKey(key, module);
        console.log(`[CMS] Result found: ${!!result.data}`);
        return sendResponse(res, 200, 'Page fetched successfully', result.data);
    } catch (error) {
        console.error(`[CMS] Error:`, error);
        next(error);
    }
};

export const getAdminPageController = async (req, res, next) => {
    try {
        const key = parseKeyFromParam(req);
        const module = req.query.module || 'ALL';
        const result = await getAdminPageByKey(key, module);
        return sendResponse(res, 200, 'Page fetched successfully', result.data);
    } catch (error) {
        next(error);
    }
};

export const upsertAdminPageController = async (req, res, next) => {
    try {
        const key = parseKeyFromParam(req);
        const module = req.body.module || 'ALL';
        const updatedBy = req.user?.userId || null;

        if (key === 'about') {
            const result = await upsertAboutPage(req.body ?? {}, updatedBy, module);
            return sendResponse(res, 200, 'Page updated successfully', result.data);
        }
        if (['terms', 'privacy', 'refund', 'shipping', 'cancellation', 'support'].includes(key)) {
            const result = await upsertLegalPage(key, req.body ?? {}, updatedBy, module);
            return sendResponse(res, 200, 'Page updated successfully', result.data);
        }
        throw new ValidationError('Invalid page key');
    } catch (error) {
        next(error);
    }
};

