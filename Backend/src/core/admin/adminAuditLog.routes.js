import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { isRestrictedAdmin } from './adminAccessPolicy.js';
import { AdminAudit } from './models/adminAudit.model.js';

/**
 * Master > Admin Activity Log: /v1/platform/audit-log.
 *
 *   GET /          rows, newest first
 *                  ?adminId= &from= &to= (ISO dates) &module= &action= &kind= &outcome=
 *                  &q= (path or target id) &page= &limit= (max 100)
 *   GET /admins    the admins who appear in the log, for the filter
 *
 * Read-only, and superadmins only: the log shows every admin's actions on every
 * panel, which a sub-admin has no business reading.
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
    if (isRestrictedAdmin(admin)) return sendError(res, 403, 'Only a superadmin can view the admin activity log');
    req.platformAdmin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
});

const MODULES = new Set(['food', 'quickCommerce', 'taxi', 'serviceProvider', 'platform']);
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  // A bare date (YYYY-MM-DD) as the upper bound means "through that whole day".
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) d.setUTCHours(23, 59, 59, 999);
  return d;
};

export const buildAuditFilter = (query = {}) => {
  const filter = {};
  if (query.adminId && mongoose.Types.ObjectId.isValid(String(query.adminId))) {
    filter.actorId = new mongoose.Types.ObjectId(String(query.adminId));
  }
  if (query.module && MODULES.has(String(query.module))) filter.module = String(query.module);
  if (query.action) filter.action = String(query.action).slice(0, 30);
  if (query.kind) filter.kind = String(query.kind) === 'finance' ? 'finance' : 'activity';
  if (query.outcome) filter.outcome = String(query.outcome).slice(0, 20);
  const from = parseDate(query.from);
  const to = parseDate(query.to, true);
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const q = String(query.q || '').trim().slice(0, 80);
  if (q) {
    filter.$or = [
      { path: new RegExp(escape(q), 'i') },
      { targetIds: q },
      { targetId: q },
      { actorEmail: new RegExp(escape(q), 'i') },
    ];
  }
  return filter;
};

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter = buildAuditFilter(req.query);
    const [rows, total] = await Promise.all([
      AdminAudit.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AdminAudit.countDocuments(filter),
    ]);
    return sendResponse(res, 200, 'OK', { rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    return sendError(res, 500, 'Could not load the activity log. Please try again.');
  }
});

// How long rows are kept (Master settings audit.retentionDays / audit.financeRetentionDays)
// and when the nightly purge last ran (core/admin/auditRetention.js).
router.get('/retention', async (req, res) => {
  try {
    const { auditRetentionOverview } = await import('./auditRetention.js');
    return sendResponse(res, 200, 'OK', await auditRetentionOverview());
  } catch (err) {
    return sendError(res, 500, 'Could not load the retention settings.');
  }
});

router.get('/admins', async (req, res) => {
  try {
    const admins = await AdminAudit.aggregate([
      { $match: { actorId: { $ne: null } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$actorId', email: { $first: '$actorEmail' }, role: { $first: '$actorRole' }, lastAt: { $first: '$createdAt' } } },
      { $sort: { lastAt: -1 } },
      { $limit: 500 },
    ]);
    return sendResponse(res, 200, 'OK', admins.map((a) => ({ id: String(a._id), email: a.email || '', role: a.role || '', lastAt: a.lastAt })));
  } catch (err) {
    return sendError(res, 500, 'Could not load admins. Please try again.');
  }
});

export default router;
