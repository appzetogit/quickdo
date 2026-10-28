/**
 * Who may move money, checked on the cases that decide whether this is real.
 *
 * Run: node src/core/admin/__checks__/financeAuthz.check.js
 *
 * Pure decision logic -- no database, no express. The three things worth pinning
 * down are the ones that make the difference between an authorization layer and
 * decoration: an admin WITHOUT the permission is refused once enforcing; a
 * platform superadmin is never accidentally locked out; and tolerant mode lets
 * work continue while still marking every violation, because a rollout that takes
 * the withdrawal queue down gets reverted and then nothing is enforced at all.
 */
import assert from 'node:assert/strict';
import { decide, FINANCE_ACTIONS, REASON_REQUIRED, MIN_REASON_LENGTH } from '../financeAuthz.js';

let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const withPerms = (permissions, extra = {}) => ({
    _id: 'a1', email: 'a@x.com', permissions, adminLevel: 'subadmin', module: 'food', ...extra,
});
const platformSuper = { _id: 's1', email: 's@x.com', adminLevel: 'platform_superadmin', permissions: [] };
const REASON = 'rider called support';

// --- enforcing: the actual gate ---------------------------------------------
console.log('\nenforcing');

check('an admin WITHOUT wallet.write is refused', () => {
    const v = decide(withPerms(['orders.read']), 'WITHDRAWAL_DECIDE', { enforcing: true, reason: REASON });
    assert.equal(v.allow, false);
    assert.equal(v.status, 403);
    assert.equal(v.code, 'FORBIDDEN_FINANCE_ACTION');
});

check('an admin with NO permissions at all is refused', () => {
    // This is the default on the schema, i.e. most existing subadmins.
    assert.equal(decide(withPerms([]), 'PARTNER_BONUS_GRANT', { enforcing: true, reason: REASON }).allow, false);
});

check('an admin with wallet.write is allowed', () => {
    const v = decide(withPerms(['wallet.write']), 'WITHDRAWAL_DECIDE', { enforcing: true, reason: REASON });
    assert.equal(v.allow, true);
    assert.equal(v.permitted, true);
    assert.equal(v.tolerated, false);
});

check('wallet.read alone does NOT permit a money move', () => {
    // write implies read in hasResourcePermission; the reverse must never hold.
    assert.equal(decide(withPerms(['wallet.read']), 'WITHDRAWAL_DECIDE', { enforcing: true, reason: REASON }).allow, false);
});

check('a wildcard permission is allowed', () => {
    assert.equal(decide(withPerms(['*']), 'PARTNER_WALLET_ADJUST', { enforcing: true, reason: REASON }).allow, true);
});

check('a platform superadmin is never locked out by an empty permission list', () => {
    // Losing superadmin access to the payout queue during a security rollout is
    // how a security rollout gets reverted.
    assert.equal(decide(platformSuper, 'WITHDRAWAL_DECIDE', { enforcing: true, reason: REASON }).allow, true);
});

check('an unauthenticated caller is 401, not 403', () => {
    const v = decide(null, 'WITHDRAWAL_DECIDE', { enforcing: true, reason: REASON });
    assert.equal(v.status, 401);
});

check('an admin with no `admins` row is TOLERATED, not locked out, while tolerant', () => {
    /*
     * This middleware runs after the vertical's own authenticate, so a null admin
     * means "token subject not found in the admins collection" -- a vertical-native
     * admin -- not "not signed in". 401-ing them while tolerant would hard-lock
     * them out of the payout queue on the very deploy that promises to change
     * nothing. serviceAccess.middleware.js meets the same case and lets it through.
     */
    const v = decide(null, 'WITHDRAWAL_DECIDE', { enforcing: false });
    assert.equal(v.allow, true);
    assert.equal(v.tolerated, true);
    assert.equal(v.permitted, false);
});

check('cash-limit changes need fee_settings.write, not wallet.write', () => {
    assert.equal(decide(withPerms(['wallet.write']), 'CASH_LIMIT_SET', { enforcing: true }).allow, false);
    assert.equal(decide(withPerms(['fee_settings.write']), 'CASH_LIMIT_SET', { enforcing: true }).allow, true);
});

// --- tolerant mode: the rollout ---------------------------------------------
console.log('\ntolerant mode (the default, until every grant is fixed)');

check('an admin without the permission is let through, but MARKED', () => {
    const v = decide(withPerms([]), 'WITHDRAWAL_DECIDE', { enforcing: false });
    assert.equal(v.allow, true);
    assert.equal(v.permitted, false);
    assert.equal(v.tolerated, true);
});

check('an admin WITH the permission is not marked as a violation', () => {
    const v = decide(withPerms(['wallet.write']), 'WITHDRAWAL_DECIDE', { enforcing: false });
    assert.equal(v.tolerated, false);
    assert.equal(v.permitted, true);
});

check('tolerant mode does not demand a reason, even with default arguments', () => {
    // Regression: `requireReason` used to default to true independently of
    // `enforcing`, so tolerant mode passed the permission check and then returned
    // 400 REASON_REQUIRED anyway -- breaking the very queue the staged rollout
    // exists to keep working. Tolerant means tolerant of the whole policy.
    assert.equal(decide(withPerms([]), 'WITHDRAWAL_DECIDE', { enforcing: false }).allow, true);
    assert.equal(decide(withPerms([]), 'WITHDRAWAL_DECIDE', { enforcing: false, requireReason: false }).allow, true);
});

check('a caller may still demand a reason while tolerant, if it asks', () => {
    assert.equal(
        decide(withPerms(['*']), 'WITHDRAWAL_DECIDE', { enforcing: false, requireReason: true, reason: '' }).code,
        'REASON_REQUIRED',
    );
});

// --- the reason requirement --------------------------------------------------
console.log('\nthe reason');

check('a money move without a reason is refused once enforcing', () => {
    const v = decide(withPerms(['wallet.write']), 'PARTNER_BONUS_GRANT', { enforcing: true, reason: '' });
    assert.equal(v.allow, false);
    assert.equal(v.code, 'REASON_REQUIRED');
});

check('a token reason is not a reason', () => {
    assert.equal(decide(withPerms(['*']), 'PARTNER_BONUS_GRANT', { enforcing: true, reason: '.' }).code, 'REASON_REQUIRED');
    assert.equal(decide(withPerms(['*']), 'PARTNER_BONUS_GRANT', { enforcing: true, reason: '   ' }).code, 'REASON_REQUIRED');
});

check('a platform-wide setting change does not demand one', () => {
    // Asking for a reason everywhere trains operators to type "." -- which looks
    // like an audit trail and is not one.
    assert.equal(REASON_REQUIRED.has('CASH_LIMIT_SET'), false);
    assert.equal(decide(withPerms(['fee_settings.write']), 'CASH_LIMIT_SET', { enforcing: true, reason: '' }).allow, true);
});

check('a reason of exactly the minimum length is accepted', () => {
    const r = 'x'.repeat(MIN_REASON_LENGTH);
    assert.equal(decide(withPerms(['*']), 'PARTNER_BONUS_GRANT', { enforcing: true, reason: r }).allow, true);
});

check('an admin who lacks the permission is told that, not scolded about the reason', () => {
    // Reporting REASON_REQUIRED to someone who could never proceed sends them to
    // fix the wrong thing.
    const v = decide(withPerms([]), 'PARTNER_BONUS_GRANT', { enforcing: true, reason: '' });
    assert.equal(v.code, 'FORBIDDEN_FINANCE_ACTION');
});

// --- failing closed ----------------------------------------------------------
console.log('\nunknown actions fail closed');

check('an unmapped action is refused, never waved through', () => {
    const v = decide(withPerms(['*']), 'NOT_A_REAL_ACTION', { enforcing: true, reason: REASON });
    assert.equal(v.allow, false);
    assert.equal(v.code, 'UNKNOWN_FINANCE_ACTION');
});

check('an unmapped action is refused in tolerant mode too', () => {
    assert.equal(decide(withPerms(['*']), 'NOT_A_REAL_ACTION', { enforcing: false }).allow, false);
});

check('every mapped action names a resource, an action and a target type', () => {
    for (const [key, spec] of Object.entries(FINANCE_ACTIONS)) {
        assert.ok(spec.resource, `${key} has no resource`);
        assert.ok(spec.action, `${key} has no action`);
        assert.ok(spec.targetType, `${key} has no targetType`);
    }
});

check('every action requiring a reason is a real action', () => {
    for (const key of REASON_REQUIRED) {
        assert.ok(FINANCE_ACTIONS[key], `REASON_REQUIRED names unknown action ${key}`);
    }
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
