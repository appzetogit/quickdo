/**
 * Which services the customer app offers, and where.
 *
 * The admin switches a service off everywhere, or off in one zone, and the
 * customer app stops showing that tile to people there. One stored document
 * (appServices.model.js) holds both kinds of switch; this module decides what
 * they add up to for one customer, and has no database so it can be tested on
 * its own.
 *
 * The rule, in order:
 *
 *   1. switched off platform-wide  -> hidden everywhere, whatever any zone says;
 *   2. switched off for the zone the customer is standing in -> hidden there;
 *   3. otherwise shown.
 *
 * A customer outside every zone of a service is NOT hidden by this. Zones were
 * never a condition for seeing a tile before this existed, and making them one
 * here would quietly remove services from every town whose map is not drawn
 * yet. `inZone` is reported so the app can say "not available in your area"
 * if it wants to; hiding is the admin's switch alone.
 *
 * Deliberately separate from the platform kill-switch (core/modules): that one
 * refuses new orders with a 503 when a vertical is misbehaving. This one is
 * what the app displays. Turning a tile off does not stop an older app that
 * never asks, and turning a vertical off does not tidy the tile away.
 */

/**
 * The services the app shows, keyed the way the admin panel names them.
 * `zones` is the map each service is drawn on -- each has its own collection.
 */
export const APP_SERVICES = Object.freeze([
    { key: 'food', label: 'Food', zones: 'food' },
    { key: 'quick', label: 'Quick Commerce', zones: 'quick' },
    { key: 'medical', label: 'Medical', zones: 'medical' },
    { key: 'taxi', label: 'Taxi', zones: 'taxi' },
]);

export const APP_SERVICE_KEYS = Object.freeze(APP_SERVICES.map((s) => s.key));

export const isAppService = (key) => APP_SERVICE_KEYS.includes(String(key));

export const HIDDEN_REASONS = Object.freeze({
    DISABLED: 'disabled',
    DISABLED_IN_ZONE: 'disabled_in_zone',
});

const idOf = (value) => (value == null ? '' : String(value));

/**
 * Fill in whatever the stored document is missing.
 *
 * A service never touched is ON. That is what every service was before these
 * switches existed, so adding them changes nothing until someone flips one.
 */
export function normalizeAppServicesState(raw = null) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const storedServices = source.services instanceof Map
        ? Object.fromEntries(source.services)
        : (source.services && typeof source.services === 'object' ? source.services : {});

    const services = {};
    for (const key of APP_SERVICE_KEYS) {
        const entry = storedServices[key];
        services[key] = { enabled: entry?.enabled !== false };
    }

    // One rule per service and zone. A later row for the same pair replaces an
    // earlier one, so a duplicate left by a race cannot disagree with itself.
    const zoneRules = new Map();
    for (const rule of Array.isArray(source.zoneRules) ? source.zoneRules : []) {
        if (!isAppService(rule?.service) || !idOf(rule?.zoneId)) continue;
        zoneRules.set(`${rule.service}:${idOf(rule.zoneId)}`, {
            service: rule.service,
            zoneId: idOf(rule.zoneId),
            enabled: rule.enabled !== false,
        });
    }

    return { services, zoneRules: [...zoneRules.values()] };
}

/** Is this service switched on for this zone, going by the zone rule alone? */
export function zoneRuleAllows(state, service, zoneId) {
    if (!zoneId) return true;
    const rule = normalizeAppServicesState(state).zoneRules
        .find((r) => r.service === service && r.zoneId === idOf(zoneId));
    return rule ? rule.enabled : true;
}

/**
 * What the app should show at one point.
 *
 * @param {object} state         the stored document, raw or normalised
 * @param {object} zonesByService { food: {id, name}|null, ... } -- the zone of each
 *                               service containing the customer, null when none
 *                               does, undefined when no location was given
 */
export function resolveAppServices(state, zonesByService = {}) {
    const normalized = normalizeAppServicesState(state);

    return APP_SERVICES.map(({ key, label }) => {
        const zone = zonesByService?.[key] || null;
        const located = zonesByService?.[key] !== undefined;
        const base = {
            key,
            label,
            inZone: located ? Boolean(zone) : null,
            zone: zone ? { id: idOf(zone.id), name: zone.name || '' } : null,
        };

        if (!normalized.services[key].enabled) {
            return { ...base, visible: false, reason: HIDDEN_REASONS.DISABLED };
        }
        if (zone && !zoneRuleAllows(normalized, key, zone.id)) {
            return { ...base, visible: false, reason: HIDDEN_REASONS.DISABLED_IN_ZONE };
        }
        return { ...base, visible: true, reason: null };
    });
}
