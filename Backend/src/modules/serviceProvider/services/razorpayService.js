const { razorpayKeyId, razorpayKeySecret } = require('../../../core/settings/platformCredentials.cjs');
const Razorpay = require('razorpay');

// The client follows the platform's keys (Master settings, else .env) and is
// rebuilt when they change, so saving new keys needs no restart.
let client = null;
let clientKeyId = '';
let warnedMissing = false;

const getRazorpay = () => {
  const keyId = razorpayKeyId();
  const keySecret = razorpayKeySecret();
  if (!keyId || !keySecret) {
    if (!warnedMissing) console.error('⚠️  Razorpay credentials missing (Master settings or .env)');
    warnedMissing = true;
    return undefined;
  }
  if (!client || clientKeyId !== keyId) {
    try {
      client = new Razorpay({ key_id: keyId, key_secret: keySecret });
      clientKeyId = keyId;
      console.log(`✅ Razorpay initialized in ${keyId.startsWith('rzp_test') ? 'TEST' : 'LIVE'} mode`);
    } catch (error) {
      console.error('❌ Failed to initialize Razorpay:', error.message);
      client = null;
    }
  }
  return client || undefined;
};

/**
 * Create Razorpay order
 */
const createOrder = async (amount, currency = 'INR', receipt = null, notes = {}) => {
  try {
    if (!getRazorpay()) {
      console.warn('⚠️ Razorpay credentials missing/not initialized. Generating MOCK order for dev mode...');
      const mockOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return {
        success: true,
        orderId: mockOrderId,
        amount: Math.round(amount * 100),
        currency,
        receipt: receipt || `receipt_${Date.now()}`,
        isMock: true
      };
    }

    const options = {
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
      notes
    };

    console.log('Creating Razorpay order with options:', {
      amount: options.amount,
      currency: options.currency,
      receipt: options.receipt
    });

    const order = await getRazorpay().orders.create(options);

    console.log('✅ Razorpay order created successfully:', order.id);

    return {
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt
    };
  } catch (error) {
    console.error('❌ Razorpay create order error:', {
      message: error.message,
      description: error.description,
      code: error.code,
      statusCode: error.statusCode,
      error: error.error
    });

    // In dev environment, fallback to mock order if Razorpay credentials fail
    if (process.env.NODE_ENV !== 'production' || !razorpayKeyId() || razorpayKeyId().includes('placeholder')) {
      console.warn('⚠️ Razorpay API error in dev environment. Generating mock order fallback...');
      const mockOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return {
        success: true,
        orderId: mockOrderId,
        amount: Math.round(amount * 100),
        currency,
        receipt: receipt || `receipt_${Date.now()}`,
        isMock: true
      };
    }

    return {
      success: false,
      error: error.error?.description || error.description || error.message || 'Failed to create Razorpay order'
    };
  }
};

/**
 * Verify payment signature
 */
const verifyPayment = (razorpay_order_id, razorpay_payment_id, razorpay_signature) => {
  const crypto = require('crypto');
  const isProd = process.env.NODE_ENV === 'production';

  // The `order_mock_` escape hatch used to apply in EVERY environment, so any caller
  // could send order_mock_anything and have the payment confirmed. Development only.
  if (!razorpay_order_id) return false;
  if (String(razorpay_order_id).startsWith('order_mock_')) {
    return !isProd;
  }

  const secret = razorpayKeySecret();
  // A missing secret used to return true — "cannot verify" was treated as "verified",
  // so an unset env var silently confirmed every payment. Now it fails closed.
  if (!secret) {
    console.error('[Razorpay] RAZORPAY_KEY_SECRET is not set — payment verification denied');
    return false;
  }

  const generated_signature = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  // timingSafeEqual, not ===: a plain compare leaks how many leading bytes matched
  // through response timing. Length is checked first because it throws on a mismatch.
  // Inlined rather than importing utils/safeCompare.js: this module is CommonJS.
  const expectedBuf = Buffer.from(generated_signature);
  const actualBuf = Buffer.from(String(razorpay_signature || ''));
  return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
};

/**
 * Get payment details
 */
/**
 * Fetch an order from Razorpay.
 *
 * This is the authoritative record of what the server asked the customer to pay:
 * both `amount` and `notes` are set by us at order-creation time and cannot be
 * influenced by the client. Verification flows should resolve what was actually
 * bought from here rather than trusting ids echoed back in the request body.
 */
const getOrderDetails = async (orderId) => {
  try {
    if (!getRazorpay()) {
      return { success: false, error: 'Razorpay not initialized' };
    }
    const order = await getRazorpay().orders.fetch(orderId);
    return { success: true, order };
  } catch (error) {
    console.error('Razorpay get order error:', error);
    return { success: false, error: error.message };
  }
};

const getPaymentDetails = async (paymentId) => {
  try {
    const payment = await getRazorpay().payments.fetch(paymentId);
    return {
      success: true,
      payment
    };
  } catch (error) {
    console.error('Razorpay get payment error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Refund payment -- through the platform refund service (core/payments/refund.service.js).
 *
 * That service keeps one Refund row per refund, named by `idempotencyKey`, so a
 * retried or double-submitted refund never reaches Razorpay twice, and the
 * `refund.processed` / `refund.failed` webhooks keep the row's gateway status
 * current for the admin refunds page.
 *
 * @param {string} paymentId  Razorpay payment id
 * @param {number|null} amount rupees; null refunds nothing (the gateway needs an amount here)
 * @param {object} notes       free-form notes sent to Razorpay
 * @param {object} [options]   { idempotencyKey, bookingId, bookingNumber, userId, source, initiatedBy }
 */
const refundPayment = async (paymentId, amount = null, notes = {}, options = {}) => {
  try {
    if (!amount || Number(amount) <= 0) {
      return { success: false, error: 'A refund amount is required' };
    }
    const { refundGatewayPayment } = await import('../../../core/payments/refund.service.js');
    const bookingId = options.bookingId || notes.bookingId || '';
    const result = await refundGatewayPayment({
      vertical: 'serviceProvider',
      gatewayPaymentId: paymentId,
      amount: Number(amount),
      idempotencyKey: options.idempotencyKey || `sp:refund:${bookingId || paymentId}:${Math.round(Number(amount) * 100)}`,
      orderId: bookingId || null,
      orderRef: options.bookingNumber || '',
      userId: options.userId || null,
      reason: notes.reason || '',
      source: options.source || 'sp_refund',
      initiatedBy: options.initiatedBy || null,
      notes: Object.fromEntries(Object.entries(notes || {}).map(([k, v]) => [k, String(v)])),
    });
    if (!result.success) {
      return { success: false, error: result.inProgress ? 'A refund for this booking is already in progress' : (result.error || 'Refund failed') };
    }
    return {
      success: true,
      duplicate: result.duplicate,
      refund: { id: result.refundId, status: result.gatewayStatus }
    };
  } catch (error) {
    console.error('Razorpay refund error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Create Razorpay QR Code
 * Tries the modern standalone QR API first, then falls back to Payment Link if needed.
 */
const createQRCode = async (amount, bookingNumber, notes = {}) => {
  try {
    // Manual UPI QR block removed as requested
    
    if (!getRazorpay()) {
      return { success: false, error: 'Razorpay not initialized' };
    }

    const axios = require('axios');
    const auth = Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString('base64');

    const payload = {
      type: 'upi_qr',
      name: 'Service Payment',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: Math.round(amount * 100), // Convert to paise
      description: `Order Payment for ${bookingNumber}`,
      notes
    };

    console.log('[QR Service] Attempting Razorpay QR creation for Booking:', bookingNumber);

    // Razorpay SDK QR API
    try {
      const qrCode = await getRazorpay().qrCode.create(payload);
      console.log('✅ QR Code created via Razorpay SDK API');
      return {
        success: true,
        qrCodeId: qrCode.id,
        imageUrl: qrCode.image_url,
        qrStatus: qrCode.status
      };
    } catch (e1) {
      console.warn('⚠️ SDK QR API failed, trying REST fallbacks...', e1.description || e1.message);

      // Fallback 1: Manual API call to /v1/payments/qr_codes
      try {
        const response = await axios.post('https://api.razorpay.com/v1/payments/qr_codes', payload, {
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }
        });
        const qrCode = response.data;
        return {
          success: true,
          qrCodeId: qrCode.id,
          imageUrl: qrCode.image_url,
          qrStatus: qrCode.status
        };
      } catch (e2) {
        // Fallback 2: /v1/qr_codes
        try {
          const response = await axios.post('https://api.razorpay.com/v1/qr_codes', payload, {
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }
          });
          const qrCode = response.data;
          return {
            success: true,
            qrCodeId: qrCode.id,
            imageUrl: qrCode.image_url,
            qrStatus: qrCode.status
          };
        } catch (e3) {
          // Final Fallback: Payment Link
          const linkPayload = {
            amount: Math.round(amount * 100),
            currency: 'INR',
            description: `Payment for Booking #${bookingNumber}`,
            notes,
            notify: { sms: false, email: false }
          };

          const linkResponse = await axios.post('https://api.razorpay.com/v1/payment_links', linkPayload, {
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }
          });

          const link = linkResponse.data;
          return {
            success: true,
            qrCodeId: link.id,
            imageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(link.short_url)}`,
            paymentUrl: link.short_url,
          };
        }
      }
    }
  } catch (error) {
    console.error('Razorpay QR/Link Error:', error.response?.data || error.message);
    const errorMsg = error.response?.data?.error?.description || error.message;
    return { success: false, error: errorMsg };
  }
};

/**
 * Get payments for a QR Code or Payment Link
 */
const getQRCodePayments = async (id) => {
  try {
    if (!getRazorpay()) {
      return { success: false, error: 'Razorpay not initialized' };
    }

    // Manual UPI check removed as requested
    if (id && (id.startsWith('plink_'))) {
      const axios = require('axios');
      const auth = Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString('base64');

      try {
        const response = await axios.get(`https://api.razorpay.com/v1/payment_links/${id}`, {
          headers: { 'Authorization': `Basic ${auth}` }
        });

        const link = response.data;
        console.log(`[QR Service] Checking Payment Link ${id} status: ${link.status}`);

        // If link is paid, we returned a captured payment object
        if (link.status === 'paid' || link.status === 'partially_paid') {
          return {
            success: true,
            payments: [{
              id: link.razorpay_payment_id || `pay_${Date.now()}`,
              status: 'captured',
              amount: link.amount_paid
            }]
          };
        }
        return { success: true, payments: [] };
      } catch (linkError) {
        console.error('Payment link fetch error:', linkError.response?.data || linkError.message);
        throw linkError;
      }
    }

    // Otherwise, standard QR Code check
    const payments = await getRazorpay().qrCode.fetchAllPayments(id);
    return {
      success: true,
      payments: payments.items || []
    };
  } catch (error) {
    console.error('Razorpay fetch payments error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  // The SDK client, or undefined without keys (services/recurringSubscription.js).
  getRazorpay,
  createOrder,
  verifyPayment,
  getOrderDetails,
  getPaymentDetails,
  refundPayment,
  createQRCode,
  getQRCodePayments,
  isTestMode: () => !razorpayKeyId() || razorpayKeyId().startsWith('rzp_test')
};

