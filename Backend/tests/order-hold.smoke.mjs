/**
 * The cancellation hold: a new order waits before reaching the restaurant.
 *
 * Run: node tests/order-hold.smoke.mjs
 *
 * Through the real food order placement, restaurant listing and status update:
 *   - no hold set: the restaurant sees the order straight away, as before;
 *   - hold set: the restaurant neither sees nor can accept it until the hold ends;
 *   - the customer app is told when it will be sent;
 *   - after the hold the order is released once (a second sweep does nothing);
 *   - an order the customer cancels during the hold is never released.
 */
import { startFoodWorld, makeChecker, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('order_hold');
const { check, summary } = makeChecker();
let failed = 1;
try {
  const { set, invalidateCache } = await import('../src/core/config/resolver.service.js');
  const hold = await import('../src/core/orders/orderHold.js');
  const policy = await import('../src/modules/food/orders/services/cancellationPolicy.js');
  const items = [w.appLine(w.dish)];
  const buyer = await w.makeUser();
  const restaurantId = String(w.restaurant._id);
  const newOrder = async () => w.saved(await w.place(buyer._id, { items, pricing: await w.quote(buyer._id, { items }) }));
  const visibleToRestaurant = async (id) => {
    const res = await w.orderService.listOrdersRestaurant(restaurantId, { page: 1, limit: 50 });
    const docs = res?.docs || res?.data || res?.items || res?.orders || [];
    return docs.some((o) => String(o._id || o.id) === String(id));
  };
  const fresh = (id) => w.m.FoodOrder.findById(id).lean();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const plain = await newOrder();
  check('no hold set: the order is not held', !plain.restaurantReleaseAt);
  check('no hold set: the restaurant sees it straight away', await visibleToRestaurant(plain._id));

  await set('orders.holdSeconds', { level: 'vertical', scopeId: 'food', value: 2 });
  invalidateCache();

  const held = await newOrder();
  check('hold set: the order carries its release time', Boolean(held.restaurantReleaseAt) && !held.restaurantReleasedAt);
  check('during the hold the restaurant does not see it', !(await visibleToRestaurant(held._id)));
  const early = await thrownBy(() => w.orderService.updateOrderStatusRestaurant(String(held._id), restaurantId, 'confirmed'));
  check('during the hold the restaurant cannot accept it', /hold/i.test(early?.message || ''), early?.message);
  const view = policy.cancellationForClient(await fresh(held._id), await policy.getCancelRules());
  check('the customer app is told when it will be sent', view.allowed === true && view.hold?.secondsLeft > 0, JSON.stringify(view.hold));

  const cancelled = await newOrder();
  await w.orderService.cancelOrder(String(cancelled._id), String(buyer._id), 'changed my mind');

  await sleep(2600);
  const firstSweep = await hold.sweepHeldOrders();
  const again = await hold.sweepHeldOrders();
  const releasedDoc = await fresh(held._id);
  check('after the hold the order is released', Boolean(releasedDoc.restaurantReleasedAt));
  check('the restaurant now sees it', await visibleToRestaurant(held._id));
  check('released once: a second sweep releases nothing', again === 0, `first ${firstSweep}, second ${again}`);
  const cancelledDoc = await fresh(cancelled._id);
  check('an order cancelled during the hold is never released', !cancelledDoc.restaurantReleasedAt && /^cancel/.test(cancelledDoc.orderStatus), cancelledDoc.orderStatus);
  check('nor shown to the restaurant', !(await visibleToRestaurant(cancelled._id)));

  const ok = await thrownBy(() => w.orderService.updateOrderStatusRestaurant(String(held._id), restaurantId, 'confirmed'));
  check('after release the restaurant can accept it', ok === null, ok?.message);

  failed = summary();
} finally {
  (await import('../src/core/orders/orderHold.js')).stopOrderHoldSweeper();
  await w.stop();
}
process.exit(failed ? 1 : 0);
