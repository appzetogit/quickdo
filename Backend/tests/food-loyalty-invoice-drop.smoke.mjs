/**
 * Food checkout loyalty, GST invoice numbers and proof of delivery.
 *
 * Run: node tests/food-loyalty-invoice-drop.smoke.mjs
 *
 * [1] Loyalty at food checkout (core/loyalty, the same calls quick commerce
 *     makes): a no-op while loyalty is off; capped at the admin's share of the
 *     food; taken off after GST; spent once; the ledger still accounts for
 *     every rupee; given back once when the order is cancelled.
 * [2] Invoice numbers (core/documents/invoiceSeries.js): sequential per
 *     restaurant, restarting each financial year (April, IST); unique under
 *     concurrent assignment; given once; orders delivered before numbering keep
 *     FD-<order id>.
 * [3] Proof of delivery (core/delivery/dropProof.js): a food delivery needs a
 *     photo when the handover code is off for food, and the photo is on the
 *     order for the customer and the admin.
 *
 * Drives the real validators and services against an in-memory Mongo.
 */
import mongoose from 'mongoose';
import { startFoodWorld, makeChecker, near, thrownBy, ADDRESS } from './food-order-fixture.mjs';

const w = await startFoodWorld('food_loyalty_invoice_drop');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const loyalty = await import('../src/core/loyalty/loyalty.service.js');
    const config = await import('../src/core/config/resolver.service.js');
    const series = await import('../src/core/documents/invoiceSeries.js');
    const invoice = await import('../src/modules/food/orders/services/orderInvoice.service.js');
    const delivery = await import('../src/modules/food/orders/services/order-delivery.service.js');
    const { billAddsUp } = await import('../src/modules/food/shared/billing.js');
    const foodLoyalty = await import('../src/modules/food/orders/services/order-loyalty.service.js');

    const items = [w.appLine(w.dish)];
    const buyer = await w.makeUser();
    const uid = String(buyer._id);
    const calc = (body) => w.orderService.calculateOrder(uid, w.validators.validateCalculateOrderDto({
        restaurantId: String(w.restaurant._id), deliveryAddress: ADDRESS, items, ...body,
    }));

    console.log('\n[1] loyalty at food checkout');

    // 100 points in the bank (earned on an earlier food order).
    await loyalty.saveLoyaltySettings({ enabled: true, pointsPerRupee: 0.1, rupeesPerPoint: 1, maxRedeemPercent: 10 }, { vertical: 'food' });
    await loyalty.earnForOrder({ customerId: uid, vertical: 'food', orderId: String(new mongoose.Types.ObjectId()), amount: 1000 });
    check('the customer has 100 points', (await loyalty.balanceOf(uid)) === 100);

    await loyalty.saveLoyaltySettings({ enabled: false }, { vertical: 'food' });
    const off = await calc({ loyaltyPoints: 50 });
    check('loyalty off: /calculate ignores the points (Rs 252, nothing off)', near(off.pricing.total, 252) && !off.pricing.loyaltyDiscount,
        `total ${off.pricing.total}, off ${off.pricing.loyaltyDiscount}`);
    const offOrder = await w.saved(await w.place(uid, { items, pricing: off.pricing, loyaltyPoints: 50 }));
    check('loyalty off: the order is placed at full price and spends nothing',
        near(offOrder.pricing.total, 252) && !offOrder.pricing.loyaltyPoints && (await loyalty.balanceOf(uid)) === 100,
        `total ${offOrder.pricing.total}`);

    await loyalty.saveLoyaltySettings({ enabled: true }, { vertical: 'food' });
    const on = await calc({ loyaltyPoints: 80 });
    check('/calculate caps 80 points at 10% of the Rs 200 food: 20 points, Rs 20',
        on.pricing.loyaltyPoints === 20 && near(on.pricing.loyaltyDiscount, 20) && on.loyalty?.capped === true,
        `${on.pricing.loyaltyPoints} pts, Rs ${on.pricing.loyaltyDiscount}`);
    check('taken off after GST: tax still Rs 10, total 251.80 - 20 = 231.80 -> Rs 232',
        near(on.pricing.tax, 10) && near(on.pricing.total, 232) && near(on.pricing.roundOff, 0.2),
        `tax ${on.pricing.tax}, total ${on.pricing.total}, roundOff ${on.pricing.roundOff}`);
    check('the bill still adds up', billAddsUp(on.pricing.bill));
    check('/calculate spends nothing', (await loyalty.balanceOf(uid)) === 100);

    const placed = await w.place(uid, { items, pricing: on.pricing, loyaltyPoints: 80 });
    const order = await w.saved(placed);
    check('the order carries 20 points / Rs 20 and charges Rs 232',
        order.pricing.loyaltyPoints === 20 && near(order.pricing.loyaltyDiscount, 20) && near(order.pricing.total, 232)
        && near(order.payment.amountDue, 232) && order.loyalty?.redeemKey === `food:${order._id}`,
        `${order.pricing.loyaltyPoints} pts, total ${order.pricing.total}`);
    check('the points are spent: 80 left', (await loyalty.balanceOf(uid)) === 80);
    const again = await foodLoyalty.burnFoodOrderLoyalty(uid, order);
    check('spending again for the same order is a no-op', again.duplicate === true && (await loyalty.balanceOf(uid)) === 80);

    const tx = await w.m.FoodTransaction.findOne({ orderId: order._id }).lean();
    const accounted = tx.amounts.restaurantShare + tx.amounts.riderTotalPayout + tx.amounts.platformNetProfit
        + order.pricing.bill.gstOnItems + order.pricing.bill.platformFeeGst;
    check('the platform funds the points; every rupee is still credited to somebody', near(accounted, order.pricing.total),
        `${Math.round(accounted * 100) / 100} of ${order.pricing.total}`);

    await w.orderService.cancelOrder(String(order._id), uid, 'changed my mind');
    check('cancelling gives the 20 points back', (await loyalty.balanceOf(uid)) === 100);
    await foodLoyalty.reverseFoodOrderLoyalty(await w.m.FoodOrder.findById(order._id).lean());
    check('only once', (await loyalty.balanceOf(uid)) === 100);

    const many = await calc({ loyaltyPoints: 5 });
    check('asking for fewer than the cap uses exactly those', many.pricing.loyaltyPoints === 5 && near(many.pricing.total, 247),
        `${many.pricing.loyaltyPoints} pts, total ${many.pricing.total}`);

    await loyalty.saveLoyaltySettings({ enabled: false }, { vertical: 'food' });
    const offAgain = await calc({ loyaltyPoints: 80 });
    check('turned off again: no-op', !offAgain.pricing.loyaltyPoints && near(offAgain.pricing.total, 252));

    console.log('\n[2] GST invoice numbers');

    const fy = series.financialYearOf;
    check('31 Mar 23:59 IST is still 2026-27', fy(new Date('2027-03-31T18:29:59Z')).label === '2026-27');
    check('1 Apr 00:00 IST is 2027-28', fy(new Date('2027-03-31T18:30:00Z')).label === '2027-28');
    check('January belongs to the year that began the April before', fy(new Date('2027-01-15T06:00:00Z')).label === '2026-27');
    check('format with tokens', series.formatDocumentNumber('{prefix}/{fyShort}/{seq:4}', { prefix: 'X', fy: fy(new Date('2026-10-08T00:00:00Z')), seq: 7 }) === 'X/2627/0007');

    const r1 = new mongoose.Types.ObjectId();
    const r2 = new mongoose.Types.ObjectId();
    const r3 = new mongoose.Types.ObjectId();
    const deliveredOn = new Date('2026-10-08T10:00:00Z');
    const fakeOrder = async (restaurantId, at = deliveredOn, extra = {}) => {
        const _id = new mongoose.Types.ObjectId();
        await w.m.FoodOrder.collection.insertOne({
            _id, order_id: `FOD-${String(_id).slice(-6)}`, userId: buyer._id, restaurantId, orderStatus: 'delivered',
            items: [{ itemId: w.dish._id, name: 'Paneer Tikka', price: 200, quantity: 1 }],
            deliveryAddress: { ...ADDRESS }, pricing: { subtotal: 200, total: 252 },
            deliveryState: { deliveredAt: at }, createdAt: at, updatedAt: at, ...extra,
        });
        return w.m.FoodOrder.findById(_id).lean();
    };
    const code = (id) => String(id).slice(-4).toUpperCase();
    const gstOk = (n) => typeof n === 'string' && n.length <= 16 && /^[A-Za-z0-9/-]+$/.test(n);

    const a1 = await invoice.assignFoodInvoiceNumber(await fakeOrder(r1));
    const a2 = await invoice.assignFoodInvoiceNumber(await fakeOrder(r1));
    const b1 = await invoice.assignFoodInvoiceNumber(await fakeOrder(r2));
    check('restaurant 1: 00001 then 00002, default format R<id4>/2627/<seq5>', a1?.number === `R${code(r1)}/2627/00001` && a2?.number === `R${code(r1)}/2627/00002`,
        `${a1?.number}, ${a2?.number}`);
    check('restaurant 2 counts on its own: 00001', b1?.number === `R${code(r2)}/2627/00001`, b1?.number);
    check('the default numbers are GST-compliant (<= 16 chars, letters/digits/"/"/"-")', [a1, a2, b1].every((g) => gstOk(g?.number)), [a1, a2, b1].map((g) => `${g?.number} (${g?.number?.length})`).join(', '));

    const a1Order = await w.m.FoodOrder.findOne({ 'invoice.number': a1.number }).lean();
    const a1Again = await invoice.assignFoodInvoiceNumber(a1Order);
    const a1Fresh = await invoice.assignFoodInvoiceNumber({ _id: a1Order._id, restaurantId: r1 });
    check('given once: a second call returns the same number', a1Again?.number === a1.number && a1Fresh?.number === a1.number && a1Fresh.assigned === false);
    check('and stores the series details on the order', a1Order.invoice.seq === 1 && a1Order.invoice.fy === '2026-27' && a1Order.invoice.series === `food:${r1}`);

    const nextYear = await invoice.assignFoodInvoiceNumber(await fakeOrder(r1, new Date('2027-04-01T05:00:00Z')));
    check('a new financial year starts again at 00001', nextYear?.number === `R${code(r1)}/2728/00001`, nextYear?.number);

    const lateMarch = await invoice.assignFoodInvoiceNumber(await fakeOrder(r1, new Date('2027-03-31T18:00:00Z')));
    check('a delivery on 31 March still continues the old year', lateMarch?.number === `R${code(r1)}/2627/00003`, lateMarch?.number);

    const burst = await Promise.all(Array.from({ length: 20 }, () => fakeOrder(r3)));
    const got = await Promise.all(burst.map((o) => invoice.assignFoodInvoiceNumber(o)));
    const seqs = got.map((g) => Number(String(g?.number).split('/').pop())).sort((x, y) => x - y);
    check('20 deliveries at once: 20 different numbers, 1..20 with no gap', new Set(got.map((g) => g?.number)).size === 20
        && seqs.every((n, i) => n === i + 1), seqs.join(','));

    const same = await fakeOrder(r3);
    const racing = await Promise.all(Array.from({ length: 5 }, () => invoice.assignFoodInvoiceNumber(same)));
    const counter = await series.DocumentCounter.findOne({ series: `food:${r3}`, fy: '2026-27' }).lean();
    check('one order assigned 5 times at once: one number, one counter step',
        new Set(racing.map((g) => g?.number)).size === 1 && counter.seq === 21, `${racing.map((g) => g?.number).join(' | ')} / counter ${counter.seq}`);

    await config.set('invoice.prefix', { level: 'partner', scopeId: String(r2), value: 'ST123', updatedBy: 'test' });
    const custom = await invoice.assignFoodInvoiceNumber(await fakeOrder(r2));
    check('a restaurant-level prefix: ST123/2627/00002', custom?.number === 'ST123/2627/00002', custom?.number);

    await config.set('invoice.prefix', { level: 'partner', scopeId: String(r2), value: 'QD-RST123', updatedBy: 'test' });
    const tooLong = await invoice.assignFoodInvoiceNumber(await fakeOrder(r2));
    check('a prefix that makes the number > 16 chars falls back to the compliant default', tooLong?.number === `R${code(r2)}/2627/00003` && gstOk(tooLong?.number), tooLong?.number);
    await config.set('invoice.prefix', { level: 'partner', scopeId: String(r2), value: 'ST123', updatedBy: 'test' });
    await config.set('invoice.numberFormat', { level: 'vertical', scopeId: 'food', value: '{prefix}_{fyShort}_{seq:3}', updatedBy: 'test' });
    const badChars = await invoice.assignFoodInvoiceNumber(await fakeOrder(r2));
    check('a format with characters GST does not allow falls back too', badChars?.number === `R${code(r2)}/2627/00004`, badChars?.number);
    await config.set('invoice.numberFormat', { level: 'vertical', scopeId: 'food', value: '{prefix}-{fyShort}-{seq:4}', updatedBy: 'test' });
    const okCustom = await invoice.assignFoodInvoiceNumber(await fakeOrder(r2));
    check('a compliant custom format is used as configured', okCustom?.number === 'ST123-2627-0005', okCustom?.number);
    await config.set('invoice.numberFormat', { level: 'vertical', scopeId: 'food', value: '{prefix}/{fyShort}/{seq:5}', updatedBy: 'test' });
    const reread = await w.m.FoodOrder.findById(a1Order._id).lean();
    check('numbers already given stay as they were', reread.invoice.number === a1.number);

    const legacy = await fakeOrder(r1);
    const legacyData = invoice.buildFoodInvoiceData(legacy, {});
    check('an order delivered before numbering keeps FD-<order id>', legacyData.invoiceNumber === `FD-${legacy.order_id}`, legacyData.invoiceNumber);
    const numberedData = invoice.buildFoodInvoiceData(a1Order, {});
    check('a numbered order prints its number', numberedData.invoiceNumber === a1.number);

    const due = await fakeOrder(r1, deliveredOn, { invoice: { due: true } });
    const pdf = await invoice.getCustomerOrderInvoice(String(due._id), uid);
    check('an order due a number but missing one gets it on download', pdf.data.invoiceNumber === `R${code(r1)}/2627/00004`, pdf.data.invoiceNumber);
    const legacyPdf = await invoice.getCustomerOrderInvoice(String(legacy._id), uid);
    check('the download for an older order still says FD-', legacyPdf.data.invoiceNumber === `FD-${legacy.order_id}` && !(await w.m.FoodOrder.findById(legacy._id).lean()).invoice?.number);

    console.log('\n[3] proof of delivery, through the real completion');

    const riderId = String(w.rider._id);
    const atDrop = async () => {
        const o = await w.saved(await w.place(uid, { items, pricing: (await calc({})).pricing }));
        await w.m.FoodOrder.updateOne({ _id: o._id }, {
            $set: {
                orderStatus: 'reached_drop',
                'dispatch.status': 'accepted',
                'dispatch.deliveryPartnerId': w.rider._id,
                'deliveryState.currentPhase': 'at_drop',
                'deliveryState.pickedUpAt': new Date(),
                'deliveryVerification.dropOtp': { required: true, verified: false },
                deliveryOtp: '4321',
            },
        });
        return String(o._id);
    };

    const withCode = await atDrop();
    const e1 = await thrownBy(() => delivery.completeDelivery(withCode, riderId, {}));
    check('code in use (the default): completing without it is refused', Boolean(e1) && /OTP is required/.test(e1.message), e1?.message);
    const reachedWithCode = await delivery.confirmReachedDropDelivery(withCode, riderId).catch((e) => e);
    check('with the code in use, no photo is asked for', reachedWithCode?.dropPhotoRequired === false, reachedWithCode?.message || reachedWithCode?.dropPhotoRequired);
    await w.m.FoodOrder.updateOne({ _id: withCode }, { $set: { deliveryOtp: '4321' } });
    const done = await delivery.completeDelivery(withCode, riderId, { otp: '4321' });
    check('with the code it completes', done.orderStatus === 'delivered');
    const doneRow = await w.m.FoodOrder.findById(withCode).lean();
    check('and the delivery gave it the restaurant\'s next invoice number',
        doneRow.invoice?.due === true && doneRow.invoice?.number === `R${code(w.restaurant._id)}/${fy(new Date()).short}/00001`, doneRow.invoice?.number);

    await config.set('delivery.dropOtpRequired', { level: 'vertical', scopeId: 'food', value: false, updatedBy: 'test' });
    const noCode = await atDrop();
    const reached = await delivery.confirmReachedDropDelivery(noCode, riderId).catch((e) => e);
    check('"reached drop" tells the rider app a photo is required', reached?.dropPhotoRequired === true, reached?.message || reached?.dropPhotoRequired);
    const e2 = await thrownBy(() => delivery.completeDelivery(noCode, riderId, {}));
    check('code off for food: completing without a photo is refused', Boolean(e2) && /photo/i.test(e2.message), e2?.message);
    check('and the order stays at the drop', (await w.m.FoodOrder.findById(noCode).lean()).orderStatus === 'reached_drop');
    const e3 = await thrownBy(() => delivery.completeDelivery(noCode, riderId, { dropProof: { photoUrl: 'data:image/png;base64,xx' } }));
    check('a photo that is not an uploaded URL is refused', Boolean(e3) && /uploaded image/.test(e3.message), e3?.message);
    const out = await delivery.completeDelivery(noCode, riderId, {
        dropProof: { photoUrl: 'https://cdn.example.com/food-pod.jpg', lat: 32.115, lng: 76.539 },
    });
    check('a photo completes it without the code', out.orderStatus === 'delivered');
    const asCustomer = await w.orderService.getOrderById(noCode, { userId: uid });
    const asAdmin = await w.orderService.getOrderById(noCode, { admin: true });
    check('the customer sees the photo and where it was taken',
        asCustomer.dropProof?.photoUrl === 'https://cdn.example.com/food-pod.jpg' && near(asCustomer.dropProof?.lat, 32.115));
    check('so does the admin', asAdmin.dropProof?.photoUrl === 'https://cdn.example.com/food-pod.jpg');
    check('the second delivery took 00002', asAdmin.invoice?.number?.endsWith('/00002'), asAdmin.invoice?.number);
    await config.set('delivery.dropOtpRequired', { level: 'vertical', scopeId: 'food', value: true, updatedBy: 'test' });

    failed = summary();
} catch (err) {
    console.error(err);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
