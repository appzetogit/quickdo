/**
 * Quick-commerce returns: refund arithmetic, eligibility and lifecycle.
 *
 * No database — both modules under test are pure by design, so every money rule can
 * be asserted directly. The cases that matter are the ones where a wrong answer costs
 * real money: refunding more than was collected, reversing a discount twice, or
 * trusting a quantity the client supplied.
 *
 * Run:  node tests/qc.returns.smoke.mjs
 */
import assert from 'node:assert/strict';

const BASE = '../src/modules/quickCommerce/modules/food/returns/services';
const { calculateReturnRefund, apportion, FAULT } = await import(`${BASE}/returnRefund.service.js`);
const {
    checkEligibility, canTransition, assertTransition, shouldRestock,
    RETURN_STATUS, PERISHABILITY,
} = await import(`${BASE}/returnPolicy.service.js`);

let fails = 0;
const check = (name, fn) => {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (err) { fails += 1; console.log(`  FAIL ${name}\n         ${err.message}`); }
};

/** 2 x 100 + 1 x 250 = 450 goods, 50 off, 5% GST, 30 delivery, 10 platform. */
const order = () => ({
    orderStatus: 'delivered',
    deliveredAt: new Date('2026-08-20T10:00:00Z'),
    items: [
        { itemId: 'A', name: 'Atta 5kg', quantity: 2, price: 100, variantPrice: 0, variantId: '', gstRate: 5 },
        { itemId: 'B', name: 'Ghee 1L', quantity: 1, price: 250, variantPrice: 0, variantId: '', gstRate: 5 },
    ],
    pricing: {
        subtotal: 450, discount: 50, tax: 20, deliveryFee: 30, deliveryFeeGst: 5,
        platformFee: 10, total: 465,
    },
});

console.log('\n[1] apportion never loses or invents a paisa');

check('shares sum exactly to the total', () => {
    for (const total of [100, 999, 1, 0, 33333]) {
        for (const weights of [[1, 1, 1], [450, 250, 300], [1], [7, 0, 3]]) {
            const shares = apportion(total, weights);
            assert.equal(shares.reduce((a, b) => a + b, 0), total, `${total} / ${weights}`);
            assert.ok(shares.every((s) => s >= 0), 'no negative share');
        }
    }
});

check('an indivisible total still sums (the classic 100/3 case)', () => {
    const shares = apportion(100, [1, 1, 1]);
    assert.equal(shares.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(shares.slice().sort((a, b) => a - b), [33, 33, 34]);
});

check('zero weights do not throw', () => {
    assert.deepEqual(apportion(500, [0, 0]), [0, 0]);
});

console.log('\n[2] Refund arithmetic');

check('a full return gives back everything the customer paid', () => {
    const r = calculateReturnRefund({
        order: order(),
        returnedLines: [{ itemId: 'A', quantity: 2 }, { itemId: 'B', quantity: 1 }],
        fault: FAULT.CUSTOMER,
    });
    assert.equal(r.isFullReturn, true);
    // Goods 450 - discount 50 + tax 20 + delivery 35 + platform 10 = 465 = order total.
    assert.equal(r.total, 465);
});

check('a partial return claws back its share of the discount', () => {
    const r = calculateReturnRefund({
        order: order(),
        returnedLines: [{ itemId: 'B', quantity: 1 }],
        fault: FAULT.CUSTOMER,
    });
    assert.equal(r.isFullReturn, false);
    assert.equal(r.goods, 250);
    // 250/450 of the 50 discount = 27.78
    assert.equal(r.discountReversed, 27.78);
    // Customer fault + partial => no delivery, no platform fee back.
    assert.equal(r.deliveryFee, 0);
    assert.equal(r.platformFee, 0);
});

check('GST matches the order pricing formula (exclusive, post-discount)', () => {
    const r = calculateReturnRefund({
        order: order(),
        returnedLines: [{ itemId: 'B', quantity: 1 }],
        fault: FAULT.CUSTOMER,
    });
    // computeItemsTax() charges GST on top of the post-discount line value:
    // (250 - 27.78) * 5/100 = 11.11. Extracting it from an inclusive price instead
    // would give 10.58 and quietly under-refund every taxed line.
    assert.ok(Math.abs(r.tax - 11.11) < 0.02, `tax was ${r.tax}, expected ~11.11`);
});

check('seller fault refunds the fees even on a partial return', () => {
    const r = calculateReturnRefund({
        order: order(),
        returnedLines: [{ itemId: 'B', quantity: 1 }],
        fault: FAULT.SELLER,
    });
    assert.equal(r.deliveryFee, 35);
    assert.equal(r.platformFee, 10);
});

check('line refunds sum to exactly the refund total', () => {
    for (const fault of [FAULT.SELLER, FAULT.CUSTOMER]) {
        const r = calculateReturnRefund({
            order: order(),
            returnedLines: [{ itemId: 'A', quantity: 2 }, { itemId: 'B', quantity: 1 }],
            fault,
        });
        const summed = r.lines.reduce((s, l) => s + l.refundAmount, 0);
        assert.ok(Math.abs(summed - r.total) < 0.005, `${fault}: lines ${summed} vs total ${r.total}`);
    }
});

console.log('\n[3] The refund cannot exceed what was collected');

check('successive seller-fault returns never exceed the order total', () => {
    const first = calculateReturnRefund({
        order: order(), returnedLines: [{ itemId: 'A', quantity: 2 }], fault: FAULT.SELLER,
    });
    const second = calculateReturnRefund({
        order: order(),
        returnedLines: [{ itemId: 'B', quantity: 1 }],
        fault: FAULT.SELLER,
        alreadyRefunded: first.total,
    });
    assert.ok(first.total + second.total <= 465.001,
        `refunded ${first.total} + ${second.total} against a 465 order`);
    assert.equal(second.capApplied, true, 'the second return should have been capped');
});

check('a fully-refunded order refunds nothing more', () => {
    const r = calculateReturnRefund({
        order: order(), returnedLines: [{ itemId: 'A', quantity: 1 }],
        fault: FAULT.SELLER, alreadyRefunded: 465,
    });
    assert.equal(r.total, 0);
});

console.log('\n[4] The client is not trusted');

check('a quantity larger than was ordered is clamped', () => {
    const r = calculateReturnRefund({
        order: order(), returnedLines: [{ itemId: 'A', quantity: 999 }], fault: FAULT.CUSTOMER,
    });
    assert.equal(r.lines[0].quantity, 2, 'clamped to the quantity actually bought');
});

check('a price sent by the client is ignored', () => {
    const r = calculateReturnRefund({
        order: order(),
        returnedLines: [{ itemId: 'B', quantity: 1, price: 99999, refundAmount: 99999 }],
        fault: FAULT.CUSTOMER,
    });
    assert.equal(r.goods, 250, 'the order is the only authority on price');
});

check('an item that was never ordered is dropped', () => {
    const r = calculateReturnRefund({
        order: order(), returnedLines: [{ itemId: 'GHOST', quantity: 1 }], fault: FAULT.SELLER,
    });
    assert.equal(r.total, 0);
    assert.equal(r.lines.length, 0);
});

check('zero and negative quantities are dropped', () => {
    for (const quantity of [0, -5]) {
        const r = calculateReturnRefund({
            order: order(), returnedLines: [{ itemId: 'A', quantity }], fault: FAULT.SELLER,
        });
        assert.equal(r.total, 0, `quantity ${quantity}`);
    }
});

console.log('\n[5] Eligibility');

const at = (hours) => new Date(new Date('2026-08-20T10:00:00Z').getTime() + hours * 3600 * 1000);

check('an undelivered order cannot be returned', () => {
    const o = { ...order(), orderStatus: 'picked_up' };
    const r = checkEligibility({ order: o, reasonCode: 'damaged', now: at(1) });
    assert.equal(r.eligible, false);
    assert.match(r.reason, /Cancel the order instead/);
});

check('ambient goods are returnable for 7 days', () => {
    assert.equal(checkEligibility({
        order: order(), reasonCode: 'changed_mind', perishability: PERISHABILITY.AMBIENT, now: at(24 * 6),
    }).eligible, true);
    assert.equal(checkEligibility({
        order: order(), reasonCode: 'changed_mind', perishability: PERISHABILITY.AMBIENT, now: at(24 * 8),
    }).eligible, false);
});

check('chilled goods get 24 hours, not 7 days', () => {
    assert.equal(checkEligibility({
        order: order(), reasonCode: 'changed_mind', perishability: PERISHABILITY.CHILLED, now: at(12),
    }).eligible, true);
    assert.equal(checkEligibility({
        order: order(), reasonCode: 'changed_mind', perishability: PERISHABILITY.CHILLED, now: at(30),
    }).eligible, false);
});

check('fresh produce cannot be returned on remorse', () => {
    const r = checkEligibility({
        order: order(), reasonCode: 'changed_mind', perishability: PERISHABILITY.FRESH, now: at(1),
    });
    assert.equal(r.eligible, false);
    assert.match(r.reason, /Fresh items cannot be returned/);
});

check('fresh produce CAN be reported damaged, within 4 hours', () => {
    const ok = checkEligibility({
        order: order(), reasonCode: 'damaged', perishability: PERISHABILITY.FRESH, now: at(2),
    });
    assert.equal(ok.eligible, true, 'spoiled produce must be reportable');
    assert.equal(ok.fault, 'seller');

    const late = checkEligibility({
        order: order(), reasonCode: 'damaged', perishability: PERISHABILITY.FRESH, now: at(6),
    });
    assert.equal(late.eligible, false);
});

check('a stored order, whose delivery time lives under deliveryState, is returnable', () => {
    // The order schema has no top-level deliveredAt; reading only that name refused
    // every real return as "no delivery time on record".
    const { deliveredAt, ...stored } = order();
    const r = checkEligibility({
        order: { ...stored, deliveryState: { deliveredAt } }, reasonCode: 'damaged', now: at(1),
    });
    assert.equal(r.eligible, true, r.reason);
});

check('the reason fixes the fault, so a caller cannot choose it', () => {
    assert.equal(checkEligibility({ order: order(), reasonCode: 'expired', now: at(1) }).fault, 'seller');
    assert.equal(checkEligibility({ order: order(), reasonCode: 'changed_mind', now: at(1) }).fault, 'customer');
});

console.log('\n[6] Lifecycle');

check('the happy path is walkable', () => {
    const path = [
        RETURN_STATUS.REQUESTED, RETURN_STATUS.APPROVED, RETURN_STATUS.PICKUP_SCHEDULED,
        RETURN_STATUS.PICKED_UP, RETURN_STATUS.INSPECTED, RETURN_STATUS.REFUNDED,
    ];
    for (let i = 0; i < path.length - 1; i += 1) assertTransition(path[i], path[i + 1]);
});

check('a refund cannot happen before inspection', () => {
    assert.equal(canTransition(RETURN_STATUS.REQUESTED, RETURN_STATUS.REFUNDED), false);
    assert.equal(canTransition(RETURN_STATUS.PICKED_UP, RETURN_STATUS.REFUNDED), false,
        'goods must be inspected before money moves');
});

check('a return can still be refused after inspection', () => {
    assert.equal(canTransition(RETURN_STATUS.INSPECTED, RETURN_STATUS.REJECTED), true);
});

check('terminal states are terminal', () => {
    for (const terminal of [RETURN_STATUS.REFUNDED, RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED]) {
        for (const to of Object.values(RETURN_STATUS)) {
            assert.equal(canTransition(terminal, to), false, `${terminal} -> ${to}`);
        }
    }
});

check('a picked-up return can no longer be cancelled by the customer', () => {
    assert.equal(canTransition(RETURN_STATUS.PICKED_UP, RETURN_STATUS.CANCELLED), false);
});

console.log('\n[7] Restocking');

check('only sealed ambient goods go back on the shelf', () => {
    assert.equal(shouldRestock({ reasonCode: 'changed_mind', perishability: PERISHABILITY.AMBIENT, condition: 'sealed' }), true);
    assert.equal(shouldRestock({ reasonCode: 'changed_mind', perishability: PERISHABILITY.AMBIENT, condition: 'opened' }), false);
    assert.equal(shouldRestock({ reasonCode: 'changed_mind', perishability: PERISHABILITY.CHILLED, condition: 'sealed' }), false);
});

check('damaged and expired stock is never restocked', () => {
    for (const reasonCode of ['damaged', 'expired', 'quality']) {
        assert.equal(
            shouldRestock({ reasonCode, perishability: PERISHABILITY.AMBIENT, condition: 'sealed' }),
            false,
            reasonCode,
        );
    }
});

console.log('\n[8] Seller storage capability');

const { canSellerStock, unstockableProducts } = await import(
    '../src/modules/quickCommerce/modules/food/shared/sellerCapability.js'
);

check('ambient goods need no special storage', () => {
    assert.equal(canSellerStock({ storageCapability: [] }, { perishability: 'ambient' }).ok, true);
});

check('a shop with no chiller cannot list chilled goods', () => {
    const r = canSellerStock({ storageCapability: [] }, { perishability: 'chilled' });
    assert.equal(r.ok, false);
    assert.equal(r.required, 'chilled');
    assert.match(r.reason, /chilled storage/);
});

check('a freezer satisfies a chilled requirement', () => {
    assert.equal(canSellerStock({ storageCapability: ['frozen'] }, { perishability: 'chilled' }).ok, true);
});

check('a chiller does NOT satisfy a frozen requirement', () => {
    const r = canSellerStock(
        { storageCapability: ['chilled'] },
        { perishability: 'chilled', requiresFreezer: true },
    );
    assert.equal(r.ok, false);
    assert.equal(r.required, 'frozen');
});

check('reducing capability surfaces what must come off the shelf', () => {
    const seller = { storageCapability: [] };
    const catalogue = [
        { sku: 'RICE', perishability: 'ambient' },
        { sku: 'MILK', perishability: 'chilled' },
        { sku: 'PEAS', perishability: 'fresh', requiresFreezer: true },
    ];
    const blocked = unstockableProducts(seller, catalogue).map((p) => p.sku);
    assert.deepEqual(blocked, ['MILK', 'PEAS']);
});

console.log('\n[9] Lines exactly as order creation stores them');

/**
 * The fixture at the top has variantPrice 0, which no real order has:
 * resolveFoodItemPrice() stamps variantPrice with the unit price on every line, sized
 * or not. Adding it to the price refunded every line twice and nothing here noticed.
 *
 * Atta 100 at 18% + Salt 100 with no slab of its own (taxed at the 5% fallback):
 * subtotal 200, tax 18 + 5 = 23, delivery 30 + 5.40 GST, platform 10 => 268.40.
 */
const realOrder = (pricing = {}) => ({
    orderStatus: 'delivered',
    deliveredAt: new Date('2026-08-20T10:00:00Z'),
    items: [
        { itemId: 'ATTA', name: 'Atta 1kg', quantity: 1, price: 100, variantPrice: 100, variantId: '', gstRate: 18 },
        { itemId: 'SALT', name: 'Salt 1kg', quantity: 1, price: 100, variantPrice: 100, variantId: '', gstRate: null },
    ],
    pricing: {
        subtotal: 200, discount: 0, tax: 23, deliveryFee: 30, deliveryFeeGst: 5.4,
        platformFee: 10, total: 268.4, ...pricing,
    },
});

check('returning the Atta refunds 100 + 18 GST, not twice the price', () => {
    const r = calculateReturnRefund({
        order: realOrder(), returnedLines: [{ itemId: 'ATTA', quantity: 1 }], fault: FAULT.CUSTOMER,
    });
    assert.equal(r.goods, 100);
    assert.equal(r.total, 118, `refunded ${r.total}`);
    assert.equal(r.lines[0].unitPrice, 100);
});

check('a full return of real lines still refunds exactly the order total', () => {
    const r = calculateReturnRefund({
        order: realOrder(),
        returnedLines: [{ itemId: 'ATTA', quantity: 1 }, { itemId: 'SALT', quantity: 1 }],
        fault: FAULT.CUSTOMER,
    });
    assert.equal(r.total, 268.4, `refunded ${r.total}`);
    assert.equal(r.capApplied, false, 'the line maths alone must reach the total, not the cap');
});

check('with no stored subtotal the discount share is still taken against the real basket', () => {
    // 20 off a 200 basket: the Atta's share is 10. Summing price + variantPrice made the
    // basket 400 and the share 5, under-reversing the discount on every such order.
    const r = calculateReturnRefund({
        order: realOrder({ subtotal: undefined, discount: 20 }),
        returnedLines: [{ itemId: 'ATTA', quantity: 1 }],
        fault: FAULT.CUSTOMER,
    });
    assert.equal(r.discountReversed, 10);
});

check('a line with no slab of its own refunds its own tax, not a share of the order tax', () => {
    // Salt was taxed 5 (5% fallback on 100). Apportioning the whole order tax of 23 by
    // value gave it 11.50 -- more than half of it the Atta's 18% GST.
    const r = calculateReturnRefund({
        order: realOrder(), returnedLines: [{ itemId: 'SALT', quantity: 1 }], fault: FAULT.CUSTOMER,
    });
    assert.equal(r.tax, 5, `tax was ${r.tax}`);
    assert.equal(r.total, 105, `refunded ${r.total}`);
});

check('the fallback rate recorded on the order is used when it is there', () => {
    const r = calculateReturnRefund({
        order: realOrder({ gstFallbackRate: 5 }), returnedLines: [{ itemId: 'SALT', quantity: 1 }], fault: FAULT.CUSTOMER,
    });
    assert.equal(r.tax, 5);
});

check('a discounted untagged line refunds GST on its post-discount value', () => {
    // 20 off 200: Salt net 90, Atta net 90. Tax charged 90 * 18% + 90 * 5% = 16.20 + 4.50 = 20.70.
    const r = calculateReturnRefund({
        order: realOrder({ discount: 20, tax: 20.7, total: 246.1 }),
        returnedLines: [{ itemId: 'SALT', quantity: 1 }],
        fault: FAULT.CUSTOMER,
    });
    assert.equal(r.tax, 4.5, `tax was ${r.tax}`);
    assert.equal(r.total, 94.5);
});

check('unit returns of a line taxed in paise give back exactly the GST charged', () => {
    // Oil 105 at 5%, three units: 15.75 GST, which is what computeItemsTax now charges.
    const oil = {
        orderStatus: 'delivered',
        deliveredAt: new Date('2026-08-20T10:00:00Z'),
        items: [{ itemId: 'OIL', name: 'Oil 1L', quantity: 3, price: 105, variantPrice: 105, variantId: '', gstRate: 5 }],
        pricing: { subtotal: 315, discount: 0, tax: 15.75, deliveryFee: 0, deliveryFeeGst: 0, platformFee: 0, total: 330.75 },
    };
    let refunded = 0;
    for (let i = 0; i < 3; i += 1) {
        const r = calculateReturnRefund({
            order: oil, returnedLines: [{ itemId: 'OIL', quantity: 1 }], fault: FAULT.CUSTOMER, alreadyRefunded: refunded,
        });
        assert.equal(r.tax, 5.25);
        refunded = Math.round((refunded + r.total) * 100) / 100;
    }
    assert.equal(refunded, 330.75);
});

console.log(fails === 0 ? '\nAll quick-commerce return rules hold.\n' : `\n${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
