/**
 * Editing compliance documents sends them for review without taking the
 * outlet offline.
 *
 * Run: node tests/seller-documents.smoke.mjs
 *
 * What this guards:
 *   - a document edit is held as a change request; what is on file, and the
 *     outlet's own status, stay as they were;
 *   - the profile save routes document fields the same way (it used to set
 *     the whole outlet to 'pending');
 *   - a placeholder on file ("11") does not block saving other fields, but a
 *     new value must be well formed;
 *   - approve puts the values on file; reject keeps them off, with a reason;
 *   - a pharmacy also files its drug licence.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('seller_docs');
await mongoose.connect(mongo.getUri('seller_docs'));

const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { sellerDocuments, updateRestaurantProfile } = await import('../src/modules/food/restaurant/services/restaurant.service.js');
const { createSellerDocuments } = await import('../src/core/sellerDocuments.js');

const r = await FoodRestaurant.create({
    restaurantName: 'Doc Diner', ownerName: 'O', ownerPhone: '9877777777', status: 'approved',
    panNumber: '11', gstRegistered: false, fssaiNumber: '11',
});

await check('a malformed new value is refused, naming the format', async () => {
    await assert.rejects(() => sellerDocuments.requestChange(r._id, { panNumber: 'ABC' }), /ABCDE1234F/);
    await assert.rejects(() => sellerDocuments.requestChange(r._id, { fssaiNumber: '123' }), /14 digits/);
});

await check('an edit is held for review; the outlet stays approved and the file unchanged', async () => {
    const out = await sellerDocuments.requestChange(r._id, { panNumber: 'abcde1234f', gstRegistered: true, gstNumber: '22ABCDE1234F1Z5' });
    assert.equal(out.review.status, 'pending');
    assert.deepEqual(Object.keys(out.review.changes).sort(), ['gstNumber', 'gstRegistered', 'panNumber']);
    assert.equal(out.review.previous.panNumber, '11');
    const doc = await FoodRestaurant.findById(r._id).lean();
    assert.equal(doc.status, 'approved');
    assert.equal(doc.panNumber, '11');
});

await check('the profile save sends documents for review instead of setting the outlet pending', async () => {
    await updateRestaurantProfile(String(r._id), { fssaiNumber: '12345678901234', panNumber: '11' });
    const doc = await FoodRestaurant.findById(r._id).lean();
    assert.equal(doc.fssaiNumber, '11', 'FSSAI changed before review');
    assert.equal(doc.documentReview.changes.fssaiNumber, '12345678901234');
    assert.equal(doc.documentReview.changes.panNumber, 'ABCDE1234F', 'earlier request lost in the merge');
    assert.equal(doc.status, 'approved', 'outlet sent to pending');
});

await check('reject keeps what is on file and tells the outlet why', async () => {
    await assert.rejects(() => sellerDocuments.reject(r._id, ''), /reason/);
    const out = await sellerDocuments.reject(r._id, 'GST certificate is blurry');
    assert.equal(out.review.status, 'rejected');
    assert.equal(out.review.rejectionReason, 'GST certificate is blurry');
    const doc = await FoodRestaurant.findById(r._id).lean();
    assert.equal(doc.gstNumber || '', '');
    assert.equal(doc.status, 'approved');
});

await check('approve puts the values on file, and the outlet stays approved', async () => {
    await sellerDocuments.requestChange(r._id, { panNumber: 'ABCDE1234F', fssaiNumber: '12345678901234', fssaiExpiry: '2030-01-31' });
    const listed = await sellerDocuments.listForAdmin();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'Doc Diner');
    await sellerDocuments.approve(r._id);
    const doc = await FoodRestaurant.findById(r._id).lean();
    assert.equal(doc.panNumber, 'ABCDE1234F');
    assert.equal(doc.fssaiNumber, '12345678901234');
    assert.equal(new Date(doc.fssaiExpiry).toISOString().slice(0, 10), '2030-01-31');
    assert.equal(doc.documentReview.status, 'approved');
    assert.equal(doc.status, 'approved');
    await assert.rejects(() => sellerDocuments.approve(r._id), /no document change/);
});

await check('sending back what is on file is not a change', async () => {
    await assert.rejects(() => sellerDocuments.requestChange(r._id, { panNumber: 'ABCDE1234F' }), /Nothing changed/);
});

await check('a pharmacy files its drug licence too', async () => {
    const Pharm = mongoose.model('PharmSeller', new mongoose.Schema({}, { strict: false, collection: 'pharm_sellers' }));
    const docs = createSellerDocuments({ Model: Pharm });
    const p = await Pharm.create({ restaurantName: 'Med', storeType: 'pharmacy', drugLicenseNumber: '' });
    const view = await docs.get(p._id);
    assert.ok(view.fields.includes('drugLicenseNumber'));
    const out = await docs.requestChange(p._id, { drugLicenseNumber: 'mh-mz1-123456', drugLicenseExpiry: '2029-05-01' });
    assert.equal(out.review.changes.drugLicenseNumber, 'MH-MZ1-123456');
    assert.ok(!(await sellerDocuments.get(r._id)).fields.includes('drugLicenseNumber'), 'restaurant shown a drug licence');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
