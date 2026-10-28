/**
 * Master > Delivery Management > Live Drivers: everyone online right now, and
 * where they are.
 *
 * One row per person. A rider can be online on the food side (their food
 * delivery partner record, `availabilityStatus`) and/or on the taxi side (the
 * unified driver record, `isOnline`); the partner's `driverId` links the two,
 * so a rider online on both is one row, placed at whichever position is newer.
 *
 * Busy means on a job now: a ride or a delivery on the unified driver's
 * assignment, or a food/quick order accepted and not yet finished
 * (manualAssign.foodRidersOnTrip).
 *
 * "Live" is a check-in within FRESH_MS. The driver app checks in every 3
 * minutes while online (and on every move), so two missed check-ins means the
 * app was closed or killed without going offline: the switch still reads
 * online on the server, but nobody is there. Those riders are listed apart as
 * not responding and are not counted as online.
 */
import { foodRidersOnTrip } from './manualAssign.js';
import { loadLiveRiderZones, shapeContains } from './liveRiderZones.js';

export const FRESH_MS = 5 * 60 * 1000;

const point = (lat, lng) => {
    const a = Number(lat);
    const b = Number(lng);
    return Number.isFinite(a) && Number.isFinite(b) && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
};

const time = (value) => {
    const t = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
};

export async function listLiveRiders({ now = Date.now() } = {}) {
    const [{ Driver }, { FoodDeliveryPartner }] = await Promise.all([
        import('../../modules/taxi/driver/models/Driver.js'),
        import('../../modules/food/delivery/models/deliveryPartner.model.js'),
    ]);

    const [drivers, partners, onDelivery] = await Promise.all([
        Driver.find({ isOnline: true, approve: { $ne: false } })
            .select('name phone isOnRide activeAssignment workMode registerFor vehicleType vehicleNumber location updatedAt')
            .lean(),
        FoodDeliveryPartner.find({ availabilityStatus: 'online', status: 'approved' })
            .select('name phone driverId vehicleType vehicleNumber lastLat lastLng lastLocationAt updatedAt')
            .lean(),
        foodRidersOnTrip().catch(() => new Set()),
    ]);
    const zoneList = await loadLiveRiderZones().catch(() => []);

    // A partner online on the food side whose linked driver is offline still
    // needs that driver's record for the merge; fetch just those.
    const knownDriverIds = new Set(drivers.map((d) => String(d._id)));
    const missing = partners.map((p) => p.driverId).filter((id) => id && !knownDriverIds.has(String(id)));
    const linkedOffline = missing.length
        ? await Driver.find({ _id: { $in: missing } })
            .select('name phone isOnRide activeAssignment workMode registerFor vehicleType vehicleNumber location updatedAt')
            .lean()
        : [];
    const driverById = new Map([...drivers, ...linkedOffline].map((d) => [String(d._id), d]));
    const onlineDriverIds = knownDriverIds;

    // The other way round: a driver online for taxi whose delivery toggle is
    // off still has a partner record, and its toggle is shown as off.
    const onlinePartnerDriverIds = new Set(partners.filter((p) => p.driverId).map((p) => String(p.driverId)));
    const offlinePartnerOf = new Map(
        (await FoodDeliveryPartner.find({
            driverId: { $in: drivers.map((d) => d._id).filter((id) => !onlinePartnerDriverIds.has(String(id))) },
        })
            .select('driverId')
            .lean()
            .catch(() => []))
            .map((p) => [String(p.driverId), p]),
    );

    const rows = new Map();
    const add = ({ driver = null, partner = null }) => {
        const key = driver ? `d:${driver._id}` : `p:${partner._id}`;
        const driverPoint = driver ? point(driver.location?.coordinates?.[1], driver.location?.coordinates?.[0]) : null;
        const partnerPoint = partner ? point(partner.lastLat, partner.lastLng) : null;
        // The driver record has no position timestamp of its own; updatedAt is
        // the closest it has (a location ping writes the record).
        const driverAt = driver && driverPoint ? time(driver.updatedAt) : 0;
        const partnerAt = partner && partnerPoint ? time(partner.lastLocationAt || partner.updatedAt) : 0;
        const usePartner = partnerAt >= driverAt && partnerPoint;
        const at = usePartner ? partnerAt : driverAt;
        const where = usePartner ? partnerPoint : driverPoint;

        const assignment = driver?.activeAssignment?.type || '';
        const delivering = partner ? onDelivery.has(String(partner._id)) : false;
        const status = assignment === 'ride' || driver?.isOnRide
            ? 'on_ride'
            : assignment === 'delivery' || delivering
                ? 'on_delivery'
                : 'free';

        const services = [];
        if (driver && onlineDriverIds.has(String(driver._id))) services.push('taxi');
        if (partner) services.push('delivery');

        // Each app's online switch: true on, false off, null when the person is
        // not registered on that side at all.
        const toggles = {
            taxi: driver ? onlineDriverIds.has(String(driver._id)) : null,
            delivery: partner ? true : driver && offlinePartnerOf.has(String(driver._id)) ? false : null,
        };

        rows.set(key, {
            id: key,
            driverId: driver ? String(driver._id) : null,
            partnerId: partner ? String(partner._id) : null,
            name: partner?.name || driver?.name || 'Unnamed',
            phone: partner?.phone || driver?.phone || '',
            services,
            toggles,
            workMode: driver?.workMode || null,
            vehicle: [driver?.vehicleType || partner?.vehicleType, driver?.vehicleNumber || partner?.vehicleNumber]
                .filter(Boolean)
                .join(' · '),
            status,
            lat: where?.lat ?? null,
            lng: where?.lng ?? null,
            lastSeenAt: at ? new Date(at).toISOString() : null,
            live: Boolean(at) && now - at <= FRESH_MS,
            // Every zone the current position is inside (taxi, food and quick
            // zones overlap, so a rider is often in one of each).
            zones: where ? zoneList.filter((z) => shapeContains(z.shape, where.lat, where.lng)).map((z) => z.id) : [],
        });
    };

    const partnerByDriver = new Map(partners.filter((p) => p.driverId).map((p) => [String(p.driverId), p]));
    for (const d of drivers) add({ driver: d, partner: partnerByDriver.get(String(d._id)) || null });
    for (const p of partners) {
        if (p.driverId && onlineDriverIds.has(String(p.driverId))) continue; // already merged above
        add({ driver: p.driverId ? driverById.get(String(p.driverId)) || null : null, partner: p });
    }

    const riders = [...rows.values()].sort((a, b) => {
        if (a.live !== b.live) return a.live ? -1 : 1;
        return time(b.lastSeenAt) - time(a.lastSeenAt);
    });
    const count = (fn) => riders.filter(fn).length;
    return {
        stats: {
            online: count((r) => r.live),
            free: count((r) => r.live && r.status === 'free'),
            onRide: count((r) => r.live && r.status === 'on_ride'),
            onDelivery: count((r) => r.live && r.status === 'on_delivery'),
            live: count((r) => r.live),
            stale: count((r) => !r.live),
            noLocation: count((r) => r.lat == null),
            taxi: count((r) => r.services.includes('taxi')),
            delivery: count((r) => r.services.includes('delivery')),
        },
        freshMinutes: FRESH_MS / 60000,
        zones: zoneList.map(({ id, name, kind, outline }) => ({
            id,
            name,
            kind,
            outline,
            online: count((r) => r.live && r.zones.includes(id)),
        })),
        riders,
        at: new Date(now).toISOString(),
    };
}
