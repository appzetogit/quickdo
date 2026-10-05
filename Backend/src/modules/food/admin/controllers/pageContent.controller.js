import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    getPublicPageByKey,
    getAdminPageByKey,
    upsertLegalPage,
    upsertAboutPage,
    upsertHelpSupportPage
} from '../services/pageContent.service.js';

const parseKeyFromParam = (req) => String(req.params?.key || '').trim().toLowerCase();

export const getPublicPageController = async (req, res, next) => {
    try {
        const key = parseKeyFromParam(req);
        const result = await getPublicPageByKey(key);
        return sendResponse(res, 200, 'Page fetched successfully', result.data);
    } catch (error) {
        next(error);
    }
};

export const getAdminPageController = async (req, res, next) => {
    try {
        const key = parseKeyFromParam(req);
        const result = await getAdminPageByKey(key);
        return sendResponse(res, 200, 'Page fetched successfully', result.data);
    } catch (error) {
        next(error);
    }
};

export const upsertAdminPageController = async (req, res, next) => {
    try {
        const key = parseKeyFromParam(req);
        const updatedBy = req.user?.userId || null;

        if (key === 'about') {
            const result = await upsertAboutPage(req.body ?? {}, updatedBy);
            return sendResponse(res, 200, 'Page updated successfully', result.data);
        }
        if (key === 'help_support') {
            const result = await upsertHelpSupportPage(req.body ?? {}, updatedBy);
            return sendResponse(res, 200, 'Page updated successfully', result.data);
        }
        if ([
            'terms', 'privacy', 'refund', 'shipping', 'cancellation',
            'terms_restaurant', 'privacy_restaurant', 'terms_delivery', 'privacy_delivery'
        ].includes(key)) {
            const result = await upsertLegalPage(key, req.body ?? {}, updatedBy);
            return sendResponse(res, 200, 'Page updated successfully', result.data);
        }
        throw new ValidationError('Invalid page key');
    } catch (error) {
        next(error);
    }
};

