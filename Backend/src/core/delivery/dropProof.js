import { get as getSetting } from '../config/resolver.service.js';

/**
 * Proof of delivery (plan §5.4).
 *
 * The rider photographs the drop -- the parcel at the door, or in the customer's
 * hands -- and the photo, where they stood and when are kept on the order as
 * `dropProof { photoUrl, lat, lng, at }`. The customer and admin see it on the
 * order.
 *
 * A photo is REQUIRED whenever the customer's handover code is not used for the
 * order: when the admin turned the code off (`delivery.dropOtpRequired`) or the
 * customer asked for a contactless drop. With the code in use the photo stays
 * optional, so riders of today's app are not refused anything.
 *
 * Shared by every store vertical; each calls it from its own completion step.
 */

const finite = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** True when the customer's handover code decides this delivery. */
export async function dropOtpInUse(order, { vertical = 'quickCommerce' } = {}) {
    if (order?.contactlessDelivery === true) return false;
    try {
        const { value } = await getSetting('delivery.dropOtpRequired', {
            vertical,
            zoneId: order?.zoneId ? String(order.zoneId) : undefined,
        });
        return value !== false;
    } catch {
        return true;
    }
}

/**
 * The proof the rider sent, cleaned, or null when none was sent.
 * Accepts `{ dropProof: { photoUrl, lat, lng } }` or the flat
 * `{ dropPhotoUrl, lat, lng }` some clients send.
 * Throws a 400-style error for a proof that is present but unusable.
 */
export function readDropProof(body = {}) {
    const raw = body?.dropProof && typeof body.dropProof === 'object' ? body.dropProof : {
        photoUrl: body?.dropPhotoUrl || body?.proofPhotoUrl,
        lat: body?.lat ?? body?.latitude,
        lng: body?.lng ?? body?.longitude,
    };
    const photoUrl = String(raw?.photoUrl || raw?.url || '').trim();
    if (!photoUrl) return null;
    // An uploaded image: an absolute URL, or this server's own /uploads/ path
    // (POST /v1/uploads/image returns that when no public base URL is set).
    if (!/^(https?:\/\/|\/uploads\/)/i.test(photoUrl) || photoUrl.length > 2048) {
        const err = new Error('Proof-of-delivery photo must be an uploaded image URL');
        err.statusCode = 400;
        throw err;
    }
    let lat = finite(raw?.lat ?? raw?.latitude);
    let lng = finite(raw?.lng ?? raw?.longitude);
    if (lat !== null && (lat < -90 || lat > 90)) lat = null;
    if (lng !== null && (lng < -180 || lng > 180)) lng = null;
    return { photoUrl, lat, lng, at: new Date(), reason: String(raw?.reason || '').slice(0, 200) };
}

/**
 * Decide the proof for a completion. Returns the proof to store (or null) and
 * whether the OTP check should be applied. Throws when a photo is required and
 * missing.
 */
export async function resolveDropProof(order, body = {}, opts = {}) {
    const proof = readDropProof(body);
    const otpInUse = await dropOtpInUse(order, opts);
    if (!otpInUse && !proof) {
        const err = new Error('Take a photo of the delivery to complete it (no handover code on this order).');
        err.statusCode = 400;
        throw err;
    }
    return { proof, otpInUse };
}
