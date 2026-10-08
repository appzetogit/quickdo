/**
 * Auto-renewing provider subscriptions (plan §3.2), for workers and vendors:
 *
 *   POST /{workers|vendors}/subscription/recurring          { planId }
 *   GET  /{workers|vendors}/subscription/recurring
 *   POST /{workers|vendors}/subscription/recurring/cancel   { atCycleEnd = true }
 *
 * Admin:
 *   POST /admin/worker-plans/:id/sync-razorpay
 *   GET  /admin/worker-plans/provider-subscriptions?providerType=&status=
 *
 * See services/recurringSubscription.js. Without Razorpay keys these answer
 * 503 { code: 'PAYMENTS_NOT_CONFIGURED', message: 'Payments not configured' }.
 */
const { razorpayKeyId } = require('../../../../core/settings/platformCredentials.cjs');
const { USER_ROLES } = require('../../utils/constants');
const recurring = require('../../services/recurringSubscription');

const providerTypeOf = (req) => (req.userRole === USER_ROLES.VENDOR ? 'vendor' : 'worker');

const fail = (res, error, fallback) => {
  if (error?.status) {
    return res.status(error.status).json({ success: false, message: error.message, ...(error.code ? { code: error.code } : {}) });
  }
  console.error(`[RecurringSubscription] ${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
};

const createRecurringSubscription = async (req, res) => {
  try {
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ success: false, message: 'planId is required' });
    const { record, plan, provider, startAt, reused } = await recurring.createRecurring({
      providerType: providerTypeOf(req),
      providerId: req.user.id,
      planId
    });
    return res.status(reused ? 200 : 201).json({
      success: true,
      data: {
        subscriptionId: record.razorpaySubscriptionId,
        keyId: razorpayKeyId() || null,
        status: record.status,
        shortUrl: record.shortUrl || null,
        planId: plan._id,
        planTitle: plan.title,
        amount: Math.round((Number(plan.price) || 0) * 100),
        currency: 'INR',
        durationDays: plan.durationDays,
        firstChargeAt: startAt ? new Date(startAt * 1000) : null,
        name: provider.name || provider.businessName || null,
        phone: provider.phone || null,
        email: provider.email || null
      }
    });
  } catch (error) {
    return fail(res, error, 'Failed to start the subscription');
  }
};

const getRecurringSubscription = async (req, res) => {
  try {
    const record = await recurring.latestForProvider(providerTypeOf(req), req.user.id);
    return res.json({ success: true, data: recurring.publicView(record), paymentsConfigured: recurring.isConfigured() });
  } catch (error) {
    return fail(res, error, 'Failed to load the subscription');
  }
};

const cancelRecurringSubscription = async (req, res) => {
  try {
    const atCycleEnd = req.body?.atCycleEnd === undefined ? true : (req.body.atCycleEnd === true || req.body.atCycleEnd === 'true');
    const record = await recurring.cancelRecurring({ providerType: providerTypeOf(req), providerId: req.user.id, atCycleEnd });
    return res.json({
      success: true,
      message: record.status === 'cancelled'
        ? 'Auto-renew cancelled. Your current term stays active until it ends.'
        : 'Auto-renew will stop at the end of the current billing cycle.',
      data: recurring.publicView(record)
    });
  } catch (error) {
    return fail(res, error, 'Failed to cancel the subscription');
  }
};

// ── Admin ──────────────────────────────────────────────────────────────────

const syncPlanToRazorpay = async (req, res) => {
  try {
    if (!recurring.isConfigured()) throw new recurring.PaymentsNotConfiguredError();
    const id = await recurring.syncPlan(req.params.id);
    const WorkerSubscriptionPlan = require('../../models/WorkerSubscriptionPlan');
    const plan = await WorkerSubscriptionPlan.findById(req.params.id).lean();
    return res.json({ success: true, message: `Synced to Razorpay plan ${id}`, data: plan });
  } catch (error) {
    return fail(res, error, 'Failed to sync the plan');
  }
};

const listProviderSubscriptions = async (req, res) => {
  try {
    const ProviderSubscription = require('../../models/ProviderSubscription');
    const filter = {};
    if (['worker', 'vendor'].includes(req.query.providerType)) filter.providerType = req.query.providerType;
    if (req.query.status) filter.status = String(req.query.status);
    const rows = await ProviderSubscription.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const Worker = require('../../models/Worker');
    const Vendor = require('../../models/Vendor');
    const ids = (type) => rows.filter((r) => r.providerType === type).map((r) => r.providerId);
    const [workers, vendors] = await Promise.all([
      Worker.find({ _id: { $in: ids('worker') } }).select('name phone subscription').lean(),
      Vendor.find({ _id: { $in: ids('vendor') } }).select('name businessName phone subscription').lean()
    ]);
    const byId = new Map([...workers, ...vendors].map((p) => [String(p._id), p]));
    const data = rows.map((r) => {
      const p = byId.get(String(r.providerId)) || {};
      return {
        ...recurring.publicView(r),
        providerType: r.providerType,
        providerId: r.providerId,
        providerName: p.businessName || p.name || null,
        providerPhone: p.phone || null,
        autoRenew: Boolean(p.subscription?.autoRenew && p.subscription?.razorpaySubscriptionId === r.razorpaySubscriptionId),
        expiryDate: p.subscription?.expiryDate || null,
        lastEvent: r.lastEvent,
        lastEventAt: r.lastEventAt
      };
    });
    return res.json({ success: true, data, paymentsConfigured: recurring.isConfigured() });
  } catch (error) {
    return fail(res, error, 'Failed to load subscriptions');
  }
};

module.exports = {
  createRecurringSubscription,
  getRecurringSubscription,
  cancelRecurringSubscription,
  syncPlanToRazorpay,
  listProviderSubscriptions
};
