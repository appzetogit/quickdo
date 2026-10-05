/**
 * Once the rider has the food, the restaurant and the admin cannot cancel.
 *
 * Run: node tests/food-no-cancel-after-pickup.smoke.mjs
 *
 * Found in the audit: isStatusAdvance treats a cancel as valid from anywhere
 * short of delivered, and cancelled_by_restaurant is on the restaurant's list,
 * so an order could be cancelled from picked_up or reached_drop. A rider is
 * only paid for delivered orders. An online customer is refunded in full,
 * delivery fee included, and there is no cancellation charge. So the rider made
 * the trip for nothing.
 *
 * Drives the real updateOrderStatusRestaurant (the restaurant and the admin
 * endpoints both call it) against an in-memory Mongo.
 */
import { startFoodWorld, makeChecker, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('no_cancel_after_pickup');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const items = [w.appLine(w.dish)];
    const buyer = await w.makeUser();
    const orderAt = async (orderStatus, currentPhase) => {
        const order = await w.saved(await w.place(buyer._id, { items, pricing: await w.quote(buyer._id, { items }) }));
        await w.m.FoodOrder.updateOne({ _id: order._id }, {
            $set: {
                orderStatus,
                'dispatch.status': 'accepted',
                'dispatch.deliveryPartnerId': w.rider._id,
                ...(currentPhase ? { 'deliveryState.currentPhase': currentPhase } : {}),
            },
        });
        return String(order._id);
    };
    const restaurantCancel = (id) => w.orderService.updateOrderStatusRestaurant(
        id, String(w.restaurant._id), 'cancelled_by_restaurant', 'out of stock',
    );
    const adminCancel = (id) => w.orderService.updateOrderStatusRestaurant(
        id, null, 'cancelled_by_restaurant', 'admin cancel', { role: 'ADMIN', id: null },
    );
    const statusOf = async (id) => (await w.m.FoodOrder.findById(id).lean()).orderStatus;

    for (const [status, phase] of [['picked_up', 'en_route_to_delivery'], ['reached_drop', 'at_drop']]) {
        console.log(`\nan order at ${status}`);
        const id = await orderAt(status, phase);
        const byRestaurant = await thrownBy(() => restaurantCancel(id));
        check('THE BUG: the restaurant cannot cancel it', Boolean(byRestaurant), byRestaurant?.message || 'cancelled');
        const byAdmin = await thrownBy(() => adminCancel(id));
        check('nor can the admin', Boolean(byAdmin), byAdmin?.message || 'cancelled');
        check('it is still on its way', (await statusOf(id)) === status, await statusOf(id));
    }

    console.log('\nan order still in the kitchen');
    const preparing = await orderAt('preparing');
    await restaurantCancel(preparing);
    check('the restaurant can cancel it', (await statusOf(preparing)) === 'cancelled_by_restaurant', await statusOf(preparing));
    const waiting = await orderAt('ready_for_pickup');
    await adminCancel(waiting);
    check('the admin can cancel one awaiting pickup', (await statusOf(waiting)) === 'cancelled_by_restaurant', await statusOf(waiting));

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
