/**
 * An admin cannot delete an order that money has moved on.
 *
 * Run: node tests/food-admin-delete-keeps-money.smoke.mjs
 *
 * Found in the audit: deleteOrderAdmin hard-deleted the order and its ledger row
 * whatever its state. Every balance is summed from those documents, so deleting
 * a delivered COD order erased the rider's cash debt and earning and the
 * restaurant's share.
 *
 * Drives the real createOrder and deleteOrderAdmin against an in-memory Mongo.
 */
import { startFoodWorld, makeChecker, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('admin_delete');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const items = [w.appLine(w.dish)];
    const buyer = await w.makeUser();
    const newOrder = async () => w.saved(await w.place(buyer._id, { items, pricing: await w.quote(buyer._id, { items }) }));
    const adminId = '64b000000000000000000001';

    console.log('\na delivered COD order');
    const delivered = await newOrder();
    await w.m.FoodOrder.updateOne({ _id: delivered._id }, {
        $set: { orderStatus: 'delivered', 'payment.status': 'paid', 'dispatch.deliveryPartnerId': w.rider._id },
    });
    const err = await thrownBy(() => w.orderService.deleteOrderAdmin(String(delivered._id), adminId));
    check('THE BUG: deleting it is refused', Boolean(err), err?.message || 'deleted');
    check('the order is still there', Boolean(await w.m.FoodOrder.findById(delivered._id).lean()));
    check('and so is its ledger row', Boolean(await w.m.FoodTransaction.findOne({ orderId: delivered._id }).lean()));

    console.log('\na paid order not yet delivered');
    const paid = await newOrder();
    await w.m.FoodOrder.updateOne({ _id: paid._id }, { $set: { 'payment.status': 'paid' } });
    check('deleting it is refused', Boolean(await thrownBy(() => w.orderService.deleteOrderAdmin(String(paid._id), adminId))));

    console.log('\na refunded order');
    const refunded = await newOrder();
    await w.m.FoodOrder.updateOne({ _id: refunded._id }, {
        $set: { orderStatus: 'cancelled_by_restaurant', 'payment.status': 'refunded' },
    });
    check('deleting it is refused', Boolean(await thrownBy(() => w.orderService.deleteOrderAdmin(String(refunded._id), adminId))));

    console.log('\nan unpaid COD order nobody has delivered');
    const unpaid = await newOrder();
    const res = await w.orderService.deleteOrderAdmin(String(unpaid._id), adminId);
    check('can still be deleted', res?.deleted === true && !(await w.m.FoodOrder.findById(unpaid._id).lean()));

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
