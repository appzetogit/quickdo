/**
 * Subscription plan catalog helpers (calendar-month postpaid model).
 *
 * Plans (Starter/Growth/Premium) are assigned automatically from the
 * restaurant's monthly earnings (restaurant net share) — see subscriptionBilling.service.js for the
 * billing engine. This module only knows how to build the plan catalog
 * from admin settings and resolve which plan a GMV amount falls into.
 */

export const GST_RATE = 0.18;

export const SUBSCRIPTION_PLAN_KEYS = {
    STARTER: "starter",
    GROWTH: "growth",
    PREMIUM: "premium",
};

const LEGACY_PLAN_MAP = {
    silver: SUBSCRIPTION_PLAN_KEYS.STARTER,
    gold: SUBSCRIPTION_PLAN_KEYS.GROWTH,
    pro: SUBSCRIPTION_PLAN_KEYS.GROWTH,
    elite: SUBSCRIPTION_PLAN_KEYS.PREMIUM,
};

const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizePlanName = (value) => {
    const plan = String(value || "").trim().toLowerCase();
    if (plan === SUBSCRIPTION_PLAN_KEYS.STARTER || plan === SUBSCRIPTION_PLAN_KEYS.GROWTH || plan === SUBSCRIPTION_PLAN_KEYS.PREMIUM) {
        return plan;
    }
    return LEGACY_PLAN_MAP[plan] || SUBSCRIPTION_PLAN_KEYS.STARTER;
};

export const buildPlanCatalog = (settings = {}) => {
    const starterPrice = Math.max(0, toNum(settings.starterPrice, 999));
    const growthPrice = Math.max(0, toNum(settings.growthPrice, 1999));
    const premiumPrice = Math.max(0, toNum(settings.premiumPrice, 2999));
    const starterMinGmv = Math.max(0, toNum(settings.starterMinGmv, 0));
    const starterMaxGmv = Math.max(starterMinGmv, toNum(settings.starterMaxGmv, 30000));
    const growthMinGmv = Math.max(starterMaxGmv, toNum(settings.growthMinGmv, starterMaxGmv + 0.01));
    const growthMaxGmv = Math.max(growthMinGmv, toNum(settings.growthMaxGmv, 60000));
    const premiumMinGmv = Math.max(growthMaxGmv, toNum(settings.premiumMinGmv, growthMaxGmv + 0.01));

    return {
        starterMinGmv,
        starterMaxGmv,
        growthMinGmv,
        growthMaxGmv,
        premiumMinGmv,
        plans: [
            { id: SUBSCRIPTION_PLAN_KEYS.STARTER, label: "Starter", basePrice: starterPrice, gmvMin: starterMinGmv, gmvMax: starterMaxGmv },
            { id: SUBSCRIPTION_PLAN_KEYS.GROWTH, label: "Growth", basePrice: growthPrice, gmvMin: growthMinGmv, gmvMax: growthMaxGmv },
            { id: SUBSCRIPTION_PLAN_KEYS.PREMIUM, label: "Premium", basePrice: premiumPrice, gmvMin: premiumMinGmv, gmvMax: null },
        ],
    };
};

export const resolveEligiblePlanByGmv = (gmv = 0, catalog = buildPlanCatalog({})) => {
    const safeGmv = Math.max(0, toNum(gmv, 0));
    if (safeGmv >= catalog.starterMinGmv && safeGmv <= catalog.starterMaxGmv) return SUBSCRIPTION_PLAN_KEYS.STARTER;
    if (safeGmv >= catalog.growthMinGmv && safeGmv <= catalog.growthMaxGmv) return SUBSCRIPTION_PLAN_KEYS.GROWTH;
    return SUBSCRIPTION_PLAN_KEYS.PREMIUM;
};
