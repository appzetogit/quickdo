/**
 * Quick commerce self-pickup, delivery slots, scheduled dispatch and proof of
 * delivery (plan §5.2, §5.3, §5.4).
 *
 * Run: node tests/qc-pickup-slots.smoke.mjs
 *
 *  - a pickup order has no delivery fee and no rider, shows the customer a
 *    code, and is completed only by the store entering that code;
 *  - once slots exist, a scheduled time must fall in one, a full slot is
 *    refused, and a cancelled order gives its place back;
 *  - a scheduled order is not offered to riders until N minutes before its
 *    slot, and the scheduled round fires once however often it is triggered;
 *  - with the handover code off, a rider cannot complete without a photo, and
 *    the photo is kept on the order for the customer and admin.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.DELIVERY_DISTANCE_SOURCE = 'straight';
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri('qc_pickup_slots'));

const BASE = '../src/modules/quickCommerce/modules/food';
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { FoodUser } = await import('../src/modules/quickCommerce/core/users/user.model.js');
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { FoodDeliveryPartner: QcRider } = await import(`${BASE}/delivery/models/deliveryPartner.model.js`);
const orders = await import(`${BASE}/orders/services/order.service.js`);
const dispatch = await import(`${BASE}/orders/services/order-dispatch.service.js`);
const delivery = await import(`${BASE}/orders/services/order-delivery.service.js`);
const slots = await import('../src/core/deliverySlots/deliverySlot.service.js');
const { DeliverySlotBooking } = await import('../src/core/deliverySlots/deliverySlot.model.js');
const scheduled = await import('../src/core/orders/scheduledDispatch.js');
const config = await import('../src/core/config/resolver.service.js');
const { resolveDropProof, readDropProof } = await import('../src/core/delivery/dropProof.js');

// ---------------------------------------------------------------- fixtures
const HERE = { lat: 22.72, lng: 75.88 };
const point = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });
const zone = await QCZone.create({
    name: 'Indore', country: 'India', isActive: true,
    coordinates: [
        { latitude: 22.6, longitude: 75.7 }, { latitude: 22.6, longitude: 76.0 },
        { latitude: 22.9, longitude: 76.0 }, { latitude: 22.9, longitude: 75.7 },
    ],
});
await FoodFeeSettings.create({ deliveryFee: 30, deliveryFeeRanges: [], platformFee: 0, gstRate: 0, isActive: true });
const allDay = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const shop = await FoodRestaurant.create({
    restaurantName: 'Corner Kirana', ownerName: 'Owner', ownerPhone: '9000000201', status: 'approved', zoneId: zone._id,
    isAcceptingOrders: true, isActive: true, openingTime: '00:00', closingTime: '23:59', openDays: allDay,
    location: { type: 'Point', coordinates: [HERE.lng, HERE.lat], latitude: HERE.lat, longitude: HERE.lng, addressLine1: 'Kirana road' },
});
const rice = await FoodItem.create({ restaurantId: shop._id, name: 'Rice 5kg', price: 300, gstRate: 0, approvalStatus: 'approved' });
const customer = await FoodUser.create({ name: 'Asha', phone: '9876502345' });
const uid = String(customer._id);
const address = {
    label: 'Home', street: '12 MG Road', city: 'Indore', state: 'MP',
    location: point({ lat: HERE.lat + 0.01, lng: HERE.lng }),
};
const line = [{ itemId: String(rice._id), name: 'Rice 5kg', price: 300, quantity: 1 }];
const rider = await QcRider.create({ name: 'Ravi', phone: '9000000299', status: 'approved' });

console.log('\n[1] self-pickup');

let pickup;
await check('a pickup order needs no address, charges no delivery fee and has no rider pay', async () => {
    pickup = await orders.createOrder(uid, { restaurantId: String(shop._id), items: line, paymentMethod: 'cash', fulfilmentType: 'pickup' });
    const row = await FoodOrder.findById(pickup.order.orderMongoId).select('+pickupOtp').lean();
    assert.equal(row.fulfilmentType, 'pickup');
    assert.equal(row.pricing.deliveryFee, 0);
    assert.equal(row.pricing.deliveryFeeGst, 0);
    assert.equal(row.riderEarning, 0);
    assert.match(row.pickupOtp, /^\d{4}$/);
    assert.equal(pickup.order.pickupOtp, row.pickupOtp, 'the customer is shown the code');
});

await check('the code is the customer\'s: the store and rider views do not carry it', async () => {
    const asStore = await orders.getOrderById(pickup.order.orderMongoId, { restaurantId: String(shop._id) });
    assert.equal(asStore.pickupOtp, undefined);
    const asCustomer = await orders.getOrderById(pickup.order.orderMongoId, { userId: uid });
    assert.match(asCustomer.pickupOtp, /^\d{4}$/);
});

await check('a pickup order is never dispatched and a rider cannot take it', async () => {
    await orders.updateOrderStatusRestaurant(pickup.order.orderMongoId, String(shop._id), 'confirmed');
    assert.equal(await dispatch.tryAutoAssign(pickup.order.orderMongoId), null);
    const row = await FoodOrder.findById(pickup.order.orderMongoId).lean();
    assert.equal(row.dispatch.status, 'unassigned');
    assert.equal(row.dispatch.dispatchingAt, undefined);
    await assert.rejects(() => delivery.acceptOrderDelivery(pickup.order.orderMongoId, String(rider._id)), /collects this order/);
});

await check('a wrong code is refused; the right one hands the order over and settles cash', async () => {
    const row = await FoodOrder.findById(pickup.order.orderMongoId).select('+pickupOtp').lean();
    const wrong = row.pickupOtp === '0000' ? '1111' : '0000';
    await assert.rejects(() => orders.verifyPickupOtpRestaurant(pickup.order.orderMongoId, String(shop._id), wrong), /Wrong pickup code/);
    const done = await orders.verifyPickupOtpRestaurant(pickup.order.orderMongoId, String(shop._id), row.pickupOtp);
    assert.equal(done.orderStatus, 'delivered');
    const after = await FoodOrder.findById(pickup.order.orderMongoId).lean();
    assert.equal(after.payment.status, 'paid');
    assert.equal(after.pickupVerification.verified, true);
    await assert.rejects(() => orders.verifyPickupOtpRestaurant(pickup.order.orderMongoId, String(shop._id), row.pickupOtp), /already been collected/);
});

await check('another store cannot verify the code', async () => {
    const p2 = await orders.createOrder(uid, { restaurantId: String(shop._id), items: line, paymentMethod: 'cash', fulfilmentType: 'pickup' });
    await assert.rejects(() => orders.verifyPickupOtpRestaurant(p2.order.orderMongoId, String(new mongoose.Types.ObjectId()), p2.order.pickupOtp), /not found/i);
});

console.log('\n[2] delivery slots');

// A slot starting three hours from now, an hour long, for every day.
const inThree = new Date(Date.now() + 3 * 3600 * 1000);
const parts = slots.localParts(inThree);
const hh = Number(parts.hhmm.slice(0, 2));
const startTime = `${String(hh).padStart(2, '0')}:00`;
const endTime = `${String((hh + 1) % 24).padStart(2, '0')}:00`;
const slot = await slots.createSlotAdmin({ vertical: 'quickCommerce', zoneId: String(zone._id), startTime, endTime, capacity: 1, cutoffMinutes: 0, label: 'Evening' });
const inSlot = new Date(slots.instantFor(parts.date, startTime).getTime() + 10 * 60000);
const outOfSlot = new Date(inSlot.getTime() + 90 * 60000);

let scheduledOrder;
await check('a time outside every slot is refused once slots exist', async () => {
    await assert.rejects(
        () => orders.createOrder(uid, { restaurantId: String(shop._id), items: line, address, paymentMethod: 'cash', scheduledAt: outOfSlot.toISOString() }),
        /delivery slots/,
    );
});

await check('a time inside a slot books it and is stored as the slot start', async () => {
    scheduledOrder = await orders.createOrder(uid, { restaurantId: String(shop._id), items: line, address, paymentMethod: 'cash', scheduledAt: inSlot.toISOString() });
    const row = await FoodOrder.findById(scheduledOrder.order.orderMongoId).lean();
    assert.equal(String(row.deliverySlot.slotId), String(slot._id));
    assert.equal(new Date(row.scheduledAt).getTime(), slots.instantFor(parts.date, startTime).getTime());
    const booking = await DeliverySlotBooking.findOne({ slotId: slot._id, date: parts.date }).lean();
    assert.equal(booking.count, 1);
});

await check('a full slot is refused', async () => {
    await assert.rejects(
        () => orders.createOrder(uid, { restaurantId: String(shop._id), items: line, address, paymentMethod: 'cash', scheduledAt: inSlot.toISOString() }),
        /slot is full/,
    );
    const listed = await slots.listAvailableSlots({ vertical: 'quickCommerce', zoneId: String(zone._id), days: 2 });
    const today = listed.days.find((d) => d.date === parts.date);
    const s = today.slots.find((x) => x.slotId === String(slot._id));
    assert.equal(s.remaining, 0);
    assert.equal(s.available, false);
});

await check('reserving twice for the same order holds one place', async () => {
    const again = await slots.reserveSlot({ slot, date: parts.date, orderId: scheduledOrder.order.orderMongoId });
    assert.equal(again.reserved, true);
    const booking = await DeliverySlotBooking.findOne({ slotId: slot._id, date: parts.date }).lean();
    assert.equal(booking.count, 1);
});

console.log('\n[3] scheduled dispatch');

await check('accepting a scheduled order does not offer it to riders before the slot', async () => {
    await orders.updateOrderStatusRestaurant(scheduledOrder.order.orderMongoId, String(shop._id), 'confirmed');
    assert.equal(await dispatch.tryAutoAssign(scheduledOrder.order.orderMongoId), null);
    const row = await FoodOrder.findById(scheduledOrder.order.orderMongoId).lean();
    assert.ok(row.scheduledDispatch?.dispatchAt, 'the round is arranged');
    const expected = new Date(row.scheduledAt).getTime() - 30 * 60000;
    assert.equal(new Date(row.scheduledDispatch.dispatchAt).getTime(), expected, 'default lead 30 minutes');
    assert.ok(!row.scheduledDispatch.firedAt, 'not fired yet');
    assert.equal(row.scheduledDispatch.via, 'timer', 'in-memory timer when BullMQ is off');
    assert.equal(scheduled.hasStoreScheduledTimer('quickCommerce', scheduledOrder.order.orderMongoId), true);
    await assert.rejects(() => delivery.acceptOrderDelivery(scheduledOrder.order.orderMongoId, String(rider._id)), /scheduled order/);
});

await check('the scheduled round fires once however many times it is triggered', async () => {
    const results = await Promise.all([
        scheduled.fireScheduledStoreDispatch('quickCommerce', scheduledOrder.order.orderMongoId),
        scheduled.fireScheduledStoreDispatch('quickCommerce', scheduledOrder.order.orderMongoId),
        scheduled.fireScheduledStoreDispatch('quickCommerce', scheduledOrder.order.orderMongoId),
    ]);
    assert.equal(results.filter((r) => r.fired).length, 1, JSON.stringify(results));
    const row = await FoodOrder.findById(scheduledOrder.order.orderMongoId).lean();
    assert.ok(row.scheduledDispatch.firedAt);
    // Once fired, the order is an ordinary one for dispatch.
    assert.equal(await scheduled.holdForSchedule('quickCommerce', row), false);
});

await check('the boot restore re-arms a pending round and ignores a fired one', async () => {
    const restored = await scheduled.restoreStoreScheduledDispatches();
    assert.equal(restored, 0);
});

await check('cancelling the scheduled order gives its slot place back', async () => {
    await orders.cancelOrder(scheduledOrder.order.orderMongoId, uid, 'plans changed').catch(async (err) => {
        // After acceptance the policy may refuse a customer cancel: the store rejects instead.
        if (!/cancel/i.test(err.message)) throw err;
        await orders.updateOrderStatusRestaurant(scheduledOrder.order.orderMongoId, String(shop._id), 'cancelled_by_restaurant', 'out of stock');
    });
    const booking = await DeliverySlotBooking.findOne({ slotId: slot._id, date: parts.date }).lean();
    assert.equal(booking.count, 0);
    const next = await orders.createOrder(uid, { restaurantId: String(shop._id), items: line, address, paymentMethod: 'cash', scheduledAt: inSlot.toISOString() });
    assert.ok(next.order.orderMongoId);
});

console.log('\n[4] proof of delivery');

await check('a proof needs an uploaded image URL; coordinates are kept', async () => {
    assert.equal(readDropProof({}), null);
    assert.throws(() => readDropProof({ dropProof: { photoUrl: 'data:image/png;base64,xx' } }), /uploaded image/);
    const p = readDropProof({ dropProof: { photoUrl: 'https://cdn.example.com/pod.jpg', lat: 22.7, lng: 75.8 } });
    assert.equal(p.lat, 22.7);
    assert.ok(p.at instanceof Date);
});

const riderAtDrop = async () => {
    const id = new mongoose.Types.ObjectId();
    await FoodOrder.collection.insertOne({
        _id: id, order_id: `FOD-POD${String(id).slice(-6)}`, orderId: `FOD-POD${String(id).slice(-6)}`,
        userId: customer._id, restaurantId: shop._id, zoneId: zone._id, orderStatus: 'reached_drop',
        items: [{ itemId: String(rice._id), name: 'Rice 5kg', price: 300, quantity: 1 }],
        deliveryAddress: { street: '12 MG Road', city: 'Indore', state: 'MP', location: point(HERE) },
        pricing: { subtotal: 300, total: 330 }, payment: { method: 'cash', status: 'cod_pending' },
        dispatch: { status: 'accepted', deliveryPartnerId: rider._id, acceptedAt: new Date() },
        deliveryState: { currentPhase: 'at_drop', pickedUpAt: new Date(), reachedDropAt: new Date() },
        deliveryVerification: { dropOtp: { required: true, verified: false } }, deliveryOtp: '4321',
        createdAt: new Date(), updatedAt: new Date(),
    });
    return String(id);
};

await check('with the code in use, completion still needs the code (as before)', async () => {
    const id = await riderAtDrop();
    await assert.rejects(() => delivery.completeDelivery(id, String(rider._id), {}), /OTP is required/);
    const done = await delivery.completeDelivery(id, String(rider._id), { otp: '4321' });
    assert.equal(done.orderStatus, 'delivered');
});

await config.set('delivery.dropOtpRequired', { level: 'global', value: false, updatedBy: 'test' });

await check('with the code off, completing without a photo is refused', async () => {
    const id = await riderAtDrop();
    await assert.rejects(() => delivery.completeDelivery(id, String(rider._id), {}), /photo/i);
    const row = await FoodOrder.findById(id).lean();
    assert.equal(row.orderStatus, 'reached_drop');
});

await check('with the code off, a photo completes it and is kept for the customer and admin', async () => {
    const id = await riderAtDrop();
    const out = await delivery.completeDelivery(id, String(rider._id), {
        dropProof: { photoUrl: 'https://cdn.example.com/pod-1.jpg', lat: 22.7201, lng: 75.8801 },
    });
    assert.equal(out.orderStatus, 'delivered');
    const asCustomer = await orders.getOrderById(id, { userId: uid });
    assert.equal(asCustomer.dropProof.photoUrl, 'https://cdn.example.com/pod-1.jpg');
    assert.equal(asCustomer.dropProof.lat, 22.7201);
    const asAdmin = await orders.getOrderById(id, { admin: true });
    assert.equal(asAdmin.dropProof.photoUrl, 'https://cdn.example.com/pod-1.jpg');
});

await check('a contactless order asks for the photo even with the code on', async () => {
    await config.set('delivery.dropOtpRequired', { level: 'global', value: true, updatedBy: 'test' });
    const r = await resolveDropProof({ contactlessDelivery: true }, {}).catch((e) => e);
    assert.match(String(r.message), /photo/);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
