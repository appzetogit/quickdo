/**
 * The two screens that exist only in the Medical panel: the prescription queue
 * and the drug-licence register.
 *
 * Run: node tests/medical-admin-screens.smoke.mjs
 *
 * Both are read-only views over data that decides whether medicine may lawfully
 * be supplied, so the things worth pinning are the ones that would mislead an
 * operator: a grocer's order appearing on a medical screen, a pharmacy with a
 * blank expiry sitting there looking compliant, a licence called expired on the
 * day it actually runs out, and tab counts that disagree with the rows beneath
 * them.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'medical_admin' });

const { FoodOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const queue = await import('../src/modules/quickCommerce/modules/food/admin/services/prescriptionAdmin.service.js');
const licences = await import('../src/modules/quickCommerce/modules/food/admin/services/drugLicenceAdmin.service.js');
// The queue populates the customer, so that model has to be registered on this
// connection before any query runs.
await import('../src/modules/quickCommerce/core/users/user.model.js');

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};
const rejects = async (fn, pattern) => {
    let threw = null;
    try { await fn(); } catch (err) { threw = err; }
    assert.ok(threw, 'expected this to be refused');
    assert.match(threw.message, pattern);
};

let phone = 6000000000;
const seller = async (name, fields = {}) => FoodRestaurant.create({
    restaurantName: name, ownerName: 'Owner', status: 'approved',
    email: `${name.replace(/\W/g, '')}@example.com`, phone: String(phone++),
    ...fields,
});
const day = (offset) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
};

const chemist = await seller('City Chemist', {
    storeType: 'pharmacy',
    drugLicenseNumber: 'DL-1', drugLicenseImage: 'https://x/l1.jpg', drugLicenseExpiry: day(200),
});
const expiringChemist = await seller('Night Chemist', {
    storeType: 'pharmacy',
    drugLicenseNumber: 'DL-2', drugLicenseImage: 'https://x/l2.jpg', drugLicenseExpiry: day(10),
});
const expiredChemist = await seller('Old Chemist', {
    storeType: 'pharmacy',
    drugLicenseNumber: 'DL-3', drugLicenseImage: 'https://x/l3.jpg', drugLicenseExpiry: day(-2),
});
const blankChemist = await seller('Blank Chemist', { storeType: 'pharmacy', drugLicenseNumber: 'DL-4' });
const grocer = await seller('Corner Kirana', {
    storeType: 'kirana',
    // A grocer carrying a licence number must still never appear on this screen.
    drugLicenseNumber: 'DL-9', drugLicenseImage: 'https://x/l9.jpg', drugLicenseExpiry: day(100),
});

let seq = 0;
const order = async (sellerDoc, rx = {}) => {
    const _id = new mongoose.Types.ObjectId();
    await FoodOrder.collection.insertOne({
        _id,
        order_id: `QC-RX-${++seq}`,
        userId: new mongoose.Types.ObjectId(),
        restaurantId: sellerDoc._id,
        customerName: 'Asha',
        customerPhone: '9876543210',
        items: [],
        prescriptionOnly: true,
        pricing: { subtotal: 0, total: 0 },
        payment: { method: 'cash', status: 'cod_pending' },
        orderStatus: 'created',
        prescription: { required: true, imageUrl: 'https://x/rx.jpg', status: 'pending_review', bill: { status: 'none' }, ...rx },
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    return _id;
};

const waiting = await order(chemist);
await order(chemist, { status: 'approved', bill: { status: 'submitted', amount: 850, imageUrl: 'https://x/b.jpg' } });
await order(expiringChemist, { status: 'rejected', rejectionReason: 'Photo unreadable' });
await order(grocer, { status: 'pending_review' });

console.log('\nthe prescription queue');
const all = await queue.listPrescriptionOrders({});
await check('THE LEAK IT PREVENTS: a grocer\'s order never reaches a medical screen', () => {
    const sellers = all.orders.map((o) => o.sellerName);
    assert.ok(!sellers.includes('Corner Kirana'), `saw ${sellers.join(', ')}`);
    assert.equal(all.orders.length, 3);
});
await check('each row carries what the operator is called about', () => {
    const row = all.orders.find((o) => o.id === String(waiting));
    assert.equal(row.prescription.status, 'pending_review');
    assert.equal(row.prescription.imageUrl, 'https://x/rx.jpg');
    assert.equal(row.sellerName, 'City Chemist');
    assert.equal(row.customerPhone, '9876543210');
});
await check('THE GAP IT CLOSES: an approved order says whether it waits on the pharmacy or the customer', () => {
    const billed = all.orders.find((o) => o.prescription.bill.status === 'submitted');
    assert.ok(billed, 'the bill state is missing from the queue');
    assert.equal(billed.prescription.bill.amount, 850);
    assert.equal(billed.paymentStatus, 'cod_pending');
});
await check('filtering by status returns only that status', async () => {
    const rejected = await queue.listPrescriptionOrders({ status: 'rejected' });
    assert.equal(rejected.orders.length, 1);
    assert.equal(rejected.orders[0].prescription.rejectionReason, 'Photo unreadable');
});
await check('an unknown status is refused, never ignored', () =>
    rejects(() => queue.listPrescriptionOrders({ status: 'pendingg' }), /Unknown prescription status/));
await check('the tab counts add up to the list beside them', async () => {
    const { counts } = await queue.getPrescriptionOrderCounts({});
    assert.equal(counts.all, 3);
    assert.equal(counts.pending_review, 1);
    assert.equal(counts.approved, 1);
    assert.equal(counts.rejected, 1);
});
await check('one order opens with what was dispensed', async () => {
    const { order: one } = await queue.getPrescriptionOrder(String(waiting));
    assert.equal(one.id, String(waiting));
    assert.ok(Array.isArray(one.items));
});
await check('a grocery order id cannot be opened on the medical screen', async () => {
    const grocerOrder = await order(grocer);
    await rejects(() => queue.getPrescriptionOrder(String(grocerOrder)), /not found/i);
});

console.log('\nthe drug-licence register');
const { licences: rows, counts } = await licences.listDrugLicences({});
const row = (name) => rows.find((r) => r.name === name);
await check('only pharmacies are listed, licence number or not', () => {
    assert.equal(rows.length, 4);
    assert.ok(!rows.some((r) => r.name === 'Corner Kirana'));
});
await check('a licence good for months is valid', () => {
    assert.equal(row('City Chemist').licenceState, 'valid');
    assert.ok(row('City Chemist').daysRemaining > 30);
});
await check('one inside the warning window is flagged to renew', () => {
    assert.equal(row('Night Chemist').licenceState, 'expiring_soon');
    assert.equal(row('Night Chemist').daysRemaining, 10);
});
await check('a lapsed one is expired, with how long ago', () => {
    assert.equal(row('Old Chemist').licenceState, 'expired');
    assert.equal(row('Old Chemist').daysRemaining, -2);
});
await check('THE BUG IT PREVENTS: a blank expiry is missing, not quietly valid', () => {
    assert.equal(row('Blank Chemist').licenceState, 'missing');
    assert.equal(row('Blank Chemist').daysRemaining, null);
});

console.log('\nthe boundary days, where a shop gets suspended by a rounding error');
const licenceOf = (expiry) => licences.classifyDrugLicence(
    { drugLicenseNumber: 'DL', drugLicenseImage: 'img', drugLicenseExpiry: expiry },
);
await check('expiring today is still valid today, not expired this morning', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { state, daysRemaining } = licenceOf(today);
    assert.equal(daysRemaining, 0);
    assert.equal(state, 'expiring_soon');
});
await check('yesterday is expired', () => assert.equal(licenceOf(day(-1)).state, 'expired'));
await check('exactly 30 days out still warns; 31 does not', () => {
    assert.equal(licenceOf(day(30)).state, 'expiring_soon');
    assert.equal(licenceOf(day(31)).state, 'valid');
});

console.log('\nfiltering and counting licences');
await check('the state filter narrows the rows but not the counts', async () => {
    const expired = await licences.listDrugLicences({ state: 'expired' });
    assert.equal(expired.licences.length, 1);
    assert.equal(expired.counts.all, 4, 'the tabs must keep counting every pharmacy');
});
await check('an unknown state is refused', () =>
    rejects(() => licences.listDrugLicences({ state: 'lapsed' }), /Unknown licence state/));
await check('the summary agrees with the list it sits above', async () => {
    const summary = await licences.getDrugLicenceSummary({});
    assert.deepEqual(summary.counts, counts);
});
await check('search matches a pharmacy by name', async () => {
    const found = await licences.listDrugLicences({ search: 'Night' });
    assert.equal(found.licences.length, 1);
    assert.equal(found.licences[0].name, 'Night Chemist');
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
