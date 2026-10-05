// The static test OTP must be OFF by default and scoped to one number when on.
// A blanket static OTP on a publicly reachable backend that shares the live database
// is an account-takeover hole, so these are the assertions that matter.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MOD = '../src/modules/serviceProvider/utils/redisOtp.util.js';

let fails = 0;
const check = (n, fn) => { try { fn(); console.log(`  ok   ${n}`); } catch (e) { fails++; console.log(`  FAIL ${n}\n         ${e.message}`); } };
const load = (env) => {
  for (const k of ['ALLOW_TEST_OTP','TEST_OTP_PHONE','TEST_OTP_CODE','USE_DEFAULT_OTP','NODE_ENV']) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve(MOD)];
  return require(MOD);
};

console.log('\n[1] off by default');
{
  const m = load({ NODE_ENV: 'production' });
  const a = m.generateOTP('9999999999'), b = m.generateOTP('9999999999');
  check('random when ALLOW_TEST_OTP unset', () => { assert.match(a, /^\d{6}$/); assert.notEqual(a, '123456'); assert.notEqual(a, b); });
}

console.log('\n[2] enabled, scoped to TEST_OTP_PHONE, in production');
{
  const m = load({ NODE_ENV: 'production', ALLOW_TEST_OTP: 'true', TEST_OTP_PHONE: '8643041429' });
  check('the test number gets the static code', () => assert.equal(m.generateOTP('8643041429'), '123456'));
  check('+91 form of the same number also matches', () => assert.equal(m.generateOTP('+918643041429'), '123456'));
  const other = m.generateOTP('9000000001');
  check('EVERY other number still gets a random code', () => { assert.notEqual(other, '123456'); assert.match(other, /^\d{6}$/); });
}

console.log('\n[3] USE_DEFAULT_OTP cannot open every account in production');
{
  const m = load({ NODE_ENV: 'production', USE_DEFAULT_OTP: 'true' });
  const r = m.generateOTP('9000000002');
  check('USE_DEFAULT_OTP is ignored in production', () => assert.notEqual(r, '123456'));
}
{
  const m = load({ NODE_ENV: 'development', USE_DEFAULT_OTP: 'true' });
  check('USE_DEFAULT_OTP still works outside production', () => assert.equal(m.generateOTP('9000000003'), '123456'));
}

console.log('\n[4] generate and verify agree');
{
  const m = load({ NODE_ENV: 'production', ALLOW_TEST_OTP: 'true', TEST_OTP_PHONE: '8643041429', TEST_OTP_CODE: '654321' });
  check('custom TEST_OTP_CODE is honoured', () => assert.equal(m.generateOTP('8643041429'), '654321'));
}

console.log(`\n${fails === 0 ? 'PASS' : `FAIL — ${fails}`}\n`);
process.exit(fails ? 1 : 0);
