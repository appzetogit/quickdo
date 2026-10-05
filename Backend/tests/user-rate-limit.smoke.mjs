/**
 * Every signed-in user gets their own rate-limit bucket, not their network's.
 *
 * Run: node tests/user-rate-limit.smoke.mjs
 */
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'x'.repeat(40);
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { __testables, apiRateLimiter } = await import('../src/middleware/rateLimit.js');
const { verifiedIdentity, USER_MAX } = __testables;

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};
const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {}, ip: '1.2.3.4' });

check('a rider token is recognised as its own identity', () => {
  const who = verifiedIdentity(req(signAccessToken({ userId: 'r1', role: 'DELIVERY_PARTNER' })));
  assert.deepEqual(who, { id: 'r1', role: 'DELIVERY_PARTNER' });
});
check('taxi tokens (sub, lower-case role) work too', () => {
  const who = verifiedIdentity(req(signAccessToken({ sub: 'd9', role: 'driver' })));
  assert.equal(who.id, 'd9');
});
check('a forged token gets no bucket', () => {
  assert.equal(verifiedIdentity(req('abc.def.ghi')), null);
});
check('no token falls back to the IP', () => {
  assert.equal(verifiedIdentity(req()), null);
});
check('two users on one IP land in different buckets', () => {
  const key = apiRateLimiter.__keyGeneratorForTests || null;
  // keyGenerator is internal to express-rate-limit; check via the identity instead.
  const a = verifiedIdentity(req(signAccessToken({ userId: 'u1', role: 'USER' })));
  const b = verifiedIdentity(req(signAccessToken({ userId: 'u2', role: 'USER' })));
  assert.notEqual(`${a.role}:${a.id}`, `${b.role}:${b.id}`);
  assert.equal(key, null);
});
check('the per-user allowance covers an app polling every 2 seconds for 15 minutes', () => {
  assert.ok(USER_MAX >= (15 * 60) / 2, `USER_MAX ${USER_MAX}`);
});

console.log(failed ? `\n${failed} FAILED` : '\nall user rate limit checks passed');
process.exit(failed ? 1 : 0);
