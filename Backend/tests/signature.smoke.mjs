/**
 * Regression guard for HMAC signature comparison.
 *
 * Every assertion corresponds to a hole that was live in this codebase:
 *
 *  1. Nine payment-verification sites compared signatures with `===`, which returns
 *     as soon as two bytes differ and so leaks how many leading hex characters were
 *     correct through response timing.
 *  2. serviceProvider/services/razorpayService.js returned true for any order id
 *     starting with `order_mock_`, in EVERY environment, so a caller could confirm
 *     any payment by naming its own order id.
 *  3. The same function returned true when RAZORPAY_KEY_SECRET was unset — "cannot
 *     verify" was treated as "verified".
 *
 * No database or network is required.
 *
 * Run:  node tests/signature.smoke.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { safeSignatureEqual } from '../src/utils/safeCompare.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

const test = (name, fn) => {
    try {
        fn();
        console.log(`  PASS  ${name}`);
        passed += 1;
    } catch (err) {
        console.error(`  FAIL  ${name}\n        ${err.message}`);
        failed += 1;
    }
};

const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('hex');

// ── safeSignatureEqual ────────────────────────────────────────────────────────
test('matching signatures compare equal', () => {
    const sig = sign('order_1|pay_1', 'shhh');
    assert.equal(safeSignatureEqual(sig, sign('order_1|pay_1', 'shhh')), true);
});

test('a signature from a different secret is rejected', () => {
    assert.equal(safeSignatureEqual(sign('order_1|pay_1', 'shhh'), sign('order_1|pay_1', 'other')), false);
});

test('a signature differing in one byte is rejected', () => {
    const sig = sign('order_1|pay_1', 'shhh');
    const tampered = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    assert.equal(safeSignatureEqual(sig, tampered), false);
});

test('a correct prefix is not enough (no early-exit accept)', () => {
    const sig = sign('order_1|pay_1', 'shhh');
    assert.equal(safeSignatureEqual(sig, sig.slice(0, 32)), false);
});

test('empty, missing and non-string input fail closed', () => {
    const sig = sign('order_1|pay_1', 'shhh');
    for (const bad of ['', null, undefined, 0, {}, [], true]) {
        assert.equal(safeSignatureEqual(sig, bad), false, `accepted ${JSON.stringify(bad)} as a signature`);
        assert.equal(safeSignatureEqual(bad, sig), false, `accepted ${JSON.stringify(bad)} as the expected value`);
    }
});

test('length mismatch does not throw (timingSafeEqual would)', () => {
    assert.doesNotThrow(() => safeSignatureEqual('abc', 'abcdef'));
    assert.equal(safeSignatureEqual('abc', 'abcdef'), false);
});

// ── no raw === comparison creeps back in ──────────────────────────────────────
const SIGNATURE_SITES = [
    // The quick-commerce webhook controller was a duplicate of this one and has been
    // removed; both /payments/webhook mounts now share the master handler, so THAT
    // is the site to scan. Dropping the path without replacing it would have left
    // the one webhook that still exists unguarded.
    'src/core/payments/controllers/razorpayWebhook.controller.js',
    'src/modules/quickCommerce/modules/food/orders/helpers/razorpay.helper.js',
    'src/modules/taxi/driver/controllers/driverController.js',
    'src/modules/taxi/user/controllers/poolingController.js',
    'src/modules/taxi/user/controllers/rideController.js',
    'src/modules/taxi/user/controllers/userController.js',
];

test('no payment site compares a signature with === or !==', () => {
    const offenders = [];
    for (const rel of SIGNATURE_SITES) {
        const source = readFileSync(path.join(root, rel), 'utf8');
        source.split('\n').forEach((line, i) => {
            if (/(?:!==|===)\s*(?:razorpay_)?signature\b/.test(line)
                || /\b(?:expected|generated)\w*\s*(?:!==|===)/.test(line)) {
                offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            }
        });
    }
    assert.deepEqual(offenders, [], `raw signature comparison found:\n        ${offenders.join('\n        ')}`);
});

// ── serviceProvider verifyPayment fails closed ────────────────────────────────
test('SP verifyPayment no longer trusts order_mock_ ids unconditionally', () => {
    const source = readFileSync(path.join(root, 'src/modules/serviceProvider/services/razorpayService.js'), 'utf8');
    assert.ok(
        !/startsWith\('order_mock_'\)\s*\)\s*\{\s*return true/.test(source.replace(/\s+/g, ' ')),
        'order_mock_ ids are accepted with no environment gate',
    );
    assert.ok(source.includes('timingSafeEqual'), 'SP verifyPayment still uses a plain comparison');
    assert.ok(!/if \(!secret\) return true;/.test(source), 'a missing secret still confirms every payment');
});

// ── the food gateway cannot be faked in production ────────────────────────────
//
// Runs in a child process: src/config/env.js reads process.env once at module load
// and every consumer shares that frozen object, so the environment cannot be changed
// after the fact from inside this process.
//
// USE_DEFAULT_OTP=true is set deliberately — that is the exact combination that used
// to re-open the mock gateway on a live server.
test('food razorpay helper refuses to mock the gateway in production', () => {
    const child = `
        import assert from 'node:assert/strict';
        const h = await import('${pathToFileURL(path.join(root, 'src/modules/food/orders/helpers/razorpay.helper.js')).href}');

        // A fabricated "refund succeeded" is the expensive one: the order gets marked
        // refunded while no money moves.
        await assert.rejects(
            () => h.initiateRazorpayRefund('mock_pay_123', 100),
            'production returned a fake refund for a mock_ payment id',
        );
        await assert.rejects(
            () => h.initiateRazorpayRefund(undefined, 100),
            'production returned a fake refund for a missing payment id',
        );

        // And the signature bypass stays shut (already guarded, asserted here too so
        // the whole file is covered by one test).
        assert.equal(h.verifyPaymentSignature('mock_order_1', 'p', 'mock_signature_bypass'), false);
        console.log('CHILD_OK');
    `;
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        USE_DEFAULT_OTP: 'true',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        RAZORPAY_KEY_ID: '',
        RAZORPAY_KEY_SECRET: '',
    };
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', child], {
        cwd: root,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(out, /CHILD_OK/);
});

test('no mock gate in the food helper reads useDefaultOtp', () => {
    const source = readFileSync(path.join(root, 'src/modules/food/orders/helpers/razorpay.helper.js'), 'utf8');
    const offenders = source
        .split('\n')
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => /config\.useDefaultOtp/.test(line) && !/^\s*(\*|\/\/)/.test(line));
    assert.deepEqual(
        offenders.map(([n, l]) => `${n}: ${l.trim()}`),
        [],
        'a mock gate is coupled to the SMS-delivery flag again',
    );
});

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
