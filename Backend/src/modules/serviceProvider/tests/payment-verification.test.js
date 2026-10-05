/**
 * Checks for gateway payment confirmation.
 *
 *   node tests/payment-verification.test.js
 *
 * The Razorpay service is stubbed via require.cache so no network or API keys
 * are needed. Each case maps to a way a verify endpoint used to be exploitable.
 */
const assert = require('assert');
const path = require('path');

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push([true, name]);
  } catch (err) {
    results.push([false, `${name}\n    ${err.message}`]);
  }
};

const servicePath = require.resolve('../services/razorpayService');
const helperPath = require.resolve('../utils/confirmGatewayPayment');

/**
 * Install a fake razorpayService, then load a fresh copy of the helper bound to it.
 */
const loadHelperWith = (stub) => {
  delete require.cache[helperPath];
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: stub
  };
  return require('../utils/confirmGatewayPayment');
};

// A well-formed captured payment of ₹500 on order_A, with our server-set notes.
const happyStub = {
  getPaymentDetails: async (id) => ({
    success: true,
    payment: { id, order_id: 'order_A', status: 'captured', amount: 50000 }
  }),
  getOrderDetails: async (id) => ({
    success: true,
    order: { id, notes: { planId: 'PLAN_CHEAP', userId: 'U1' } }
  })
};

const main = async () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_stub';
  process.env.RAZORPAY_KEY_SECRET = 'stub_secret';
  process.env.NODE_ENV = 'production';

  await check('returns the gateway amount, not anything the client sent', async () => {
    const { confirmGatewayPayment } = loadHelperWith(happyStub);
    const out = await confirmGatewayPayment({ orderId: 'order_A', paymentId: 'pay_1' });
    assert.strictEqual(out.ok, true);
    // 50000 paise => ₹500. A client claiming ₹1,000,000 cannot influence this.
    assert.strictEqual(out.amount, 500);
  });

  await check('returns server-set order notes (the trusted planId source)', async () => {
    const { confirmGatewayPayment } = loadHelperWith(happyStub);
    const out = await confirmGatewayPayment({ orderId: 'order_A', paymentId: 'pay_1' });
    assert.deepStrictEqual(out.notes, { planId: 'PLAN_CHEAP', userId: 'U1' });
  });

  await check('rejects a payment belonging to a different order', async () => {
    const { confirmGatewayPayment } = loadHelperWith({
      ...happyStub,
      getPaymentDetails: async (id) => ({
        success: true,
        payment: { id, order_id: 'order_SOMEONE_ELSE', status: 'captured', amount: 50000 }
      })
    });
    const out = await confirmGatewayPayment({ orderId: 'order_A', paymentId: 'pay_1' });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.status, 400);
    assert.match(out.message, /does not belong/i);
  });

  await check('rejects a payment that is not captured', async () => {
    const { confirmGatewayPayment } = loadHelperWith({
      ...happyStub,
      getPaymentDetails: async (id) => ({
        success: true,
        payment: { id, order_id: 'order_A', status: 'authorized', amount: 50000 }
      })
    });
    const out = await confirmGatewayPayment({ orderId: 'order_A', paymentId: 'pay_1' });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.status, 400);
  });

  await check('fails closed (502) when the gateway cannot be reached', async () => {
    const { confirmGatewayPayment } = loadHelperWith({
      ...happyStub,
      getPaymentDetails: async () => ({ success: false, error: 'network down' })
    });
    const out = await confirmGatewayPayment({ orderId: 'order_A', paymentId: 'pay_1' });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.status, 502);
  });

  await check('fails closed when the order cannot be fetched', async () => {
    const { confirmGatewayPayment } = loadHelperWith({
      ...happyStub,
      getOrderDetails: async () => ({ success: false, error: 'nope' })
    });
    const out = await confirmGatewayPayment({ orderId: 'order_A', paymentId: 'pay_1' });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.status, 502);
  });

  // The dev bypass is the one thing that must never leak into production.
  await check('mock bypass is DISABLED in production, even for order_mock_ ids', async () => {
    process.env.NODE_ENV = 'production';
    const { isDevMockOrder } = loadHelperWith(happyStub);
    assert.strictEqual(isDevMockOrder('order_mock_123'), false);

    // ...and also when credentials are missing (a misconfigured live server)
    const keyId = process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_ID;
    assert.strictEqual(isDevMockOrder('order_real_1'), false,
      'production must never trust the client, even with no credentials');
    process.env.RAZORPAY_KEY_ID = keyId;
  });

  await check('mock bypass works outside production so local dev still runs', async () => {
    process.env.NODE_ENV = 'development';
    const { confirmGatewayPayment, isDevMockOrder } = loadHelperWith(happyStub);
    assert.strictEqual(isDevMockOrder('order_mock_123'), true);

    const out = await confirmGatewayPayment({ orderId: 'order_mock_123', paymentId: 'pay_1' });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.mock, true);
    assert.strictEqual(out.amount, null, 'mock mode has no authoritative amount');
    process.env.NODE_ENV = 'production';
  });

  // ── Source guards: the exploitable shapes must not come back ──────────────
  await check('verify endpoints do not read planId/amount from req.body', async () => {
    const fs = require('fs');
    const targets = [
      '../controllers/paymentControllers/subscriptionPaymentController.js',
      '../controllers/paymentControllers/paymentController.js'
    ];

    for (const rel of targets) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      // The old shape destructured planId straight out of the request body
      // alongside the razorpay fields.
      assert.ok(
        !/razorpay_signature,\s*planId\s*\}\s*=\s*req\.body/.test(src),
        `${rel} destructures planId from req.body again`
      );
    }
  });

  process.env.NODE_ENV = ORIGINAL_ENV;
  delete require.cache[servicePath];

  let failed = 0;
  for (const [ok, name] of results) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
};

main();
