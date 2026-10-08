/**
 * Auto-renewing provider subscriptions on Razorpay Subscriptions (plan §3.2).
 *
 * Alongside the one-off flow (create-order / verify-payment, one Razorpay order
 * per term), a plan whose billingMode is 'recurring' or 'both' can be bought as
 * a Razorpay Subscription that charges the provider every period:
 *
 *   1. syncPlan(plan)          creates the Razorpay plan for a WorkerSubscriptionPlan
 *                              (again whenever price or duration changed; Razorpay
 *                              plans are immutable).
 *   2. createRecurring(...)    creates the Razorpay subscription and returns its id
 *                              for Checkout (`subscription_id`). If a one-off term
 *                              is still running, the first charge is deferred to
 *                              its end (start_at), so the provider never pays twice
 *                              for the same days.
 *   3. Webhooks (core razorpayWebhook.controller -> handleSubscriptionWebhook):
 *        subscription.authenticated / activated / resumed  -> autoRenew on
 *        subscription.charged      -> one more term, booked as platform fee +
 *                                     remainder (services/subscriptionLedger.js);
 *                                     idempotent on the payment id
 *        subscription.pending      -> a renewal charge is being retried
 *        subscription.halted / paused / cancelled / completed / expired
 *                                  -> autoRenew off; the paid term runs to its end
 *   4. cancelRecurring(...)    cancels at the end of the paid cycle (default) or now.
 *
 * Whether a provider may receive jobs is still decided only by
 * provider.subscription.isActive + expiryDate, exactly as for one-off payments.
 * Expiry reminders skip providers whose subscription.autoRenew is on.
 *
 * Without Razorpay keys every entry point throws PaymentsNotConfiguredError
 * (the controllers answer 503); there is no mock subscription.
 */
const { razorpayKeyId, razorpayKeySecret } = require('../../../core/settings/platformCredentials.cjs');
const WorkerSubscriptionPlan = require('../models/WorkerSubscriptionPlan');
const ProviderSubscription = require('../models/ProviderSubscription');
const { TERMINAL_STATUSES } = require('../models/ProviderSubscription');
const Worker = require('../models/Worker');
const Vendor = require('../models/Vendor');
const Transaction = require('../models/Transaction');
const { withTransaction, abort } = require('../utils/withTransaction');
const { recordSubscriptionPayment, SUBSCRIPTION_TX_TYPES } = require('./subscriptionLedger');

class PaymentsNotConfiguredError extends Error {
  constructor() {
    super('Payments not configured');
    this.status = 503;
    this.code = 'PAYMENTS_NOT_CONFIGURED';
  }
}

class SubscriptionError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ── Gateway client (replaceable in tests) ──────────────────────────────────
let clientOverride = null;
const setGatewayForTests = (client) => { clientOverride = client; };

const isConfigured = () => Boolean(clientOverride) || Boolean(razorpayKeyId() && razorpayKeySecret());

const gateway = () => {
  if (clientOverride) return clientOverride;
  if (!razorpayKeyId() || !razorpayKeySecret()) throw new PaymentsNotConfiguredError();
  const client = require('./razorpayService').getRazorpay();
  if (!client) throw new PaymentsNotConfiguredError();
  return client;
};

const gatewayMessage = (err) => err?.error?.description || err?.description || err?.message || 'Payment gateway error';

const modelFor = (providerType) => (providerType === 'vendor' ? Vendor : Worker);
const LIVE_STATUSES = ['created', 'authenticated', 'active', 'pending', 'halted', 'paused'];

// ── Plans ──────────────────────────────────────────────────────────────────

/**
 * Razorpay billing period for a plan's durationDays. Pure.
 * @returns {{ period, interval }} or throws SubscriptionError
 */
const periodFor = (durationDays) => {
  const d = Math.floor(Number(durationDays) || 0);
  if (d >= 365 && d % 365 === 0) return { period: 'yearly', interval: d / 365 };
  if (d >= 30 && d % 30 === 0) return { period: 'monthly', interval: d / 30 };
  if (d >= 7 && d % 7 === 0) return { period: 'weekly', interval: d / 7 };
  // Razorpay daily plans need an interval of at least 7.
  if (d >= 7) return { period: 'daily', interval: d };
  throw new SubscriptionError(400, 'A recurring plan must last at least 7 days');
};

/** Billing cycles for a subscription: the plan's, else about ten years. */
const totalCountFor = (plan) => {
  if (plan.recurringTotalCount) return plan.recurringTotalCount;
  const { period, interval } = periodFor(plan.durationDays);
  const perTenYears = { yearly: 10, monthly: 120, weekly: 520, daily: 3650 }[period];
  return Math.max(1, Math.min(120, Math.floor(perTenYears / interval)));
};

const allowsRecurring = (plan) => plan.billingMode === 'recurring' || plan.billingMode === 'both';

/**
 * Make sure the plan has a Razorpay plan matching its current price and
 * duration; create one if not. Returns the Razorpay plan id.
 */
const syncPlan = async (planOrId) => {
  const plan = planOrId?._id ? planOrId : await WorkerSubscriptionPlan.findById(planOrId);
  if (!plan) throw new SubscriptionError(404, 'Plan not found');
  const amount = Math.round((Number(plan.price) || 0) * 100);
  if (amount < 100) throw new SubscriptionError(400, 'A recurring plan must cost at least ₹1');
  const { period, interval } = periodFor(plan.durationDays);
  const synced = plan.razorpayPlan || {};
  if (synced.id && synced.amount === amount && synced.period === period && synced.interval === interval) {
    return synced.id;
  }
  let created;
  try {
    created = await gateway().plans.create({
      period,
      interval,
      item: { name: plan.title, amount, currency: 'INR', description: (plan.description || plan.title).slice(0, 250) },
      notes: { spPlanId: String(plan._id), type: 'sp_provider_plan' }
    });
  } catch (err) {
    if (err instanceof PaymentsNotConfiguredError) throw err;
    throw new SubscriptionError(502, `Could not create the Razorpay plan: ${gatewayMessage(err)}`);
  }
  const razorpayPlan = { id: created.id, amount, period, interval, syncedAt: new Date() };
  await WorkerSubscriptionPlan.updateOne({ _id: plan._id }, { $set: { razorpayPlan } });
  plan.razorpayPlan = razorpayPlan;
  return created.id;
};

// ── Provider actions ───────────────────────────────────────────────────────

const publicView = (record) => (record ? {
  _id: record._id,
  subscriptionId: record.razorpaySubscriptionId,
  planId: record.planId,
  planTitle: record.planTitle,
  status: record.status,
  shortUrl: record.shortUrl || null,
  paidCount: record.paidCount || 0,
  totalCount: record.totalCount ?? null,
  currentStart: record.currentStart || null,
  currentEnd: record.currentEnd || null,
  cancelAtCycleEnd: Boolean(record.cancelAtCycleEnd),
  createdAt: record.createdAt
} : null);

/**
 * Start an auto-renewing subscription. Returns what Checkout needs.
 */
const createRecurring = async ({ providerType, providerId, planId, now = new Date() }) => {
  if (!isConfigured()) throw new PaymentsNotConfiguredError();
  const plan = await WorkerSubscriptionPlan.findById(planId);
  if (!plan) throw new SubscriptionError(404, 'Plan not found');
  if (!plan.isActive) throw new SubscriptionError(400, 'Plan is currently inactive');
  if (plan.providerType && plan.providerType !== 'all' && plan.providerType !== providerType) {
    throw new SubscriptionError(400, `This plan is not available for ${providerType}s`);
  }
  if (!allowsRecurring(plan)) {
    throw new SubscriptionError(400, 'This plan is sold as a one-time payment. Use create-order.', 'ONE_TIME_ONLY');
  }
  const provider = await modelFor(providerType).findById(providerId).select('name businessName phone email subscription').lean();
  if (!provider) throw new SubscriptionError(404, `${providerType === 'vendor' ? 'Vendor' : 'Worker'} not found`);

  const live = await ProviderSubscription.findOne({ providerType, providerId, status: { $in: LIVE_STATUSES } })
    .sort({ createdAt: -1 });
  if (live) {
    // Checkout not completed yet on the same plan: hand the same subscription back.
    if (live.status === 'created' && String(live.planId) === String(plan._id)) {
      return { record: live, plan, provider, reused: true };
    }
    if (!['created', 'halted'].includes(live.status)) {
      throw new SubscriptionError(409, 'You already have an auto-renewing subscription. Cancel it before starting another.', 'ALREADY_SUBSCRIBED');
    }
  }

  const razorpayPlanId = await syncPlan(plan);
  const totalCount = totalCountFor(plan);
  const expiry = provider.subscription?.expiryDate ? new Date(provider.subscription.expiryDate) : null;
  // A one-off term still running for more than a day: first charge when it ends.
  const startAt = provider.subscription?.isActive && expiry && expiry.getTime() > now.getTime() + 24 * 3600 * 1000
    ? Math.floor(expiry.getTime() / 1000)
    : null;

  let sub;
  try {
    sub = await gateway().subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: totalCount,
      quantity: 1,
      customer_notify: 1,
      ...(startAt ? { start_at: startAt } : {}),
      notes: {
        type: 'sp_provider_subscription',
        providerType,
        providerId: String(providerId),
        planId: String(plan._id)
      }
    });
  } catch (err) {
    throw new SubscriptionError(502, `Could not create the subscription: ${gatewayMessage(err)}`);
  }

  // An abandoned checkout (or a halted subscription) is replaced by the new one.
  if (live) {
    try { await gateway().subscriptions.cancel(live.razorpaySubscriptionId, false); } catch (err) {
      console.warn(`[RecurringSubscription] could not cancel superseded ${live.razorpaySubscriptionId}: ${gatewayMessage(err)}`);
    }
    await ProviderSubscription.updateOne({ _id: live._id }, {
      $set: { status: 'cancelled', endedAt: now, lastEvent: 'superseded', lastEventAt: now },
      $push: { history: { event: 'superseded', at: now } }
    });
  }

  const record = await ProviderSubscription.create({
    providerType,
    providerId,
    planId: plan._id,
    planTitle: plan.title,
    razorpaySubscriptionId: sub.id,
    razorpayPlanId,
    status: sub.status || 'created',
    shortUrl: sub.short_url || null,
    totalCount,
    history: [{ event: 'created', at: now }]
  });
  return { record, plan, provider, startAt, reused: false };
};

/**
 * Cancel the provider's auto-renewing subscription. By default at the end of
 * the paid cycle (the provider keeps the days paid for); `atCycleEnd: false`
 * cancels at once. Either way the paid term itself is not shortened.
 */
const cancelRecurring = async ({ providerType, providerId, atCycleEnd = true, now = new Date() }) => {
  if (!isConfigured()) throw new PaymentsNotConfiguredError();
  const record = await ProviderSubscription.findOne({ providerType, providerId, status: { $in: LIVE_STATUSES } })
    .sort({ createdAt: -1 });
  if (!record) throw new SubscriptionError(404, 'No auto-renewing subscription to cancel');

  // A subscription that never started has no cycle to finish.
  const immediate = !atCycleEnd || ['created', 'authenticated', 'halted'].includes(record.status);
  try {
    await gateway().subscriptions.cancel(record.razorpaySubscriptionId, !immediate);
  } catch (err) {
    throw new SubscriptionError(502, `Could not cancel the subscription: ${gatewayMessage(err)}`);
  }

  const set = { cancelAtCycleEnd: !immediate, cancelRequestedAt: now, lastEvent: 'cancel_requested', lastEventAt: now };
  if (immediate) Object.assign(set, { status: 'cancelled', endedAt: now });
  await ProviderSubscription.updateOne({ _id: record._id }, { $set: set, $push: { history: { event: immediate ? 'cancelled_by_provider' : 'cancel_at_cycle_end', at: now } } });
  await modelFor(providerType).updateOne(
    { _id: providerId, 'subscription.razorpaySubscriptionId': record.razorpaySubscriptionId },
    { $set: { 'subscription.autoRenew': false, ...(immediate ? { 'subscription.gatewayStatus': 'cancelled' } : {}) } }
  );
  return ProviderSubscription.findById(record._id).lean();
};

const latestForProvider = (providerType, providerId) => ProviderSubscription
  .findOne({ providerType, providerId })
  .sort({ createdAt: -1 })
  .lean();

// ── Webhooks ───────────────────────────────────────────────────────────────

const STATUS_FOR_EVENT = {
  'subscription.authenticated': 'authenticated',
  'subscription.activated': 'active',
  'subscription.resumed': 'active',
  'subscription.pending': 'pending',
  'subscription.halted': 'halted',
  'subscription.paused': 'paused',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'completed',
  'subscription.expired': 'expired'
};

/**
 * Find the record for a gateway subscription, or adopt one created elsewhere
 * from its notes (e.g. the record write failed after the gateway call).
 */
const recordFor = async (sub) => {
  const existing = await ProviderSubscription.findOne({ razorpaySubscriptionId: sub.id });
  if (existing) return existing;
  const notes = sub.notes || {};
  if (notes.type !== 'sp_provider_subscription' || !['worker', 'vendor'].includes(notes.providerType) || !notes.providerId || !notes.planId) {
    return null;
  }
  const plan = await WorkerSubscriptionPlan.findById(notes.planId).select('title').lean();
  try {
    return await ProviderSubscription.create({
      providerType: notes.providerType,
      providerId: notes.providerId,
      planId: notes.planId,
      planTitle: plan?.title || '',
      razorpaySubscriptionId: sub.id,
      razorpayPlanId: sub.plan_id || null,
      status: 'created',
      totalCount: sub.total_count ?? null,
      history: [{ event: 'adopted_from_webhook', at: new Date() }]
    });
  } catch (err) {
    if (err?.code === 11000) return ProviderSubscription.findOne({ razorpaySubscriptionId: sub.id });
    throw err;
  }
};

const secondsToDate = (s) => (s ? new Date(Number(s) * 1000) : null);

/**
 * Apply one subscription.charged: one more paid term, two ledger rows.
 * Idempotent on the payment id (the same ledger lookup as one-off payments).
 */
const applyCharge = async (record, sub, payment, now = new Date()) => {
  const amount = Math.round(Number(payment.amount || 0)) / 100;
  if (!payment.id || !(amount > 0)) return { ignored: 'no payment amount' };
  const plan = await WorkerSubscriptionPlan.findById(record.planId).lean();
  const durationDays = plan?.durationDays || 30;
  const Model = modelFor(record.providerType);
  const terminal = TERMINAL_STATUSES.includes(record.status);
  const autoRenew = !terminal && !record.cancelAtCycleEnd;

  const outcome = await withTransaction(async (session) => {
    const already = await Transaction.findOne({ referenceId: payment.id, type: { $in: SUBSCRIPTION_TX_TYPES } }).session(session);
    if (already) abort({ duplicate: true });

    const provider = await Model.findById(record.providerId).session(session);
    if (!provider) abort({ notFound: true });

    const current = provider.subscription?.expiryDate ? new Date(provider.subscription.expiryDate) : null;
    const running = current && current > now ? current : null;
    const gatewayEnd = secondsToDate(sub.current_end);
    let expiryDate;
    if (gatewayEnd && gatewayEnd > now) {
      // The gateway's cycle end, never earlier than a term already paid for.
      expiryDate = running && running > gatewayEnd ? running : gatewayEnd;
    } else {
      expiryDate = new Date(running || now);
      expiryDate.setDate(expiryDate.getDate() + durationDays);
    }

    provider.set({
      'subscription.isActive': true,
      'subscription.planId': record.planId,
      'subscription.planName': plan?.title || record.planTitle || null,
      'subscription.startDate': running && provider.subscription?.startDate ? provider.subscription.startDate : now,
      'subscription.expiryDate': expiryDate,
      'subscription.durationDays': durationDays,
      'subscription.lastPaymentId': payment.id,
      'subscription.lastOrderId': payment.order_id || null,
      'subscription.reminderSentFor': null,
      'subscription.autoRenew': autoRenew,
      'subscription.razorpaySubscriptionId': sub.id,
      'subscription.gatewayStatus': terminal ? record.status : 'active'
    });
    // Only the subscription changed; an older profile missing a field added
    // since must not block a payment that has already been taken.
    await provider.save({ session, validateModifiedOnly: true });

    const split = await recordSubscriptionPayment({
      session,
      providerType: record.providerType,
      providerId: provider._id,
      amount,
      referenceId: payment.id,
      orderId: payment.order_id || null,
      plan: plan || { _id: record.planId, title: record.planTitle, durationDays },
      expiryDate,
      extraMetadata: { subscriptionId: sub.id, invoiceId: payment.invoice_id || null, recurring: true }
    });

    await ProviderSubscription.updateOne({ _id: record._id }, {
      $addToSet: { chargedPaymentIds: payment.id },
      $set: {
        status: terminal ? record.status : 'active',
        paidCount: sub.paid_count ?? ((record.paidCount || 0) + 1),
        currentStart: secondsToDate(sub.current_start) || record.currentStart,
        currentEnd: gatewayEnd || expiryDate,
        lastEvent: 'subscription.charged',
        lastEventAt: now
      },
      $push: { history: { event: 'subscription.charged', at: now, paymentId: payment.id } }
    }, { session });

    return { expiryDate, fee: split.fee, amount };
  });

  if (outcome.duplicate || outcome.notFound) return outcome;
  const { recordWorkerSubscription } = require('./earningTrackerService');
  recordWorkerSubscription(now, outcome.amount, outcome.fee)
    .catch((err) => console.error('[RecurringSubscription] earnings tracker failed:', err.message));
  return { charged: true, ...outcome };
};

/**
 * Entry point for subscription.* webhook events (verified and deduplicated by
 * the core webhook controller). Returns what it did; throws only when a retry
 * could help (the core controller then answers 500 and Razorpay redelivers).
 */
const handleSubscriptionWebhook = async (event, payload = {}, now = new Date()) => {
  const sub = payload.subscription?.entity;
  if (!sub?.id) return { ignored: 'no subscription entity' };
  const record = await recordFor(sub);
  if (!record) return { ignored: 'not a service-provider subscription' };

  if (event === 'subscription.charged') {
    const payment = payload.payment?.entity;
    if (!payment) return { ignored: 'no payment entity' };
    return applyCharge(record, sub, payment, now);
  }

  const status = STATUS_FOR_EVENT[event];
  if (!status) return { ignored: `unhandled event ${event}` };

  const wasTerminal = TERMINAL_STATUSES.includes(record.status);
  const nowTerminal = TERMINAL_STATUSES.includes(status);
  // A late 'activated' must not bring a cancelled subscription back.
  if (wasTerminal && !nowTerminal) {
    await ProviderSubscription.updateOne({ _id: record._id }, { $push: { history: { event: `${event} (ignored, already ${record.status})`, at: now } } });
    return { ignored: `already ${record.status}` };
  }

  const set = { status, lastEvent: event, lastEventAt: now };
  if (sub.current_start) set.currentStart = secondsToDate(sub.current_start);
  if (sub.current_end) set.currentEnd = secondsToDate(sub.current_end);
  if (nowTerminal) set.endedAt = now;
  await ProviderSubscription.updateOne({ _id: record._id }, { $set: set, $push: { history: { event, at: now } } });

  const Model = modelFor(record.providerType);
  if (status === 'active' || status === 'authenticated') {
    // This subscription becomes the provider's current one.
    await Model.updateOne({ _id: record.providerId }, {
      $set: {
        'subscription.autoRenew': !record.cancelAtCycleEnd,
        'subscription.razorpaySubscriptionId': sub.id,
        'subscription.gatewayStatus': status
      }
    });
  } else {
    // Only if it is still the provider's current subscription.
    const patch = { 'subscription.gatewayStatus': status };
    if (status !== 'pending') patch['subscription.autoRenew'] = false;
    await Model.updateOne({ _id: record.providerId, 'subscription.razorpaySubscriptionId': sub.id }, { $set: patch });
  }
  return { status };
};

module.exports = {
  PaymentsNotConfiguredError,
  SubscriptionError,
  setGatewayForTests,
  isConfigured,
  periodFor,
  totalCountFor,
  allowsRecurring,
  syncPlan,
  createRecurring,
  cancelRecurring,
  latestForProvider,
  publicView,
  handleSubscriptionWebhook
};
