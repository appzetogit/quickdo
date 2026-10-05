/**
 * A service provider's cash limit, from the platform settings.
 *
 * SP used to own this number outright: each vendor and worker document carries
 * `wallet.cashLimit`, SP's settings screen pushed one value onto all of them, and
 * the per-vendor admin edit overwrote one. Nothing connected it to the rest of the
 * platform. It is now read through core/finance/cashLimit.service.js at the
 * `serviceProvider` vertical, so Master > Platform settings can set it globally, for
 * SP as a whole, or per partner -- and SP's own screens still work, because they
 * write through to the same settings (see settingsController / settlementController).
 *
 * The document's own `wallet.cashLimit` is the fallback until an admin sets a value
 * in Platform settings, so nothing changes on deploy. SP's historic convention is
 * kept for that fallback: unset or 0 on the document meant Rs 10,000.
 *
 * `limit` is what to COMPARE with. A configured 0, or enforcement switched off,
 * means no ceiling -- an explicit NO_CEILING here, because SP code compares
 * `netOwed > limit` directly and a literal 0 would block every partner.
 */
const LEGACY_DEFAULT = 10000;
const NO_CEILING = Number.MAX_SAFE_INTEGER;

const load = () => import('../../../core/finance/cashLimit.service.js');

const legacyOf = (doc) => {
  const v = Number(doc?.wallet?.cashLimit);
  return Number.isFinite(v) && v > 0 ? v : LEGACY_DEFAULT;
};

const toSp = (r) => ({
  limit: r.cashLimit > 0 ? r.cashLimit : NO_CEILING,
  display: r.configuredCashLimit,
  enforce: r.enforce,
  source: r.source,
});

/** One partner (vendor or worker document, or anything with _id and wallet). */
const effectiveCashLimit = async (doc) => {
  const { resolveCashLimit } = await load();
  const r = await resolveCashLimit({ vertical: 'serviceProvider', partnerId: doc?._id, legacy: legacyOf(doc) });
  return toSp(r);
};

/** Many partners in one settings read; returns Map<idString, result>. */
const effectiveCashLimits = async (docs = []) => {
  const { resolveCashLimitsForPartners } = await load();
  const resolved = await resolveCashLimitsForPartners({
    vertical: 'serviceProvider',
    partners: docs.map((d) => ({ id: d._id, legacy: legacyOf(d) })),
  });
  return new Map([...resolved].map(([id, r]) => [id, toSp(r)]));
};

/** Mirror an SP admin's change into the platform settings. Never throws. */
const recordCashLimit = async ({ level, scopeId, value, updatedBy, reason }) => {
  const { recordCashLimitSetting } = await load();
  return recordCashLimitSetting({ level, scopeId, value, updatedBy: String(updatedBy || ''), reason });
};

module.exports = { effectiveCashLimit, effectiveCashLimits, recordCashLimit, NO_CEILING, LEGACY_DEFAULT };
