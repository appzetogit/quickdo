/**
 * Two ways to send a prescription, and the line between them.
 *
 * Run: node tests/qc-medical-request-broadcast.smoke.mjs
 *
 * A customer who picks a pharmacy gets that pharmacy. A customer who does not
 * want to pick has the prescription offered to every pharmacy in range, and the
 * first to accept fills it. The dangerous mistakes are one becoming the other:
 *
 *   - a chosen pharmacy's order also reaching the shops next door, which shows
 *     a health record to people the customer never chose;
 *   - two pharmacies both accepting one broadcast, which is two shops
 *     dispensing the same prescription and two orders to pay for.
 *
 * Both are pinned here against the real services on an in-memory Mongo, along
 * with the admin's range, which is the only thing that decides how far a
 * prescription travels.
 */
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

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_medical_broadcast' });

const BASE = '../src/modules/quickCommerce/modules/food';
const requests = await import(`${BASE}/orders/services/prescriptionRequest.service.js`);
const rx = await import(`${BASE}/orders/services/prescriptionOrder.service.js`);
const { QCPrescriptionRequest } = await import(`${BASE}/orders/models/prescriptionRequest.model.js`);
const { QCMedicalSettings } = await import(`${BASE}/admin/models/medicalSettings.model.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
// Medical draws its own zones now: a prescription order resolves against
// medical_zones, so a fixture in qc_zones would be invisible to it.
const { MedicalZone } = await import(`${BASE}/admin/models/medicalZone.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);

const id = () => new mongoose.Types.ObjectId();
const zoneId = id();
const userId = id();

await MedicalZone.collection.insertOne({
    _id: zoneId,
    name: 'Central',
    isActive: true,
    coordinates: [
        { latitude: 12.8, longitude: 77.5 },
        { latitude: 12.8, longitude: 77.8 },
        { latitude: 13.1, longitude: 77.8 },
        { latitude: 13.1, longitude: 77.5 },
    ],
});
await FoodFeeSettings.create({ deliveryFee: 30, deliveryFeeRanges: [], platformFee: 10, gstRate: 5, isActive: true });

/** The customer is at 12.95 / 77.62. Distances below are from there. */
const address = {
    street: '1 MG Road', city: 'Bengaluru', state: 'KA', phone: '9000000000',
    latitude: 12.95, longitude: 77.62,
    location: { type: 'Point', coordinates: [77.62, 12.95] },
};
const HERE = { lat: 12.95, lng: 77.62 };

const makeSeller = async (name, { lat, lng, storeType = 'pharmacy', status = 'approved', accepting = true }) => {
    const _id = id();
    await FoodRestaurant.collection.insertOne({
        _id,
        restaurantName: name,
        status,
        storeType,
        zoneId,
        isActive: true,
        isAcceptingOrders: accepting,
        location: { type: 'Point', coordinates: [lng, lat], latitude: lat, longitude: lng },
    });
    return _id;
};

// Two pharmacies close by, one about 11 km off, one grocery next door.
const nearA = await makeSeller('Apollo Chemist', { lat: 12.952, lng: 77.622 });
const nearB = await makeSeller('MedPlus', { lat: 12.960, lng: 77.630 });
const farAway = await makeSeller('Hilltop Pharmacy', { lat: 13.050, lng: 77.620 });
const grocery = await makeSeller('Daily Needs', { lat: 12.951, lng: 77.621, storeType: 'grocery' });
const offline = await makeSeller('Shut Chemist', { lat: 12.951, lng: 77.623, accepting: false });

const RX_IMAGE = 'https://cdn.example/rx/broadcast.jpg';
const setRadius = (km) => QCMedicalSettings.findOneAndUpdate(
    {}, { $set: { requestRadiusKm: km, requestExpiryMinutes: 30, broadcastEnabled: true } },
    { upsert: true },
);

// =============================================================================
console.log('\n[1] a customer who chooses a pharmacy gets that pharmacy, and only it');

await check('the direct order is placed with the chosen shop', async () => {
    const order = await rx.createPrescriptionOrder(String(userId), {
        restaurantId: String(nearA),
        address,
        prescriptionImage: 'https://cdn.example/rx/direct.jpg',
        customerName: 'Asha',
    });
    const stored = await FoodOrder.findById(order.orderMongoId).lean();
    assert.equal(String(stored.restaurantId), String(nearA));
});

await check('THE BUG IT PREVENTS: no other pharmacy is told anything about it', async () => {
    // A direct order writes no request, so there is nothing for the shop next
    // door to see -- not an empty queue, no document at all.
    assert.equal(await QCPrescriptionRequest.countDocuments({}), 0);
    for (const other of [nearB, farAway]) {
        const queue = await requests.listRequestsForPharmacy(String(other));
        assert.deepEqual(queue, [], `${other} can see it`);
    }
});

await check('and exactly one order exists for that prescription', async () => {
    assert.equal(await FoodOrder.countDocuments({ prescriptionOnly: true }), 1);
});

// =============================================================================
console.log('\n[2] a broadcast reaches the pharmacies in range, and nobody else');

await setRadius(5);
let request = null;

await check('the request is created and invites the shops within 5 km', async () => {
    const out = await requests.createPrescriptionRequest(String(userId), {
        address,
        prescriptionImage: RX_IMAGE,
        note: 'Please send before evening',
        customerName: 'Asha',
    });
    request = out.request;
    const stored = await QCPrescriptionRequest.findById(request.id).lean();
    const invited = stored.invited.map((i) => String(i.pharmacyId));
    assert.deepEqual(invited.sort(), [String(nearA), String(nearB)].sort(), `invited ${invited}`);
});

await check('the shop 11 km away is not one of them -- that is the admin\'s range', async () => {
    const stored = await QCPrescriptionRequest.findById(request.id).lean();
    assert.ok(!stored.invited.some((i) => String(i.pharmacyId) === String(farAway)));
});

await check('a grocery is never shown a prescription', async () => {
    const stored = await QCPrescriptionRequest.findById(request.id).lean();
    assert.ok(!stored.invited.some((i) => String(i.pharmacyId) === String(grocery)));
});

await check('nor is a pharmacy that is not accepting orders', async () => {
    const stored = await QCPrescriptionRequest.findById(request.id).lean();
    assert.ok(!stored.invited.some((i) => String(i.pharmacyId) === String(offline)));
});

await check('each invited pharmacy sees it in its own queue', async () => {
    for (const who of [nearA, nearB]) {
        const queue = await requests.listRequestsForPharmacy(String(who));
        assert.equal(queue.length, 1, `${who} sees ${queue.length}`);
        assert.equal(queue[0].id, request.id);
        assert.ok(queue[0].distanceKm !== null, 'the pharmacist is told how far away it is');
    }
});

await check('a pharmacy that was not invited sees nothing', async () => {
    assert.deepEqual(await requests.listRequestsForPharmacy(String(farAway)), []);
});

await check('the customer\'s address is NOT handed out before anyone accepts', async () => {
    const queue = await requests.listRequestsForPharmacy(String(nearA));
    const row = JSON.stringify(queue[0]);
    assert.ok(!row.includes('MG Road'), 'the street was sent to a shop that has not taken the order');
    assert.ok(!row.includes('9000000000'), 'so was the phone number');
});

await check('no order exists yet -- a broadcast is not an order', async () => {
    assert.equal(await FoodOrder.countDocuments({ prescriptionOnly: true }), 1, 'only the direct one');
});

// =============================================================================
console.log('\n[3] the admin\'s range is what decides, and it can be changed');

await check('widening it to 20 km brings the far pharmacy in', async () => {
    await setRadius(20);
    const out = await requests.createPrescriptionRequest(String(userId), {
        address, prescriptionImage: RX_IMAGE, customerName: 'Asha',
    });
    const stored = await QCPrescriptionRequest.findById(out.request.id).lean();
    assert.equal(stored.invited.length, 3, `invited ${stored.invited.length}`);
    assert.ok(stored.invited.some((i) => String(i.pharmacyId) === String(farAway)));
    await QCPrescriptionRequest.deleteOne({ _id: out.request.id });
});

await check('narrowing it later does not un-invite a shop already asked', async () => {
    await setRadius(1);
    const stored = await QCPrescriptionRequest.findById(request.id).lean();
    assert.equal(stored.radiusKm, 5, 'the request keeps the range it went out under');
    const queue = await requests.listRequestsForPharmacy(String(nearB));
    assert.equal(queue.length, 1, 'MedPlus is 1.2 km away and was invited at 5 km; it keeps the request');
});

await check('with nothing in range the customer is told, not left waiting', async () => {
    await setRadius(5);
    const before = await QCPrescriptionRequest.countDocuments({});
    // The far corner of the same delivery zone: serviceable, but no pharmacy
    // within 5 km of it.
    const remote = {
        ...address,
        street: '9 Far Lane', latitude: 13.09, longitude: 77.79,
        location: { type: 'Point', coordinates: [77.79, 13.09] },
    };
    await assert.rejects(
        () => requests.createPrescriptionRequest(String(userId), {
            address: remote, prescriptionImage: RX_IMAGE, customerName: 'Asha',
        }),
        /No pharmacy is open within/,
    );
    assert.equal(await QCPrescriptionRequest.countDocuments({}), before, 'and nothing was saved');
});

await check('a broadcast with no prescription is refused', async () => {
    await assert.rejects(
        () => requests.createPrescriptionRequest(String(userId), { address, customerName: 'Asha' }),
        /Upload a prescription/,
    );
});

await check('the admin can turn broadcasting off without breaking direct orders', async () => {
    await QCMedicalSettings.findOneAndUpdate({}, { $set: { broadcastEnabled: false } }, { upsert: true });
    await assert.rejects(
        () => requests.createPrescriptionRequest(String(userId), {
            address, prescriptionImage: RX_IMAGE,
        }),
        /turned off/,
    );
    const order = await rx.createPrescriptionOrder(String(userId), {
        restaurantId: String(nearA), address, prescriptionImage: RX_IMAGE, customerName: 'Asha',
    });
    assert.ok(order.orderMongoId, 'choosing a pharmacy still works');
    await FoodOrder.deleteOne({ _id: order.orderMongoId });
    await QCMedicalSettings.findOneAndUpdate({}, { $set: { broadcastEnabled: true } });
});

// =============================================================================
console.log('\n[4] the first pharmacy to accept gets it, and only one order is created');

await check('THE BUG IT PREVENTS: two shops accepting at once produce ONE order', async () => {
    const before = await FoodOrder.countDocuments({ prescriptionOnly: true });
    const results = await Promise.allSettled([
        requests.claimPrescriptionRequest(request.id, String(nearA)),
        requests.claimPrescriptionRequest(request.id, String(nearB)),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    assert.equal(won.length, 1, `${won.length} pharmacies were told they had it`);
    assert.equal(lost.length, 1);
    assert.match(lost[0].reason?.message || '', /already accepted/);
    const after = await FoodOrder.countDocuments({ prescriptionOnly: true });
    assert.equal(after - before, 1, `${after - before} orders were created for one prescription`);
});

let claimedOrder = null;
await check('the order belongs to the pharmacy that accepted, and carries the prescription', async () => {
    const stored = await QCPrescriptionRequest.findById(request.id).lean();
    assert.equal(stored.status, 'claimed');
    assert.ok(stored.claimedBy, 'nobody recorded as the winner');
    assert.ok(stored.orderId, 'the request does not point at its order');
    claimedOrder = await FoodOrder.findById(stored.orderId).lean();
    assert.equal(String(claimedOrder.restaurantId), String(stored.claimedBy));
    assert.equal(claimedOrder.prescription.imageUrl, RX_IMAGE);
    assert.equal(claimedOrder.prescriptionOnly, true);
    assert.equal(claimedOrder.prescription.status, 'pending_review', 'the pharmacist still has to read it');
});

await check('the losing pharmacy is not left holding it in its queue', async () => {
    const stored = await QCPrescriptionRequest.findById(request.id).lean();
    const loser = String(stored.claimedBy) === String(nearA) ? nearB : nearA;
    assert.deepEqual(await requests.listRequestsForPharmacy(String(loser)), []);
});

await check('and cannot accept it afterwards either', async () => {
    const stored = await QCPrescriptionRequest.findById(request.id).lean();
    const loser = String(stored.claimedBy) === String(nearA) ? nearB : nearA;
    await assert.rejects(
        () => requests.claimPrescriptionRequest(request.id, String(loser)),
        /already accepted/,
    );
});

await check('a pharmacy that was never invited cannot take it by guessing the id', async () => {
    const out = await requests.createPrescriptionRequest(String(userId), {
        address, prescriptionImage: RX_IMAGE, customerName: 'Asha',
    });
    await assert.rejects(
        () => requests.claimPrescriptionRequest(out.request.id, String(farAway)),
        /not sent to your pharmacy/,
    );
    await QCPrescriptionRequest.deleteOne({ _id: out.request.id });
});

// =============================================================================
console.log('\n[5] declining, expiring and cancelling');

let second = null;
await check('a pharmacy that passes stops seeing it; the others still do', async () => {
    const out = await requests.createPrescriptionRequest(String(userId), {
        address, prescriptionImage: RX_IMAGE, customerName: 'Asha',
    });
    second = out.request;
    await requests.declinePrescriptionRequest(second.id, String(nearA));
    assert.deepEqual(await requests.listRequestsForPharmacy(String(nearA)), []);
    const stillThere = await requests.listRequestsForPharmacy(String(nearB));
    assert.equal(stillThere.length, 1, 'declining for one shop closed it for everyone');
});

await check('and cannot then accept what it passed on', async () => {
    await assert.rejects(
        () => requests.claimPrescriptionRequest(second.id, String(nearA)),
        /passed on this request/,
    );
});

await check('an expired request can be taken by nobody', async () => {
    await QCPrescriptionRequest.updateOne(
        { _id: second.id },
        { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );
    assert.deepEqual(await requests.listRequestsForPharmacy(String(nearB)), [], 'still in the queue');
    await assert.rejects(
        () => requests.claimPrescriptionRequest(second.id, String(nearB)),
        /expired/,
    );
});

await check('the customer can withdraw one nobody has taken', async () => {
    const out = await requests.createPrescriptionRequest(String(userId), {
        address, prescriptionImage: RX_IMAGE, customerName: 'Asha',
    });
    await requests.cancelPrescriptionRequest(out.request.id, String(userId));
    const stored = await QCPrescriptionRequest.findById(out.request.id).lean();
    assert.equal(stored.status, 'cancelled');
    assert.deepEqual(await requests.listRequestsForPharmacy(String(nearB)), []);
    await assert.rejects(
        () => requests.claimPrescriptionRequest(out.request.id, String(nearB)),
        /cancelled/,
    );
});

await check('but not one a pharmacy has already accepted -- that is an order now', async () => {
    await assert.rejects(
        () => requests.cancelPrescriptionRequest(request.id, String(userId)),
        /Cancel the order instead/,
    );
});

await check('and not somebody else\'s request', async () => {
    const out = await requests.createPrescriptionRequest(String(userId), {
        address, prescriptionImage: RX_IMAGE, customerName: 'Asha',
    });
    await assert.rejects(
        () => requests.cancelPrescriptionRequest(out.request.id, String(id())),
        /no longer exists/,
    );
});

// =============================================================================
console.log('\n[6] what the customer and the admin can see');

await check('the customer sees their own requests and their state', async () => {
    const mine = await requests.listRequestsForUser(String(userId));
    assert.ok(mine.length >= 3, `only ${mine.length}`);
    assert.ok(mine.some((r) => r.status === 'claimed'), 'no claimed one listed');
    assert.ok(mine.every((r) => r.prescriptionImageUrl), 'a request with no prescription on it');
});

await check('the admin sees who each one went to, and who took it', async () => {
    const out = await requests.listRequestsForAdmin({});
    assert.ok(out.total >= 3);
    const claimed = out.requests.find((r) => r.status === 'claimed');
    assert.ok(claimed, 'the accepted request is not in the admin list');
    assert.ok(claimed.invited.length >= 2, 'the audit trail of who could see it is missing');
    assert.ok(claimed.invited.every((i) => i.name), 'invited shops are listed as ids with no names');
    assert.ok(claimed.orderId, 'the admin cannot get from the request to the order');
});

await check('a stale open request reads as expired rather than looking live', async () => {
    const out = await requests.listRequestsForAdmin({ status: 'expired' });
    assert.ok(out.requests.some((r) => r.id === second.id), 'the expired one is not marked expired');
});

await check('the admin\'s range round-trips through the settings', async () => {
    const saved = await requests.updateMedicalSettings({ requestRadiusKm: 8, requestExpiryMinutes: 45 }, String(id()));
    assert.equal(saved.requestRadiusKm, 8);
    const read = await requests.getMedicalSettings();
    assert.equal(read.requestRadiusKm, 8);
    assert.equal(read.requestExpiryMinutes, 45);
    await assert.rejects(() => requests.updateMedicalSettings({ requestRadiusKm: 0 }), /between/);
    await assert.rejects(() => requests.updateMedicalSettings({ requestRadiusKm: 5000 }), /between/);
});

await check('the pharmacy list a customer browses is the same set a broadcast reaches', async () => {
    await setRadius(5);
    const listed = await requests.listNearbyPharmacies(String(userId), HERE);
    assert.equal(listed.radiusKm, 5);
    const ids = listed.pharmacies.map((p) => p.id).sort();
    assert.deepEqual(ids, [String(nearA), String(nearB)].sort(), `listed ${ids}`);
    assert.ok(listed.pharmacies.every((p) => p.distanceKm !== null), 'no distance shown');
    assert.ok(
        listed.pharmacies[0].distanceKm <= listed.pharmacies[1].distanceKm,
        'not nearest first',
    );
});

await check('each listed pharmacy carries what the customer needs to choose', async () => {
    const listed = await requests.listNearbyPharmacies(String(userId), HERE);
    const shop = listed.pharmacies[0];
    // The detail screen is built from this row, so what it needs has to be here
    // -- a second call per pharmacy to show opening hours would be a request per
    // row on a list that already knows the answer.
    assert.equal(typeof shop.openingTime, 'string');
    assert.equal(typeof shop.closingTime, 'string');
    assert.ok(Array.isArray(shop.openDays));
    assert.equal(shop.isOpenNow, true, 'a shop in the list is one that can take the order');
    assert.equal(typeof shop.address, 'string');
});

await check('without a location the customer is asked for one, not shown everything', async () => {
    await assert.rejects(
        () => requests.listNearbyPharmacies(String(userId), {}),
        /location is needed/,
    );
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
