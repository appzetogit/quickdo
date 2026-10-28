/**
 * Self-check for the pharmacy bill — phases 3 and 4 of the medical flow.
 * Run: node src/modules/quickCommerce/modules/food/shared/__checks__/prescriptionBill.check.js
 *
 * The bill is the one part of the flow where an error costs money: the amount
 * is typed by hand off a paper bill, and the customer is committed to it. The
 * rules that stop a bad one were the only part of the flow with no coverage.
 */
import assert from 'node:assert/strict';
import {
    BILL_STATUS,
    MAX_BILL_AMOUNT,
    assertBillApproved,
    isBillApproved,
    normalizeBillSubmission,
} from '../prescriptionOrder.js';

const throws = (fn, re) =>
    assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

const order = (billStatus, prescriptionOnly = true) => ({
    prescriptionOnly,
    prescription: { bill: { status: billStatus } },
});

// --- phase 3: what the pharmacist may submit -----------------------------

// The amount without the document is one person's word against another's.
throws(() => normalizeBillSubmission({ billAmount: 240 }), /photo of the pharmacy bill/);

// A photo without an amount prices nothing.
throws(() => normalizeBillSubmission({ billImageUrl: 'https://cdn/bill.jpg' }), /bill amount/);
throws(
    () => normalizeBillSubmission({ billImageUrl: 'https://cdn/bill.jpg', billAmount: 0 }),
    /bill amount/,
);
throws(
    () => normalizeBillSubmission({ billImageUrl: 'https://cdn/bill.jpg', billAmount: -5 }),
    /bill amount/,
);

// A mistyped row of zeros is the realistic slip, not an attack.
throws(
    () =>
        normalizeBillSubmission({
            billImageUrl: 'https://cdn/bill.jpg',
            billAmount: MAX_BILL_AMOUNT + 1,
        }),
    /has to be raised with support/,
);

// A good bill survives, rounded to paise.
{
    const bill = normalizeBillSubmission({
        billImageUrl: '  https://cdn/bill.jpg  ',
        billAmount: '240.567',
    });
    assert.equal(bill.imageUrl, 'https://cdn/bill.jpg');
    assert.equal(bill.amount, 240.57);
}

// The alternative field names both apps have used over time still work.
{
    const bill = normalizeBillSubmission({ imageUrl: 'https://cdn/b.jpg', amount: 100 });
    assert.equal(bill.amount, 100);
}

// --- phase 4: the customer's answer gates the order ----------------------

assert.equal(isBillApproved(order(BILL_STATUS.APPROVED)), true);
assert.equal(isBillApproved(order(BILL_STATUS.SUBMITTED)), false);
assert.equal(isBillApproved({}), false);

// Sent but unanswered: the pharmacy may not start on it.
throws(
    () => assertBillApproved(order(BILL_STATUS.SUBMITTED), 'confirmed'),
    /not approved the bill/,
);
throws(
    () => assertBillApproved(order(BILL_STATUS.SUBMITTED), 'preparing'),
    /not approved the bill/,
);
throws(
    () => assertBillApproved(order(BILL_STATUS.SUBMITTED), 'ready_for_pickup'),
    /not approved the bill/,
);

// Declined stays declined.
throws(() => assertBillApproved(order(BILL_STATUS.REJECTED), 'confirmed'), /declined the bill/);

// Paid: the order moves.
assertBillApproved(order(BILL_STATUS.APPROVED), 'confirmed');

// Cancelling is never blocked by an unanswered bill — an unaffordable bill
// must not be a trap.
assertBillApproved(order(BILL_STATUS.SUBMITTED), 'cancelled_by_user');
assertBillApproved(order(BILL_STATUS.SUBMITTED), 'cancelled_by_restaurant');

// No bill was ever sent: left to assertPrescriptionOrderPriced, so orders
// placed before bills existed are not stranded.
assertBillApproved(order(BILL_STATUS.NONE), 'confirmed');

// A catalogue order is not governed by any of this.
assertBillApproved(order(BILL_STATUS.SUBMITTED, false), 'confirmed');

console.log('prescriptionBill.check.js OK');
