/**
 * Whether an admin may move somebody else's money -- decided, not assumed.
 *
 * Today every financial admin route is gated on `role === 'ADMIN' || 'SUPER_ADMIN'`
 * and nothing else, so any admin account can approve any withdrawal, grant any
 * bonus and credit any wallet. The permission model to stop that already exists
 * (`hasAdminPermission`, and a resource catalog with `wallet` in it) -- it was
 * simply never mounted anywhere.
 *
 * This file is the decision only: pure, no database, no express. The middleware
 * beside it does the loading and the logging. Splitting them is what makes the
 * rule checkable without standing up a request.
 *
 * ROLLOUT, and why it is not just "start returning 403":
 *
 * `permissions` defaults to `[]` on the admin schema, and only the seeded
 * superadmin gets `['*']`. So switching enforcement on in one deploy would lock
 * every existing subadmin out of the withdrawal queue at once -- a self-inflicted
 * outage on the operations team, in exchange for closing a hole that has been open
 * for months. Instead `decide()` reports what it WOULD do, the middleware records
 * every tolerated violation, and enforcement flips only once that list is empty.
 */

import { hasAdminPermission } from './adminHierarchy.service.js';

/**
 * The permission each money-moving action requires.
 *
 * Resource names come from FOOD_PERMISSION_RESOURCES -- `wallet`, `fee_settings`
 * -- rather than being invented here. A new name like `partner_wallet` would be a
 * permission no admin holds and the panel cannot grant, so enforcement would
 * block everyone forever with no way out.
 */
export const FINANCE_ACTIONS = Object.freeze({
    WITHDRAWAL_DECIDE: { resource: 'wallet', action: 'write', targetType: 'withdrawal' },
    PARTNER_WALLET_ADJUST: { resource: 'wallet', action: 'write', targetType: 'partner' },
    PARTNER_BONUS_GRANT: { resource: 'wallet', action: 'write', targetType: 'partner' },
    EARNING_CREDIT: { resource: 'wallet', action: 'write', targetType: 'partner' },
    CASH_LIMIT_SET: { resource: 'fee_settings', action: 'write', targetType: 'platform' },
    COMMISSION_RULE_SET: { resource: 'fee_settings', action: 'write', targetType: 'platform' },
    /*
     * Platform settings. Write only -- reading the catalogue is how an operator
     * finds out what exists, and gating that behind a permission means the panel
     * cannot render its own settings screen for anyone who is not allowed to
     * change them. A value that can be seen but not edited is fine; a screen that
     * renders empty is a support ticket.
     */
    PLATFORM_SETTING_SET: { resource: 'settings', action: 'write', targetType: 'platform' },
});

/**
 * Does this action need a written justification?
 *
 * Money moving to a specific person does; changing a platform-wide setting is
 * already attributable by its own before/after. Asking for a reason on everything
 * trains operators to type "." -- which is worse than not asking, because it looks
 * like an audit trail and is not one.
 */
export const REASON_REQUIRED = Object.freeze(
    new Set(['WITHDRAWAL_DECIDE', 'PARTNER_WALLET_ADJUST', 'PARTNER_BONUS_GRANT', 'EARNING_CREDIT']),
);

export const MIN_REASON_LENGTH = 4;

/**
 * @param {object} admin      the admin document (permissions, adminLevel, module)
 * @param {string} actionKey  a key of FINANCE_ACTIONS
 * @param {object} opts
 * @param {boolean} opts.enforcing      is enforcement switched on yet
 * @param {string}  opts.reason         operator-supplied justification
 * @param {boolean} [opts.requireReason]  override; defaults to `enforcing`
 * @returns {{allow: boolean, permitted: boolean, tolerated: boolean, status: number, code: string|null, message: string|null}}
 */
export function decide(admin, actionKey, { enforcing = false, reason = '', requireReason } = {}) {
    /*
     * The reason requirement follows enforcement unless a caller overrides it.
     *
     * Defaulting this to `true` independently made tolerant mode incoherent: an
     * admin with no permission was let through on the permission check and then
     * refused for a missing reason, so "tolerant" still returned 400 and the
     * rollout would have broken the withdrawal queue it was designed to protect.
     * Tolerant means tolerant of the whole policy, not half of it.
     */
    const reasonRequired = requireReason === undefined ? enforcing : requireReason;
    const spec = FINANCE_ACTIONS[actionKey];
    if (!spec) {
        // An unmapped action is a programming error, and the safe reading of "I do
        // not know what permission this needs" is not "therefore none".
        return {
            allow: false, permitted: false, tolerated: false,
            status: 500, code: 'UNKNOWN_FINANCE_ACTION',
            message: `No finance permission mapped for "${actionKey}"`,
        };
    }

    if (!admin) {
        /*
         * "No admin document" is not the same as "not signed in". This middleware
         * runs AFTER the vertical's own authenticate, so the caller is already
         * authenticated; a null here means their token subject was not found in the
         * `admins` collection -- a vertical-native admin, or a lookup that failed.
         *
         * serviceAccess.middleware.js meets the same case and lets it through. If
         * this returned 401 while tolerant, a rollout whose entire promise is "this
         * changes nothing yet" would hard-lock those admins out of the payout
         * queue on deploy. Tolerated and recorded instead, so they show up in the
         * same audit list as every other grant that needs fixing.
         */
        if (!enforcing) {
            return { allow: true, permitted: false, tolerated: true, status: 200, code: null, message: null };
        }
        return {
            allow: false, permitted: false, tolerated: false,
            status: 401, code: 'NOT_AUTHENTICATED', message: 'Not authenticated',
        };
    }

    const permitted = hasAdminPermission(admin, spec.resource, spec.action);

    // The reason is checked BEFORE the permission outcome is applied, but only for
    // an admin who would otherwise be allowed through -- there is no point telling
    // someone who lacks the permission that their justification was too short.
    if ((permitted || !enforcing) && reasonRequired && REASON_REQUIRED.has(actionKey)) {
        const trimmed = String(reason || '').trim();
        if (trimmed.length < MIN_REASON_LENGTH) {
            return {
                allow: false, permitted, tolerated: false,
                status: 400, code: 'REASON_REQUIRED',
                message: `A reason of at least ${MIN_REASON_LENGTH} characters is required for this action`,
            };
        }
    }

    if (permitted) {
        return { allow: true, permitted: true, tolerated: false, status: 200, code: null, message: null };
    }

    if (!enforcing) {
        // Let it through, but say loudly that it would have been blocked. Every one
        // of these is a grant somebody has to fix before enforcement can start.
        return {
            allow: true, permitted: false, tolerated: true,
            status: 200, code: null, message: null,
        };
    }

    return {
        allow: false, permitted: false, tolerated: false,
        status: 403, code: 'FORBIDDEN_FINANCE_ACTION',
        message: `This action requires the "${spec.resource}.${spec.action}" permission`,
    };
}

export const __testables = { FINANCE_ACTIONS, REASON_REQUIRED, MIN_REASON_LENGTH };
