import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { ADMIN_LEVELS } from './adminHierarchy.constants.js';
import { effectiveAdminLevel } from './adminAccessPolicy.js';
import { adminVerticals } from './adminVerticals.js';

/**
 * The Master panel's cross-vertical screens: /v1/platform/master/*.
 *
 *   GET  /dashboard                     KPIs and charts (dashboard.service.js)
 *   GET  /reports/:kind                 sales | revenue | customers | vendors | drivers | providers
 *   GET  /reports/:kind/export          ?format=csv|xlsx
 *   GET  /tax/gst, /tax/gst/export      one GST report (analytics/tax.service.js)
 *   GET  /subscriptions                 every paid plan (analytics/subscriptions.service.js)
 *   GET  /broadcasts/roles              who this admin may message
 *   POST /broadcasts/preview            audience size per role and channel
 *   POST /broadcasts                    send (push + inbox, SMS, email)
 *   GET  /broadcasts                    history
 *   GET  /analytics/summary|forecast|demand|pairs, POST /analytics/recompute
 *        (the panel calls /insights/*: routes/index.js rewrites it, ad blockers
 *        drop requests with "analytics" in the URL)
 *
 * Every read is scoped to the verticals the admin may see (adminVerticals.js);
 * nothing here writes to a vertical's own records.
 */
const router = express.Router();

router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
});
router.use(authMiddleware, requireRoles('ADMIN'));
router.use(async (req, res, next) => {
    try {
        const admin = await loadAdminCached(req.user?.userId || req.user?.id);
        if (!admin) return sendError(res, 403, 'Admin account not found');
        if (admin.isActive === false) return sendError(res, 403, 'Your admin account has been deactivated');
        req.platformAdmin = admin;
        return next();
    } catch (err) {
        return next(err);
    }
});

const handle = (fn, failMessage = 'Could not load this. Please try again.') => async (req, res) => {
    try {
        return sendResponse(res, 200, 'OK', await fn(req, res));
    } catch (err) {
        const status = err?.statusCode || err?.status || 500;
        if (status >= 500) console.error(`[master] ${req.method} ${req.originalUrl}: ${err?.stack || err}`);
        return sendError(res, status, status >= 500 ? failMessage : err.message);
    }
};

const sendFile = async (res, file) => {
    res.set('Content-Type', file.contentType);
    res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
    return res.status(200).send(file.body);
};

/* ------------------------------------------------------------ dashboard */

router.get('/dashboard', handle(async (req) => {
    const { masterDashboard } = await import('./dashboard.service.js');
    return masterDashboard(req.platformAdmin, req.query);
}, 'Could not build the dashboard. Please try again.'));

/* -------------------------------------------------------------- reports */

router.get('/reports/:kind/export', async (req, res) => {
    try {
        const { exportReport } = await import('../analytics/reports.service.js');
        return sendFile(res, await exportReport(req.platformAdmin, req.params.kind, req.query));
    } catch (err) {
        const status = err?.statusCode || err?.status || 500;
        return sendError(res, status, status >= 500 ? 'Could not export the report.' : err.message);
    }
});
router.get('/reports/:kind', handle(async (req) => {
    const { buildReport } = await import('../analytics/reports.service.js');
    return buildReport(req.platformAdmin, req.params.kind, req.query);
}, 'Could not build the report. Please try again.'));

router.get('/tax/gst/export', async (req, res) => {
    try {
        const { gstReport } = await import('../analytics/tax.service.js');
        const { toCsv, toXlsx } = await import('../analytics/reports.service.js');
        const report = await gstReport(req.platformAdmin, req.query);
        const base = `gst-report-${report.range.from}-to-${report.range.to}`;
        const xlsx = String(req.query.format || '').toLowerCase() === 'xlsx';
        const summary = {
            title: 'By service',
            columns: [
                { key: 'label', label: 'Service' }, { key: 'invoices', label: 'Invoices', type: 'number' },
                { key: 'taxableValue', label: 'Taxable value', type: 'money' }, { key: 'gst', label: 'GST', type: 'money' },
                { key: 'estimated', label: 'Estimated', type: 'number' }, { key: 'basis', label: 'Basis' },
            ],
            rows: report.summary,
        };
        return sendFile(res, xlsx
            ? { filename: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: await toXlsx({ ...report, tables: [summary] }) }
            : { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: toCsv(report.columns, report.rows) });
    } catch (err) {
        const status = err?.statusCode || err?.status || 500;
        return sendError(res, status, status >= 500 ? 'Could not export the report.' : err.message);
    }
});
router.get('/tax/gst', handle(async (req) => {
    const { gstReport } = await import('../analytics/tax.service.js');
    return gstReport(req.platformAdmin, req.query);
}, 'Could not build the GST report. Please try again.'));

/* -------------------------------------------------------- subscriptions */

router.get('/subscriptions', handle(async (req) => {
    const verticals = adminVerticals(req.platformAdmin, { resource: 'reports' }).filter((v) => v !== 'food');
    if (!verticals.length) {
        const err = new Error('You do not have access to subscriptions');
        err.statusCode = 403;
        throw err;
    }
    const { listSubscriptions, subscriptionIncome } = await import('../analytics/subscriptions.service.js');
    const { parseRange } = await import('../analytics/facts.js');
    const range = parseRange(req.query, { defaultDays: 30 });
    const [list, income] = await Promise.all([
        listSubscriptions(req.query, verticals),
        subscriptionIncome(range, verticals),
    ]);
    return { ...list, verticals, income: { range: { from: range.from, to: range.to }, ...income } };
}));

/* ----------------------------------------------------------- broadcasts */

router.get('/broadcasts/roles', handle(async (req) => {
    const { roleCatalogue, CHANNELS } = await import('../notifications/platformBroadcast.service.js');
    return { roles: roleCatalogue(req.platformAdmin), channels: CHANNELS };
}));
router.post('/broadcasts/preview', handle(async (req) => {
    const { previewAudience } = await import('../notifications/platformBroadcast.service.js');
    return previewAudience(req.platformAdmin, req.body || {});
}));
router.post('/broadcasts', handle(async (req) => {
    const { createPlatformBroadcast } = await import('../notifications/platformBroadcast.service.js');
    return createPlatformBroadcast(req.platformAdmin, req.body || {});
}, 'Could not send the broadcast. Please try again.'));
router.get('/broadcasts', handle(async (req) => {
    const { listPlatformBroadcasts } = await import('../notifications/platformBroadcast.service.js');
    return listPlatformBroadcasts(req.platformAdmin, req.query);
}));

/* ------------------------------------------------------------- insights */

const insightVerticals = (req) => {
    const list = adminVerticals(req.platformAdmin, { resource: 'reports' });
    if (!list.length) {
        const err = new Error('You do not have access to insights');
        err.statusCode = 403;
        throw err;
    }
    return list;
};

router.get('/analytics/summary', handle(async (req) => {
    const { insightsSummary } = await import('../analytics/insights.service.js');
    return insightsSummary(insightVerticals(req));
}));
router.get('/analytics/forecast', handle(async (req) => {
    const { getForecast } = await import('../analytics/insights.service.js');
    return getForecast(String(req.query.vertical || 'food'), String(req.query.zoneId || 'all'), insightVerticals(req));
}));
router.get('/analytics/demand', handle(async (req) => {
    const { getDemand } = await import('../analytics/insights.service.js');
    return getDemand(String(req.query.vertical || 'food'), { zoneId: req.query.zoneId, hours: req.query.hours }, insightVerticals(req));
}));
router.get('/analytics/pairs', handle(async (req) => {
    const { getTopPairs } = await import('../analytics/insights.service.js');
    return getTopPairs(String(req.query.vertical || 'food'), req.query.limit, insightVerticals(req));
}));
router.post('/analytics/recompute', handle(async (req) => {
    if (effectiveAdminLevel(req.platformAdmin) !== ADMIN_LEVELS.PLATFORM_SUPERADMIN) {
        const err = new Error('Only a platform owner can recompute insights');
        err.statusCode = 403;
        throw err;
    }
    const { recomputeInsightsNow } = await import('../analytics/insights.service.js');
    const r = await recomputeInsightsNow();
    return { runId: r.runId, night: r.night, summary: r.summary };
}, 'Could not recompute insights. Please try again.'));

export default router;
