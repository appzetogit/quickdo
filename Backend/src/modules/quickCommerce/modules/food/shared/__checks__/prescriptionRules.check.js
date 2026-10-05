/**
 * Self-check for medical-order prescription rules.
 * Run: node src/modules/quickCommerce/modules/food/shared/__checks__/prescriptionRules.check.js
 */
import assert from 'node:assert/strict';
import {
    PRESCRIPTION_STATUS,
    assertCanAcceptOrder,
    buildOrderPrescription,
    canAcceptOrder,
    reviewPrescription,
} from '../prescriptionRules.js';

const throws = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

const NOW = new Date('2026-08-25T10:00:00Z');
const pharmacy = { storeType: 'pharmacy' };
const grocery = { storeType: 'grocery' };

// --- creation: non-medical orders carry nothing --------------------------
{
    const rx = buildOrderPrescription(grocery, {}, NOW);
    assert.equal(rx.required, false);
    assert.equal(rx.status, PRESCRIPTION_STATUS.NOT_REQUIRED);
    assert.equal(rx.imageUrl, '');
}
// A prescription sent for a grocery order is discarded, not stored.
{
    const rx = buildOrderPrescription(grocery, { prescriptionImage: 'https://cdn/rx.jpg' }, NOW);
    assert.equal(rx.imageUrl, '');
    assert.equal(rx.required, false);
}
// Unknown / missing seller type is treated as non-medical.
assert.equal(buildOrderPrescription({}, {}, NOW).required, false);
assert.equal(buildOrderPrescription(null, {}, NOW).required, false);

// --- creation: a medical order must carry one ----------------------------
throws(() => buildOrderPrescription(pharmacy, {}, NOW), /Upload a prescription/);
throws(() => buildOrderPrescription(pharmacy, { prescriptionImage: '   ' }, NOW), /Upload a prescription/);
{
    const rx = buildOrderPrescription(pharmacy, { prescriptionImage: ' https://cdn/rx.jpg ' }, NOW);
    assert.equal(rx.required, true);
    assert.equal(rx.imageUrl, 'https://cdn/rx.jpg'); // trimmed
    assert.equal(rx.status, PRESCRIPTION_STATUS.PENDING_REVIEW);
    assert.equal(rx.uploadedAt, NOW);
    assert.equal(rx.reviewedAt, null);
}
// Either key works, since the two clients name it differently.
assert.equal(buildOrderPrescription(pharmacy, { prescriptionImageUrl: 'https://cdn/a.jpg' }, NOW).imageUrl, 'https://cdn/a.jpg');

// --- acceptance gate -----------------------------------------------------
const order = (status, extra = {}) => ({ prescription: { required: true, status, ...extra } });

// Non-medical orders are never gated.
assert.equal(canAcceptOrder({ prescription: { required: false } }, 'confirmed').ok, true);
assert.equal(canAcceptOrder({}, 'confirmed').ok, true);

// Medical orders are gated until reviewed.
assert.equal(canAcceptOrder(order(PRESCRIPTION_STATUS.PENDING_REVIEW), 'confirmed').ok, false);
assert.match(canAcceptOrder(order(PRESCRIPTION_STATUS.PENDING_REVIEW), 'confirmed').reason, /Review the customer/);
assert.equal(canAcceptOrder(order(PRESCRIPTION_STATUS.APPROVED), 'confirmed').ok, true);
assert.equal(canAcceptOrder(order(PRESCRIPTION_STATUS.REJECTED), 'confirmed').ok, false);
assert.match(canAcceptOrder(order(PRESCRIPTION_STATUS.REJECTED), 'confirmed').reason, /was rejected/);

// Every acceptance-shaped status is gated, not just 'confirmed'.
for (const s of ['confirmed', 'preparing', 'ready_for_pickup']) {
    assert.equal(canAcceptOrder(order(PRESCRIPTION_STATUS.PENDING_REVIEW), s).ok, false, s);
}
// Cancelling an unreviewed medical order must stay possible.
for (const s of ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin']) {
    assert.equal(canAcceptOrder(order(PRESCRIPTION_STATUS.PENDING_REVIEW), s).ok, true, s);
}

throws(() => assertCanAcceptOrder(order(PRESCRIPTION_STATUS.PENDING_REVIEW), 'confirmed'), /Review the customer/);
assertCanAcceptOrder(order(PRESCRIPTION_STATUS.APPROVED), 'confirmed'); // does not throw

// --- review --------------------------------------------------------------
{
    const o = order(PRESCRIPTION_STATUS.PENDING_REVIEW);
    const next = reviewPrescription(o, 'approved', { reviewerId: 'seller-1', now: NOW });
    assert.equal(next.status, PRESCRIPTION_STATUS.APPROVED);
    assert.equal(next.reviewedAt, NOW);
    assert.equal(next.reviewedBy, 'seller-1');
    assert.equal(next.rejectionReason, '');
}
{
    const o = order(PRESCRIPTION_STATUS.PENDING_REVIEW);
    const next = reviewPrescription(o, 'rejected', { reason: ' unreadable ', now: NOW });
    assert.equal(next.status, PRESCRIPTION_STATUS.REJECTED);
    assert.equal(next.rejectionReason, 'unreadable');
}
// A rejection must say why, or the customer cannot fix it.
throws(() => reviewPrescription(order(PRESCRIPTION_STATUS.PENDING_REVIEW), 'rejected', {}), /Give a reason/);
// Reviewing twice, or reviewing an order with no prescription, is refused.
throws(() => reviewPrescription(order(PRESCRIPTION_STATUS.APPROVED), 'approved', {}), /already been reviewed/);
throws(() => reviewPrescription(order(PRESCRIPTION_STATUS.REJECTED), 'approved', {}), /already been reviewed/);
throws(() => reviewPrescription({ prescription: { required: false } }, 'approved', {}), /does not carry a prescription/);
throws(() => reviewPrescription(order(PRESCRIPTION_STATUS.PENDING_REVIEW), 'maybe', {}), /approved or rejected/);

console.log('All prescription-rule checks passed.');
