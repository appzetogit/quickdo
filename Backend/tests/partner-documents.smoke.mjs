/**
 * Partner documents: one catalogue for every partner, and every document in it
 * can actually be uploaded.
 *
 * Run: node tests/partner-documents.smoke.mjs
 *
 * The partner app asks GET /food/delivery/onboarding/requirements what to
 * collect (the live logs show it is the only sign-up path in use), which reads
 * Taxi's driver-needed-document catalogue. What this guards:
 *   - every document goes out with a key the app can name its upload by -- the
 *     admin form never sets one on documents, so they all went out keyed '';
 *   - a document limited to one class of partner reaches only that class;
 *   - a paper that arrives through the catalogue (Aadhaar, PAN, licence) also
 *     fills the named field the admin panel reads, without overwriting one that
 *     was sent the old way; other documents are left alone.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
  }
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(mongod.getUri());

const { getOnboardingRequirements } = await import('../src/modules/food/delivery/services/onboardingRequirements.service.js');
const { mirrorLegacyDocuments } = await import('../src/modules/food/delivery/services/delivery.service.js');
const { DriverNeededDocument } = await import('../src/modules/taxi/admin/models/DriverNeededDocument.js');

// The catalogue as it is live: documents saved by the admin form, no field_key.
await DriverNeededDocument.collection.insertMany([
  { name: 'aadhar card', slug: 'aadhar-card', template_type: 'document', image_type: 'front_back', applies_to: [], is_required: true, active: true, field_key: '' },
  { name: 'pan card', slug: 'pan-card', template_type: 'document', image_type: 'front_back', applies_to: ['two_wheeler'], is_required: true, active: true },
  { name: 'Goods permit', slug: 'goods-permit', template_type: 'document', image_type: 'front', applies_to: ['parcel_vehicle'], is_required: true, active: true },
  { name: 'Brand / Make', slug: 'vehicle-field-brand', template_type: 'vehicle_field', field_key: 'brand', active: true },
]);

console.log('\nWhat the app is asked for');
await check('every document has a key the app can name its upload by', async () => {
  const { documents } = await getOnboardingRequirements({ driverClass: 'two_wheeler', intents: ['food_daily_medical_parcel'] });
  assert.deepEqual(documents.map((d) => d.key).sort(), ['aadhar-card', 'pan-card']);
  assert.ok(documents.every((d) => d.key));
});
await check('a document for one class reaches only that class', async () => {
  const parcel = await getOnboardingRequirements({ driverClass: 'parcel_vehicle', intents: ['parcel_delivery'] });
  assert.deepEqual(parcel.documents.map((d) => d.key).sort(), ['aadhar-card', 'goods-permit']);
  const taxi = await getOnboardingRequirements({ driverClass: 'passenger_taxi', intents: ['four_wheeler'] });
  assert.deepEqual(taxi.documents.map((d) => d.key), ['aadhar-card']);
});
await check('vehicle fields are not asked for as papers', async () => {
  const { documents } = await getOnboardingRequirements({ driverClass: 'two_wheeler', intents: ['food_daily_medical_parcel'] });
  assert.ok(!documents.some((d) => d.key === 'brand' || d.key === 'vehicle-field-brand'));
});
await check('a key the admin did set still wins', async () => {
  await DriverNeededDocument.collection.updateOne({ slug: 'goods-permit' }, { $set: { field_key: 'goods_permit' } });
  const { documents } = await getOnboardingRequirements({ driverClass: 'parcel_vehicle', intents: ['parcel_delivery'] });
  assert.ok(documents.some((d) => d.key === 'goods_permit'));
});

console.log('\nWhat the admin panel reads');
await check('Aadhaar, PAN and licence sent through the catalogue fill the named fields', async () => {
  const { images, numbers } = mirrorLegacyDocuments(
    [
      { key: 'aadhar-card', name: 'aadhar card', frontUrl: 'https://x/a.jpg', number: '1111 2222 3333' },
      { key: 'pan-card', name: 'pan card', frontUrl: 'https://x/p.jpg', number: 'ABCDE1234F' },
      { key: 'driving-license', name: 'driving license', frontUrl: 'https://x/l.jpg', number: 'HP01 2020' },
    ],
    {},
    {},
  );
  assert.deepEqual(images, { aadharPhoto: 'https://x/a.jpg', panPhoto: 'https://x/p.jpg', drivingLicensePhoto: 'https://x/l.jpg' });
  assert.deepEqual(numbers, { aadharNumber: '1111 2222 3333', panNumber: 'ABCDE1234F', drivingLicenseNumber: 'HP01 2020' });
});
await check('a paper sent the old way is never overwritten', async () => {
  const { images, numbers } = mirrorLegacyDocuments(
    [{ key: 'aadhar-card', name: 'aadhar card', frontUrl: 'https://x/new.jpg', number: '9999' }],
    { aadharPhoto: 'https://x/old.jpg' },
    { aadharNumber: '1111' },
  );
  assert.equal(images.aadharPhoto, 'https://x/old.jpg');
  assert.equal(numbers.aadharNumber, '1111');
});
await check('other documents are left alone ("Company Name" is not PAN)', async () => {
  const { images } = mirrorLegacyDocuments(
    [
      { key: 'goods-permit', name: 'Goods permit', frontUrl: 'https://x/g.jpg' },
      { key: 'company-name', name: 'Company Name', frontUrl: 'https://x/c.jpg' },
    ],
    {},
    {},
  );
  assert.deepEqual(images, {});
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll partner document checks passed');
process.exit(failed ? 1 : 0);
