import { sendResponse, sendError } from '../../../../utils/response.js';
import {
    getSalesAnalytics,
    buildRestaurantReport,
    listSettlementStatements,
    getSettlementStatement,
    buildSettlementStatementFile,
} from '../services/restaurantReports.service.js';

const sendFile = (res, { filename, contentType, body }) => {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', body.length);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).end(body);
};

const restaurantIdOf = (req, res) => {
    const id = req.user?.userId;
    if (!id) sendError(res, 401, 'Restaurant authentication required');
    return id;
};

export const getSalesAnalyticsController = async (req, res, next) => {
    try {
        const id = restaurantIdOf(req, res);
        if (!id) return undefined;
        const data = await getSalesAnalytics(id, req.query || {});
        return sendResponse(res, 200, 'Sales analytics', data);
    } catch (err) {
        return next(err);
    }
};

export const downloadReportController = async (req, res, next) => {
    try {
        const id = restaurantIdOf(req, res);
        if (!id) return undefined;
        return sendFile(res, await buildRestaurantReport(id, req.query || {}));
    } catch (err) {
        return next(err);
    }
};

export const listSettlementStatementsController = async (req, res, next) => {
    try {
        const id = restaurantIdOf(req, res);
        if (!id) return undefined;
        return sendResponse(res, 200, 'Settlement statements', await listSettlementStatements(id, req.query || {}));
    } catch (err) {
        return next(err);
    }
};

export const getSettlementStatementController = async (req, res, next) => {
    try {
        const id = restaurantIdOf(req, res);
        if (!id) return undefined;
        return sendResponse(res, 200, 'Settlement statement', await getSettlementStatement(id, req.params.cycleId));
    } catch (err) {
        return next(err);
    }
};

export const downloadSettlementStatementController = async (req, res, next) => {
    try {
        const id = restaurantIdOf(req, res);
        if (!id) return undefined;
        return sendFile(res, await buildSettlementStatementFile(id, req.params.cycleId, { format: req.query?.format }));
    } catch (err) {
        return next(err);
    }
};
