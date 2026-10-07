const mongoose = require('mongoose');
const CommissionRule = require('../../models/CommissionRule');
const Category = require('../../models/Category');
const Vendor = require('../../models/Vendor');
const Worker = require('../../models/Worker');
const Settings = require('../../models/Settings');

/**
 * Admin CRUD for CommissionRules (SOW §8, plan §3.2).
 *
 * Rules only apply to bookings above Settings.commissionThreshold (and the
 * global rule also to unsubscribed providers under it). Changing a rule never
 * touches a booking that already has a commissionSnapshot.
 *
 * Mounted at /api/admin/commission-rules (routes/admin-routes/commissionRules.routes.js).
 */

const SCOPES = ['global', 'category', 'provider'];
const TYPES = ['fixed', 'percentage'];
const PROVIDER_TYPES = ['vendor', 'worker'];

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || '')) && String(v).length === 24;

const parseDate = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
};

/**
 * Validate a full rule (after merging an update onto the stored one).
 * @returns {Promise<string|null>} error message, or null when valid
 */
const validateRule = async (rule) => {
  if (!SCOPES.includes(rule.scope)) return `scope must be one of ${SCOPES.join(', ')}`;
  if (!TYPES.includes(rule.type)) return `type must be one of ${TYPES.join(', ')}`;
  const value = Number(rule.value);
  if (rule.value === undefined || rule.value === null || rule.value === '' || !Number.isFinite(value) || value < 0) {
    return 'value must be a number of 0 or more';
  }
  if (rule.type === 'percentage' && value > 100) return 'a percentage cannot exceed 100';
  if (rule.validFrom === 'invalid' || rule.validTo === 'invalid') return 'validFrom/validTo must be dates';
  if (rule.validFrom && rule.validTo && rule.validTo < rule.validFrom) return 'validTo must be on or after validFrom';

  if (rule.scope === 'global') {
    if (rule.refId) return 'a global rule cannot have a refId';
    return null;
  }
  if (!isId(rule.refId)) return `a ${rule.scope} rule needs a valid refId`;
  if (rule.scope === 'category') {
    if (!(await Category.exists({ _id: rule.refId }))) return 'category not found';
    return null;
  }
  if (!PROVIDER_TYPES.includes(rule.providerType)) return 'providerType must be vendor or worker';
  const Model = rule.providerType === 'vendor' ? Vendor : Worker;
  if (!(await Model.exists({ _id: rule.refId }))) return `${rule.providerType} not found`;
  return null;
};

/** Attach a human label for refId (category title / provider name). */
const withLabels = async (rules) => {
  const ids = (scope, type) => rules
    .filter((r) => r.scope === scope && (!type || r.providerType === type) && r.refId)
    .map((r) => r.refId);
  const [cats, vendors, workers] = await Promise.all([
    Category.find({ _id: { $in: ids('category') } }).select('title').lean(),
    Vendor.find({ _id: { $in: ids('provider', 'vendor') } }).select('name businessName phone').lean(),
    Worker.find({ _id: { $in: ids('provider', 'worker') } }).select('name phone').lean()
  ]);
  const label = new Map();
  cats.forEach((c) => label.set(String(c._id), c.title));
  vendors.forEach((v) => label.set(String(v._id), v.businessName || v.name || v.phone));
  workers.forEach((w) => label.set(String(w._id), w.name || w.phone));
  return rules.map((r) => ({ ...r, refLabel: r.refId ? (label.get(String(r.refId)) || 'Deleted') : null }));
};

/**
 * GET /api/admin/commission-rules?scope=&active=
 * Also returns the settings the rules work with, so the page can show the
 * threshold and the fallback rate used while no global rule exists.
 */
exports.listRules = async (req, res) => {
  try {
    const filter = {};
    if (req.query.scope) {
      if (!SCOPES.includes(req.query.scope)) return res.status(400).json({ success: false, message: 'invalid scope' });
      filter.scope = req.query.scope;
    }
    if (req.query.active === 'true') filter.active = true;
    if (req.query.active === 'false') filter.active = false;

    const rules = await CommissionRule.find(filter).sort({ scope: 1, createdAt: -1 }).lean();
    const settings = await Settings.findOne({ type: 'global' })
      .select('commissionThreshold servicePayoutPercentage subscriptionPrice subscriptionPlatformFee')
      .lean();

    res.status(200).json({
      success: true,
      data: await withLabels(rules),
      settings: {
        commissionThreshold: settings?.commissionThreshold ?? 1000,
        subscriptionPrice: settings?.subscriptionPrice ?? 1000,
        subscriptionPlatformFee: settings?.subscriptionPlatformFee ?? 100,
        // Used as the global percentage until an active global rule exists.
        fallbackCommissionPercentage: 100 - (settings?.servicePayoutPercentage ?? 90)
      }
    });
  } catch (error) {
    console.error('List commission rules error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch commission rules' });
  }
};

/**
 * POST /api/admin/commission-rules
 */
exports.createRule = async (req, res) => {
  try {
    const b = req.body || {};
    const rule = {
      scope: b.scope,
      refId: b.refId || null, // a refId on a global rule is refused, not silently dropped
      providerType: b.scope === 'provider' ? (b.providerType || null) : null,
      type: b.type,
      value: b.value,
      active: b.active === undefined ? true : Boolean(b.active),
      validFrom: parseDate(b.validFrom) ?? null,
      validTo: parseDate(b.validTo) ?? null,
      note: typeof b.note === 'string' ? b.note : ''
    };
    const error = await validateRule(rule);
    if (error) return res.status(400).json({ success: false, message: error });

    const created = await CommissionRule.create({
      ...rule,
      value: Number(rule.value),
      createdBy: isId(req.user?.id) ? req.user.id : null
    });
    res.status(201).json({ success: true, data: (await withLabels([created.toObject()]))[0] });
  } catch (error) {
    console.error('Create commission rule error:', error);
    res.status(500).json({ success: false, message: 'Failed to create commission rule' });
  }
};

/**
 * PUT /api/admin/commission-rules/:id
 * Partial update; the merged rule is validated as a whole.
 */
exports.updateRule = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'invalid id' });
    const existing = await CommissionRule.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Commission rule not found' });

    const b = req.body || {};
    const merged = {
      scope: b.scope ?? existing.scope,
      refId: b.refId !== undefined ? (b.refId || null) : existing.refId,
      providerType: b.providerType !== undefined ? (b.providerType || null) : existing.providerType,
      type: b.type ?? existing.type,
      value: b.value ?? existing.value,
      active: b.active !== undefined ? Boolean(b.active) : existing.active,
      validFrom: b.validFrom !== undefined ? parseDate(b.validFrom) : existing.validFrom,
      validTo: b.validTo !== undefined ? parseDate(b.validTo) : existing.validTo,
      note: typeof b.note === 'string' ? b.note : existing.note
    };
    if (merged.scope === 'global') { merged.refId = null; merged.providerType = null; }
    if (merged.scope === 'category') merged.providerType = null;

    const error = await validateRule(merged);
    if (error) return res.status(400).json({ success: false, message: error });

    Object.assign(existing, merged, {
      value: Number(merged.value),
      updatedBy: isId(req.user?.id) ? req.user.id : existing.updatedBy
    });
    await existing.save();
    res.status(200).json({ success: true, data: (await withLabels([existing.toObject()]))[0] });
  } catch (error) {
    console.error('Update commission rule error:', error);
    res.status(500).json({ success: false, message: 'Failed to update commission rule' });
  }
};

/**
 * PATCH /api/admin/commission-rules/:id/toggle
 */
exports.toggleRule = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'invalid id' });
    const rule = await CommissionRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Commission rule not found' });
    rule.active = req.body?.active !== undefined ? Boolean(req.body.active) : !rule.active;
    if (isId(req.user?.id)) rule.updatedBy = req.user.id;
    await rule.save();
    res.status(200).json({ success: true, data: rule });
  } catch (error) {
    console.error('Toggle commission rule error:', error);
    res.status(500).json({ success: false, message: 'Failed to update commission rule' });
  }
};

/**
 * DELETE /api/admin/commission-rules/:id
 * Safe for history: settled bookings keep their snapshot (with the ruleId).
 */
exports.deleteRule = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'invalid id' });
    const rule = await CommissionRule.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Commission rule not found' });
    res.status(200).json({ success: true, message: 'Commission rule deleted' });
  } catch (error) {
    console.error('Delete commission rule error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete commission rule' });
  }
};

/**
 * GET /api/admin/commission-rules/options?kind=category|vendor|worker&q=
 * Pick-list for the rule form.
 */
exports.listOptions = async (req, res) => {
  try {
    const { kind, q } = req.query;
    const rx = q ? new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    let data = [];
    if (kind === 'category') {
      const rows = await Category.find(rx ? { title: rx } : {}).select('title').sort({ title: 1 }).limit(200).lean();
      data = rows.map((r) => ({ id: String(r._id), label: r.title }));
    } else if (kind === 'vendor') {
      const rows = await Vendor.find(rx ? { $or: [{ businessName: rx }, { name: rx }, { phone: rx }] } : {})
        .select('name businessName phone').sort({ businessName: 1 }).limit(200).lean();
      data = rows.map((r) => ({ id: String(r._id), label: `${r.businessName || r.name || 'Vendor'}${r.phone ? ` (${r.phone})` : ''}` }));
    } else if (kind === 'worker') {
      const rows = await Worker.find(rx ? { $or: [{ name: rx }, { phone: rx }] } : {})
        .select('name phone').sort({ name: 1 }).limit(200).lean();
      data = rows.map((r) => ({ id: String(r._id), label: `${r.name || 'Worker'}${r.phone ? ` (${r.phone})` : ''}` }));
    } else {
      return res.status(400).json({ success: false, message: 'kind must be category, vendor or worker' });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Commission rule options error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch options' });
  }
};

exports.validateRule = validateRule;
