const Worker = require('../models/Worker');
const Vendor = require('../models/Vendor');

/**
 * Subscription expiry reminders (SOW §8, plan §3.2).
 *
 * Providers whose subscription ends within REMIND_DAYS get one in-app/push
 * notification per term through the existing notification controller. A lapsed
 * subscription already stops job assignment (locationService), so this is the
 * provider's only warning.
 *
 * Run from the SP booking scheduler tick at most once an hour (see
 * bookingScheduler.js). The claim on subscription.reminderSentFor makes it safe
 * across instances: only the instance that flips the flag sends the reminder.
 */

const REMIND_DAYS = 3;
const RUN_EVERY_MS = 60 * 60 * 1000;

let lastRunAt = 0;

const sendSubscriptionReminders = async ({ now = new Date(), days = REMIND_DAYS } = {}) => {
  const { createNotification } = require('../controllers/notificationControllers/notificationController');
  const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  let sent = 0;

  for (const [Model, field, label] of [[Worker, 'workerId', 'worker'], [Vendor, 'vendorId', 'vendor']]) {
    const due = await Model.find({
      'subscription.isActive': true,
      // An auto-renewing subscription renews itself; no reminder (plan §3.2).
      'subscription.autoRenew': { $ne: true },
      'subscription.expiryDate': { $gt: now, $lte: horizon }
    }).select('subscription').limit(500).lean();

    for (const p of due) {
      const expiry = p.subscription.expiryDate;
      const claim = await Model.updateOne(
        { _id: p._id, 'subscription.reminderSentFor': { $ne: expiry } },
        { $set: { 'subscription.reminderSentFor': expiry } }
      );
      if (claim.modifiedCount !== 1) continue;

      const dateLabel = new Date(expiry).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      await createNotification({
        [field]: p._id,
        type: 'subscription_expiring',
        title: 'Subscription expiring soon',
        message: `Your ${p.subscription.planName || 'platform'} subscription ends on ${dateLabel}. Renew to keep receiving jobs.`,
        relatedType: label,
        priority: 'high',
        pushData: { type: 'subscription_expiring', expiryDate: new Date(expiry).toISOString() }
      }).catch((err) => console.error('[SubscriptionReminder] notify failed:', err.message));
      sent += 1;
    }
  }
  return sent;
};

/**
 * Throttled entry point for the scheduler tick. Never throws.
 */
const maybeSendSubscriptionReminders = async () => {
  const nowMs = Date.now();
  if (nowMs - lastRunAt < RUN_EVERY_MS) return 0;
  lastRunAt = nowMs;
  try {
    return await sendSubscriptionReminders();
  } catch (err) {
    console.error('[SubscriptionReminder] run failed:', err.message);
    return 0;
  }
};

module.exports = { REMIND_DAYS, sendSubscriptionReminders, maybeSendSubscriptionReminders };
