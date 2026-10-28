import assert from 'node:assert/strict';
import mongoose from 'mongoose';
const { fillAddressLocality } = await import('../src/modules/quickCommerce/modules/food/shared/geo.utils.js');
const { reviewPrescription } = await import('../src/modules/quickCommerce/modules/food/shared/prescriptionRules.js');
const r = { location: { city: 'Indore', state: 'Madhya Pradesh' } };
assert.deepEqual([fillAddressLocality({ city: null, state: '' }, r).city, fillAddressLocality({ city: null, state: '' }, r).state], ['Indore', 'Madhya Pradesh']);
assert.equal(fillAddressLocality({ city: 'Bhopal', state: 'MP' }, r).city, 'Bhopal');
assert.equal(fillAddressLocality({ area: 'Vijay Nagar' }, r).city, 'Vijay Nagar');
// review on a real subdocument keeps bill/packet
const S = new mongoose.Schema({ prescription: { required: Boolean, status: String, bill: { status: String, amount: Number }, packet: { note: String } } });
const M = mongoose.model('RxT', S);
const doc = new M({ prescription: { required: true, status: 'pending', bill: { status: 'none', amount: 0 }, packet: { note: '' } } });
const out = reviewPrescription(doc, 'approved', {});
assert.equal(out.status, 'approved');
assert.equal(out.bill.status, 'none');
doc.prescription = out;
assert.equal(doc.validateSync(), undefined);
console.log('rx + address checks passed');

// A medical order gets a MED- number; a grocery order keeps FOD-.
{
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create();
  const conn = await mongoose.connect(server.getUri(), { dbName: 'med_prefix' });
  const { FoodOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
  const base = { userId: new mongoose.Types.ObjectId(), restaurantId: new mongoose.Types.ObjectId(), items: [], pricing: { subtotal: 0, total: 0 } };
  const med = new FoodOrder({ ...base, prescription: { required: true, status: 'pending_review' } });
  const qc = new FoodOrder({ ...base });
  await med.validate().catch(() => {});
  // pre('save') assigns the number; run it without the rest of the schema's required fields.
  const pre = FoodOrder.schema.s.hooks._pres.get('save').find((h) => /order_id/.test(String(h.fn)));
  await new Promise((r, j) => pre.fn.call(med, (e) => (e ? j(e) : r())));
  await new Promise((r, j) => pre.fn.call(qc, (e) => (e ? j(e) : r())));
  assert.match(med.order_id, /^MED-/);
  assert.match(qc.order_id, /^FOD-/);
  console.log('order number prefix checks passed');
  await conn.disconnect();
  await server.stop();
}
