/**
 * Dynamic UPI QR: a single-use, fixed-amount Razorpay QR the rider or driver
 * shows at the door or at the end of a ride. Any UPI app that scans it opens
 * with the amount already filled in, like a card machine's QR, and Razorpay
 * closes it after the one payment.
 *
 * Shared by taxi rides and parcels (taxi/driver/controllers/driverController.js)
 * and food / quick-commerce cash-on-delivery (orders/services/order-payment.service.js).
 * The amount is always the caller's own server-side figure -- never one an app sent.
 *
 * Uses the platform's Razorpay keys (Master settings, else .env). QR Codes is a
 * feature Razorpay enables per account; until it is, create() fails with
 * QR_UNAVAILABLE and callers fall back to a payment link.
 */
import { razorpayCredentials } from '../settings/platformProfile.service.js';

const API = 'https://api.razorpay.com/v1';
// Razorpay requires close_by to be at least 2 minutes ahead; 20 leaves the
// customer time to open their UPI app and approve.
export const QR_LIFETIME_SECONDS = 20 * 60;
// Above this a UPI payment is refused by most banks anyway.
export const QR_MAX_RUPEES = 100000;

export class RazorpayQrError extends Error {
    constructor(message, { status = 502, code = '', unavailable = false } = {}) {
        super(message);
        this.statusCode = status;
        this.code = code;
        // The account has no QR Codes feature (or the keys cannot reach it):
        // the caller should fall back to a payment link rather than fail.
        this.unavailable = unavailable;
    }
}

const request = async (method, path, body) => {
    const { keyId, keySecret } = razorpayCredentials();
    if (!keyId || !keySecret) {
        throw new RazorpayQrError('Razorpay keys are not set up', { status: 503, unavailable: true });
    }
    let res;
    try {
        res = await fetch(`${API}${path}`, {
            method,
            headers: {
                Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15000),
        });
    } catch (err) {
        throw new RazorpayQrError(`Could not reach Razorpay: ${err.message}`, { status: 502 });
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        const description = payload?.error?.description || payload?.error?.message || `Razorpay answered ${res.status}`;
        // "The requested URL was not found on the server." is what an account
        // without QR Codes gets for /payments/qr_codes.
        const unavailable = res.status === 401
            || /not found on the server|not enabled|not activated|feature/i.test(description);
        throw new RazorpayQrError(description, { status: res.status === 401 ? 503 : 502, code: payload?.error?.code || '', unavailable });
    }
    return payload;
};

/** Rupees -> whole paise, refusing anything a QR cannot carry. */
export const toQrPaise = (rupees) => {
    const amount = Number(rupees);
    if (!Number.isFinite(amount) || amount < 1) {
        throw new RazorpayQrError('Nothing to collect: the amount due is under Rs 1', { status: 400 });
    }
    if (amount > QR_MAX_RUPEES) {
        throw new RazorpayQrError(`Rs ${amount} is too much for one UPI payment; collect it another way`, { status: 400 });
    }
    return Math.round(amount * 100);
};

const shape = (qr = {}) => ({
    id: qr.id,
    status: String(qr.status || '').toLowerCase(), // active | closed
    closeReason: qr.close_reason || null, // paid | on_demand | null
    // The upi://pay?... string the QR encodes, so an app can draw it crisply;
    // imageUrl is Razorpay's hosted picture of the same QR.
    upiString: qr.image_content || '',
    imageUrl: qr.image_url || '',
    amountPaise: Number(qr.payment_amount || 0),
    paidPaise: Number(qr.payments_amount_received || 0),
    paymentsCount: Number(qr.payments_count_received || 0),
    closeBy: qr.close_by ? new Date(qr.close_by * 1000) : null,
    notes: qr.notes || {},
});

/**
 * Create a single-use QR for exactly `amountPaise`. `notes` must say what it
 * is for ({ kind, refId }) -- the webhook routes the payment by them.
 */
export async function createUpiQr({ amountPaise, name, description, notes = {}, lifetimeSeconds = QR_LIFETIME_SECONDS }) {
    const qr = await request('POST', '/payments/qr_codes', {
        type: 'upi_qr',
        name: String(name || 'Payment').slice(0, 40),
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: amountPaise,
        description: String(description || '').slice(0, 250),
        close_by: Math.floor(Date.now() / 1000) + Math.max(150, lifetimeSeconds),
        notes: Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, String(v ?? '')])),
    });
    return shape(qr);
}

export async function fetchUpiQr(qrId) {
    return shape(await request('GET', `/payments/qr_codes/${encodeURIComponent(qrId)}`));
}

/** The captured payments made to a QR (normally one). */
export async function fetchUpiQrPayments(qrId) {
    const list = await request('GET', `/payments/qr_codes/${encodeURIComponent(qrId)}/payments`);
    return (list?.items || []).map((p) => ({
        id: p.id,
        amountPaise: Number(p.amount || 0),
        status: String(p.status || '').toLowerCase(),
        vpa: p.vpa || '',
        createdAt: p.created_at ? new Date(p.created_at * 1000) : null,
    }));
}

/**
 * Close a QR so it can no longer be paid. Already closed (paid, expired or
 * closed before) is not an error -- the goal is that it is closed.
 */
export async function closeUpiQr(qrId) {
    if (!qrId) return null;
    try {
        return shape(await request('POST', `/payments/qr_codes/${encodeURIComponent(qrId)}/close`));
    } catch (err) {
        if (/already closed|closed/i.test(err.message)) return null;
        throw err;
    }
}

/**
 * Paid in full? A single-use fixed-amount QR closes as 'paid' after its one
 * payment; the received amount is checked too, so a short credit never counts.
 */
export const isQrPaid = (qr, expectedPaise) =>
    Boolean(qr) && Number(expectedPaise) > 0 && Number(qr.paidPaise) >= Number(expectedPaise);

/** Still payable: active and not past its close time. */
export const isQrLive = (qr, now = Date.now()) =>
    Boolean(qr) && qr.status === 'active' && (!qr.closeBy || new Date(qr.closeBy).getTime() > now + 30_000);
