/**
 * Security regression checks for the auth/authz/money fixes.
 *
 * Plain node + assert, no framework, no DB required:
 *   node tests/security.test.js
 *
 * Each case here maps to a bug that was live in the codebase. If one fails,
 * that bug is back.
 */
const assert = require('assert');
const path = require('path');

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push([true, name]);
  } catch (err) {
    results.push([false, `${name}\n    ${err.message}`]);
  }
};

// Load OTP modules fresh so env changes take effect
const freshOtp = () => {
  delete require.cache[require.resolve('../utils/redisOtp.util')];
  return { redis: require('../utils/redisOtp.util') };
};

const TEST_PHONE = '9000000777';
// The module no longer carries a default test number: it used to hardcode a REAL
// customer's phone, which made that account permanently loggable-in with 123456.
// Callers must now name the number explicitly.
process.env.TEST_OTP_PHONE = TEST_PHONE;

// ── 1. Static OTP must be off by default ──────────────────────────────────
check('generateOTP does not return the static OTP when ALLOW_TEST_OTP is unset', () => {
  delete process.env.ALLOW_TEST_OTP;
  delete process.env.USE_DEFAULT_OTP;
  process.env.NODE_ENV = 'development';
  const { redis } = freshOtp();

  for (let i = 0; i < 200; i++) {
    assert.notStrictEqual(redis.generateOTP(TEST_PHONE), '123456',
      'redis generateOTP leaked the static OTP');
  }
});

// ── 2. In production the hatch is allowed, but ONLY for the named number ──
// It is deliberately usable in production: staging deployments run
// NODE_ENV=production, and the alternative -- flipping NODE_ENV -- also re-enables
// write-side background jobs against the live database. Scoping is the protection.
check('in production the static OTP serves ONLY the named test phone', () => {
  process.env.ALLOW_TEST_OTP = 'true';
  process.env.USE_DEFAULT_OTP = 'true';
  process.env.NODE_ENV = 'production';
  const { redis } = freshOtp();

  assert.strictEqual(redis.generateOTP(TEST_PHONE), '123456');
  for (let i = 0; i < 200; i++) {
    assert.notStrictEqual(redis.generateOTP('9998887776'), '123456',
      'static OTP leaked to a number other than TEST_OTP_PHONE');
  }
});

// ── 3. The escape hatch still works where it is supposed to ───────────────
check('static OTP works for the test phone outside production too', () => {
  process.env.ALLOW_TEST_OTP = 'true';
  delete process.env.USE_DEFAULT_OTP;
  process.env.NODE_ENV = 'development';
  const { redis } = freshOtp();

  assert.strictEqual(redis.generateOTP(TEST_PHONE), '123456');
  // ...but not for an unrelated number
  assert.notStrictEqual(redis.generateOTP('9998887776'), '123456');
});

// ── 4. OTPs and tokens must be crypto-random, not Math.random ─────────────
check('generated OTPs are 6 digits and well distributed', () => {
  delete process.env.ALLOW_TEST_OTP;
  delete process.env.USE_DEFAULT_OTP;
  process.env.NODE_ENV = 'development';
  const { redis } = freshOtp();

  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const b = redis.generateOTP('9998887776');
    assert.match(b, /^\d{6}$/, `OTP malformed: ${b}`);
    seen.add(b);
  }
  // 1000 draws from 900k values should almost never collide heavily
  assert.ok(seen.size > 950, `OTP entropy too low: only ${seen.size} unique of 1000`);
});

// ── 5. isSuperAdmin must actually reject non-super-admins ─────────────────
check('isSuperAdmin rejects non-admin roles', async () => {
  const { isSuperAdmin } = require('../middleware/roleMiddleware');
  for (const role of ['USER', 'VENDOR', 'WORKER', undefined]) {
    let status = null;
    let nextCalled = false;
    const res = { status: (c) => { status = c; return { json: () => {} }; } };
    isSuperAdmin({ userRole: role, user: { id: 'x' } }, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false, `isSuperAdmin let role="${role}" through`);
    assert.strictEqual(status, 403, `isSuperAdmin did not 403 role="${role}"`);
  }
});

// ── 6. Refund must be admin-gated, not user-gated ─────────────────────────
check('POST /refund is guarded by isAdmin, not isUser', () => {
  const { isUser, isAdmin } = require('../middleware/roleMiddleware');
  const router = require('../routes/payment-routes/payment.routes');

  const refundLayer = router.stack.find(
    (l) => l.route && l.route.path === '/refund'
  );
  assert.ok(refundLayer, '/refund route not found');

  const handlers = refundLayer.route.stack.map((s) => s.handle);
  assert.ok(handlers.includes(isAdmin), '/refund is not protected by isAdmin');
  assert.ok(!handlers.includes(isUser), '/refund is still reachable by plain users');
});

// ── 7. No unconditional static-OTP bypass left in source ──────────────────
check('no ungated static OTP comparison remains in redisOtp.util', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '../utils/redisOtp.util.js'), 'utf8');

  // The original bug: `|| plainOtp === '123456' || plainOtp === '110211'`
  assert.ok(!/\|\|\s*plainOtp\s*===/.test(src),
    'found an OR-ed plainOtp comparison — the universal OTP bypass is back');
  assert.ok(!src.includes('110211'), 'the 110211 master OTP is back');
  // And the OTP must not be logged in plaintext
  assert.ok(!/OTP:\s*\$\{plainOtp\}/.test(src), 'plaintext OTP is being logged again');
});

// ── report ────────────────────────────────────────────────────────────────
let failed = 0;
for (const [ok, name] of results) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
