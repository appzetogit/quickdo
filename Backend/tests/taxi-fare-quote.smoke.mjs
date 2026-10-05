/**
 * A ride is charged from its vehicle's price and the server's own measurement
 * of the trip -- never from a fare or a distance the app sent -- and the quote
 * the app shows is that same figure.
 *
 * Run: node tests/taxi-fare-quote.smoke.mjs
 *
 * From production, 8-10 Sep: a second "Bike" was added with no price row. The
 * app, finding none, priced it at the first row it had -- the Sedan's -- and the
 * server, finding none either, charged whatever the app sent. A 3.3 km bike
 * ride was billed Rs 113; as a bike it is Rs 45. The distance was the app's to
 * report as well, so an app claiming 0 km paid the base fare for any trip.
 *
 * Drives the real rideService against an in-memory Mongo.
 *
 * Measured in a STRAIGHT LINE here, on purpose. Production prices on road
 * distance (common/tripMeasure.js, TAXI_DISTANCE_SOURCE defaults to 'road'),
 * and with no Maps key -- as in a test -- the road measure falls back to the
 * straight line x 1.4. The rupee figures below were written for the straight
 * line and this file checks that the SERVER measures the trip rather than the
 * app, which holds either way. Pinning it keeps those figures exact instead of
 * depending on whether a Maps key happens to be set. When this ran in road
 * mode it quoted Rs 59 and Rs 149, which read like a pricing bug and was not
 * one.
 */
process.env.TAXI_DISTANCE_SOURCE = 'straight';

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'taxi_fare' });

    const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
    const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
    const { User } = await import('../src/modules/taxi/user/models/User.js');
    const svc = await import('../src/modules/taxi/services/rideService.js');

    const id = () => new mongoose.Types.ObjectId();
    const oldBike = id(), sedan = id(), newBike = id(), scooter = id();
    const vehicle = (_id, name, createdAt) => ({ _id, name, createdAt: new Date(createdAt), active: true, status: 1, transport_type: 'taxi' });
    await Vehicle.collection.insertMany([
        vehicle(oldBike, 'Bike', '2026-08-26'),
        vehicle(sedan, 'Sedan', '2026-08-26'),
        vehicle(newBike, 'Bike', '2026-09-05'),   // never given a price
        vehicle(scooter, 'Scooter', '2026-09-06'), // never given a price, no namesake
    ]);

    const serviceLocation = id();
    const row = (vehicleType, prices) => ({
        vehicle_type: vehicleType, transport_type: 'taxi', pricing_scope: 'ride', active: 1, status: 'active',
        zone_id: null, service_location_id: serviceLocation, service_tax: 5,
        createdAt: new Date(), updatedAt: new Date(), ...prices,
    });
    // The production Bike and Sedan rows.
    await SetPrice.collection.insertMany([
        row(oldBike, { base_price: 20, base_distance: 2, price_per_distance: 8, time_price: 1, admin_commision: 5, admin_commision_type: 0 }),
        row(sedan, { base_price: 70, base_distance: 2, price_per_distance: 17, time_price: 2, admin_commision: 5, admin_commision_type: 1 }),
    ]);

    // Ride 8a4a1c from production: the 3.27 km bike trip billed Rs 113.
    const pickup = [75.8843673, 22.728214];
    const drop = [75.8968202, 22.75521];

    console.log('\nwhich price a vehicle is charged from');
    await check('a vehicle with no price borrows its older namesake\'s', async () => {
        const rule = await svc.resolveSetPriceForRide({ transportType: 'taxi', vehicleTypeId: newBike });
        assert.ok(rule, 'no rule found');
        assert.equal(String(rule.vehicle_type), String(oldBike));
        assert.equal(String(rule.borrowedFromVehicleTypeId), String(oldBike));
    });
    await check('a vehicle with its own price keeps it', async () => {
        const rule = await svc.resolveSetPriceForRide({ transportType: 'taxi', vehicleTypeId: sedan });
        assert.equal(String(rule.vehicle_type), String(sedan));
        assert.equal(rule.borrowedFromVehicleTypeId, undefined);
    });
    await check('a vehicle with no price and no namesake has none', async () => {
        assert.equal(await svc.resolveSetPriceForRide({ transportType: 'taxi', vehicleTypeId: scooter }), null);
    });

    console.log('\nthe quote the booking screen shows');
    const quote = (extra = {}) => svc.quoteRideFares({
        pickupCoords: pickup, dropCoords: drop, vehicleTypeIds: [newBike, sedan, scooter], transport_type: 'taxi', ...extra,
    });
    const quotes = await quote();
    const quoteFor = (list, v) => list.find((q) => q.vehicleTypeId === String(v));
    await check('THE BUG: the new Bike is quoted at bike rates, Rs 45 -- not Sedan\'s Rs 113', async () => {
        assert.equal(quoteFor(quotes, newBike).fare.total, 45);
    });
    await check('the Sedan is quoted at its own rates', async () => {
        assert.equal(quoteFor(quotes, sedan).fare.total, 118);
    });
    await check('a vehicle that cannot be priced is quoted as unavailable', async () => {
        assert.equal(quoteFor(quotes, scooter).available, false);
        assert.equal(quoteFor(quotes, scooter).fare, null);
    });
    await check('the quote\'s rows add up to its total', async () => {
        const f = quoteFor(quotes, newBike).fare;
        const rows = f.baseFare + f.distanceFare + f.timeFare + f.serviceTax + f.platformFee + f.roundOff + f.surge;
        assert.equal(Math.round(rows * 100) / 100, f.total);
    });
    await check('the quote ignores a distance the app sends', async () => {
        const lying = await quote({ estimatedDistanceMeters: 1, estimatedDurationMinutes: 0 });
        assert.equal(quoteFor(lying, newBike).fare.total, 45);
    });
    await check('a stop on the way lengthens the quoted trip', async () => {
        const withStop = await quote({ stops: [{ lat: 22.70, lng: 75.90 }] });
        assert.ok(quoteFor(withStop, newBike).fare.total > 45, `quoted ${quoteFor(withStop, newBike).fare.total}`);
    });

    console.log('\nthe tariff list older apps read');
    await check('lists the new Bike under its own id, at bike rates', async () => {
        const rows = await svc.addBorrowedRidePriceRows([
            { id: 'a', type_id: String(oldBike), pricing_scope: 'ride', base_price: 20 },
            { id: 'b', type_id: String(sedan), pricing_scope: 'ride', base_price: 70 },
        ]);
        const mine = rows.filter((r) => r.type_id === String(newBike));
        assert.equal(mine.length, 1, 'no row for the new Bike');
        assert.equal(mine[0].base_price, 20);
        assert.ok(!rows.some((r) => r.type_id === String(scooter)), 'invented a row for the Scooter');
    });

    console.log('\nthe booking itself');
    const userId = id();
    await User.collection.insertOne({ _id: userId, name: 'Test Rider', phone: '9999999999', createdAt: new Date() });
    const reset = async () => {
        await mongoose.connection.collection('taxirides').deleteMany({});
        await User.collection.updateOne({ _id: userId }, { $set: { currentRideId: null } });
    };
    const book = (vehicleTypeId, fare, extra = {}) => svc.createRideRecord({
        userId, pickupCoords: pickup, dropCoords: drop, pickupAddress: 'A', dropAddress: 'B',
        fare, vehicleTypeId, paymentMethod: 'cash', serviceType: 'ride', transport_type: 'taxi', ...extra,
    });
    await check('THE BUG: a new-Bike ride sent at Rs 113 is charged Rs 45', async () => {
        const ride = await book(newBike, 113);
        assert.equal(Number(ride.fare), 45, `charged ${ride.fare}`);
        await reset();
    });
    await check('a ride sent at Rs 0 is still charged its price', async () => {
        const ride = await book(sedan, 0);
        assert.equal(Number(ride.fare), 118, `charged ${ride.fare}`);
        await reset();
    });
    /*
     * The booking screen now shows this quote instead of its own estimate, so
     * the two must agree for the SAME trip -- stops included. The web app used
     * not to send stops when booking, so a trip with a stop was quoted as a
     * detour and charged as a straight run.
     */
    await check('the quote is exactly what the booking charges, stop included', async () => {
        const via = [{ lat: 22.70, lng: 75.90 }];
        const quoted = quoteFor(await quote({ stops: via }), sedan).fare.total;
        const ride = await book(sedan, 1, { stops: via });
        assert.equal(Number(ride.fare), quoted, `quoted ${quoted}, charged ${ride.fare}`);
        const direct = await quote();
        assert.ok(quoted > quoteFor(direct, sedan).fare.total, 'the stop should cost more than the direct trip');
        await reset();
    });
    await check('an app claiming 0 km is still charged the measured trip', async () => {
        const ride = await book(newBike, 20, { estimatedDistanceMeters: 0, estimatedDurationMinutes: 0 });
        assert.equal(Number(ride.fare), 45, `charged ${ride.fare}`);
        assert.ok(Math.abs(ride.estimatedDistanceMeters - 3265.83) < 0.5, `stored ${ride.estimatedDistanceMeters} m`);
        await reset();
    });
    await check('a vehicle nobody priced cannot be booked at the app\'s figure', async () => {
        await assert.rejects(() => book(scooter, 50), (err) => err.statusCode === 400 || err.status === 400);
    });

    console.log('\nride insurance');
    const { RideInsurancePlan } = await import('../src/modules/taxi/admin/models/RideInsurancePlan.js');
    const [anyVehicle, sedanOnly] = await RideInsurancePlan.create([
        { name: 'Basic', premium_type: 'flat', premium_value: 10, cover_amount: 50000 },
        { name: 'Sedan 10%', premium_type: 'percent', premium_value: 10, vehicle_type_ids: [sedan] },
    ]);
    const insuredQuotes = await quote();
    await check('the quote offers each vehicle only the plans that cover it, priced for its fare', async () => {
        const bikeOptions = quoteFor(insuredQuotes, newBike).insuranceOptions.map((o) => o.name);
        assert.deepEqual(bikeOptions, ['Basic']);
        const sedanQuote = quoteFor(insuredQuotes, sedan);
        const tenPercent = sedanQuote.insuranceOptions.find((o) => o.name === 'Sedan 10%');
        assert.equal(tenPercent.premium, Math.round(sedanQuote.fare.total * 0.1));
    });
    await check('a booked plan is priced by the server and frozen on the ride, not added to the fare yet', async () => {
        const ride = await book(sedan, 0, { insurancePlanId: String(sedanOnly._id) });
        const sedanFare = quoteFor(insuredQuotes, sedan).fare.total;
        assert.equal(ride.pricingSnapshot.insurance.premium, Math.round(sedanFare * 0.1));
        assert.equal(Number(ride.fare), sedanFare, 'premium is charged at completion, not at booking');
        await reset();
    });
    await check('a plan for another vehicle is refused', async () => {
        await assert.rejects(() => book(newBike, 0, { insurancePlanId: String(sedanOnly._id) }), (err) => err.statusCode === 400 || err.status === 400);
        await reset();
    });
    await check('a switched-off plan is refused', async () => {
        await RideInsurancePlan.updateOne({ _id: anyVehicle._id }, { active: false });
        await assert.rejects(() => book(newBike, 0, { insurancePlanId: String(anyVehicle._id) }), (err) => err.statusCode === 400 || err.status === 400);
        await reset();
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
