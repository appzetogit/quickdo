/**
 * The verticals this platform serves, and whether each is currently accepting traffic.
 *
 * Why a kill-switch exists at all: this is one process serving food, taxi,
 * quick-commerce and service-provider. When one vertical misbehaves -- a pricing bug
 * mis-charging every order, a dispatch loop hammering the database, a payment
 * provider outage that only affects one flow -- the options today are to fix it under
 * pressure or restart the whole API and take the other three down with it. Turning
 * one vertical off is the smaller, reversible action, and it is the one you want at
 * 2am.
 *
 * What it deliberately does NOT do:
 *
 *   - It never blocks reads. A customer must still be able to open an order they
 *     already placed, see where the driver is, and find support. Disabling a vertical
 *     stops NEW commitments, it does not erase the ones in flight.
 *   - It never blocks admin routes. The panel is how you diagnose and re-enable.
 *   - It never blocks payment webhooks. A provider callback for an order placed
 *     before the switch flipped still has to reconcile, or that money is stranded.
 *
 * Those three exemptions are the difference between a kill-switch and an outage.
 */

export const MODULES = Object.freeze({
    FOOD: 'food',
    TAXI: 'taxi',
    QUICK_COMMERCE: 'quickCommerce',
    SERVICE_PROVIDER: 'serviceProvider',
});

export const ALL_MODULES = Object.freeze(Object.values(MODULES));

export const isKnownModule = (name) => ALL_MODULES.includes(String(name));

/**
 * Methods that create or change a commitment. Anything outside this set is treated as
 * a read and always allowed through.
 *
 * OPTIONS is absent on purpose: blocking it breaks CORS preflight, so the browser
 * reports a network error instead of the 503 the API is trying to send.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isWriteRequest = (method) => WRITE_METHODS.has(String(method || '').toUpperCase());

/**
 * Paths that stay reachable even when their vertical is disabled.
 *
 * Matched against the full original URL, so a mount prefix does not hide them.
 */
const ALWAYS_ALLOWED = [
    '/admin',            // the panel that turns the vertical back on
    '/payments/webhook', // provider callbacks for orders placed before the switch
    '/auth',             // an operator or driver still needs to sign in
    '/health',
];

export const isAlwaysAllowed = (url) => {
    const path = String(url || '');
    return ALWAYS_ALLOWED.some((allowed) => path.includes(allowed));
};
