/**
 * Admins get their own rate-limit bucket, and only real admins do.
 *
 * Run: node tests/admin-rate-limit.smoke.mjs
 *
 * The global limiter runs BEFORE authMiddleware. That is why it was IP-keyed:
 * keying on a token nobody had checked would let an attacker mint a fresh
 * bucket per request and have no limit at all.
 *
 * So the identity here is signature-verified. A verified admin gets their own,
 * larger bucket -- an admin screen is dozens of calls and a whole office shares
 * one public IP, which is what produced "Too many requests" during ordinary
 * work. Anything that does not verify falls back to the IP bucket, so a forged
 * token is never better than sending none.
 */
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const jwt = (await import('jsonwebtoken')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { __testables } = await import('../src/middleware/rateLimit.js');
const { verifiedAdminId, ADMIN_MAX } = __testables;

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

check('a real admin token is recognised', () => {
  const token = signAccessToken({ userId: 'admin-1', role: 'ADMIN' });
  assert.equal(verifiedAdminId(req(token)), 'admin-1');
});

check("taxi's lower-case role and `sub` claim work too", () => {
  // adminService signs { sub, role: 'admin' } rather than { userId, role: 'ADMIN' }.
  const token = signAccessToken({ sub: 'admin-2', role: 'admin' });
  assert.equal(verifiedAdminId(req(token)), 'admin-2');
});

check('a forged token gets no bucket of its own', () => {
  // Correctly shaped, signed with the wrong key: exactly the bucket-farming
  // attempt the IP keying existed to prevent.
  const forged = jwt.sign({ userId: 'attacker', role: 'ADMIN' }, 'not-the-real-secret');
  assert.equal(verifiedAdminId(req(forged)), null);
  // Unsigned "alg: none" style payloads too.
  assert.equal(verifiedAdminId(req('eyJhbGciOiJub25lIn0.eyJyb2xlIjoiQURNSU4ifQ.')), null);
});

check('a customer token gets no admin bucket', () => {
  const token = signAccessToken({ userId: 'cust-1', role: 'USER' });
  assert.equal(verifiedAdminId(req(token)), null);
});

check('an expired admin token gets no admin bucket', () => {
  const token = jwt.sign({ userId: 'admin-3', role: 'ADMIN' }, process.env.JWT_ACCESS_SECRET, { expiresIn: -10 });
  assert.equal(verifiedAdminId(req(token)), null);
});

check('nonsense in the header is refused rather than thrown', () => {
  for (const h of [undefined, '', 'Bearer', 'Bearer ', 'Basic abc', 'Bearer not.a.token', 'Bearer ...']) {
    assert.equal(verifiedAdminId({ headers: h === undefined ? {} : { authorization: h } }), null, String(h));
  }
  assert.equal(verifiedAdminId({}), null, 'a request with no headers at all');
});

check('the admin allowance is well above a panel screen', () => {
  // 500/15min shared across an office is what admins were hitting.
  assert.ok(ADMIN_MAX >= 2000, `ADMIN_MAX is ${ADMIN_MAX}`);
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
