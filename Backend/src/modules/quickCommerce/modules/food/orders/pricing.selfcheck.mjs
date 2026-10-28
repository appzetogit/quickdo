// Standalone check of the mixed-slab GST maths — no DB, no server.
//   node src/modules/food/orders/pricing.selfcheck.mjs
import assert from 'node:assert';
import { computeItemsTax } from './services/order-pricing.service.js';

const line = (price, quantity, gstRate = null) => ({ price, quantity, gstRate });
// GST is charged to the paisa, like every other figure on the bill.
const paise = (rupees) => Math.round(rupees * 100) / 100;

// A basket of items with no rate of their own is taxed exactly as the food flow
// taxed it, so nothing that predates per-product slabs changes price.
assert.equal(
    computeItemsTax([line(100, 2), line(50, 1)], { subtotal: 250, discount: 0, fallbackRate: 5 }),
    paise(250 * 0.05),
);

// Discount first, tax second — same order as before.
assert.equal(
    computeItemsTax([line(100, 2)], { subtotal: 200, discount: 50, fallbackRate: 5 }),
    paise(150 * 0.05),
);

// The point of the change: flour at 0 and biscuits at 18 in one basket are
// taxed separately, not averaged into a single basket rate.
assert.equal(
    computeItemsTax([line(100, 1, 0), line(100, 1, 18)], { subtotal: 200, discount: 0, fallbackRate: 12 }),
    18,
);

// A zero-rated item stays zero-rated even though the order-wide rate is not.
// Falling back on `gstRate: 0` would silently tax exempt staples.
assert.equal(
    computeItemsTax([line(100, 1, 0)], { subtotal: 100, discount: 0, fallbackRate: 18 }),
    0,
);

// A basket coupon belongs to no single product, so it reduces each line in
// proportion. Charging it against the highest-taxed line would let the total
// swing on the order the lines happen to arrive in.
const mixed = [line(100, 1, 0), line(100, 1, 18)];
assert.equal(
    computeItemsTax(mixed, { subtotal: 200, discount: 100, fallbackRate: 0 }),
    paise(100 * 0.5 * 0.18),
);

// Lines are summed before rounding, so a long basket does not accumulate a
// rounding error per line.
assert.equal(
    computeItemsTax([line(33, 1, 5), line(33, 1, 5), line(33, 1, 5)], { subtotal: 99, discount: 0, fallbackRate: 0 }),
    paise(99 * 0.05),
);

// Degenerate baskets return zero rather than dividing by zero.
assert.equal(computeItemsTax([], { subtotal: 0, discount: 0, fallbackRate: 18 }), 0);
assert.equal(computeItemsTax([line(100, 1, 18)], { subtotal: 100, discount: 100, fallbackRate: 0 }), 0);

console.log('pricing tax: all assertions passed');
