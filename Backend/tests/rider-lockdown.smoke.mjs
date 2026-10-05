/**
 * Riders only get, and only finish, what is theirs.
 *
 * Run: node tests/rider-lockdown.smoke.mjs
 *
 * What this guards (found in the 22 Sep audit):
 *   - a rider cannot accept an order dispatch never offered them;
 *   - the rider status route cannot mark an order delivered or cancel it;
 *   - completing needs the food picked up and the customer's handover code;
 *   - the rider never gets the handover code back in a response;
 *   - a rejected rider is refused on the very next request, not days later;
 *   - taxi phone-only login and the fixed driver code are gone.
 */
import express from 'express';
import { startFoodWorld, makeChecker, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('rider_lockdown');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const delivery = await import('../src/modules/food/orders/services/order-delivery.service.js');
    const { signAccessToken } = await import('../src/core/auth/token.util.js');
    const routes = (await import('../src/routes/index.js')).default;

    await w.m.FoodDeliveryPartner.updateOne({ _id: w.rider._id }, { $set: { status: 'approved' } });
    const other = await w.m.FoodDeliveryPartner.create({ name: 'Other', phone: '9000000077', status: 'approved', availabilityStatus: 'online' });
    const items = [w.appLine(w.dish)];
    const buyer = await w.makeUser();

    const newOrder = async (set) => {
        const order = await w.saved(await w.place(buyer._id, { items, pricing: await w.quote(buyer._id, { items }) }));
        await w.m.FoodOrder.updateOne({ _id: order._id }, { $set: { orderStatus: 'confirmed', 'dispatch.status': 'unassigned', ...set } });
        return String(order._id);
    };
    const riderId = String(w.rider._id);

    console.log('\naccepting');
    const notOffered = await newOrder({ 'dispatch.offeredTo': [{ partnerId: other._id, action: 'offered' }] });
    const e1 = await thrownBy(() => delivery.acceptOrderDelivery(notOffered, riderId));
    check('an order offered to someone else cannot be taken', Boolean(e1) && /not offered/.test(e1.message), e1?.message);
    const offered = await newOrder({ 'dispatch.offeredTo': [{ partnerId: w.rider._id, action: 'timeout' }] });
    const accepted = await delivery.acceptOrderDelivery(offered, riderId);
    check('an order offered to this rider can be', accepted?.dispatch?.status === 'accepted');
    const list = await delivery.listOrdersAvailableDelivery(riderId, {});
    const ids = (list.docs || list.orders || list.items || list.data || []).map((o) => String(o._id));
    check('the available list does not show the other rider\'s offer', !ids.includes(notOffered), ids.join(','));

    console.log('\nfinishing');
    const e2 = await thrownBy(() => delivery.updateOrderStatusDelivery(offered, riderId, 'cancelled_by_restaurant'));
    check('the rider cannot cancel as the restaurant', Boolean(e2), e2?.message || 'cancelled');
    const e3 = await thrownBy(() => delivery.updateOrderStatusDelivery(offered, riderId, 'delivered'));
    check('"delivered" on the status route goes through completion and is refused before pickup', Boolean(e3) && /Pick up/.test(e3.message), e3?.message);
    const e4 = await thrownBy(() => delivery.completeDelivery(offered, riderId, {}));
    check('complete straight after accept is refused', Boolean(e4) && /Pick up/.test(e4.message), e4?.message);
    await w.m.FoodOrder.updateOne({ _id: offered }, { $set: { orderStatus: 'picked_up', 'deliveryState.currentPhase': 'en_route_to_delivery' } });
    const e5 = await thrownBy(() => delivery.completeDelivery(offered, riderId, {}));
    check('picked up but "reached drop" skipped: refused', Boolean(e5) && /Reached drop/.test(e5.message), e5?.message);
    const atDrop = await delivery.confirmReachedDropDelivery(offered, riderId);
    check('reached drop does not hand the code to the rider', atDrop && atDrop.deliveryOtp === undefined);
    const again = await delivery.updateOrderStatusDelivery(offered, riderId, 'picked_up').catch((e) => e);
    check('nor does a status update after it', !(again && again.deliveryOtp));
    const e6 = await thrownBy(() => delivery.completeDelivery(offered, riderId, {}));
    check('without the customer\'s code: refused', Boolean(e6), e6?.message || 'delivered');

    console.log('\nrejected rider');
    const app = express();
    app.use(express.json());
    app.use('/api', routes);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const token = signAccessToken({ userId: riderId, role: 'DELIVERY_PARTNER' });
    const hit = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const before = await hit('/v1/food/delivery/orders/available');
    check('an approved rider gets through', before.status !== 401 && before.status !== 403, before.status);
    const adminSvc = await import('../src/modules/food/admin/services/admin.service.js');
    await adminSvc.rejectDeliveryPartner(riderId, 'test');
    const after = await hit('/v1/food/delivery/orders/available');
    check('rejected: refused on the next request', after.status === 403, after.status);

    const qcToken = signAccessToken({ userId: String(other._id), role: 'DELIVERY_PARTNER' });
    const { FoodDeliveryPartner: QCPartner } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
    const qcRider = await QCPartner.create({ name: 'QC', phone: '9000000066', status: 'approved' });
    const qcHit = await fetch(`${base}/v1/food/delivery/orders/available`, {
        headers: { Authorization: `Bearer ${signAccessToken({ userId: String(qcRider._id), role: 'DELIVERY_PARTNER' })}` },
    });
    check('a quick-commerce rider cannot use food rider routes', qcHit.status === 403, qcHit.status);
    void qcToken;

    console.log('\ntaxi sign-in');
    const otpLogin = await fetch(`${base}/v1/taxi/users/otp-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: String(buyer.phone || '9876543210') }),
    });
    const otpBody = await otpLogin.json().catch(() => ({}));
    check('phone-only login no longer returns a session', !otpBody?.data?.token && !otpBody?.data?.accessToken && otpLogin.status >= 400, `${otpLogin.status} ${JSON.stringify(otpBody).slice(0, 120)}`);
    server.close();

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const loginOtp = await import('../src/modules/taxi/driver/services/loginOtpService.js');
    const fixed = loginOtp.__testables?.resolveDriverLoginOtpForPhone
        ? loginOtp.__testables.resolveDriverLoginOtpForPhone('6268423925')
        : null;
    process.env.NODE_ENV = prevEnv;
    if (fixed) check('the fixed driver test code is off in production', fixed.isStatic !== true, JSON.stringify(fixed));

    failed = summary();
} catch (err) {
    console.error(err);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
