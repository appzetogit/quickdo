const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');

/**
 * Provider subscription ledger (SOW §8, plan §3.2).
 *
 * A subscription payment is written as two Transaction rows sharing the
 * gateway referenceId:
 *
 *   subscription_platform_fee  Settings.subscriptionPlatformFee — platform revenue
 *   subscription_remainder     the rest of the payment, tagged with
 *                              metadata.ledgerAccount = Settings.subscriptionRemainderLabel.
 *                              Where this money goes is still to be agreed (D7);
 *                              it is recorded, not routed.
 *
 * Payments made before the split were one 'worker_subscription' row for the
 * full amount. Revenue reads treat min(amount, current fee) of those as the fee.
 */

const SUBSCRIPTION_TX_TYPES = ['subscription_platform_fee', 'subscription_remainder', 'worker_subscription'];

const DEFAULT_PRICE = 1000;
const DEFAULT_FEE = 100;

const subscriptionSettings = async (session = null) => {
  const q = Settings.findOne({ type: 'global' })
    .select('subscriptionPrice subscriptionPlatformFee subscriptionRemainderLabel')
    .lean();
  if (session) q.session(session);
  const s = await q;
  return {
    price: s?.subscriptionPrice ?? DEFAULT_PRICE,
    platformFee: s?.subscriptionPlatformFee ?? DEFAULT_FEE,
    remainderLabel: s?.subscriptionRemainderLabel || 'subscription_remainder'
  };
};

/**
 * Split a paid amount into platform fee and remainder. Pure.
 */
const splitSubscription = (paid, platformFee) => {
  const amount = Math.max(0, Number(paid) || 0);
  const fee = Math.min(amount, Math.max(0, Number(platformFee) || 0));
  return { fee, remainder: Math.round((amount - fee) * 100) / 100 };
};

/**
 * Write the two ledger rows for one subscription payment, inside `session`.
 * @returns {Promise<{fee, remainder, remainderLabel}>}
 */
const recordSubscriptionPayment = async ({
  session = null,
  providerType,
  providerId,
  amount,
  referenceId,
  orderId,
  plan,
  expiryDate
}) => {
  const cfg = await subscriptionSettings(session);
  const { fee, remainder } = splitSubscription(amount, cfg.platformFee);
  const who = providerType === 'vendor' ? { vendorId: providerId } : { workerId: providerId };
  const metadata = {
    orderId,
    planId: plan?._id,
    expiryDate,
    providerType,
    grossAmount: Number(amount) || 0
  };

  const rows = [{
    ...who,
    type: 'subscription_platform_fee',
    amount: fee,
    status: 'completed',
    paymentMethod: 'razorpay',
    description: `Subscription platform fee: ${plan?.title || 'plan'} (${plan?.durationDays || '-'} days)`,
    referenceId,
    metadata: { ...metadata, ledgerAccount: 'platform_revenue' }
  }];
  if (remainder > 0) {
    rows.push({
      ...who,
      type: 'subscription_remainder',
      amount: remainder,
      status: 'completed',
      paymentMethod: 'razorpay',
      description: `Subscription remainder (${cfg.remainderLabel}): ${plan?.title || 'plan'}`,
      referenceId,
      metadata: { ...metadata, ledgerAccount: cfg.remainderLabel }
    });
  }
  await Transaction.create(rows, session ? { session, ordered: true } : { ordered: true });
  return { fee, remainder, remainderLabel: cfg.remainderLabel };
};

/**
 * Subscription money in, split into gross / platform fee / remainder.
 *
 * @param {object} match    extra $match on Transaction (e.g. a createdAt range)
 * @param {object} [groupId] $group _id expression; omit for a single total
 * @returns {Promise<{gross, platformFee, remainder}|Array<{_id, gross, platformFee, remainder}>>}
 */
const subscriptionRevenue = async (match = {}, groupId = null) => {
  const { platformFee } = await subscriptionSettings();
  const rows = await Transaction.aggregate([
    { $match: { status: 'completed', type: { $in: SUBSCRIPTION_TX_TYPES }, ...match } },
    {
      $group: {
        _id: groupId,
        gross: { $sum: '$amount' },
        platformFee: {
          $sum: {
            $switch: {
              branches: [
                { case: { $eq: ['$type', 'subscription_platform_fee'] }, then: '$amount' },
                { case: { $eq: ['$type', 'worker_subscription'] }, then: { $min: ['$amount', platformFee] } }
              ],
              default: 0
            }
          }
        }
      }
    }
  ]);
  const shape = (r) => ({
    _id: r._id,
    gross: r.gross || 0,
    platformFee: r.platformFee || 0,
    remainder: Math.round(((r.gross || 0) - (r.platformFee || 0)) * 100) / 100
  });
  if (groupId === null) {
    const { _id, ...total } = shape(rows[0] || {});
    return total;
  }
  return rows.map(shape);
};

module.exports = {
  SUBSCRIPTION_TX_TYPES,
  subscriptionSettings,
  splitSubscription,
  recordSubscriptionPayment,
  subscriptionRevenue
};
