import api from '../../../shared/api/axiosInstance';
import { deliveryAPI } from '@food/api';
import { setAuthData } from '@food/utils/auth';
import { getLocalDriverToken } from '../services/registrationService';

/*
 * Unified job feed (SOW plan §8).
 *
 * While unified dispatch is on, the server also sends every offer to the
 * driver as `job:offer` with a `jobType` ('taxi' | 'food' | 'quick_commerce')
 * and withdraws it with `job:cancelled`. Rides keep arriving through
 * `rideRequest` and are handled as before, so only deliveries are picked up
 * here. The server sends a delivery job:offer only to a driver who holds a
 * delivery capability and whose work mode accepts deliveries, so seeing one
 * means the driver can take it.
 *
 * A delivery is accepted, and then run (pickup, OTP, drop), through the
 * delivery app's own API (DeliveryV2), with a delivery-partner session the
 * server issues for the driver's own linked delivery record.
 */

export const DELIVERY_JOB_TYPES = new Set(['food', 'quick_commerce']);

export const isDeliveryJobOffer = (job) => Boolean(job?.jobId) && DELIVERY_JOB_TYPES.has(String(job?.jobType || ''));

const formatKm = (value) => {
    const km = Number(value);
    if (!Number.isFinite(km) || km <= 0) return 'nearby';
    return km < 1 ? `${Math.max(50, Math.round(km * 100) * 10)} m` : `${km.toFixed(km >= 10 ? 0 : 1)} km`;
};

/** A delivery job:offer in the shape IncomingRideRequest renders. */
export const toDeliveryRequest = (job = {}) => ({
    type: 'delivery',
    jobType: job.jobType,
    title: job.title || 'Delivery',
    fare: `Rs ${Number(job.earning || 0)}`,
    payment: job.paymentMethod || 'online',
    pickup: [job.pickup?.name, job.pickup?.address].filter(Boolean).join(', ') || 'Pickup point',
    drop: job.drop?.address || 'Drop point',
    distance: formatKm(job.tripDistanceKm),
    requestId: job.jobId,
    // The card's countdown keys off rideId; for a delivery it is the order id.
    rideId: job.jobId,
    deliveryOrderId: job.jobId,
    acceptRejectDurationSeconds: job.expiresInSeconds,
    requestExpiresAt: job.expiresAt || null,
    customer: job.customer || null,
    bookingMode: 'normal',
    bidding: { enabled: false },
    raw: job,
});

export const isOfferExpired = (job) => Boolean(job?.expiresAt) && new Date(job.expiresAt).getTime() <= Date.now();

const decodeTokenPayload = (token) => {
    try {
        const part = String(token || '').split('.')[1] || '';
        return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
        return null;
    }
};

const LINKED_PARTNER_KEY = 'unified_delivery_partner_id';

/**
 * A delivery-partner session for this driver's own linked delivery record.
 * Reused while the stored one is for the same rider and still fresh.
 */
export const ensureDeliverySession = async () => {
    let existing = null;
    let linkedId = null;
    try {
        existing = localStorage.getItem('delivery_accessToken');
        linkedId = localStorage.getItem(LINKED_PARTNER_KEY);
    } catch {
        // Private window: fall through and ask the server.
    }
    const payload = decodeTokenPayload(existing);
    if (existing && linkedId && payload?.userId === linkedId && Number(payload?.exp || 0) * 1000 > Date.now() + 60000) {
        return linkedId;
    }

    const driverToken = getLocalDriverToken();
    const response = await api.post(
        '/drivers/jobs/delivery-session',
        {},
        driverToken ? { headers: { Authorization: `Bearer ${driverToken}` } } : {},
    );
    const data = response?.data?.data || response?.data || response;
    if (!data?.accessToken) throw new Error('Could not start a delivery session');
    setAuthData('delivery', data.accessToken, null, data.refreshToken || null);
    try {
        localStorage.setItem(LINKED_PARTNER_KEY, String(data.deliveryPartnerId || ''));
    } catch {
        // Not fatal: the next accept just asks for a session again.
    }
    return String(data.deliveryPartnerId || '');
};

/** Accept a food or grocery job. Throws with the server's message on refusal. */
export const acceptDeliveryJob = async (orderId) => {
    await ensureDeliverySession();
    return deliveryAPI.acceptOrder(orderId);
};

/** Decline a delivery offer. Best effort: the offer also lapses on its own. */
export const declineDeliveryJob = (orderId) => {
    let hasSession = false;
    try {
        hasSession = Boolean(localStorage.getItem('delivery_accessToken'));
    } catch {
        hasSession = false;
    }
    if (!hasSession || !orderId) return Promise.resolve(null);
    return deliveryAPI.rejectOrder(orderId, { reason: 'declined_in_driver_app' }).catch(() => null);
};

export const deliveryErrorMessage = (error, fallback = 'This order is no longer available.') => (
    error?.response?.data?.message || error?.message || fallback
);

/** Where the delivery is run once accepted (DeliveryV2). */
export const DELIVERY_HOME_PATH = '/food/delivery';
