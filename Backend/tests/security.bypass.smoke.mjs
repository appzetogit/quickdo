/**
 * Regression guard for the sign-in and payment bypasses.
 *
 * Every assertion here corresponds to a hole that was live in this codebase:
 *
 *  1. core/otp/otp.service.js hardcoded "7974161582" / "1234" with no environment
 *     gate, so anyone who read the number out of the source could sign in as that
 *     account on the live system.
 *  2. modules/taxi/user/services/userOtpService.js did the same with "7610416911" /
 *     "0000" whenever STATIC_OTP_PHONE was unset — which is the default.
 *  3. razorpay.helper.js accepted the literal signature "mock_signature_bypass" when
 *     NODE_ENV was production but USE_DEFAULT_OTP was true, coupling payment
 *     verification to an SMS-delivery switch.
 *  4. validateEnv did not stop USE_DEFAULT_OTP=true reaching production, which is
 *     what made (3) reachable and turned every OTP into "1234".
 *
 * Each case runs in its own process. That is not ceremony: src/config/env.js reads
 * process.env once at module load and every consumer imports the same frozen object,
 * so re-importing a module inside one process cannot change the environment it sees.
 * An in-process version of this file passed while asserting nothing.
 *
 * No database is required — every bypass returns before any query.
 *
 * Run:  node tests/security.bypass.smoke.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(here, '..');

let fails = 0;
const check = (name, fn) => {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (err) { fails += 1; console.log(`  FAIL ${name}\n         ${err.message}`); }
};

/**
 * Variables blanked for every child run.
 *
 * config/env.js calls dotenv.config(), which reads the developer's real .env but
 * never overwrites a key already present in process.env. Presetting each one to ''
 * is therefore what keeps a local .env from leaking into these assertions — an
 * earlier version of this file spread process.env alone and failed because the
 * developer's live RAZORPAY_KEY_ID came along for the ride.
 */
const BLANKED = {
    USE_DEFAULT_OTP: '',
    ALLOW_INSECURE_DEFAULT_OTP: '',
    STATIC_OTP_PHONE: '',
    STATIC_OTP_CODE: '',
    DEFAULT_USER_PHONE: '',
    DEFAULT_RESTAURANT_PHONE: '',
    DEFAULT_DELIVERY_PHONE: '',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    REDIS_ENABLED: '',
    BULLMQ_ENABLED: '',
    JWT_ACCESS_EXPIRES: '15m',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/securitysmoke',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
};

/**
 * Run an ES-module snippet in a child with a controlled environment.
 *
 * spawnSync rather than execFileSync so BOTH streams come back on every path: the
 * logger writes warnings to stderr, and an execFileSync success returns stdout only —
 * which silently dropped every warning these tests assert on.
 */
const runNode = (script, env = {}) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: backendDir,
        env: { ...process.env, ...BLANKED, ...env },
        encoding: 'utf8',
    });
    return { exited: r.status !== 0, out: `${r.stdout || ''}${r.stderr || ''}` };
};

/**
 * Source with comments removed.
 *
 * Every guard below documents the hole it closes, and those comments quote the very
 * constants and identifiers being searched for. Matching raw source therefore finds
 * the explanation instead of the code and reports a pass (or a failure) that has
 * nothing to do with what executes.
 */
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Evaluate verifyPaymentSignature(...) in a child and return its boolean result. */
const verifySignature = (env, orderId, paymentId, signature) => {
    const script = `
        const { verifyPaymentSignature } = await import('./src/modules/food/orders/helpers/razorpay.helper.js');
        console.log('RESULT:' + verifyPaymentSignature(${JSON.stringify(orderId)}, ${JSON.stringify(paymentId)}, ${JSON.stringify(signature)}));
    `;
    const r = runNode(script, env);
    const m = r.out.match(/RESULT:(true|false)/);
    if (!m) throw new Error(`no result from child:\n${r.out}`);
    return m[1] === 'true';
};

console.log('\n[1] Razorpay signature — the mock bypass is production-fatal');

check('production rejects mock_signature_bypass', () => {
    assert.equal(verifySignature({ NODE_ENV: 'production' }, 'mock_order_1', 'pay_1', 'mock_signature_bypass'), false);
});

check('production STILL rejects it when USE_DEFAULT_OTP=true (the old coupling)', () => {
    assert.equal(
        verifySignature({ NODE_ENV: 'production', USE_DEFAULT_OTP: 'true' }, 'mock_order_1', 'pay_1', 'mock_signature_bypass'),
        false,
        'an SMS flag must never re-open payment verification',
    );
});

check('development still accepts it so local checkout works', () => {
    assert.equal(verifySignature({ NODE_ENV: 'development' }, 'mock_order_1', 'pay_1', 'mock_signature_bypass'), true);
});

check('a wrong signature is rejected in every environment', () => {
    for (const NODE_ENV of ['development', 'production']) {
        const env = { NODE_ENV, RAZORPAY_KEY_SECRET: 'k'.repeat(24) };
        assert.equal(verifySignature(env, 'order_real', 'pay_1', 'deadbeef'), false, NODE_ENV);
        // Length-mismatched input must return false rather than throw: timingSafeEqual
        // rejects unequal buffer lengths, so length is compared before the comparison.
        assert.equal(verifySignature(env, 'order_real', 'pay_1', ''), false, `${NODE_ENV} empty`);
        assert.equal(verifySignature(env, 'order_real', 'pay_1', 'x'.repeat(500)), false, `${NODE_ENV} long`);
    }
});

check('a correct signature is still accepted', () => {
    const script = `
        const crypto = await import('node:crypto');
        const { verifyPaymentSignature } = await import('./src/modules/food/orders/helpers/razorpay.helper.js');
        const sig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update('order_real|pay_1').digest('hex');
        console.log('RESULT:' + verifyPaymentSignature('order_real', 'pay_1', sig));
    `;
    const r = runNode(script, { NODE_ENV: 'production', RAZORPAY_KEY_SECRET: 'k'.repeat(24) });
    assert.match(r.out, /RESULT:true/, `timingSafeEqual broke the happy path:\n${r.out}`);
});

console.log('\n[2] Environment validation refuses an unsafe production config');

const bootWith = (env) => runNode(
    "const m = await import('./src/config/validateEnv.js'); m.validateConfig(); console.log('BOOTED');",
    env,
);

check('USE_DEFAULT_OTP=true in production is fatal', () => {
    const r = bootWith({ NODE_ENV: 'production', USE_DEFAULT_OTP: 'true' });
    assert.equal(r.exited, true, `expected a non-zero exit, got:\n${r.out}`);
    assert.match(r.out, /USE_DEFAULT_OTP must be false in production/);
});

check('the documented escape hatch boots, loudly', () => {
    const r = bootWith({ NODE_ENV: 'production', USE_DEFAULT_OTP: 'true', ALLOW_INSECURE_DEFAULT_OTP: 'true' });
    assert.equal(r.exited, false, `expected boot, got:\n${r.out}`);
    assert.match(r.out, /SECURITY: USE_DEFAULT_OTP=true in production/);
    assert.match(r.out, /BOOTED/);
});

check('development is unaffected by the production guards', () => {
    const r = bootWith({ NODE_ENV: 'development', USE_DEFAULT_OTP: 'true' });
    assert.equal(r.exited, false, `local dev must still boot with USE_DEFAULT_OTP, got:\n${r.out}`);
});

check('identical access and refresh secrets are fatal in production', () => {
    const same = 'c'.repeat(40);
    const r = bootWith({ NODE_ENV: 'production', JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same });
    assert.equal(r.exited, true, `expected a non-zero exit, got:\n${r.out}`);
    assert.match(r.out, /identical/);
});

check('a short secret is fatal in production', () => {
    const r = bootWith({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short' });
    assert.equal(r.exited, true, `expected a non-zero exit, got:\n${r.out}`);
    assert.match(r.out, /minimum 32/);
});

check('an unreplaced placeholder in MONGODB_URI is fatal', () => {
    const r = bootWith({ NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@host/<REAL_DB_NAME>' });
    assert.equal(r.exited, true, `expected a non-zero exit, got:\n${r.out}`);
    assert.match(r.out, /placeholder/);
});

check('Razorpay configured without a webhook secret is fatal', () => {
    const r = bootWith({ NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's'.repeat(24) });
    assert.equal(r.exited, true, `expected a non-zero exit, got:\n${r.out}`);
    assert.match(r.out, /RAZORPAY_WEBHOOK_SECRET/);
});

check('a sane production config boots', () => {
    const r = bootWith({ NODE_ENV: 'production' });
    assert.equal(r.exited, false, `expected boot, got:\n${r.out}`);
    assert.match(r.out, /BOOTED/);
});

console.log('\n[3] Source-level guards (the constants must stay behind an env check)');

const srcOf = (rel) => stripComments(readFileSync(path.join(backendDir, 'src', rel), 'utf8'));

check('otp.service.js gates its bypass block on NODE_ENV', () => {
    const src = srcOf('core/otp/otp.service.js');
    const verify = src.indexOf('export const verifyOtp');
    assert.ok(verify !== -1, 'verifyOtp is gone');
    const gate = src.indexOf("config.nodeEnv !== 'production'", verify);
    // The executable fallback, not the number in prose — the comment above the gate
    // quotes the same digits deliberately.
    const bypass = src.indexOf('process.env.DEFAULT_RESTAURANT_PHONE', verify);
    assert.ok(gate !== -1, 'the production gate is gone from verifyOtp');
    assert.ok(bypass !== -1 && bypass > gate, 'the default phone fallback escaped the gate');
});

check('userOtpService.js gates its static OTP on NODE_ENV', () => {
    const src = srcOf('modules/taxi/user/services/userOtpService.js');
    const fn = src.indexOf('const resolveUserOtpForPhone');
    const gate = src.indexOf("process.env.NODE_ENV !== 'production'", fn);
    const useStatic = src.indexOf('isStatic: true', fn);
    assert.ok(gate !== -1, 'the production gate is gone');
    assert.ok(useStatic > gate, 'the static-OTP return escaped the gate');
});

check('no OTP value is logged unconditionally', () => {
    const src = srcOf('core/otp/otp.service.js');
    const debug = src.indexOf('[OTP DEBUG] Generated OTP');
    assert.ok(debug !== -1, 'expected the debug log to still exist for development');
    const gate = src.lastIndexOf("config.nodeEnv !== 'production'", debug);
    assert.ok(gate !== -1 && gate < debug, 'the OTP is logged outside a development gate');
});

check('the razorpay mock bypass is not reachable via useDefaultOtp', () => {
    const src = srcOf('modules/food/orders/helpers/razorpay.helper.js');
    const fn = src.indexOf('export function verifyPaymentSignature');
    assert.ok(fn !== -1, 'verifyPaymentSignature is gone');
    const region = src.slice(fn, src.indexOf('\n}', fn));
    assert.ok(!/useDefaultOtp/.test(region), 'verifyPaymentSignature reads useDefaultOtp again');
    assert.ok(/timingSafeEqual/.test(region), 'the signature comparison is no longer constant-time');
});

check('the razorpay webhook compares signatures in constant time', () => {
    /*
     * The webhook no longer inlines timingSafeEqual: it calls the shared
     * safeSignatureEqual util, as the quick-commerce copy already did. So the
     * property is asserted in two parts rather than by grepping one file for a
     * word that is no longer in it -- the webhook must go through the util, AND the
     * util must actually be constant-time. Checking only the first would let
     * somebody "simplify" the util to === and keep this guard green.
     */
    const src = srcOf('core/payments/controllers/razorpayWebhook.controller.js');
    const util = srcOf('utils/safeCompare.js');
    const usesUtil = /import\s*\{[^}]*\bsafeSignatureEqual\b[^}]*\}\s*from\s*['"][^'"]*safeCompare\.js['"]/.test(src)
        && /\bsafeSignatureEqual\s*\(/.test(src);
    assert.ok(usesUtil || /timingSafeEqual/.test(src), 'the webhook signature comparison is no longer constant-time');
    if (usesUtil) {
        assert.ok(/crypto\.timingSafeEqual\s*\(/.test(util), 'safeSignatureEqual is no longer constant-time');
        assert.ok(!/expected\s*===\s*actual|actual\s*===\s*expected/.test(util), 'safeSignatureEqual compares with ===');
    }
    assert.ok(!/\bexpected !== signature\b/.test(src), 'the timing-unsafe compare is back');
});

console.log(fails === 0 ? '\nAll security bypass guards hold.\n' : `\n${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
