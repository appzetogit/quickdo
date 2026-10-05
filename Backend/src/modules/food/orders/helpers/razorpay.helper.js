import crypto from 'crypto';

let Razorpay;
try {
    const mod = await import('razorpay');
    Razorpay = mod.default;
} catch {
    Razorpay = null;
}

import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';
import { normalizePhoneToTenDigits } from '../../../../utils/phone.util.js';
// Master settings if saved there, else .env (core/settings/platformProfile.service.js).
import { razorpayKeyId, razorpayKeySecret } from '../../../../core/settings/platformProfile.service.js';

/**
 * Whether the gateway may be faked: mock orders, mock payment links, mock refunds.
 *
 * NODE_ENV is the ONLY thing that opens this door. Every site below used to read
 * `config.nodeEnv !== 'production' || config.useDefaultOtp`, but useDefaultOtp is an
 * SMS-delivery switch that validateEnv explicitly permits in production (via
 * ALLOW_INSECURE_DEFAULT_OTP). Coupling the two meant "do not send SMS" also meant
 * "fake the payment gateway" on a live server — verifyPaymentSignature was fixed for
 * exactly this reason, and these three sites were missed.
 *
 * The refund site was the expensive one: it returned a fabricated success for any
 * missing or `mock_` payment id, so a production refund would mark the order refunded
 * while no money ever moved.
 *
 * One constant, not three copies, so the next fix cannot miss a site again.
 */
const MOCK_GATEWAY_ALLOWED = config.nodeEnv !== 'production';

function getRazorpayErrorMessage(error) {
    return (
        error?.error?.description ||
        error?.error?.message ||
        error?.description ||
        error?.message ||
        'Razorpay request failed'
    );
}

export function isRazorpayConfigured() {
    return Boolean(razorpayKeyId() && razorpayKeySecret() && Razorpay);
}

export function getRazorpayKeyId() {
    return razorpayKeyId();
}

export function getRazorpayInstance() {
    if (!isRazorpayConfigured()) return null;
    return new Razorpay({ key_id: razorpayKeyId(), key_secret: razorpayKeySecret() });
}

export function createRazorpayOrder(amountPaise, currency = 'INR', receipt = '') {
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));
    return instance.orders
        .create({
            amount: Math.round(amountPaise),
            currency,
            receipt: receipt || undefined
        })
        .catch((error) => {
            const errMsg = getRazorpayErrorMessage(error);
            logger.error(`[Razorpay] Order Creation Failed: ${errMsg}`);
            
            if (errMsg.includes('Authentication failed') || errMsg.includes('invalid api key')) {
                if (MOCK_GATEWAY_ALLOWED) {
                    logger.warn(`[Razorpay] Generating fallback Mock Order due to Authentication failed`);
                    return {
                        id: `mock_order_${Date.now()}`,
                        amount: Math.round(amountPaise),
                        currency
                    };
                }
            }
            throw new Error(errMsg);
        });
}

export async function createRazorpayCheckoutOrder(amountPaise, currency = 'INR', receipt = '') {
    if (!isRazorpayConfigured()) {
        throw new Error('Razorpay payment gateway is not configured');
    }

    const roundedAmount = Math.round(Number(amountPaise) || 0);
    if (roundedAmount < 100) {
        throw new Error('Amount too low for online payment');
    }

    const order = await createRazorpayOrder(roundedAmount, currency, receipt);
    if (!order?.id) {
        throw new Error('Razorpay order was created without an order id');
    }

    return {
        key: getRazorpayKeyId(),
        orderId: String(order.id || ''),
        amount: Number(order.amount) || roundedAmount,
        currency: order.currency || currency
    };
}

export function createPaymentLink({ amountPaise, currency = 'INR', description, orderId, customerName, customerEmail, customerPhone }) {
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));

    const contact = normalizePhoneToTenDigits(customerPhone);
    const payload = {
        amount: Math.round(amountPaise),
        currency,
        description: description || `Order ${orderId}`,
        customer: {
            name: customerName || 'Customer',
            email: customerEmail || 'customer@example.com',
            contact
        }
    };

    logger.info(`[Razorpay] Creating Payment Link for Order ${orderId}: Amount ${amountPaise} Paise, Contact: ${contact}`);

    return instance.paymentLink
        .create(payload)
        .catch((error) => {
            const errMsg = getRazorpayErrorMessage(error);
            logger.error(`[Razorpay] Payment Link Failed for Order ${orderId}: ${errMsg}`);
            
            if (errMsg.includes('Authentication failed') || errMsg.includes('invalid api key')) {
                if (MOCK_GATEWAY_ALLOWED) {
                    logger.warn(`[Razorpay] Falling back to standard UPI URI due to Authentication failed`);
                    return {
                        id: `mock_plink_${Date.now()}`,
                        short_url: `upi://pay?pa=k9rides@ybl&pn=QuickDrop&am=${(amountPaise / 100).toFixed(2)}&tr=${orderId}`,
                        status: 'created',
                        expire_by: Math.floor(Date.now() / 1000) + 86400
                    };
                }
            }
            throw new Error(errMsg);
        });
}

export function verifyPaymentSignature(orderId, paymentId, signature) {
    // The mock bypass marks a payment as verified without any signature at all, so it
    // is only ever allowed outside production.
    //
    // It used to also switch on config.useDefaultOtp, which meant a flag whose entire
    // purpose is "do not send SMS" silently disabled payment verification on a live
    // server: set USE_DEFAULT_OTP=true and any client could claim an order was paid by
    // sending the literal string below. The two settings are unrelated and the coupling
    // is deliberately gone. NODE_ENV is the only thing that opens this door.
    if (config.nodeEnv !== 'production'
        && signature === 'mock_signature_bypass'
        && String(orderId || '').startsWith('mock_order_')) {
        return true;
    }
    if (!razorpayKeySecret()) return false;
    const body = `${orderId}|${paymentId}`;
    const expected = crypto.createHmac('sha256', razorpayKeySecret()).update(body).digest('hex');
    // timingSafeEqual, not ===: a plain string compare returns as soon as two bytes
    // differ, so response time leaks how many leading hex characters were correct and
    // a signature can be recovered byte by byte. Lengths are checked first because
    // timingSafeEqual throws when the buffers differ in length.
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(String(signature || ''));
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Fetch Razorpay payment (server-side) for additional validation (amount/status/order match).
 * @param {string} paymentId
 */
export async function fetchRazorpayPayment(paymentId) {
    const instance = getRazorpayInstance();
    if (!instance) throw new Error('Razorpay not configured');
    if (!paymentId) throw new Error('paymentId is required');
    return instance.payments.fetch(String(paymentId)).catch((error) => {
        throw new Error(getRazorpayErrorMessage(error));
    });
}

/**
 * Fetch Razorpay payment-link to check status (used for Razorpay QR auto verification).
 * @param {string} paymentLinkId
 */
export function fetchRazorpayPaymentLink(paymentLinkId) {
    if (String(paymentLinkId || '').startsWith('mock_plink_')) {
        return Promise.resolve({
            id: paymentLinkId,
            status: 'created'
        });
    }
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));
    return instance.paymentLink.fetch(String(paymentLinkId)).catch((error) => {
        throw new Error(getRazorpayErrorMessage(error));
    });
}

/**
 * ✅ NEW: Initiate a refund for a successful payment.
 * NON-BREAKING Extension for automated cancellation refunds.
 * @param {string} paymentId - Original Razorpay payment_id (captured)
 * @param {number} amount - Amount to refund (in major unit, e.g., INR 123.45)
 */
export async function initiateRazorpayRefund(paymentId, amount) {
    if (MOCK_GATEWAY_ALLOWED && (!paymentId || String(paymentId).startsWith('mock_'))) {
        logger.info(`[Razorpay] Mock Refund triggered for payment ID: ${paymentId}`);
        return {
            success: true,
            refundId: `mock_ref_${Date.now()}`,
            status: 'processed',
            raw: { id: `mock_ref_${Date.now()}`, status: 'processed' }
        };
    }
    if (!isRazorpayConfigured()) {
        throw new Error('Razorpay is not configured on this server');
    }
    const instance = getRazorpayInstance();
    try {
        const refund = await instance.payments.refund(paymentId, {
            amount: Math.round(Number(amount) * 100), // convert to paise
            notes: {
                reason: 'Order cancelled by system flow',
                at: new Date().toISOString()
            }
        });
        return {
            success: true,
            refundId: refund.id,
            status: refund.status || 'processed',
            raw: refund
        };
    } catch (err) {
        // Log locally but pass the error to the service to handle status update
        console.error(`Razorpay Refund API Failure [PaymentId: ${paymentId}]:`, err?.message || err);
        return {
            success: false,
            error: err?.message || 'Razorpay refund API error',
            status: 'failed'
        };
    }
}
