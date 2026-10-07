/**
 * The platform's finance permission check (core/admin/requireFinancePermission.middleware.js)
 * for this CommonJS module.
 *
 * That middleware is ESM, so it cannot be required here. It is loaded on the first
 * request and reused after that. The action key is checked when the route file is
 * loaded, the same as the ESM version does, so a typo still fails at boot rather
 * than letting money move unchecked.
 *
 * Mount it AFTER `authenticate` and `isAdmin`: it reads req.user.
 */
const KNOWN_ACTIONS = new Set([
  'WITHDRAWAL_DECIDE',
  'PARTNER_WALLET_ADJUST',
  'PARTNER_BONUS_GRANT',
  'EARNING_CREDIT',
  'REFUND_ISSUE',
  'CASH_LIMIT_SET',
  'COMMISSION_RULE_SET',
  'PLATFORM_SETTING_SET',
]);

const requireFinancePermission = (actionKey) => {
  if (!KNOWN_ACTIONS.has(actionKey)) {
    throw new Error(`requireFinancePermission: unknown action "${actionKey}"`);
  }
  let middleware = null;
  return async (req, res, next) => {
    try {
      if (!middleware) {
        const mod = await import('../../../core/admin/requireFinancePermission.middleware.js');
        middleware = mod.requireFinancePermission(actionKey);
      }
      return middleware(req, res, next);
    } catch (err) {
      return next(err);
    }
  };
};

module.exports = { requireFinancePermission };
