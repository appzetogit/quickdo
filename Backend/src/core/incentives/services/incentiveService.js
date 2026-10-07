import mongoose from 'mongoose';
import { FoodDeliveryPartner } from '../../../modules/food/delivery/models/deliveryPartner.model.js';
import { FoodDeliveryPartner as QCDeliveryPartner } from '../../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js';
import { FoodOrder } from '../../../modules/food/orders/models/order.model.js';
import { FoodOrder as QCOrder } from '../../../modules/quickCommerce/modules/food/orders/models/order.model.js';
import { Driver } from '../../../modules/taxi/driver/models/Driver.js';
import { Ride } from '../../../modules/taxi/user/models/Ride.js';
import { DriverIncentiveRule } from '../models/driverIncentiveRule.model.js';
import { DriverIncentiveCredit } from '../models/driverIncentiveCredit.model.js';
import { DeliveryBonusTransaction } from '../../../modules/food/admin/models/deliveryBonusTransaction.model.js';
import { applyDriverWalletAdjustment } from '../../../modules/taxi/driver/services/walletService.js';
import { notifyOwnerSafely } from '../../notifications/firebase.service.js';
import { logger } from '../../../utils/logger.js';

// Same convention as driverTodaySummaryService.js's toIstDayKey — this
// product is India-only, and a rider's "today" is their IST calendar day
// regardless of which timezone the server process happens to run in.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDayBounds(at = new Date()) {
    const ist = new Date(at.getTime() + IST_OFFSET_MS);
    const y = ist.getUTCFullYear();
    const m = ist.getUTCMonth();
    const d = ist.getUTCDate();
    const startUtcMs = Date.UTC(y, m, d, 0, 0, 0, 0) - IST_OFFSET_MS;
    const endUtcMs = Date.UTC(y, m, d, 23, 59, 59, 999) - IST_OFFSET_MS;
    return {
        start: new Date(startUtcMs),
        end: new Date(endUtcMs),
        periodKey: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    };
}

/**
 * Monday 00:00 IST through Sunday 23:59:59.999 IST, the week containing
 * `at` — for a weekly ladder (e.g. a taxi vehicle-type incentive counted
 * per week rather than per day). periodKey is the Monday's date, prefixed
 * so it can never collide with a daily key.
 */
function istWeekBounds(at = new Date()) {
    const ist = new Date(at.getTime() + IST_OFFSET_MS);
    const dow = ist.getUTCDay(); // 0 = Sunday .. 6 = Saturday
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    const y = ist.getUTCFullYear();
    const m = ist.getUTCMonth();
    const d = ist.getUTCDate() - mondayOffset;
    const startUtcMs = Date.UTC(y, m, d, 0, 0, 0, 0) - IST_OFFSET_MS;
    const endUtcMs = startUtcMs + 7 * 24 * 60 * 60 * 1000 - 1;
    const mondayIst = new Date(startUtcMs + IST_OFFSET_MS);
    const periodKey =
        `W${mondayIst.getUTCFullYear()}-${String(mondayIst.getUTCMonth() + 1).padStart(2, '0')}` +
        `-${String(mondayIst.getUTCDate()).padStart(2, '0')}`;
    return { start: new Date(startUtcMs), end: new Date(endUtcMs), periodKey };
}

/** Which window a rule counts in — daily unless it says otherwise. */
function windowBoundsFor(rule, at = new Date()) {
    return rule?.windowType === 'weekly' ? istWeekBounds(at) : istDayBounds(at);
}

/**
 * Resolves the caller's unified identity from any one of its three possible
 * starting points, so a food order, a QC order and a ride all agree on the
 * same rider for progress-counting and credit idempotency.
 *
 * `driverKey` is what DriverIncentiveCredit dedupes on. A linked (unified)
 * rider always resolves to the SAME driverKey regardless of which vertical's
 * completion event triggered the call — that's the whole point of following
 * the link — while an unlinked rider only ever has one identity to begin
 * with, so their own id is stable on its own.
 */
async function resolveDriverContext({ startFrom, id }) {
    let foodPartnerId = null;
    let qcPartnerId = null;
    let driver = null;

    if (startFrom === 'taxiDriver') {
        driver = await Driver.findById(id)
            .select('workMode legacyDeliveryPartnerId legacyQcPartnerId')
            .lean();
        if (!driver) return null;
        foodPartnerId = driver.legacyDeliveryPartnerId || null;
        qcPartnerId = driver.legacyQcPartnerId || null;
        // Older links point only the other way (partner.driverId). A ride
        // starts here and must still find the Food account, so the card nudge
        // reaches the delivery app.
        if (!foodPartnerId) {
            const linked = await FoodDeliveryPartner.findOne({ driverId: driver._id }).select('_id').lean();
            foodPartnerId = linked?._id || null;
        }
    } else {
        const PartnerModel = startFrom === 'qcPartner' ? QCDeliveryPartner : FoodDeliveryPartner;
        const partner = await PartnerModel.findById(id).select('driverId').lean();
        if (!partner) return null;
        if (startFrom === 'qcPartner') qcPartnerId = partner._id;
        else foodPartnerId = partner._id;

        if (partner.driverId) {
            driver = await Driver.findById(partner.driverId)
                .select('workMode legacyDeliveryPartnerId legacyQcPartnerId')
                .lean();
            if (driver) {
                foodPartnerId = foodPartnerId || driver.legacyDeliveryPartnerId || null;
                qcPartnerId = qcPartnerId || driver.legacyQcPartnerId || null;
            }
        }
    }

    // The Quick & Medical rider record a Food rider delivers those orders as
    // (core/delivery/qcRiderLink): without it, Medical deliveries made through
    // the Food app never counted towards the day's ladder.
    // ...and the other way round: a Medical order completed as the Quick rider
    // still credits the Food account the delivery app shows.
    if (qcPartnerId && !foodPartnerId) {
        try {
            const { foodRiderIdForQcRider } = await import('../../delivery/qcRiderLink.js');
            foodPartnerId = (await foodRiderIdForQcRider(qcPartnerId)) || null;
        } catch {
            /* no Food account */
        }
    }
    if (foodPartnerId && !qcPartnerId) {
        try {
            const { qcRiderIdForFoodRider } = await import('../../delivery/qcRiderLink.js');
            qcPartnerId = (await qcRiderIdForFoodRider(foodPartnerId)) || null;
        } catch {
            /* count Food orders only */
        }
    }

    const taxiDriverId = driver?._id || null;
    const driverKey = taxiDriverId
        ? `driver:${taxiDriverId}`
        : foodPartnerId
            ? `foodPartner:${foodPartnerId}`
            : `qcPartner:${qcPartnerId}`;

    return {
        driverKey,
        foodPartnerId,
        qcPartnerId,
        taxiDriverId,
        // Only meaningful when a unified driver was actually found — the
        // read path uses it to guess which segment to show before the rider
        // has completed anything today. See getCurrentIncentiveForFoodPartner.
        workMode: driver?.workMode || null,
    };
}

const asId = (v) => (v && mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

/** A ladder with run dates applies only between them (null = open on that side). */
const runningNow = (now = new Date()) => ({
    $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
});

/** A ladder's day or week, cut to its run dates. */
function boundsWithin(rule, at = new Date()) {
    const b = windowBoundsFor(rule, at);
    const starts = rule?.startsAt ? new Date(rule.startsAt) : null;
    const ends = rule?.endsAt ? new Date(rule.endsAt) : null;
    return {
        ...b,
        start: starts && starts > b.start ? starts : b.start,
        end: ends && ends < b.end ? ends : b.end,
    };
}

/** Every distinct non-null value a segment's rules use for one axis. */
async function ownValuesOf(segment, field, windowType = 'daily') {
    return DriverIncentiveRule.distinct(field, { segment, windowType, isActive: true, [field]: { $ne: null }, ...runningNow() });
}

/**
 * Which ladder an order or ride in `zoneId` (and, for taxiAndPorter,
 * `vehicleTypeId`) climbs, and which of the rider's trips count toward it.
 *
 * Two independent axes, most-specific-wins — same idea as CSS specificity:
 * a ladder naming both zone and vehicle type beats one naming only zone or
 * only vehicle type, which both beat the fully-default ladder. foodAndQuick
 * never sets vehicleTypeId, so for it this collapses to the original
 * zone-only behaviour (candidates 1 and 3 can never match, since `v` is
 * always null).
 *
 * Whichever axis the winning rule left null falls back to "every trip not
 * already claimed by a MORE specific rule on that axis" — so no trip counts
 * toward two ladders, and none is silently uncounted.
 *
 * Daily and weekly are independent ladders, not alternatives (see
 * upsertIncentiveRuleController), so `windowType` narrows which one this
 * call is about -- callers wanting both call this twice.
 *
 * @returns {Promise<{rule: object|null, scope: object}>}
 */
async function ladderFor(segment, zoneId = null, vehicleTypeId = null, windowType = 'daily') {
    const z = asId(zoneId);
    const v = asId(vehicleTypeId);
    const candidates = [
        z && v ? { zoneId: z, vehicleTypeId: v } : null,
        z ? { zoneId: z, vehicleTypeId: null } : null,
        v ? { zoneId: null, vehicleTypeId: v } : null,
        { zoneId: null, vehicleTypeId: null },
    ].filter(Boolean);

    for (const match of candidates) {
        // eslint-disable-next-line no-await-in-loop
        // A running limited-time ladder beats the permanent one it sits on.
        const live = await DriverIncentiveRule.find({ segment, windowType, isActive: true, ...match, ...runningNow() })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();
        const rule = live.find((r) => r.startsAt || r.endsAt) || live[0] || null;
        if (!rule) continue;
        return {
            rule,
            scope: {
                onlyZone: match.zoneId || undefined,
                excludeZones: match.zoneId ? undefined : await ownValuesOf(segment, 'zoneId', windowType),
                onlyVehicleType: match.vehicleTypeId || undefined,
                excludeVehicleTypes: match.vehicleTypeId
                    ? undefined
                    : await ownValuesOf(segment, 'vehicleTypeId', windowType),
            },
        };
    }
    return { rule: null, scope: {} };
}

/** Mongo filter narrowing a food/quick order count to the ladder's zones. */
function orderZoneFilter(scope = {}) {
    if (scope.onlyZone) return { zoneId: scope.onlyZone };
    if (scope.excludeZones?.length) return { zoneId: { $nin: scope.excludeZones } };
    return {};
}

/** Rides only: narrows a ride count to the ladder's vehicle type, if any. */
function rideVehicleTypeFilter(scope = {}) {
    if (scope.onlyVehicleType) return { vehicleTypeId: scope.onlyVehicleType };
    if (scope.excludeVehicleTypes?.length) return { vehicleTypeId: { $nin: scope.excludeVehicleTypes } };
    return {};
}

/** The same for rides: taxi rides store no zone, so their pickup is tested against it. */
async function rideZoneFilter(scope = {}) {
    const ids = scope.onlyZone ? [scope.onlyZone] : scope.excludeZones || [];
    if (!ids.length) return {};
    const { Zone } = await import('../../../modules/taxi/driver/models/Zone.js');
    const zones = await Zone.find({ _id: { $in: ids } }).select('geometry').lean();
    const within = zones
        .filter((z) => z?.geometry?.coordinates?.length)
        .map((z) => ({ pickupLocation: { $geoWithin: { $geometry: z.geometry } } }));
    // A zone ladder whose zone has no shape matches nothing.
    if (scope.onlyZone) return within.length ? within[0] : { _id: null };
    return within.length ? { $nor: within } : {};
}

/**
 * Rule's tiers, ascending by the order count that unlocks them. A rule saved
 * before tiers existed (one targetOrders/rewardAmount, no `tiers`) reads as a
 * one-rung ladder keyed by the rule's own id, so it keeps paying riders.
 */
export function tiersOfRule(rule) {
    if (Array.isArray(rule?.tiers) && rule.tiers.length) return rule.tiers;
    if (Number(rule?.targetOrders) > 0) {
        return [{ _id: rule._id, fromOrders: 1, toOrders: Number(rule.targetOrders), rewardAmount: Number(rule.rewardAmount) || 0 }];
    }
    return [];
}

/*
 * Every completed ride climbs the taxiAndPorter ladder, shown as "Taxi".
 * (Parcel delivery, and with it the bike-parcel and heavyParcel ladders, was
 * removed; old 'parcel' rides still count as rides.)
 */
const RIDE_SEGMENTS = new Set(['taxiAndPorter']);

function sortedTiersOf(rule) {
    return [...tiersOfRule(rule)].sort((a, b) => a.toOrders - b.toOrders);
}

async function countCompletedToday(ctx, segment, { start, end }, scope = {}) {
    if (RIDE_SEGMENTS.has(segment)) {
        if (!ctx.taxiDriverId) return 0;
        return Ride.countDocuments({
            $and: [
                {
                    driverId: ctx.taxiDriverId,
                    liveStatus: 'completed',
                    completedAt: { $gte: start, $lte: end },
                    ...rideVehicleTypeFilter(scope),
                },
                await rideZoneFilter(scope),
            ],
        });
    }

    const zone = orderZoneFilter(scope);
    let total = 0;
    if (ctx.foodPartnerId) {
        total += await FoodOrder.countDocuments({
            'dispatch.deliveryPartnerId': ctx.foodPartnerId,
            orderStatus: 'delivered',
            'deliveryState.deliveredAt': { $gte: start, $lte: end },
            ...zone,
        });
    }
    if (ctx.qcPartnerId) {
        total += await QCOrder.countDocuments({
            'dispatch.deliveryPartnerId': ctx.qcPartnerId,
            orderStatus: 'delivered',
            'deliveryState.deliveredAt': { $gte: start, $lte: end },
            ...zone,
        });
    }
    return total;
}

/**
 * Pays one tier's reward through whichever wallet this rider actually has.
 *
 * A linked (unified) rider is paid through the taxi driver wallet —
 * applyDriverWalletAdjustment — because that is the balance getRiderFinance
 * folds everything into for a unified person. An unlinked, food/QC-only
 * partner has no taxi driver record to credit, so they're paid through a
 * DeliveryBonusTransaction row instead, same as an admin-granted bonus.
 */
async function payTierReward({ ctx, rule, tier, completedOrders, periodKey }) {
    const description =
        `${rule.title || 'Daily incentive'} — tier ${tier.fromOrders}-${tier.toOrders} ` +
        `(${completedOrders} completed today)`;
    const metadata = {
        category: 'daily_order_incentive',
        ruleId: String(rule._id),
        tierId: String(tier._id),
        segment: rule.segment,
        periodKey,
    };

    // Food & Quick rewards go to the delivery wallet -- the balance the delivery
    // app shows and pays out from. They used to go to the taxi driver wallet
    // for a linked rider, which the delivery app never reads, so the reward
    // was earned but never seen. Taxi rewards stay in the taxi wallet.
    const deliveryPartnerId = rule.segment === 'foodAndQuick'
        ? (ctx.foodPartnerId || ctx.qcPartnerId)
        : null;
    if (ctx.taxiDriverId && !deliveryPartnerId) {
        await applyDriverWalletAdjustment({
            driverId: ctx.taxiDriverId,
            amount: tier.rewardAmount,
            type: 'adjustment',
            description,
            metadata,
        });
        return 'taxi_driver_wallet';
    }

    const partnerId = deliveryPartnerId || ctx.foodPartnerId || ctx.qcPartnerId;
    if (!partnerId) throw new Error('No wallet to credit — rider resolved to neither a driver nor a delivery partner');

    // Unique per (day, tier, partner) — via the schema's unique index, a
    // second idempotency guard alongside DriverIncentiveCredit's own one.
    const transactionId =
        `INC-${periodKey.replace(/-/g, '')}-${String(tier._id).slice(-6)}-${String(partnerId).slice(-6)}`;
    await DeliveryBonusTransaction.create({
        deliveryPartnerId: partnerId,
        transactionId,
        amount: tier.rewardAmount,
        reference: description,
    });
    return 'delivery_bonus_transaction';
}

/**
 * Recomputes today's progress and pays every tier the rider has newly
 * reached and hasn't already been credited for today.
 *
 * A rule is a ladder (1-5 → ₹100, 5-10 → ₹150, 10-15 → ₹200, ...), so more
 * than one rung can be due in a single call — a bulk backfill, or a tier
 * whose threshold was low enough that yesterday's last order and today's
 * first already cleared it. Each tier is credited independently and
 * idempotently; a tier already paid today is simply skipped.
 *
 * Called from every order/ride completion path. Never throws — a failure
 * here must not fail the delivery or ride the rider just completed; callers
 * fire this with `.catch(logger.warn)`, matching the cashback/referral hooks
 * it sits alongside.
 *
 * Daily and weekly are independent ladders (see upsertIncentiveRuleController),
 * so both are checked and credited on every completion — a rider can be on
 * both at once, e.g. a per-day ladder and a per-week bonus for the same
 * vehicle type.
 */
async function maybeCreditIncentive({ startFrom, id, segment, zoneId = null, vehicleTypeId = null }) {
    try {
        const ctx = await resolveDriverContext({ startFrom, id });
        if (!ctx) return;

        for (const windowType of ['daily', 'weekly']) {
            // eslint-disable-next-line no-await-in-loop
            await creditWindow({ ctx, segment, zoneId, vehicleTypeId, windowType });
        }
    } catch (err) {
        logger.warn(`incentive progress hook failed: ${err?.message || err}`);
    }
}

/** One window's (daily or weekly) worth of maybeCreditIncentive's work. */
async function creditWindow({ ctx, segment, zoneId, vehicleTypeId, windowType }) {
    try {
        // The most specific ladder for this zone/vehicle type, else the default.
        const { rule, scope } = await ladderFor(segment, zoneId, vehicleTypeId, windowType);
        const tiers = sortedTiersOf(rule);
        if (tiers.length === 0) return;

        const { start, end, periodKey } = boundsWithin(rule);
        const completedOrders = await countCompletedToday(ctx, segment, { start, end }, scope);

        const dueTiers = tiers.filter((t) => completedOrders >= t.toOrders);
        if (dueTiers.length === 0) return;

        for (const tier of dueTiers) {
            let creditRow;
            try {
                creditRow = await DriverIncentiveCredit.create({
                    driverKey: ctx.driverKey,
                    ruleId: rule._id,
                    tierId: tier._id,
                    segment,
                    periodKey,
                    completedOrders,
                    rewardAmount: tier.rewardAmount,
                    creditedVia: ctx.taxiDriverId && segment !== 'foodAndQuick' ? 'taxi_driver_wallet' : 'delivery_bonus_transaction',
                });
            } catch (err) {
                if (err?.code === 11000) continue; // this tier was already credited today
                throw err;
            }

            const creditedVia = await payTierReward({ ctx, rule, tier, completedOrders, periodKey });
            if (creditedVia !== creditRow.creditedVia) {
                await DriverIncentiveCredit.updateOne({ _id: creditRow._id }, { $set: { creditedVia } });
            }

            // notifyOwnerSafely's DELIVERY_PARTNER type only resolves against the
            // food-vertical partner collection, not the QC one — so a QC-only,
            // unlinked rider (ctx.foodPartnerId null) quietly gets no push here.
            // The wallet credit above is unaffected either way.
            if (ctx.foodPartnerId) {
                notifyOwnerSafely(
                    { ownerType: 'DELIVERY_PARTNER', ownerId: ctx.foodPartnerId },
                    {
                        title: 'Incentive unlocked! 🎉',
                        body: `You completed ${tier.toOrders} orders today and earned ₹${tier.rewardAmount}.`,
                        data: {
                            type: 'incentive_credited',
                            ruleId: String(rule._id),
                            tierId: String(tier._id),
                            amount: String(tier.rewardAmount),
                        },
                    },
                ).catch(() => {});
            }
        }
    } catch (err) {
        logger.warn(`incentive progress hook failed: ${err?.message || err}`);
    }
}

/** Called after a food or quick-commerce order is marked delivered. */
export function onFoodOrQuickCommerceOrderCompleted({ deliveryPartnerId, vertical, zoneId = null }) {
    return maybeCreditIncentive({
        startFrom: vertical === 'quickCommerce' ? 'qcPartner' : 'foodPartner',
        id: deliveryPartnerId,
        segment: 'foodAndQuick',
        zoneId,
    });
}

/**
 * Called after a taxi ride is completed. It climbs the taxiAndPorter ladder
 * for the ride's zone and vehicle type.
 */
export async function onTaxiRideCompleted({ driverId, ride = null }) {
    const { taxiZoneIdOfRide } = await import('../../zones/taxiZone.js');
    const zoneId = ride ? await taxiZoneIdOfRide(ride) : null;
    const vehicleTypeId = ride?.vehicleTypeId || null;
    await maybeCreditIncentive({
        startFrom: 'taxiDriver',
        id: driverId,
        segment: 'taxiAndPorter',
        zoneId,
        vehicleTypeId,
    });
    await nudgeIncentiveCard(driverId);
}

/**
 * Tell the delivery app to redraw its incentive card now.
 *
 * The app refetches the card when a FOOD order finishes, but not when a
 * ride does, so the bar waited for its 60-second poll. It already
 * refetches on an `incentive_credited` push; one with no tier or amount is
 * silent (data-only, nothing announced, no notification shown).
 */
async function nudgeIncentiveCard(driverId) {
    try {
        const ctx = await resolveDriverContext({ startFrom: 'taxiDriver', id: driverId });
        if (!ctx?.foodPartnerId) return;
        const { sendNotificationToOwners } = await import('../../notifications/firebase.service.js');
        await sendNotificationToOwners(
            [{ ownerType: 'DELIVERY_PARTNER', ownerId: ctx.foodPartnerId }],
            { dataOnly: true, skipHighlighter: true, title: '', body: '', data: { type: 'incentive_credited', reason: 'progress' } },
        );
    } catch (err) {
        logger.warn(`incentive: card nudge failed: ${err?.message || err}`);
    }
}

/**
 * The zone the rider is working in now, for the home-screen card: the zone of
 * their latest trip. Null when they have none, which shows the default ladder.
 */
async function currentZoneOf(ctx, segment) {
    if (RIDE_SEGMENTS.has(segment)) {
        if (!ctx.taxiDriverId) return null;
        const last = await Ride.findOne({ driverId: ctx.taxiDriverId }).sort({ createdAt: -1 }).select('pickupLocation').lean();
        if (!last) return null;
        const { taxiZoneIdOfRide } = await import('../../zones/taxiZone.js');
        return taxiZoneIdOfRide(last);
    }
    const latest = await Promise.all([
        ctx.foodPartnerId
            ? FoodOrder.findOne({ 'dispatch.deliveryPartnerId': ctx.foodPartnerId }).sort({ updatedAt: -1 }).select('zoneId updatedAt').lean()
            : null,
        ctx.qcPartnerId
            ? QCOrder.findOne({ 'dispatch.deliveryPartnerId': ctx.qcPartnerId }).sort({ updatedAt: -1 }).select('zoneId updatedAt').lean()
            : null,
    ]);
    const newest = latest.filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    return newest?.zoneId || null;
}

/**
 * The vehicle type the rider is driving now, for a taxiAndPorter ladder —
 * the driver's own current vehicle type, since (unlike zone) that doesn't
 * change ride to ride. Null when unset, which shows the vehicle-type-wide
 * (or fully default) ladder.
 */
async function currentVehicleTypeOf(ctx) {
    if (!ctx.taxiDriverId) return null;
    const driver = await Driver.findById(ctx.taxiDriverId).select('vehicleTypeId').lean();
    return driver?.vehicleTypeId || null;
}

/**
 * The rider-facing read path: what to show on the home-screen card right
 * now, for whichever segment this rider is currently working. Shared by both
 * entry points below — [getCurrentIncentiveForFoodPartner] and
 * [getCurrentIncentiveForDriver] only differ in how `ctx` was resolved.
 *
 * Segment guess for a linked rider: the server has no separate "quick
 * commerce toggle" signal today (see DutySegment.resolve in the Flutter app
 * for the fuller client-side rule this approximates), so a 'taxi' or 'all'
 * workMode is treated as the taxi segment and anything else as food/QC —
 * the same fallback the client itself uses. A rider resolved straight from a
 * taxi driver id has no other option to guess between, so is always taxi.
 *
 * Daily and weekly ladders exist independently (see maybeCreditIncentive),
 * but the card shows one at a time: the daily one when there is a live
 * daily ladder, else the weekly one. A rider on both still gets both
 * credited — this only decides which progress the card leads with.
 */
async function buildCurrentIncentive(ctx, { forceSegment } = {}) {
    if (!ctx) return null;

    const segment =
        forceSegment || (ctx.workMode === 'taxi' || ctx.workMode === 'all' ? 'taxiAndPorter' : 'foodAndQuick');
    const vehicleTypeId = RIDE_SEGMENTS.has(segment) ? await currentVehicleTypeOf(ctx) : null;
    const zoneId = await currentZoneOf(ctx, segment);
    let { rule, scope } = await ladderFor(segment, zoneId, vehicleTypeId, 'daily');
    if (!rule) ({ rule, scope } = await ladderFor(segment, zoneId, vehicleTypeId, 'weekly'));
    const tiers = sortedTiersOf(rule);
    if (tiers.length === 0) return null;

    const { start, end, periodKey } = boundsWithin(rule);
    const completedOrders = await countCompletedToday(ctx, segment, { start, end }, scope);

    const creditedRows = await DriverIncentiveCredit.find({ driverKey: ctx.driverKey, ruleId: rule._id, periodKey })
        .select('tierId')
        .lean();
    const creditedTierIds = new Set(creditedRows.map((r) => String(r.tierId)));

    const finalTier = tiers[tiers.length - 1];
    const totalRewardAmount = tiers.reduce((sum, t) => sum + t.rewardAmount, 0);

    return {
        id: String(rule._id),
        // Which ladder this is, so the app can word the card (orders / rides / jobs).
        segment,
        title: rule.title || `Complete ${finalTier.toOrders} orders, get ₹${totalRewardAmount}`,
        tiers: tiers.map((t) => ({
            id: String(t._id),
            fromOrders: t.fromOrders,
            toOrders: t.toOrders,
            rewardAmount: t.rewardAmount,
            achieved: completedOrders >= t.toOrders,
            credited: creditedTierIds.has(String(t._id)),
        })),
        completedOrders,
        // Convenience fields for a simple display: the ladder's last rung and
        // what every rung together pays out.
        targetOrders: finalTier.toOrders,
        totalRewardAmount,
        expiresAt: end.toISOString(),
    };
}

/**
 * Entry point for a food/QC delivery partner opening their home screen.
 * Always the foodAndQuick segment: the endpoint itself already says which
 * card is being asked for, so this must not re-guess from the driver's
 * CURRENT workMode the way buildCurrentIncentive's fallback does.
 *
 * Without forceSegment here, a driver approved for both food and taxi who
 * flips Food -> Taxi -> Food back saw their food ladder vanish: if this
 * request lands before the driver document's workMode has actually settled
 * back to a non-taxi value (or while it briefly reads 'all'), the fallback
 * at line ~484 resolves to 'taxiAndPorter' instead, computes a taxi ladder
 * for a request that has nothing to do with taxi, and returns null the
 * moment that ladder has no active rule in scope -- even though a perfectly
 * valid food ladder exists.
 */
export async function getCurrentIncentiveForFoodPartner(foodPartnerId) {
    const ctx = await resolveDriverContext({ startFrom: 'foodPartner', id: foodPartnerId });
    return buildCurrentIncentive(ctx, { forceSegment: 'foodAndQuick' });
}

/**
 * Entry point for a taxi driver opening their home screen — including a
 * driver with no linked food/QC partner at all, who [getCurrentIncentiveForFoodPartner]
 * has no id to start from for. Always the taxiAndPorter segment: there is no
 * workMode to guess from when the caller is already known to be a taxi driver.
 */
export async function getCurrentIncentiveForDriver(taxiDriverId) {
    const ctx = await resolveDriverContext({ startFrom: 'taxiDriver', id: taxiDriverId });
    return buildCurrentIncentive(ctx, { forceSegment: await ladderSegmentForDriver(taxiDriverId) });
}

/**
 * Which ladder a driver's card shows, from what they were approved for.
 *   - passengers: the taxi ladder;
 *   - deliveries: the food ladder.
 */
export async function ladderSegmentForDriver(taxiDriverId) {
    const driver = await Driver.findById(taxiDriverId).select('serviceCapabilities').lean().catch(() => null);
    const caps = new Set(Array.isArray(driver?.serviceCapabilities) ? driver.serviceCapabilities : []);
    if (caps.has('taxi')) return 'taxiAndPorter';
    if (caps.has('delivery') || caps.has('quickCommerce')) return 'foodAndQuick';
    return 'taxiAndPorter';
}

export const __testables = {
    istDayBounds,
    istWeekBounds,
    resolveDriverContext,
    sortedTiersOf,
    ladderFor,
    countCompletedToday,
};
