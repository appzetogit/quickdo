import { logger } from '../../utils/logger.js';

/**
 * What a referral pays, set once in Master > Referral.
 *
 * Three systems grew separately: Food (food_referral_settings), Quick & Medical
 * (qc_referral_settingses) and Taxi (the referral block of its business
 * settings). Each still decides WHEN it pays -- Food and Quick at sign-up or
 * rider approval, Taxi after the completed rides its own screen asks for -- but
 * HOW MUCH now comes from here when an admin has set it (globally, or for one
 * service), so "a referral pays Rs 50" is one number instead of three.
 *
 * Unset keeps each service's own value. That is deliberate: this reaches the
 * code paths that credit wallets, and a new screen must not change what anyone
 * is paid until somebody saves something on it.
 *
 * Verticals: 'food', 'quickCommerce' (which Medical runs on) and 'taxi'.
 */

const KEYS = {
  customerReward: 'referral.customerReward',
  customerLimit: 'referral.customerLimit',
  partnerReward: 'referral.partnerReward',
  partnerLimit: 'referral.partnerLimit',
};

export const REFERRAL_VERTICALS = ['food', 'quickCommerce', 'taxi'];

const NONE = Object.freeze({ customerReward: null, customerLimit: null, partnerReward: null, partnerLimit: null });

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The Master values for one service; null for anything not set there.
 *
 * Fails open to "nothing set": a settings read that errors must not decide what
 * someone is paid, so the service's own value stands, as it did before.
 */
export async function resolveMasterReferral(vertical) {
  try {
    const { getMany } = await import('../config/resolver.service.js');
    const rows = await getMany(Object.values(KEYS), { vertical: vertical || undefined });
    const pick = (key) => (rows[key] && !rows[key].isDefault ? num(rows[key].value) : null);
    return {
      customerReward: pick(KEYS.customerReward),
      customerLimit: pick(KEYS.customerLimit),
      partnerReward: pick(KEYS.partnerReward),
      partnerLimit: pick(KEYS.partnerLimit),
    };
  } catch (err) {
    logger.warn(`referral: Master read failed for ${vertical}, using the service's own: ${err.message}`);
    return { ...NONE };
  }
}

const anySet = (m) => Object.values(m).some((v) => v !== null);

/**
 * Food's or Quick's referral settings document, with Master's values in place.
 *
 * Returns the same shape every existing caller reads (referralRewardUser,
 * referralLimitUser, referralRewardDelivery, referralLimitDelivery, plus the
 * link templates), so a call site changes only where the document comes from.
 * Null only when neither the service nor Master has anything -- as before.
 *
 * @param {'food'|'quickCommerce'} vertical
 * @param {import('mongoose').Model} Model  that service's referral settings model
 */
export async function referralSettingsFor(vertical, Model) {
  const [doc, master] = await Promise.all([
    Model.findOne({ isActive: true }).sort({ createdAt: -1 }).lean(),
    resolveMasterReferral(vertical),
  ]);
  if (!anySet(master)) return doc;
  const base = doc || { isActive: true, referralRewardUser: 0, referralLimitUser: 0, referralRewardDelivery: 0, referralLimitDelivery: 0 };
  return {
    ...base,
    referralRewardUser: master.customerReward ?? base.referralRewardUser,
    referralLimitUser: master.customerLimit ?? base.referralLimitUser,
    referralRewardDelivery: master.partnerReward ?? base.referralRewardDelivery,
    referralLimitDelivery: master.partnerLimit ?? base.referralLimitDelivery,
  };
}

/**
 * Taxi's referral block ({ enabled, type, amount, ride_count, ... }) for users or
 * drivers, with Master's amount in place. A Master amount above 0 also switches
 * the programme on and 0 switches it off; Taxi's own rules -- which type, how
 * many rides first, the driver milestones -- are left exactly as its screen has
 * them. Taxi has no per-referrer cap, so the Master caps do not apply to it.
 *
 * @param {'user'|'driver'} kind
 * @param {object} own  setting.referral.user or setting.referral.driver
 */
export async function taxiReferralFor(kind, own = {}) {
  const master = await resolveMasterReferral('taxi');
  const amount = kind === 'driver' ? master.partnerReward : master.customerReward;
  if (amount === null) return own || {};
  return { ...(own || {}), amount, enabled: amount > 0 };
}

/**
 * What every service pays right now and where each number comes from, for the
 * Master screen: "Food pays Rs 50 (its own setting)" vs "(Master)".
 */
export async function referralOverview() {
  const [{ FoodReferralSettings }, { FoodReferralSettings: QuickReferralSettings }, { AdminBusinessSetting }] = await Promise.all([
    import('../../modules/food/admin/models/referralSettings.model.js'),
    import('../../modules/quickCommerce/modules/food/admin/models/referralSettings.model.js'),
    import('../../modules/taxi/admin/models/AdminBusinessSetting.js'),
  ]);

  const storeRow = async (vertical, Model) => {
    const [own, master] = await Promise.all([
      Model.findOne({ isActive: true }).sort({ createdAt: -1 }).lean(),
      resolveMasterReferral(vertical),
    ]);
    const field = (m, o) => ({ value: m ?? num(o) ?? 0, from: m !== null ? 'master' : 'service' });
    return {
      vertical,
      customerReward: field(master.customerReward, own?.referralRewardUser),
      customerLimit: field(master.customerLimit, own?.referralLimitUser),
      partnerReward: field(master.partnerReward, own?.referralRewardDelivery),
      partnerLimit: field(master.partnerLimit, own?.referralLimitDelivery),
    };
  };

  const taxiRow = async () => {
    const [setting, master] = await Promise.all([
      AdminBusinessSetting.findOne({ scope: 'default' }).lean(),
      resolveMasterReferral('taxi'),
    ]);
    const own = setting?.referral || {};
    const amount = (m, o) =>
      m !== null
        ? { value: m, from: 'master' }
        : { value: o?.enabled ? num(o?.amount) ?? 0 : 0, from: 'service' };
    return {
      vertical: 'taxi',
      customerReward: amount(master.customerReward, own.user),
      customerLimit: { value: null, from: 'none' },
      partnerReward: amount(master.partnerReward, own.driver),
      partnerLimit: { value: null, from: 'none' },
      afterRides: {
        user: num(own.user?.ride_count) ?? 0,
        driver: num(own.driver?.ride_count) ?? 0,
      },
    };
  };

  return {
    services: await Promise.all([
      storeRow('food', FoodReferralSettings),
      storeRow('quickCommerce', QuickReferralSettings),
      taxiRow(),
    ]),
  };
}
