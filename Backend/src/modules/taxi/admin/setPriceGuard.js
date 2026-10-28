import mongoose from 'mongoose';

/**
 * Runs in front of the taxi admin's set-price create and edit
 * (POST /taxi/admin/types/set-prices, PATCH .../:id) so a price row can only
 * be saved in a shape the ride lookup reads correctly.
 *
 * 1. The service location comes from the zone. The save code falls back to
 *    `zone._id` when the panel sends no service location, which is how
 *    Palampur's rows were saved with the zone's id as their service location.
 *    Here the zone's own service location is filled in instead, and the zone
 *    object is dropped so that fallback cannot fire.
 *
 * 2. One active price per vehicle per zone per service. A second active row
 *    for the same vehicle in the same zone (Taxi, Parcel, or Both, which
 *    covers both) leaves the fare to whichever was edited last. That is
 *    refused, naming the row to edit instead.
 *
 * Package prices (pricing_scope other than 'ride') are left alone: those rows
 * hold several vehicles and are looked up differently.
 */

const ID = (v) => {
    const raw = v?._id || v?.id || v;
    return raw && mongoose.Types.ObjectId.isValid(String(raw)) ? new mongoose.Types.ObjectId(String(raw)) : null;
};

const transportOf = (value = '') => {
    const t = String(value || '').trim().toLowerCase();
    if (t === 'delivery' || t === 'pooling') return t;
    if (t === 'both' || t === 'all') return 'both';
    return 'taxi';
};

/** Transport types whose rows a ride of type `t` could be priced from. */
const clashesWith = (t) => (t === 'both' ? ['taxi', 'delivery', 'both'] : [t, 'both']);

const LABEL = { taxi: 'Taxi', delivery: 'Parcel', both: 'Taxi + Parcel', pooling: 'Pooling' };

export async function setPriceGuard(req, res, next) {
    const isCreate = req.method === 'POST' && (req.path === '/' || req.path === '');
    const editMatch = req.method === 'PATCH' ? /^\/([0-9a-fA-F]{24})\/?$/.exec(req.path) : null;
    if ((!isCreate && !editMatch) || !req.headers.authorization || !req.body || typeof req.body !== 'object') return next();

    try {
        const [{ SetPrice }, { Zone }, { Vehicle }] = await Promise.all([
            import('./models/SetPrice.js'),
            import('../driver/models/Zone.js'),
            import('./models/Vehicle.js').catch(() => ({ Vehicle: null })),
        ]);
        const body = req.body;
        const existing = editMatch ? await SetPrice.findById(editMatch[1]).lean() : null;
        if (editMatch && !existing) return next(); // the handler answers 404

        const scope = String(body.pricing_scope ?? existing?.pricing_scope ?? 'ride');
        if (scope !== 'ride') return next();

        // 1. Service location from the zone.
        const zoneSent = body.zone_id !== undefined || body.zone !== undefined;
        const zoneId = ID(body.zone_id) || ID(body.zone) || (zoneSent ? null : existing?.zone_id || null);
        if (zoneSent && zoneId) {
            const zone = await Zone.findById(zoneId).select('service_location_id').lean();
            if (zone) {
                body.zone_id = String(zoneId);
                if (zone.service_location_id) body.service_location_id = String(zone.service_location_id);
                else if (ID(body.service_location_id) && String(ID(body.service_location_id)) === String(zoneId)) delete body.service_location_id;
                delete body.zone;
            }
        }

        // 2. One active row per vehicle, zone and service.
        const vehicleId = ID(body.vehicle_type) || ID(body.type_id) || existing?.vehicle_type || null;
        const transport = transportOf(body.transport_type ?? existing?.transport_type);
        const active = Number(body.active ?? existing?.active ?? 1) === 1;
        if (zoneId && vehicleId && active) {
            const clash = await SetPrice.findOne({
                _id: { $ne: existing?._id || null },
                zone_id: zoneId,
                vehicle_type: vehicleId,
                active: 1,
                status: 'active',
                pricing_scope: { $in: ['ride', null] },
                transport_type: { $in: clashesWith(transport) },
            }).select('_id transport_type base_price base_distance price_per_distance').lean();
            if (clash) {
                const vehicle = Vehicle ? await Vehicle.findById(vehicleId).select('name').lean().catch(() => null) : null;
                const name = vehicle?.name || 'This vehicle';
                return res.status(409).json({
                    success: false,
                    message: `${name} already has an active ${LABEL[clash.transport_type] || clash.transport_type} price in this zone `
                        + `(Rs ${clash.base_price} for ${clash.base_distance} km + Rs ${clash.price_per_distance}/km). `
                        + 'Edit that price, or switch it off first, so the fare is never decided by whichever was saved last.',
                    data: { conflictingSetPriceId: String(clash._id) },
                });
            }
        }
        return next();
    } catch (err) {
        // A guard failure must not block an admin from saving prices.
        return next();
    }
}
