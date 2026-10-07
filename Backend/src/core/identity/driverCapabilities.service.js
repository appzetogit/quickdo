import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * One person, one registration, both job streams.
 *
 * A driver registering in the app becomes a unified TaxiDriver. That identity
 * owns the busy-lock and the workMode toggle, but it is NOT the pool food
 * dispatch selects from: order-dispatch.service.js still picks candidates out of
 * FoodDeliveryPartner and only *filters* them by the linked driver. So granting
 * the 'delivery' capability alone puts nobody in the food pool -- the driver
 * would toggle to Delivery and simply never be offered anything.
 *
 * This creates the other half and links the two, which is what the Phase-1
 * backfill (scripts/migrate-unify-drivers.js) does for existing records. Same
 * shape, applied forward at registration instead of retroactively.
 *
 * Idempotent: safe to call on every registration and safe to re-run over
 * drivers that already have both halves.
 *
 * Deliberately non-fatal. A driver who cannot be given delivery capability must
 * still finish registering as a taxi driver -- failing the whole signup because
 * the second identity could not be written would be worse than the missing
 * capability, which a backfill can repair later.
 */

const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);

/**
 * Give a unified driver the delivery half: capability, a linked
 * FoodDeliveryPartner, and the dispatch hints food matching reads off the core doc.
 *
 * @param {object} driver  a TaxiDriver mongoose document (saved)
 * @returns {Promise<{ granted: boolean, partnerId: string|null, reason?: string }>}
 */
export async function ensureDeliveryCapability(driver) {
    try {
        if (!driver?._id) return { granted: false, partnerId: null, reason: 'no driver' };

        const phone = normalizePhone(driver.phone);
        if (!phone) return { granted: false, partnerId: null, reason: 'driver has no phone' };

        const { FoodDeliveryPartner } = await import('../../modules/food/delivery/models/deliveryPartner.model.js');

        // Match on the last 10 digits, because the two apps store country codes
        // differently and a '+91' prefix would otherwise create a duplicate
        // partner for someone who already exists.
        let partner = await FoodDeliveryPartner.findOne({
            phone: { $regex: `${phone}$` },
        });

        if (!partner) {
            partner = await FoodDeliveryPartner.create({
                name: driver.name || driver.fullName || 'Driver',
                phone,
                countryCode: driver.countryCode || '+91',
                email: driver.email || undefined,
                vehicleType: driver.delivery?.vehicleType || '',
                vehicleName: driver.delivery?.vehicleName || driver.vehicleName || '',
                // vehicleNumber is unique+sparse: writing an empty string on every
                // auto-created partner would collide on the second one, so it is
                // left unset unless we actually have a value.
                ...(driver.vehicleNumber ? { vehicleNumber: driver.vehicleNumber } : {}),
                // Mirrors the taxi approval state rather than assuming approved:
                // a driver still pending verification must not receive orders.
                status: driver.approve === true ? 'approved' : 'pending',
                driverId: driver._id,
            });
        } else if (!partner.driverId) {
            partner.driverId = driver._id;
            await partner.save();
        }

        // Link and capability on the driver side.
        const caps = Array.isArray(driver.serviceCapabilities) ? [...driver.serviceCapabilities] : [];
        let changed = false;

        if (!caps.includes('delivery')) {
            caps.push('delivery');
            driver.serviceCapabilities = caps;
            changed = true;
        }
        if (!caps.includes('taxi')) {
            // Registration is through the driver app, which is a taxi identity;
            // without this a delivery-first signup could never toggle to rides.
            driver.serviceCapabilities = [...caps, 'taxi'];
            changed = true;
        }
        if (String(driver.legacyDeliveryPartnerId || '') !== String(partner._id)) {
            driver.legacyDeliveryPartnerId = partner._id;
            changed = true;
        }
        if (changed) await driver.save();

        // The per-service profile the unification design expects. Not read by
        // dispatch today, but the backfill creates one and the two paths should
        // not disagree about what a unified driver looks like.
        try {
            const { DeliveryProfile } = await import('../../modules/food/delivery/models/deliveryProfile.model.js');
            await DeliveryProfile.updateOne(
                { driverId: driver._id },
                { $setOnInsert: { driverId: driver._id, legacyDeliveryPartnerId: partner._id } },
                { upsert: true }
            );
        } catch (err) {
            logger.warn(`DeliveryProfile upsert skipped for driver ${driver._id}: ${err.message}`);
        }

        return { granted: true, partnerId: String(partner._id) };
    } catch (err) {
        // Never fail a registration over this.
        logger.error(`ensureDeliveryCapability failed for driver ${driver?._id}: ${err.message}`);
        return { granted: false, partnerId: null, reason: err.message };
    }
}

/**
 * Give a unified driver the quick-commerce half.
 *
 * Kept separate from the food half because the two verticals keep separate pools
 * -- food_delivery_partners and qc_delivery_partners -- so being in one says
 * nothing about the other. Same shape as ensureDeliveryCapability: create the
 * missing record, link both ways, grant the capability, never fail the caller.
 */
export async function ensureQuickCommerceCapability(driver) {
    try {
        if (!driver?._id) return { granted: false, partnerId: null, reason: 'no driver' };

        const phone = normalizePhone(driver.phone);
        if (!phone) return { granted: false, partnerId: null, reason: 'driver has no phone' };

        const { FoodDeliveryPartner: QCDeliveryPartner } = await import(
            '../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js'
        );

        let partner = await QCDeliveryPartner.findOne({ phone: { $regex: `${phone}$` } });

        if (!partner) {
            partner = await QCDeliveryPartner.create({
                name: driver.name || driver.fullName || 'Driver',
                phone,
                countryCode: driver.countryCode || '+91',
                email: driver.email || undefined,
                vehicleType: driver.delivery?.vehicleType || '',
                vehicleName: driver.delivery?.vehicleName || driver.vehicleName || '',
                ...(driver.vehicleNumber ? { vehicleNumber: driver.vehicleNumber } : {}),
                status: driver.approve === true ? 'approved' : 'pending',
                driverId: driver._id,
            });
        } else if (!partner.driverId) {
            partner.driverId = driver._id;
            await partner.save();
        }

        const caps = Array.isArray(driver.serviceCapabilities) ? [...driver.serviceCapabilities] : [];
        let changed = false;

        if (!caps.includes('quickCommerce')) {
            caps.push('quickCommerce');
            driver.serviceCapabilities = caps;
            changed = true;
        }
        if (String(driver.legacyQcPartnerId || '') !== String(partner._id)) {
            driver.legacyQcPartnerId = partner._id;
            changed = true;
        }
        if (changed) await driver.save();

        return { granted: true, partnerId: String(partner._id) };
    } catch (err) {
        logger.error(`ensureQuickCommerceCapability failed for driver ${driver?._id}: ${err.message}`);
        return { granted: false, partnerId: null, reason: err.message };
    }
}

/**
 * Every stream, from one registration. What the registration paths call.
 *
 * Each half is independent: if one fails the other still lands, and the driver
 * ends up able to work the streams that did succeed rather than none of them.
 */
export async function ensureAllDriverCapabilities(driver) {
    const delivery = await ensureDeliveryCapability(driver);
    const quickCommerce = await ensureQuickCommerceCapability(driver);
    return { delivery, quickCommerce };
}

/**
 * Keep the delivery half's approval in step when a driver is approved or
 * suspended on the taxi side, so one decision does not leave the person able to
 * take food orders while barred from rides.
 */
export async function syncDeliveryApproval(driver) {
    const status = driver?.approve === true ? 'approved' : 'pending';
    let touched = false;

    if (driver?.legacyDeliveryPartnerId) {
        try {
            const { FoodDeliveryPartner } = await import('../../modules/food/delivery/models/deliveryPartner.model.js');
            await FoodDeliveryPartner.updateOne({ _id: driver.legacyDeliveryPartnerId }, { $set: { status } });
            touched = true;
        } catch (err) {
            logger.error(`syncDeliveryApproval (food) failed for driver ${driver?._id}: ${err.message}`);
        }
    }

    // The quick-commerce half moves with the same decision. Skipping it would
    // leave someone barred from rides and food but still taking grocery orders.
    if (driver?.legacyQcPartnerId) {
        try {
            const { FoodDeliveryPartner: QCDeliveryPartner } = await import(
                '../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js'
            );
            await QCDeliveryPartner.updateOne({ _id: driver.legacyQcPartnerId }, { $set: { status } });
            touched = true;
        } catch (err) {
            logger.error(`syncDeliveryApproval (qc) failed for driver ${driver?._id}: ${err.message}`);
        }
    }

    return touched;
}

// ---------------------------------------------------------------------------
// Admin-controlled capabilities
// ---------------------------------------------------------------------------

/**
 * Which job streams a driver may be offered. The admin decides this at approval
 * and can change it later; the driver's in-app workMode toggle then picks from
 * within it (setWorkMode refuses a mode the driver is not set up for).
 *
 * Registration used to grant all three unconditionally, so every driver could
 * take everything and the admin had no say. Dispatch already enforces the
 * capability in all three matchers -- food, quick-commerce and taxi -- so this
 * is purely about who sets it, not about adding enforcement.
 */
// Ordered widest-first; the order is what two admins ticking the same boxes
// store, so it must stay stable.
export const SERVICE_CAPABILITIES = Object.freeze(['taxi', 'delivery', 'quickCommerce']);

// Capabilities that no longer exist. Dropped quietly rather than refused, so a
// driver who still holds one (parcel delivery was removed) can be re-saved.
const RETIRED_CAPABILITIES = new Set(['parcel']);

export const CAPABILITY_LABELS = Object.freeze({
    delivery: 'Food delivery',
    quickCommerce: 'Quick Commerce',
    taxi: 'Taxi',
});

/**
 * Validate an admin-submitted capability list. Accepts an array or a
 * comma-separated string, dedupes, and rejects unknown values -- a typo must not
 * silently strip a driver of every stream.
 */
export function normalizeCapabilities(input) {
    const raw = Array.isArray(input) ? input : String(input ?? '').split(',');

    const seen = new Set();
    for (const value of raw) {
        const key = String(value ?? '').trim();
        if (!key || RETIRED_CAPABILITIES.has(key.toLowerCase())) continue;
        const match = SERVICE_CAPABILITIES.find((c) => c.toLowerCase() === key.toLowerCase());
        if (!match) {
            const err = new Error(
                'Unknown capability "' + key + '". Choose from: ' + SERVICE_CAPABILITIES.join(', ')
            );
            err.statusCode = 400;
            throw err;
        }
        seen.add(match);
    }

    if (seen.size === 0) {
        const err = new Error('Pick at least one service the driver will take orders for');
        err.statusCode = 400;
        throw err;
    }

    // Stable order, so two admins ticking the same boxes store the same array.
    return SERVICE_CAPABILITIES.filter((c) => seen.has(c));
}

/**
 * Keep workMode valid after the capability set changes.
 *
 * The driver's toggle only makes sense within what they are allowed: a driver
 * left on 'all' with a single capability would be refused that very mode by
 * setWorkMode, and one left on 'taxi' after taxi was revoked would sit online
 * and never be offered anything. Coerce to the nearest legal mode; leave a
 * still-valid choice alone.
 */
export function coerceWorkMode(currentMode, capabilities) {
    const caps = new Set(capabilities);
    const canTaxi = caps.has('taxi');
    const canDeliver = caps.has('delivery') || caps.has('quickCommerce');
    const mode = String(currentMode || 'all');

    if (mode === 'all' && canTaxi && canDeliver) return 'all';
    if (mode === 'taxi' && canTaxi) return 'taxi';
    if ((mode === 'delivery' || mode === 'quickCommerce') && canDeliver) return 'delivery';

    // Current mode is no longer allowed: fall to the widest legal one.
    if (canTaxi && canDeliver) return 'all';
    if (canTaxi) return 'taxi';
    return 'delivery';
}

/**
 * The reverse of ensureDeliveryCapability: given a FoodDeliveryPartner, make sure
 * a unified TaxiDriver exists for the same person and the two are linked.
 *
 * Needed because the food delivery app registers a partner directly and never
 * creates the unified half -- every food-app signup is unlinked. Capabilities
 * live on the unified driver, and every dispatcher's capability filter only
 * applies to LINKED partners (unlinked ones are waved through as "not migrated
 * yet"). So an admin decision about a food-app driver has nowhere to land, and
 * no effect, until this link exists.
 *
 * Field mapping mirrors scripts/migrate-unify-drivers.js so a driver created
 * here is indistinguishable from one the backfill would have produced.
 * Idempotent: matches an existing driver on the last ten digits of the phone.
 */
export async function ensureUnifiedDriverForPartner(partner, { approved } = {}) {
    if (!partner?._id) throw new Error('ensureUnifiedDriverForPartner: partner is required');

    const phone10 = normalizePhone(partner.phone);
    if (!phone10) {
        const err = new Error('Driver has no usable phone number, so a unified driver cannot be created');
        err.statusCode = 400;
        throw err;
    }

    const { Driver } = await import('../../modules/taxi/driver/models/Driver.js');
    const { FoodDeliveryPartner } = await import('../../modules/food/delivery/models/deliveryPartner.model.js');

    const isApproved = approved ?? partner.status === 'approved';

    let driver = partner.driverId ? await Driver.findById(partner.driverId) : null;
    if (!driver) {
        driver = await Driver.findOne({ phone: { $regex: phone10 + '$' } });
    }

    if (!driver) {
        const crypto = await import('crypto');
        driver = await Driver.create({
            name: partner.name || 'Delivery Partner',
            phone: partner.phone,
            // Placeholder: delivery login is OTP-based. select:false on the schema.
            password: crypto.randomBytes(16).toString('hex'),
            vehicleType: partner.vehicleType || 'bike',
            serviceCapabilities: ['delivery'],
            // Schema default; applyPartnerCapabilities coerces this to the widest mode
            // the admin's capabilities allow. A fixed 'delivery' here made a new driver
            // granted taxi+delivery start delivery-only and never be offered rides.
            workMode: 'all',
            status: isApproved ? 'approved' : 'pending',
            approve: isApproved,
            city: partner.city || '',
            profileImage: partner.profilePhoto || '',
            legacyDeliveryPartnerId: partner._id,
            location: partner.lastLocation?.coordinates?.length === 2
                ? { type: 'Point', coordinates: partner.lastLocation.coordinates }
                : { type: 'Point', coordinates: [0, 0] },
            delivery: {
                vehicleType: partner.vehicleType || '',
                vehicleName: partner.vehicleName || '',
                vehicleNumber: partner.vehicleNumber || '',
                codCashLimit: 0,
            },
        });
    } else {
        let changed = false;
        if (String(driver.legacyDeliveryPartnerId || '') !== String(partner._id)) {
            driver.legacyDeliveryPartnerId = partner._id;
            changed = true;
        }
        if (driver.approve !== isApproved) {
            driver.approve = isApproved;
            driver.status = isApproved ? 'approved' : 'pending';
            changed = true;
        }
        if (changed) await driver.save();
    }

    if (String(partner.driverId || '') !== String(driver._id)) {
        await FoodDeliveryPartner.updateOne({ _id: partner._id }, { $set: { driverId: driver._id } });
        partner.driverId = driver._id;
    }

    return driver;
}

/**
 * Copy what the rider chose at sign-up onto the driver record.
 *
 * The app builds its duty toggle from the driver's serviceIntents/driverClass,
 * and dispatch matches on the vehicle's type ('bike'). Approval copied
 * neither, and the new sign-up sends the vehicle as a catalogue id, which landed
 * in vehicleType as an id that matches no vehicle key.
 */
async function carrySignupOntoDriver(partner, driver) {
    if (Array.isArray(partner?.serviceIntents) && partner.serviceIntents.length) {
        driver.serviceIntents = [...partner.serviceIntents];
    }
    if (partner?.driverClass) driver.driverClass = partner.driverClass;

    const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
    const vehicleId = [partner?.vehicleType, driver.vehicleType].find(isId);
    if (!vehicleId) return;
    try {
        const { Vehicle } = await import('../../modules/taxi/admin/models/Vehicle.js');
        const vehicle = await Vehicle.findById(vehicleId).select('icon_types').lean();
        if (!vehicle) return;
        driver.vehicleTypeId = vehicle._id;
        if (vehicle.icon_types) {
            driver.vehicleType = vehicle.icon_types;
            driver.vehicleIconType = vehicle.icon_types;
        }
    } catch {
        // A vehicle lookup must not block an approval.
    }
}

/**
 * Set exactly which streams a partner's driver may work, from the admin panel.
 *
 * Order matters: the quick-commerce pool helper unconditionally ADDS its
 * capability, so it runs first and the admin's exact list is written last --
 * otherwise revoking quick-commerce would be undone a line later. Removing a
 * capability needs no pool cleanup: each dispatcher filters linked partners on
 * the driver's capabilities, so a linked record with the capability gone is
 * simply never offered work.
 */
export async function applyPartnerCapabilities(partner, capabilities, { approved } = {}) {
    const caps = normalizeCapabilities(capabilities);
    const driver = await ensureUnifiedDriverForPartner(partner, { approved });

    if (caps.includes('quickCommerce')) {
        // Puts the driver in the grocery pool (creates + links the QC record).
        await ensureQuickCommerceCapability(driver);
    }

    driver.serviceCapabilities = caps;
    driver.workMode = coerceWorkMode(driver.workMode, caps);
    await carrySignupOntoDriver(partner, driver);
    await driver.save();

    return {
        driverId: String(driver._id),
        serviceCapabilities: [...caps],
        workMode: driver.workMode,
    };
}

/**
 * Capabilities for a batch of partners, for list screens.
 *
 * An unlinked partner reports ['delivery']: with no unified driver it bypasses
 * every capability filter and sits in the food pool only, so that is the honest
 * description of what it can currently be offered.
 */
export async function getCapabilitiesForPartners(partners) {
    const linked = (partners || []).filter((p) => p?.driverId);
    const byDriver = new Map();

    if (linked.length) {
        const { Driver } = await import('../../modules/taxi/driver/models/Driver.js');
        const rows = await Driver.find({ _id: { $in: linked.map((p) => p.driverId) } })
            .select('_id serviceCapabilities workMode')
            .lean();
        for (const d of rows) byDriver.set(String(d._id), d);
    }

    const out = new Map();
    for (const p of partners || []) {
        const d = p?.driverId ? byDriver.get(String(p.driverId)) : null;
        out.set(String(p._id), {
            serviceCapabilities: d?.serviceCapabilities?.length ? [...d.serviceCapabilities] : ['delivery'],
            workMode: d?.workMode || 'delivery',
            linked: Boolean(d),
        });
    }
    return out;
}

export const __testables = { normalizePhone, normalizeCapabilities, coerceWorkMode };
