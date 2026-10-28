import { getIO, rooms } from '../../config/socket.js';
import { logger } from '../../utils/logger.js';

/**
 * Live alerts for the admin panel: every new order, ride, booking, SOS and
 * partner request, across all modules.
 *
 * Admins (and super admins) already join one shared room on connect (see
 * config/socket.js), so an alert is a single emit to that room. The panel's
 * alert centre rings, shows a card and links to the record.
 *
 * Fire-and-forget by design: an alert is a courtesy on top of a write that has
 * already succeeded, so this never throws and never awaits. Callers place it
 * AFTER the record is saved -- an alert for an order that then failed to save
 * would send someone looking for nothing.
 *
 * Only the API process holds the socket server. Called from the workers
 * process it logs and does nothing.
 */

export const ADMIN_ALERT_EVENT = 'admin_alert';

/** What kind of ring the panel plays. */
export const ALERT_KINDS = Object.freeze({
    ORDER: 'order',
    RIDE: 'ride',
    BOOKING: 'booking',
    CANCELLED: 'cancelled',
    SOS: 'sos',
    PARTNER: 'partner',
    PAYOUT: 'payout',
    SUPPORT: 'support',
});

const KINDS = new Set(Object.values(ALERT_KINDS));
const text = (v, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// A burst of saves for one record (retries, status echo) should ring once.
const recent = new Map();
const DEDUPE_MS = 60 * 1000;
const isDuplicate = (id, now) => {
    for (const [key, at] of recent) {
        if (now - at > DEDUPE_MS) recent.delete(key);
    }
    if (recent.has(id)) return true;
    recent.set(id, now);
    return false;
};

/**
 * Build the alert payload. Exported for tests.
 *
 * @param {object} a
 * @param {string} a.kind     one of ALERT_KINDS
 * @param {string} a.module   food | quick | medical | taxi | parcel | services | partners ...
 * @param {string} a.title    "New food order #QD1234"
 * @param {string} [a.body]   "Sri Nangli Sweets · ₹450 · Rahul"
 * @param {string} [a.link]   admin panel path to open, e.g. /admin/food/orders/all
 * @param {string} [a.refId]  the record's id; with kind it makes the alert id
 */
export function buildAdminAlert({ kind, module, title, body = '', link = '', refId = '' } = {}) {
    const k = KINDS.has(kind) ? kind : ALERT_KINDS.ORDER;
    const ref = text(refId, 80);
    return {
        id: `${k}:${text(module, 30) || 'app'}:${ref || Date.now().toString(36)}`,
        kind: k,
        module: text(module, 30) || 'app',
        title: text(title, 120) || 'New activity',
        body: text(body),
        link: String(link || '').startsWith('/') ? String(link) : '',
        refId: ref,
        // SOS rings until someone acknowledges it; everything else rings briefly.
        urgent: k === ALERT_KINDS.SOS,
        at: new Date().toISOString(),
    };
}

/**
 * The same alert as a browser push, for admins whose panel tab is closed (Chrome
 * still running). Data-only: the service worker shows it, tagged with the alert
 * id, so an open-but-hidden tab's own notification replaces it rather than
 * doubling it. Also works from the workers process, which has no socket.
 */
function pushToAdmins(alert) {
    if (process.env.ADMIN_ALERT_PUSH === 'false') return;
    import('./firebase.service.js')
        .then(({ notifyAdminsSafely }) => notifyAdminsSafely({
            title: alert.title,
            body: alert.body,
            dataOnly: true,
            webpushNotification: false,
            data: {
                adminAlert: '1',
                notificationId: alert.id,
                title: alert.title,
                body: alert.body,
                link: alert.link || '/admin',
                kind: alert.kind,
                urgent: alert.urgent ? '1' : '0',
            },
        }))
        .catch((err) => logger.warn(`[AdminAlert] push not sent: ${err?.message || err}`));
}

/** Send an alert to every connected admin. Never throws. */
export function alertAdmins(input) {
    try {
        const alert = buildAdminAlert(input);
        if (isDuplicate(alert.id, Date.now())) return alert;
        const io = getIO();
        if (io) io.to(rooms.admin()).emit(ADMIN_ALERT_EVENT, alert);
        pushToAdmins(alert);
        return alert;
    } catch (err) {
        logger.warn(`[AdminAlert] not sent: ${err?.message || err}`);
        return null;
    }
}

/** Indian rupees for an alert line, or '' when there is no amount. */
export const rupees = (amount) => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? `₹${Math.round(n * 100) / 100}` : '';
};

/** Join the non-empty parts of an alert body with a middle dot. */
export const line = (...parts) => parts.map((p) => text(p, 60)).filter(Boolean).join(' · ');

const ORDER_MODULES = {
    food: { label: 'food', link: '/admin/food/orders/all' },
    quickCommerce: { label: 'daily needs', link: '/admin/quick-commerce/orders/all' },
    medical: { label: 'medical', link: '/admin/medical/orders/all' },
};

/**
 * New or cancelled food / daily-needs / medical order. An order still waiting
 * for online payment is not new yet -- the payment confirmation alerts instead.
 *
 * @param {object} order   the saved order document
 * @param {object} [opts]
 * @param {'food'|'quickCommerce'|'medical'} [opts.module]  defaults to order.vertical, else food
 * @param {string} [opts.storeName]
 * @param {boolean} [opts.cancelled]
 * @param {string} [opts.by]   who cancelled: customer, restaurant, store, admin, system
 */
export function alertOrderEvent(order, { module, storeName = '', cancelled = false, by = '' } = {}) {
    if (!order) return null;
    if (!cancelled && String(order.orderStatus || '') === 'pending_payment') return null;
    const key = ORDER_MODULES[module] ? module : (ORDER_MODULES[order.vertical] ? order.vertical : 'food');
    const meta = ORDER_MODULES[key];
    const number = order.order_id || order.orderId || String(order._id || '').slice(-6);
    return alertAdmins({
        kind: cancelled ? ALERT_KINDS.CANCELLED : ALERT_KINDS.ORDER,
        module: key,
        title: cancelled
            ? `${meta.label[0].toUpperCase()}${meta.label.slice(1)} order #${number} cancelled${by ? ` by ${by}` : ''}`
            : `New ${meta.label} order #${number}`,
        body: line(storeName || order.restaurantName, rupees(order.pricing?.total), order.customerName),
        link: meta.link,
        refId: String(order._id || number),
    });
}

const RIDE_LABELS = { ride: 'ride', parcel: 'parcel', intercity: 'intercity ride' };

/**
 * Taxi / bike / parcel / intercity ride events.
 *
 * @param {object} ride   the saved Ride document
 * @param {object} [opts]
 * @param {'new'|'unmatched'|'cancelled'} [opts.event]
 * @param {string} [opts.customerName]
 * @param {string} [opts.by]   who cancelled
 */
export function alertRideEvent(ride, { event = 'new', customerName = '', by = '' } = {}) {
    if (!ride) return null;
    const type = String(ride.serviceType || 'ride').toLowerCase();
    const label = RIDE_LABELS[type] || 'ride';
    const Label = `${label[0].toUpperCase()}${label.slice(1)}`;
    const isParcel = type === 'parcel';
    const route = [ride.pickupAddress, ride.dropAddress].map((a) => text(a, 40)).filter(Boolean).join(' → ');
    const title = event === 'unmatched'
        ? `${Label}: no driver found`
        : event === 'cancelled'
            ? `${Label} cancelled${by ? ` by ${by}` : ''}`
            : `New ${label} request`;
    return alertAdmins({
        kind: event === 'cancelled' || event === 'unmatched' ? ALERT_KINDS.CANCELLED : ALERT_KINDS.RIDE,
        module: isParcel ? 'parcel' : 'taxi',
        title,
        body: line(customerName, rupees(ride.fare), route),
        link: isParcel ? '/taxi/admin/deliveries' : '/taxi/admin/trips',
        refId: `${String(ride._id)}:${event}`,
    });
}
