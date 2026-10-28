/**
 * A customer may cancel a food order after the restaurant accepts, but only
 * inside the window the admin set (Food -> Order cancellation).
 *
 * Run: node tests/food-cancel-window.smoke.mjs
 *
 * What this guards:
 *   - off (the default), nothing changes: cancel only before the restaurant accepts;
 *   - on, an accepted order can be cancelled for N minutes, then not;
 *   - once the kitchen starts preparing it cannot, unless the admin allowed that;
 *   - never once the rider has the food;
 *   - the customer's order view tells the app whether to show Cancel, and until when.
 *
 * Drives the real cancelOrder against an in-memory Mongo.
 */
import { startFoodWorld, makeChecker, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('cancel_window');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const policy = await import('../src/modules/food/orders/services/cancellationPolicy.js');
    const items = [w.appLine(w.dish)];
    const buyer = await w.makeUser();
    const minutesAgo = (m) => new Date(Date.now() - m * 60_000);

    const orderAt = async (orderStatus, { acceptedMinutesAgo = 1, phase } = {}) => {
        const order = await w.saved(await w.place(buyer._id, { items, pricing: await w.quote(buyer._id, { items }) }));
        await w.m.FoodOrder.updateOne({ _id: order._id }, {
            $set: {
                orderStatus,
                ...(phase ? { 'deliveryState.currentPhase': phase } : {}),
            },
            $push: { statusHistory: { at: minutesAgo(acceptedMinutesAgo), byRole: 'RESTAURANT', from: 'created', to: 'confirmed' } },
        });
        return String(order._id);
    };
    const cancel = (id) => w.orderService.cancelOrder(id, String(buyer._id), 'changed my mind');
    const statusOf = async (id) => (await w.m.FoodOrder.findById(id).lean()).orderStatus;

    console.log('\nsetting off (the default)');
    policy.clearCancelRulesCache();
    const offAccepted = await orderAt('confirmed');
    const offErr = await thrownBy(() => cancel(offAccepted));
    check('an accepted order cannot be cancelled', Boolean(offErr), offErr?.message || 'cancelled');
    check('and the reason says why', /accepted/.test(offErr?.message || ''), offErr?.message);
    const waiting = await w.saved(await w.place(buyer._id, { items, pricing: await w.quote(buyer._id, { items }) }));
    await cancel(String(waiting._id));
    check('an order still waiting for the restaurant can be', (await statusOf(String(waiting._id))) === 'cancelled_by_user');

    console.log('\nsetting on: 5 minutes, stop when preparing');
    await policy.setCancelRules({ allowAfterAccept: true, windowMinutes: 5, stopWhenPreparing: true });
    const fresh = await orderAt('confirmed', { acceptedMinutesAgo: 2 });
    const view = await w.orderService.getOrderById(fresh, { userId: String(buyer._id) });
    check('the order view offers Cancel', view.cancellation?.allowed === true, JSON.stringify(view.cancellation));
    check('with about 3 minutes left', view.cancellation?.secondsLeft > 170 && view.cancellation?.secondsLeft <= 180, view.cancellation?.secondsLeft);
    await cancel(fresh);
    check('accepted 2 minutes ago: cancelled', (await statusOf(fresh)) === 'cancelled_by_user');

    const late = await orderAt('confirmed', { acceptedMinutesAgo: 6 });
    const lateErr = await thrownBy(() => cancel(late));
    check('accepted 6 minutes ago: refused', Boolean(lateErr), lateErr?.message || 'cancelled');
    check('saying the window has passed', /more than 5 minutes ago/.test(lateErr?.message || ''), lateErr?.message);
    const lateView = await w.orderService.getOrderById(late, { userId: String(buyer._id) });
    check('and the order view no longer offers Cancel', lateView.cancellation?.allowed === false);

    const cooking = await orderAt('preparing', { acceptedMinutesAgo: 1 });
    const cookingErr = await thrownBy(() => cancel(cooking));
    check('preparing, inside the window: refused', Boolean(cookingErr), cookingErr?.message || 'cancelled');
    check('saying the kitchen has started', /preparing/.test(cookingErr?.message || ''), cookingErr?.message);

    console.log('\nsetting on, preparing allowed');
    await policy.setCancelRules({ stopWhenPreparing: false });
    const cooking2 = await orderAt('preparing', { acceptedMinutesAgo: 1 });
    await cancel(cooking2);
    check('preparing, inside the window: cancelled', (await statusOf(cooking2)) === 'cancelled_by_user');

    const picked = await orderAt('picked_up', { acceptedMinutesAgo: 1, phase: 'en_route_to_delivery' });
    const pickedErr = await thrownBy(() => cancel(picked));
    check('never once the rider has the food', Boolean(pickedErr) && (await statusOf(picked)) === 'picked_up', pickedErr?.message || 'cancelled');

    await policy.setCancelRules({ windowMinutes: 0 }).then(
        () => check('a zero-minute window is refused', false),
        () => check('a zero-minute window is refused', true),
    );

    failed = summary();
} catch (err) {
    console.error(err);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
