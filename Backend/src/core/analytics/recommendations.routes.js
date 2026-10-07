import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';

/**
 * Recommendations for the apps: /v1/platform/recommendations/*.
 *
 *   GET /together?vertical=food|quickCommerce&itemId=...&limit=   items often bought with this one
 *   GET /popular?vertical=food|quickCommerce&lat=..&lng=..&limit= popular near a point
 *   GET /demand?vertical=food|quickCommerce|taxi&zoneId=&hours=   expected orders per zone per
 *                                                                 hour (rider / driver positioning;
 *                                                                 signed-in partners only)
 *
 * All read what the nightly insights job stored (insights.service.js): cheap,
 * aggregate-only, and no customer data.
 */
const router = express.Router();

const handle = (fn) => async (req, res) => {
    try {
        res.set('Cache-Control', 'public, max-age=300');
        return sendResponse(res, 200, 'OK', await fn(req));
    } catch (err) {
        const status = err?.statusCode || err?.status || 500;
        return sendError(res, status, status >= 500 ? 'Recommendations are not available right now' : err.message);
    }
};

router.get('/together', handle(async (req) => {
    const { recommendTogether } = await import('./insights.service.js');
    return recommendTogether(String(req.query.vertical || 'food'), req.query.itemId, req.query.limit);
}));

router.get('/popular', handle(async (req) => {
    const { recommendPopular } = await import('./insights.service.js');
    return recommendPopular(String(req.query.vertical || 'food'), { lat: req.query.lat, lng: req.query.lng, limit: req.query.limit });
}));

router.get('/demand', authMiddleware, async (req, res, next) => {
    res.set('Cache-Control', 'private, max-age=300');
    return next();
}, async (req, res) => {
    try {
        const { getDemand } = await import('./insights.service.js');
        const data = await getDemand(String(req.query.vertical || 'food'), { zoneId: req.query.zoneId, hours: req.query.hours });
        return sendResponse(res, 200, 'OK', data);
    } catch (err) {
        const status = err?.statusCode || err?.status || 500;
        return sendError(res, status, status >= 500 ? 'Demand is not available right now' : err.message);
    }
});

export default router;
