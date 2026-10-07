/**
 * Reads and writes the app-services switches, and finds which zone of each
 * service a customer is standing in.
 *
 * The rule itself is in appServices.rules.js.
 */
import { logger } from '../../utils/logger.js';
import { AppServicesState } from './appServices.model.js';
import {
    APP_SERVICES,
    isAppService,
    normalizeAppServicesState,
    resolveAppServices,
} from './appServices.rules.js';

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

// ---------------------------------------------------------------- state ----

/*
 * Cached, because every app launch and every change of address asks. Writes
 * here refresh it at once; the TTL only bounds how long another pm2 instance
 * keeps the old answer.
 */
const CACHE_TTL_MS = 10_000;
let cache = { at: 0, value: null };

async function readState() {
    if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
    try {
        const doc = await AppServicesState.findById('platform').lean();
        cache = { at: Date.now(), value: doc || {} };
        return cache.value;
    } catch (err) {
        // Fail OPEN: a database hiccup must not empty the app of services.
        // Not cached, so the next request tries again.
        logger.warn(`[app-services] state read failed, showing everything: ${err.message}`);
        return {};
    }
}

export const clearAppServicesCache = () => { cache = { at: 0, value: null }; };

// ---------------------------------------------------------------- zones ----

/*
 * Each service is drawn on its own map. Loaded lazily so this module does not
 * drag every vertical's models into whatever imports it.
 */
const ZONE_SOURCES = {
    async food() {
        const { FoodZone } = await import('../../modules/food/admin/models/zone.model.js');
        return {
            list: () => FoodZone.find({}).select('name zoneName isActive coordinates').lean(),
            active: (z) => z.isActive !== false,
            contains: polygonContains,
        };
    },
    async quick() {
        return qcZones('quick');
    },
    async taxi() {
        const { Zone } = await import('../../modules/taxi/driver/models/Zone.js');
        return {
            list: () => Zone.find({}).select('name active status').lean(),
            active: (z) => z.active !== false && String(z.status || 'active') === 'active',
            // Taxi stores GeoJSON with a 2dsphere index, so the database answers.
            find: async (lat, lng) => Zone.findOne({
                active: { $ne: false },
                geometry: { $geoIntersects: { $geometry: { type: 'Point', coordinates: [lng, lat] } } },
            }).select('name').lean(),
        };
    },
};

/**
 * A module's zones for an admin picker: id, name, whether active.
 * `module` is the settings name ('food' | 'quickCommerce' | 'taxi').
 */
export async function listZonesFor(module) {
    const key = { food: 'food', quickCommerce: 'quick', taxi: 'taxi' }[module];
    if (!key) return null;
    const source = await ZONE_SOURCES[key]();
    const docs = await source.list();
    return docs
        .map((z) => ({ id: String(z._id), name: String(z.name || z.zoneName || 'Unnamed zone'), active: source.active(z) }))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

async function qcZones(vertical) {
    const { zoneModelFor } = await import(
        '../../modules/quickCommerce/modules/food/shared/zoneServiceability.js'
    );
    const Model = zoneModelFor(vertical);
    return {
        list: () => Model.find({}).select('name zoneName isActive coordinates').lean(),
        active: (z) => z.isActive !== false,
        contains: polygonContains,
    };
}

/** Ray casting over the [{latitude, longitude}] rings food and quick store. */
function polygonContains(zone, lat, lng) {
    const ring = Array.isArray(zone?.coordinates) ? zone.coordinates : [];
    if (ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i].longitude);
        const yi = Number(ring[i].latitude);
        const xj = Number(ring[j].longitude);
        const yj = Number(ring[j].latitude);
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

const zoneName = (z) => String(z?.name || z?.zoneName || 'Unnamed zone');

/** The active zone of this service containing the point, or null. */
async function zoneAt(service, lat, lng) {
    const source = await ZONE_SOURCES[service]();
    if (source.find) {
        const hit = await source.find(lat, lng);
        return hit ? { id: String(hit._id), name: zoneName(hit) } : null;
    }
    const zones = await source.list();
    const hit = zones.find((z) => source.active(z) && source.contains(z, lat, lng));
    return hit ? { id: String(hit._id), name: zoneName(hit) } : null;
}

const toCoordinate = (value, limit) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

// ------------------------------------------------------------- customer ----

/**
 * What the app should show. Without a location only the platform-wide
 * switches apply; with one, each service's zone there is looked up too.
 */
export async function resolveAppServicesAt({ lat, lng } = {}) {
    const latitude = toCoordinate(lat, 90);
    const longitude = toCoordinate(lng, 180);
    const state = await readState();

    let zonesByService = {};
    if (latitude !== null && longitude !== null) {
        const found = await Promise.all(APP_SERVICES.map(async ({ key }) => {
            try {
                return [key, await zoneAt(key, latitude, longitude)];
            } catch (err) {
                // One vertical's map failing must not hide or break the others.
                logger.warn(`[app-services] zone lookup failed for ${key}: ${err.message}`);
                return [key, undefined];
            }
        }));
        zonesByService = Object.fromEntries(found);
    }

    const services = resolveAppServices(state, zonesByService);
    // Riders online in the customer's zone, for the delivery services, so the
    // app can say "no delivery partners available right now" instead of the
    // order just sitting unassigned. Never blocks ordering (cash or online).
    await Promise.all(services.map(async (svc) => {
        if (!DELIVERY_SERVICES.has(svc.key) || !svc.inZone || !svc.zone?.id) return;
        try {
            const online = await ridersOnlineInZone(svc.key, svc.zone.id);
            svc.ridersOnline = online;
            svc.ridersAvailable = online > 0;
            svc.notice = online > 0
                ? null
                : 'No delivery partners are available in your area right now. You can still order; delivery may take longer.';
        } catch (err) {
            logger.warn(`[app-services] rider count failed for ${svc.key}: ${err.message}`);
        }
    }));

    return {
        located: latitude !== null && longitude !== null,
        services,
    };
}

// ------------------------------------------------- riders in a zone ----

const DELIVERY_SERVICES = new Set(['food', 'quick']);
// Same window dispatch uses (DISPATCH_STALE_GPS_MS): older positions do not count.
const RIDER_FRESH_MS = Number(process.env.DISPATCH_STALE_GPS_MS) || 45 * 60 * 1000;
const RIDER_COUNT_TTL_MS = 30 * 1000;
const riderCountCache = new Map(); // `${service}:${zoneId}` -> { at, value }

/**
 * Online riders with a recent position inside this service's zone. The
 * delivery app goes online on the Food side for every delivery service, so
 * Food riders are counted against the Food or Quick zone polygon.
 */
async function ridersOnlineInZone(service, zoneId) {
    const key = `${service}:${zoneId}`;
    const hit = riderCountCache.get(key);
    if (hit && Date.now() - hit.at < RIDER_COUNT_TTL_MS) return hit.value;

    const source = await ZONE_SOURCES[service]();
    const zone = (await source.list()).find((z) => String(z._id) === String(zoneId));
    if (!zone) return 0;
    const { FoodDeliveryPartner } = await import('../../modules/food/delivery/models/deliveryPartner.model.js');
    const riders = await FoodDeliveryPartner.find({
        availabilityStatus: 'online',
        status: 'approved',
        lastLocationAt: { $gte: new Date(Date.now() - RIDER_FRESH_MS) },
    }).select('lastLat lastLng').lean();
    const value = riders.filter((r) => Number.isFinite(Number(r.lastLat)) && Number.isFinite(Number(r.lastLng))
        && polygonContains(zone, Number(r.lastLat), Number(r.lastLng))).length;
    riderCountCache.set(key, { at: Date.now(), value });
    return value;
}

// ---------------------------------------------------------------- admin ----

/** Every service, its platform-wide switch, and every zone with its own switch. */
export async function getAdminView() {
    clearAppServicesCache();
    const raw = await readState();
    const state = normalizeAppServicesState(raw);
    const storedServices = raw?.services || {};

    const services = await Promise.all(APP_SERVICES.map(async ({ key, label }) => {
        let zones = [];
        let zonesError = null;
        try {
            const source = await ZONE_SOURCES[key]();
            zones = (await source.list()).map((z) => {
                const rule = state.zoneRules.find((r) => r.service === key && r.zoneId === String(z._id));
                const storedRule = (raw?.zoneRules || []).find(
                    (r) => r.service === key && String(r.zoneId) === String(z._id),
                );
                return {
                    id: String(z._id),
                    name: zoneName(z),
                    zoneActive: source.active(z),
                    enabled: rule ? rule.enabled : true,
                    updatedBy: storedRule?.updatedBy || null,
                    updatedAt: storedRule?.updatedAt || null,
                };
            }).sort((a, b) => a.name.localeCompare(b.name));
        } catch (err) {
            zonesError = `Could not load ${label} zones.`;
            logger.warn(`[app-services] listing ${key} zones failed: ${err.message}`);
        }
        return {
            key,
            label,
            enabled: state.services[key].enabled,
            updatedBy: storedServices[key]?.updatedBy || null,
            updatedAt: storedServices[key]?.updatedAt || null,
            zones,
            zonesError,
        };
    }));

    return { services };
}

const assertService = (service) => {
    if (!isAppService(service)) throw httpError(404, `Unknown service: ${service}`);
};

const assertBoolean = (enabled) => {
    if (typeof enabled !== 'boolean') throw httpError(400, '`enabled` must be true or false');
};

export async function setServiceEnabled(service, enabled, { actorId = '' } = {}) {
    assertService(service);
    assertBoolean(enabled);

    await AppServicesState.findByIdAndUpdate(
        'platform',
        {
            $set: {
                [`services.${service}`]: {
                    enabled,
                    updatedBy: String(actorId || ''),
                    updatedAt: new Date(),
                },
            },
        },
        { upsert: true },
    );
    clearAppServicesCache();
    logger.warn(`[app-services] ${service} ${enabled ? 'SHOWN' : 'HIDDEN'} everywhere by=${actorId || 'unknown'}`);
    return getAdminView();
}

export async function setZoneEnabled(service, zoneId, enabled, { actorId = '' } = {}) {
    assertService(service);
    assertBoolean(enabled);

    const id = String(zoneId || '');
    const source = await ZONE_SOURCES[service]();
    const exists = (await source.list()).some((z) => String(z._id) === id);
    if (!exists) throw httpError(404, 'That zone does not exist for this service.');

    const rule = { service, zoneId: id, enabled, updatedBy: String(actorId || ''), updatedAt: new Date() };

    // Replace any rule for this pair, then add the new one -- two steps on one
    // document, so a zone never ends up with two rules that disagree.
    await AppServicesState.findByIdAndUpdate(
        'platform',
        { $pull: { zoneRules: { service, zoneId: id } } },
        { upsert: true },
    );
    await AppServicesState.findByIdAndUpdate('platform', { $push: { zoneRules: rule } });

    clearAppServicesCache();
    logger.warn(
        `[app-services] ${service} ${enabled ? 'SHOWN' : 'HIDDEN'} in zone ${id} by=${actorId || 'unknown'}`,
    );
    return getAdminView();
}
