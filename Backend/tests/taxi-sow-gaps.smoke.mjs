/**
 * The taxi gaps against the SOW (plan §4.1-4.5, §4.13): multiple stops, round
 * trips, tolls, night charges, extra kilometres and scheduled dispatch.
 *
 * Run: node tests/taxi-sow-gaps.smoke.mjs
 *
 * Drives the real quote, booking, lifecycle, settlement and dispatch code on a
 * single-node replica set (settlement runs in a transaction). Measured in a
 * straight line (TAXI_DISTANCE_SOURCE=straight) so the rupee figures do not
 * depend on a Maps key -- see taxi-fare-quote.smoke.mjs for why.
 *
 * SOS and live trip sharing are in taxi-sos-share.smoke.mjs.
 */
process.env.TAXI_DISTANCE_SOURCE = 'straight';
process.env.NODE_ENV = 'development';

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};
const id = () => new mongoose.Types.ObjectId();
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const ist = (hhmm) => new Date(`2026-10-08T${hhmm}:00+05:30`);

const main = async () => {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), { dbName: 'taxi_sow_gaps' });

    const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
    const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
    const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
    const { User } = await import('../src/modules/taxi/user/models/User.js');
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
    const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
    const svc = await import('../src/modules/taxi/services/rideService.js');
    const dispatch = await import('../src/modules/taxi/services/dispatchService.js');
    const extras = await import('../src/modules/taxi/services/rideExtrasService.js');
    const trip = await import('../src/modules/taxi/common/tripExtras.js');
    for (const model of Object.values(mongoose.models)) await model.init().catch(() => {});

    // Every socket emit, so the payloads the apps receive can be read back.
    const emitted = [];
    dispatch.setSocketServer({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });

    const sedan = id();
    await Vehicle.collection.insertOne({ _id: sedan, name: 'Sedan', transport_type: 'taxi', active: true, status: 1, createdAt: new Date() });
    // Rs 70 for 2 km, then Rs 17/km and Rs 2/min; no tax, no fee, so the
    // figures below are plain arithmetic.
    const priceRow = {
        vehicle_type: sedan, transport_type: 'taxi', pricing_scope: 'ride', active: 1, status: 'active',
        zone_id: null, service_location_id: null, service_tax: 0, admin_commision: 0,
        base_price: 70, base_distance: 2, price_per_distance: 17, time_price: 2,
        admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
        round_trip_return_factor: 0.8, round_trip_wait_free_minutes: 60, round_trip_wait_per_hour: 50,
        night_charge: { enabled: true, start: '22:00', end: '06:00', type: 'percentage', value: 20 },
        createdAt: new Date(), updatedAt: new Date(),
    };
    await SetPrice.collection.insertOne(priceRow);

    let phone = 9100000000;
    const makeUser = async () => {
        const _id = id();
        await User.collection.insertOne({ _id, name: 'Rider Kumar', phone: String(phone++), createdAt: new Date() });
        return _id;
    };
    const pickup = [75.8843673, 22.728214];
    const drop = [75.8968202, 22.75521];
    const stop = { lat: 22.741, lng: 75.8851, address: 'Stop A, Palasia' };
    const quote = (body) => svc.quoteRideFares({ pickupCoords: pickup, dropCoords: drop, vehicleTypeIds: [String(sedan)], ...body })
        .then((rows) => rows[0]);
    const book = async (body) => {
        const userId = await makeUser();
        return svc.createRideRecord({ userId, pickupCoords: pickup, dropCoords: drop, fare: 0, vehicleTypeId: String(sedan), paymentMethod: 'cash', ...body });
    };
    const daytime = ist('12:00');

    /* ------------------------------------------------------------ stops -- */
    console.log('\nmultiple stops (4.1)');
    const stopQuote = await quote({ stops: [stop, 'only an address, no coordinate'], scheduledAt: daytime });
    const stopRide = await book({ stops: [stop, 'only an address, no coordinate'], pickupAddress: 'Pickup', dropAddress: 'Drop', scheduledAt: daytime });
    await check('the stop the quote priced is saved on the ride, in order; one with no coordinate is dropped', async () => {
        assert.equal(stopQuote.stopCount, 1);
        assert.equal(stopRide.stops.length, 1);
        const saved = stopRide.stops[0];
        assert.equal(saved.order, 1);
        assert.equal(saved.address, 'Stop A, Palasia');
        assert.equal(saved.lat, stop.lat);
        assert.equal(saved.reachedAt, null);
    });
    await check('the booking charges the quote, stop included', async () => {
        assert.equal(r2(stopRide.fare), r2(stopQuote.fare.total));
    });
    await check('the rider sees the stops (ride:state / GET /rides/:id)', async () => {
        const state = svc.serializeRideRealtime(await svc.getRideDetails(stopRide._id));
        assert.deepEqual(state.stops.map((s) => [s.order, s.address]), [[1, 'Stop A, Palasia']]);
        assert.equal(state.tripType, 'one_way');
    });

    // A driver dispatch can find: online, approved, free, this vehicle, near.
    const driverId = id();
    await Driver.collection.insertOne({
        _id: driverId, name: 'Suresh Yadav', phone: String(phone++), password: 'x', vehicleType: 'sedan',
        vehicleTypeId: sedan, vehicleNumber: 'MP09AB1234', registerFor: 'taxi', approve: true, status: 'approved',
        isOnline: true, isOnRide: false, wallet: { balance: 500 },
        location: { type: 'Point', coordinates: pickup }, createdAt: new Date(),
    });
    await Driver.init();
    emitted.length = 0;
    const offerRide = await book({ stops: [stop] });
    await dispatch.startDispatchFlow(offerRide);
    dispatch.stopDispatchFlow(offerRide._id);
    await check('the driver\'s ride offer carries the stops', async () => {
        const offer = emitted.find((e) => e.event === 'rideRequest' && e.payload.rideId === String(offerRide._id));
        assert.ok(offer, 'no rideRequest was emitted');
        assert.equal(offer.payload.stops.length, 1);
        assert.equal(offer.payload.stops[0].address, 'Stop A, Palasia');
        assert.equal(offer.payload.tripType, 'one_way');
    });

    await Ride.updateOne({ _id: offerRide._id }, { $set: { driverId, status: 'accepted', liveStatus: 'accepted', acceptedAt: new Date() } });
    emitted.length = 0;
    await dispatch.notifyRideAccepted({ _id: offerRide._id });
    await check('the accepted ride state sent to the rider carries the stops', async () => {
        const state = emitted.find((e) => e.event === 'ride:state' && e.payload.rideId === String(offerRide._id));
        assert.ok(state, 'no ride:state emitted');
        assert.equal(state.payload.stops.length, 1);
    });
    await check('the driver\'s active ride carries the stops', async () => {
        const active = await svc.getActiveRideForIdentity({ role: 'driver', entityId: driverId });
        assert.equal(svc.serializeRideRealtime(active).stops[0].order, 1);
    });

    await check('a stop cannot be marked before the trip starts', async () => {
        await assert.rejects(() => extras.markRideStopReached({ rideId: offerRide._id, driverId, order: 1 }), /trip has started/);
    });
    await Ride.updateOne({ _id: offerRide._id }, { $set: { status: 'ongoing', liveStatus: 'started', startedAt: new Date() } });
    const reached = await extras.markRideStopReached({ rideId: offerRide._id, driverId, order: 1 });
    await check('the driver marks the stop reached; again keeps the first time', async () => {
        assert.ok(reached.reachedAt, 'no reachedAt');
        const again = await extras.markRideStopReached({ rideId: offerRide._id, driverId, order: 1 });
        assert.equal(new Date(again.reachedAt).getTime(), new Date(reached.reachedAt).getTime());
        await assert.rejects(() => extras.markRideStopReached({ rideId: offerRide._id, driverId, order: 2 }), /no such stop/);
    });
    await check('another driver cannot mark it', async () => {
        await assert.rejects(() => extras.markRideStopReached({ rideId: offerRide._id, driverId: id(), order: 1 }), /not found/);
    });
    await Ride.updateOne({ _id: offerRide._id }, { $set: { status: 'cancelled', liveStatus: 'cancelled' } });
    await Driver.updateOne({ _id: driverId }, { $set: { isOnline: false } });

    /* ------------------------------------------------------- round trip -- */
    console.log('\nround trip (4.2)');
    const oneWay = await quote({ scheduledAt: daytime });
    const tripFare = oneWay.fare.baseFare + oneWay.fare.distanceFare + oneWay.fare.timeFare;
    // Back three hours after the outbound trip should arrive: 60 min free,
    // then two started hours at Rs 50.
    const returnAt = new Date(daytime.getTime() + (oneWay.measuredDurationMinutes + 180) * 60000);
    const round = await quote({ scheduledAt: daytime, tripType: 'round_trip', returnAt });
    await check('a round trip is the outbound fare + 0.8 x it for the way back + Rs 100 waiting', async () => {
        assert.equal(round.tripType, 'round_trip');
        assert.equal(r2(round.fare.returnTripFare), r2(tripFare * 0.8));
        assert.equal(round.fare.roundTripWaitingCharge, 100);
        assert.equal(round.fare.total, Math.round(tripFare * 1.8 + 100));
    });
    await check('a one-way quote has no return leg', async () => {
        assert.equal(oneWay.fare.returnTripFare, 0);
        assert.equal(oneWay.fare.roundTripWaitingCharge, 0);
        assert.equal(oneWay.tripType, 'one_way');
    });
    const roundRide = await book({ scheduledAt: daytime, tripType: 'round_trip', returnAt });
    await check('the booking charges the round-trip quote and saves trip type and return time', async () => {
        assert.equal(r2(roundRide.fare), r2(round.fare.total));
        assert.equal(roundRide.tripType, 'round_trip');
        assert.equal(new Date(roundRide.returnAt).getTime(), returnAt.getTime());
        assert.equal(r2(roundRide.pricingSnapshot.return_trip_fare), r2(tripFare * 0.8));
        assert.equal(Math.round(roundRide.pricingSnapshot.priced_distance_meters), Math.round(round.measuredDistanceMeters * 2));
    });
    await check('a return before the outbound trip arrives is refused', async () => {
        await assert.rejects(() => quote({ scheduledAt: daytime, tripType: 'round_trip', returnAt: daytime }), /return time must be after/);
    });

    /* ----------------------------------------------------- night charge -- */
    console.log('\nnight charge (4.4)');
    const night = trip.nightChargeSettings(priceRow);
    await check('22:00-06:00 runs past midnight (Asia/Kolkata)', async () => {
        assert.equal(trip.isNightTime(night, ist('23:30')), true);
        assert.equal(trip.isNightTime(night, ist('02:00')), true);
        assert.equal(trip.isNightTime(night, ist('05:59')), true);
        assert.equal(trip.isNightTime(night, ist('06:00')), false);
        assert.equal(trip.isNightTime(night, ist('21:59')), false);
        assert.equal(trip.isNightTime(night, ist('12:00')), false);
    });
    await check('a daytime window does not wrap', async () => {
        const day = trip.nightChargeSettings({ night_charge: { enabled: true, start: '13:00', end: '15:00', type: 'fixed', value: 30 } });
        assert.equal(trip.isNightTime(day, ist('14:00')), true);
        assert.equal(trip.isNightTime(day, ist('23:00')), false);
        assert.equal(trip.computeNightCharge({ pricingRule: { night_charge: { enabled: true, start: '13:00', end: '15:00', type: 'fixed', value: 30 } }, subtotal: 500, at: ist('14:00') }), 30);
    });
    await check('switched off, or never set, it charges nothing', async () => {
        assert.equal(trip.computeNightCharge({ pricingRule: { ...priceRow, night_charge: { ...priceRow.night_charge, enabled: false } }, subtotal: 100, at: ist('23:30') }), 0);
        assert.equal(trip.computeNightCharge({ pricingRule: {}, subtotal: 100, at: ist('23:30') }), 0);
    });
    const nightQuote = await quote({ scheduledAt: ist('23:30') });
    await check('a pickup at 23:30 is quoted 20% more, as its own line', async () => {
        assert.equal(r2(nightQuote.fare.nightCharge), r2(tripFare * 0.2));
        assert.equal(nightQuote.fare.total, Math.round(tripFare * 1.2));
        assert.equal(nightQuote.fare.nightChargeWindow, '22:00-06:00');
    });
    const nightRide = await book({ scheduledAt: ist('23:30') });
    await check('the booking saves the night charge it priced', async () => {
        assert.equal(r2(nightRide.nightChargeAmount), r2(tripFare * 0.2));
        assert.equal(r2(nightRide.pricingSnapshot.night_charge_amount), r2(tripFare * 0.2));
        assert.equal(r2(nightRide.fare), r2(nightQuote.fare.total));
    });

    /* ------------------------------------------------------------ tolls -- */
    console.log('\ntolls (4.3)');
    await AdminBusinessSetting.create({ scope: 'default', transport_ride: { toll_auto_approve_limit: '100' } });
    const makeOnTrip = async ({ snapshot = {}, extra = {} } = {}) => {
        const userId = await makeUser();
        const dId = id();
        await Driver.collection.insertOne({
            _id: dId, name: 'Driver', phone: String(phone++), password: 'x', vehicleType: 'sedan', approve: true,
            isOnline: true, isOnRide: true, wallet: { balance: 0 }, location: { type: 'Point', coordinates: pickup }, createdAt: new Date(),
        });
        const _id = id();
        const now = Date.now();
        await Ride.collection.insertOne({
            _id, userId, driverId: dId, status: 'ongoing', liveStatus: 'started', fare: 118, baseFare: 118,
            paymentMethod: 'cash', serviceType: 'ride', transport_type: 'taxi', tripType: 'one_way',
            pickupLocation: { type: 'Point', coordinates: pickup }, dropLocation: { type: 'Point', coordinates: drop },
            pickupAddress: 'A', dropAddress: 'B', estimatedDistanceMeters: 5000,
            arrivedAt: new Date(now - 10 * 60000), startedAt: new Date(now - 9 * 60000),
            pricingSnapshot: {
                starting_fare: 118, agreed_fare: 118, promo_discount_applied: 0,
                waiting_charge: 0, free_waiting_before: 0, ride_surge_amount: 0,
                admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
                cancellation_fee_goes_to: 'admin', ...snapshot,
            },
            tolls: [], createdAt: new Date(), updatedAt: new Date(), ...extra,
        });
        return { rideId: _id, driverId: dId };
    };
    const receipt = 'https://example.com/receipt.jpg';
    const tollTrip = await makeOnTrip();
    const t1 = await extras.addRideToll({ rideId: tollTrip.rideId, driverId: tollTrip.driverId, amount: 60, receiptPhotoUrl: receipt });
    const t2 = await extras.addRideToll({ rideId: tollTrip.rideId, driverId: tollTrip.driverId, amount: 80, receiptPhotoUrl: receipt });
    const t3 = await extras.addRideToll({ rideId: tollTrip.rideId, driverId: tollTrip.driverId, amount: 50, receiptPhotoUrl: receipt });
    await check('within the Rs 100 per-ride limit a toll is approved on the spot; past it, it waits', async () => {
        assert.equal(t1.toll.status, 'approved');
        assert.equal(t1.toll.autoApproved, true);
        assert.equal(t2.toll.status, 'pending');
        assert.equal(t3.toll.status, 'pending');
    });
    await check('a toll needs its receipt, and a sane amount', async () => {
        await assert.rejects(() => extras.addRideToll({ rideId: tollTrip.rideId, driverId: tollTrip.driverId, amount: 40 }), /receiptPhotoUrl/);
        await assert.rejects(() => extras.addRideToll({ rideId: tollTrip.rideId, driverId: tollTrip.driverId, amount: 0, receiptPhotoUrl: receipt }), /amount/);
    });
    await extras.reviewRideToll({ rideId: tollTrip.rideId, tollId: t2.toll.id, decision: 'approve', adminId: 'admin1' });
    await check('the admin\'s queue lists the toll still pending', async () => {
        const queue = await extras.listRideTollsForReview({ status: 'pending' });
        assert.deepEqual(queue.results.map((row) => row.toll.id), [t3.toll.id]);
        assert.equal(queue.results[0].driver.name, 'Driver');
    });
    await check('a toll cannot be decided twice', async () => {
        await assert.rejects(() => extras.reviewRideToll({ rideId: tollTrip.rideId, tollId: t2.toll.id, decision: 'reject' }), /already been reviewed/);
    });

    // The driver's app sends charges of its own at completion; they are ignored.
    await svc.updateRideLifecycle({ rideId: tollTrip.rideId, driverId: tollTrip.driverId, nextStatus: 'completed', additionalCharge: 500, distanceChargeAmount: 50 });
    const tolled = await Ride.findById(tollTrip.rideId).lean();
    await check('the approved tolls (Rs 60 + Rs 80) are their own line on the fare; the pending one is not', async () => {
        assert.equal(tolled.tollChargeAmount, 140);
        assert.equal(r2(tolled.fare), 118 + 140);
        assert.equal(tolled.distanceChargeAmount, 0);
    });
    await check('no commission is taken on the tolls', async () => {
        assert.equal(r2(tolled.commissionAmount), r2(118 * 0.1));
        assert.equal(r2(tolled.driverEarnings + tolled.commissionAmount), r2(tolled.fare));
    });
    const late = await extras.reviewRideToll({ rideId: tollTrip.rideId, tollId: t3.toll.id, decision: 'approve' });
    await check('a toll approved after the ride was settled is paid to the driver by the platform, once', async () => {
        assert.equal(late.settledToDriver, true);
        const paid = await WalletTransaction.find({ driverId: tollTrip.driverId, 'metadata.referenceKey': `taxi_toll:${tollTrip.rideId}:${t3.toll.id}` }).lean();
        assert.equal(paid.length, 1);
        assert.equal(r2(paid[0].amount), 50);
        const after = await Ride.findById(tollTrip.rideId).lean();
        assert.equal(r2(after.fare), 258, 'the settled fare does not change');
    });

    /* --------------------------------------------------------- extra km -- */
    console.log('\nextra kilometres (4.5)');
    const extraSnapshot = { priced_distance_meters: 5000, price_per_distance: 10, extra_km_enabled: true, extra_km_tolerance_type: 'percent', extra_km_tolerance_value: 10 };
    // A trace of 16 points 600 m apart, 30 s between them: 9 km driven.
    const buildTrace = ({ points = 16, stepMeters = 600, gapSeconds = 30 } = {}) => {
        const start = new Date(Date.now() - points * gapSeconds * 1000);
        let trace = { distanceMeters: 0, points: 0, maxGapSeconds: 0, rejectedJumps: 0, startedAt: start };
        const dLat = stepMeters / 111320;
        for (let i = 0; i < points; i += 1) {
            trace = svc.advanceTripTrace(trace, [pickup[0], pickup[1] + i * dLat], new Date(start.getTime() + i * gapSeconds * 1000));
        }
        return trace;
    };
    const complete = async (ride) => {
        await svc.updateRideLifecycle({ rideId: ride.rideId, driverId: ride.driverId, nextStatus: 'completed' });
        return Ride.findById(ride.rideId).lean();
    };
    const over = await makeOnTrip({ snapshot: extraSnapshot, extra: { tripTrace: buildTrace() } });
    const overDone = await complete(over);
    await check('9 km driven on a 5 km quote, 10% tolerance: 3.5 extra km at Rs 10 = Rs 35, its own line', async () => {
        assert.equal(overDone.extraDistance.traceReliable, true);
        assert.equal(overDone.extraDistance.extraKm, 3.5);
        assert.equal(overDone.distanceChargeAmount, 35);
        assert.equal(r2(overDone.fare), 118 + 35);
    });
    const within = await makeOnTrip({ snapshot: extraSnapshot, extra: { tripTrace: buildTrace({ points: 10, stepMeters: 600 }) } });
    await check('5.4 km on a 5 km quote is within the tolerance: nothing extra', async () => {
        const done = await complete(within);
        assert.equal(done.distanceChargeAmount, 0);
        assert.equal(r2(done.fare), 118);
    });
    const noTrace = await makeOnTrip({ snapshot: extraSnapshot });
    await check('with no trace, nothing extra is charged', async () => {
        const done = await complete(noTrace);
        assert.equal(done.distanceChargeAmount, 0);
        assert.equal(done.extraDistance.traceReliable, false);
    });
    const gappy = await makeOnTrip({ snapshot: extraSnapshot, extra: { tripTrace: buildTrace({ gapSeconds: 600 }) } });
    await check('a trace with ten-minute silences is not trusted: nothing extra', async () => {
        const done = await complete(gappy);
        assert.equal(done.distanceChargeAmount, 0);
    });
    const off = await makeOnTrip({ snapshot: { ...extraSnapshot, extra_km_enabled: false }, extra: { tripTrace: buildTrace() } });
    await check('switched off on the price row at booking: nothing extra', async () => {
        const done = await complete(off);
        assert.equal(done.distanceChargeAmount, 0);
    });
    await check('a jump no vehicle could make is dropped from the trace', async () => {
        let t = buildTrace({ points: 3 });
        const before = t.distanceMeters;
        t = svc.advanceTripTrace(t, [pickup[0] + 0.5, pickup[1]], new Date(new Date(t.lastAt).getTime() + 5000));
        assert.equal(t.distanceMeters, before);
        assert.equal(t.rejectedJumps, 1);
    });
    const live = await makeOnTrip();
    await check('the server traces the ride\'s own location updates while the rider is on board', async () => {
        await Ride.updateOne({ _id: live.rideId }, { $set: { tripTrace: { startedAt: new Date(), distanceMeters: 0, points: 0 } } });
        for (let i = 0; i < 3; i += 1) {
            await svc.updateRideDriverLocation({ rideId: live.rideId, driverId: live.driverId, coordinates: [pickup[0], pickup[1] + i * 0.003] });
        }
        const traced = await Ride.findById(live.rideId).lean();
        assert.equal(traced.tripTrace.points, 3);
        assert.ok(traced.tripTrace.distanceMeters > 600 && traced.tripTrace.distanceMeters < 700, `traced ${traced.tripTrace.distanceMeters}`);
    });

    /* --------------------------------------------------------- live ETA -- */
    console.log('\nlive ETA (4.6)');
    const { computeLiveEta } = await import('../src/modules/taxi/socket/services/liveEtaService.js');
    let lookups = 0;
    const lookup = async () => { lookups += 1; return { minutes: 12, meters: 4000 }; };
    const etaRide = { _id: id(), liveStatus: 'arriving', pickupLocation: { coordinates: pickup }, dropLocation: { coordinates: drop }, stops: [] };
    const driverAt = [pickup[0], pickup[1] - 0.02];
    const now0 = Date.now();
    const firstEta = await computeLiveEta({ ride: etaRide, coordinates: driverAt, now: now0, lookup });
    const cachedEta = await computeLiveEta({ ride: etaRide, coordinates: [pickup[0], pickup[1] - 0.015], now: now0 + 15000, lookup });
    await check('before the trip: the ETA to the pickup, from a road lookup', async () => {
        assert.equal(firstEta.target, 'pickup');
        assert.equal(firstEta.etaMinutes, 12);
        assert.equal(firstEta.source, 'directions');
    });
    await check('between lookups the last one is scaled, not fetched again', async () => {
        assert.equal(lookups, 1);
        assert.equal(cachedEta.source, 'directions_cached');
        assert.equal(cachedEta.etaMinutes, 9); // three quarters of the way left: 12 x 0.75
    });
    await check('on the trip: the ETA to the drop; with no road lookup, an estimate', async () => {
        const onTrip = await computeLiveEta({ ride: { ...etaRide, _id: id(), liveStatus: 'started' }, coordinates: pickup, now: now0, lookup: async () => null });
        assert.equal(onTrip.target, 'drop');
        assert.equal(onTrip.source, 'estimate');
        assert.ok(onTrip.etaMinutes > 0);
    });

    /* ------------------------------------------------ scheduled dispatch -- */
    console.log('\nscheduled dispatch (4.13)');
    const later = await book({ scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60000) });
    const first = await dispatch.scheduleRideDispatch(later, { bufferMs: 15 * 60000 });
    const second = await dispatch.scheduleRideDispatch(later, { bufferMs: 15 * 60000 });
    await check('without BullMQ the round is an in-memory timer, and scheduling twice keeps one', async () => {
        assert.equal(first.via, 'timer');
        assert.equal(second.via, 'timer');
        assert.equal(dispatch.hasScheduledDispatchTimer(later._id), true);
        const saved = await Ride.findById(later._id).lean();
        assert.equal(new Date(saved.scheduledDispatch.runAt).getTime(), new Date(later.scheduledAt).getTime() - 15 * 60000);
    });
    let rounds = 0;
    const standIn = async () => { rounds += 1; };
    const [a, b] = await Promise.all([
        dispatch.fireScheduledDispatch(later._id, { dispatch: standIn }),
        dispatch.fireScheduledDispatch(later._id, { dispatch: standIn }),
    ]);
    await check('fired twice at once (two servers, a retry): one dispatch round', async () => {
        assert.equal(rounds, 1);
        assert.equal([a.fired, b.fired].filter(Boolean).length, 1);
        assert.equal(dispatch.hasScheduledDispatchTimer(later._id), false);
    });
    await check('and never again after that', async () => {
        const c = await dispatch.fireScheduledDispatch(later._id, { dispatch: standIn });
        assert.equal(c.fired, false);
        assert.equal(rounds, 1);
    });
    const waiting = await book({ scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60000) });
    await check('on boot, only rides whose round has not fired are re-armed', async () => {
        // (The other future-scheduled rides booked above are re-armed too.)
        const restored = await dispatch.restoreScheduledDispatches();
        assert.ok(restored >= 1, `restored ${restored}`);
        assert.equal(dispatch.hasScheduledDispatchTimer(waiting._id), true);
        assert.equal(dispatch.hasScheduledDispatchTimer(later._id), false);
    });
    await check('a cancelled ride does not fire', async () => {
        await Ride.updateOne({ _id: waiting._id }, { $set: { status: 'cancelled', liveStatus: 'cancelled' } });
        const result = await dispatch.fireScheduledDispatch(waiting._id, { dispatch: standIn });
        assert.equal(result.fired, false);
        assert.equal(rounds, 1);
    });
    for (const ride of await Ride.find({}).select('_id').lean()) dispatch.stopDispatchFlow(ride._id);

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
