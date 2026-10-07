const Settings = require('../models/Settings');

/**
 * Single source of truth for the platform/vendor revenue split.
 *
 * Before this existed the same rate was written three different ways:
 * the Settings schema defaulted to 90, the billing controllers fell back to 70,
 * and the dashboards hardcoded 80 (as `* 0.2` / `* 0.8`). Reports therefore
 * disagreed with the actual ledger whenever the configured split wasn't 80.
 *
 * Note: this is the SERVICE split only. Parts use partsPayoutPercentage, and
 * withdrawal-time TDS/platform fees are separate (see settlementController).
 *
 * Subscription & commission engine (SOW §8, plan §3.2)
 * ─────────────────────────────────────────────────────
 * resolveCommission(booking) decides the platform commission for one booking:
 *
 *   total <= commissionThreshold, provider subscription active  → 0 ('subscription')
 *   total <= commissionThreshold, no active subscription        → global rate, flagged
 *   total >  commissionThreshold                                → most specific active
 *       CommissionRule (provider > category > global), fixed or percentage, on the
 *       WHOLE base (D8), fixed capped at the base.
 *
 * "Global rate" is the newest active global CommissionRule, or, until admin
 * creates one, 100 - Settings.servicePayoutPercentage: exactly what the
 * platform charged before the engine existed.
 *
 * The result is frozen on the booking as `commissionSnapshot`. Everything that
 * pays out or reports a booking reads the snapshot (billSplit / bookingSplit /
 * commissionExpr below); getCommissionRates stays only as the fallback for
 * bookings settled before snapshots existed.
 */

// Must stay in sync with the Settings schema default.
const DEFAULT_SERVICE_PAYOUT_PCT = 90;
const DEFAULT_COMMISSION_THRESHOLD = 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Resolve the configured service payout percentage (vendor's share, 0-100).
 */
const getServicePayoutPct = async () => {
  const settings = await Settings.findOne({ type: 'global' })
    .select('servicePayoutPercentage')
    .lean();
  return settings?.servicePayoutPercentage ?? DEFAULT_SERVICE_PAYOUT_PCT;
};

/**
 * Resolve the split as fractions, ready to multiply against an amount.
 * Legacy: only for bookings without a commissionSnapshot.
 * @returns {Promise<{vendorShare: number, platformShare: number}>}
 */
const getCommissionRates = async () => {
  const payoutPct = await getServicePayoutPct();
  return {
    vendorShare: payoutPct / 100,
    platformShare: (100 - payoutPct) / 100
  };
};

/**
 * Is a subscription sub-document active right now?
 */
const isSubscriptionActive = (subscription, now = new Date()) => Boolean(
  subscription?.isActive &&
  subscription?.expiryDate &&
  new Date(subscription.expiryDate) > now
);

const ruleApplies = (rule, now) => Boolean(
  rule &&
  rule.active !== false &&
  (!rule.validFrom || new Date(rule.validFrom) <= now) &&
  (!rule.validTo || new Date(rule.validTo) >= now)
);

const newestFirst = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);

/**
 * Pick the rule that governs a booking. Pure.
 * @param {Array} rules candidate rules (any scope)
 * @param {{providerId, providerType, categoryId, now}} ctx
 * @param {boolean} globalOnly skip provider/category rules
 */
const pickRule = (rules, { providerId, providerType, categoryId, now = new Date() }, globalOnly = false) => {
  const live = (rules || []).filter((r) => ruleApplies(r, now)).sort(newestFirst);
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  if (!globalOnly) {
    const provider = live.find((r) => r.scope === 'provider' && same(r.refId, providerId) &&
      (!r.providerType || !providerType || r.providerType === providerType));
    if (provider) return provider;
    const category = live.find((r) => r.scope === 'category' && same(r.refId, categoryId));
    if (category) return category;
  }
  return live.find((r) => r.scope === 'global') || null;
};

/**
 * Apply a fixed/percentage rule to a base. Fixed is capped at the base.
 */
const applyRule = (type, value, base) => {
  const b = Math.max(0, Number(base) || 0);
  const v = Math.max(0, Number(value) || 0);
  if (type === 'fixed') return round2(Math.min(v, b));
  return round2((b * Math.min(v, 100)) / 100);
};

/**
 * The engine itself, with every input passed in. Pure: the smoke test drives it
 * directly, and resolveCommission below only gathers the inputs from the db.
 *
 * @param {object} p
 * @param {number} p.total              booking value compared with the threshold
 * @param {number} [p.base]             amount commission is charged on (defaults to total)
 * @param {number} p.threshold
 * @param {boolean} p.subscriptionActive
 * @param {Array}  p.rules              CommissionRule docs (lean)
 * @param {number} p.fallbackPayoutPct  Settings.servicePayoutPercentage
 * @returns {object} commissionSnapshot
 */
const computeCommission = ({
  total,
  base,
  threshold = DEFAULT_COMMISSION_THRESHOLD,
  subscriptionActive = false,
  rules = [],
  fallbackPayoutPct = DEFAULT_SERVICE_PAYOUT_PCT,
  providerId = null,
  providerType = null,
  categoryId = null,
  now = new Date()
}) => {
  const t = round2(total);
  const b = round2(base === undefined || base === null ? total : base);
  const snapshot = {
    model: 'commission',
    flag: null,
    ruleId: null,
    scope: null,
    type: null,
    value: 0,
    base: b,
    total: t,
    threshold: Number(threshold) || 0,
    amount: 0,
    providerType,
    providerId,
    subscriptionActive: Boolean(subscriptionActive),
    resolvedAt: now
  };

  const overThreshold = t > snapshot.threshold;

  if (!overThreshold && subscriptionActive) {
    snapshot.model = 'subscription';
    return snapshot;
  }

  // Under the threshold without a subscription only the global rate applies
  // (the behaviour before the engine) and the booking is flagged for review.
  if (!overThreshold) snapshot.flag = 'no_active_subscription';

  const rule = pickRule(rules, { providerId, providerType, categoryId, now }, !overThreshold);
  if (rule) {
    snapshot.ruleId = rule._id || null;
    snapshot.scope = rule.scope;
    snapshot.type = rule.type;
    snapshot.value = Number(rule.value) || 0;
  } else {
    snapshot.scope = 'settings';
    snapshot.type = 'percentage';
    snapshot.value = round2(100 - Number(fallbackPayoutPct ?? DEFAULT_SERVICE_PAYOUT_PCT));
  }
  snapshot.amount = applyRule(snapshot.type, snapshot.value, b);
  return snapshot;
};

/**
 * Who is the paid provider on this booking? Worker model → the worker;
 * vendor model → the vendor (its workers are the vendor's staff).
 */
const providerOf = (booking) => {
  if (booking?.bookingModel === 'worker' || (!booking?.vendorId && booking?.workerId)) {
    return { providerType: 'worker', providerId: booking?.workerId || null };
  }
  return { providerType: 'vendor', providerId: booking?.vendorId || null };
};

/**
 * Work out the commission for a booking from the database.
 *
 * @param {object} booking  Booking doc (needs bookingModel, vendorId/workerId, categoryId)
 * @param {object} opts
 * @param {number} opts.total   booking value (bill grand total, or amount collected)
 * @param {number} [opts.base]  amount commission is charged on (defaults to total)
 * @param {object} [opts.session]
 * @returns {Promise<object>} commissionSnapshot (not saved; the caller persists it)
 */
const resolveCommission = async (booking, { total, base, session = null, now = new Date() } = {}) => {
  const CommissionRule = require('../models/CommissionRule');
  const { providerType, providerId } = providerOf(booking);

  const settingsQuery = Settings.findOne({ type: 'global' })
    .select('servicePayoutPercentage commissionThreshold')
    .lean();
  if (session) settingsQuery.session(session);
  const settings = await settingsQuery;

  let subscriptionActive = false;
  if (providerId) {
    const Model = providerType === 'worker' ? require('../models/Worker') : require('../models/Vendor');
    const q = Model.findById(providerId).select('subscription').lean();
    if (session) q.session(session);
    const provider = await q;
    subscriptionActive = isSubscriptionActive(provider?.subscription, now);
  }

  const or = [{ scope: 'global' }];
  if (providerId) or.push({ scope: 'provider', refId: providerId });
  if (booking?.categoryId) or.push({ scope: 'category', refId: booking.categoryId });
  const rq = CommissionRule.find({ active: true, $or: or }).lean();
  if (session) rq.session(session);
  const rules = await rq;

  const amount = total ?? booking?.finalAmount ?? 0;
  return computeCommission({
    total: amount,
    base: base ?? amount,
    threshold: settings?.commissionThreshold ?? DEFAULT_COMMISSION_THRESHOLD,
    subscriptionActive,
    rules,
    fallbackPayoutPct: settings?.servicePayoutPercentage ?? DEFAULT_SERVICE_PAYOUT_PCT,
    providerId,
    providerType,
    categoryId: booking?.categoryId || null,
    now
  });
};

const hasSnapshot = (booking) => Boolean(
  booking?.commissionSnapshot?.model && booking.commissionSnapshot.amount !== undefined
);

/**
 * Partner/platform split for a booking WITH a VendorBill. Synchronous.
 *
 * Vendor model: the bill's vendorTotalEarning (it already has the snapshot's
 * commission taken off the service line, see the bill controllers).
 * Worker model: the worker keeps the bill total less the snapshot's commission;
 * bills made before snapshots existed keep the old 100%.
 */
const billSplit = (booking, bill) => {
  const grandTotal = Number(bill?.grandTotal) || 0;
  if (booking?.bookingModel === 'worker') {
    const commission = hasSnapshot(booking) ? Math.min(Number(booking.commissionSnapshot.amount) || 0, grandTotal) : 0;
    return { partnerEarning: round2(grandTotal - commission), platformCommission: round2(commission), grandTotal };
  }
  return {
    partnerEarning: Number(bill?.vendorTotalEarning) || 0,
    platformCommission: Number(bill?.companyRevenue) || 0,
    grandTotal
  };
};

/**
 * Partner/platform split at settlement time.
 *
 * With a bill → billSplit. Without one this is the moment the commission is
 * worked out, so it resolves (if the booking has no snapshot yet), writes the
 * snapshot onto `booking` (the caller's booking.save() persists it) and
 * charges it on the whole amount.
 *
 * @returns {Promise<{partnerEarning, platformCommission, grandTotal, snapshot}>}
 */
const bookingSplit = async ({ booking, bill = null, amount, session = null }) => {
  if (bill) return { ...billSplit(booking, bill), snapshot: booking?.commissionSnapshot || null };

  const total = round2(amount ?? booking?.finalAmount ?? 0);
  if (!hasSnapshot(booking)) {
    booking.commissionSnapshot = await resolveCommission(booking, { total, base: total, session });
  }
  const commission = Math.min(Number(booking.commissionSnapshot.amount) || 0, total);
  return {
    partnerEarning: round2(total - commission),
    platformCommission: round2(commission),
    grandTotal: total,
    snapshot: booking.commissionSnapshot
  };
};

/**
 * Mongo expression for a booking's platform commission in reports: the
 * snapshot amount when there is one, else the legacy `amountField * platformShare`.
 */
const commissionExpr = (platformShare, amountField = '$finalAmount') => ({
  $ifNull: ['$commissionSnapshot.amount', { $multiply: [{ $ifNull: [amountField, 0] }, platformShare] }]
});

module.exports = {
  DEFAULT_SERVICE_PAYOUT_PCT,
  DEFAULT_COMMISSION_THRESHOLD,
  round2,
  getServicePayoutPct,
  getCommissionRates,
  isSubscriptionActive,
  pickRule,
  applyRule,
  computeCommission,
  providerOf,
  resolveCommission,
  hasSnapshot,
  billSplit,
  bookingSplit,
  commissionExpr
};
