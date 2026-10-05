/**
 * Give existing medical (pharmacy) orders a MED- number instead of FOD-.
 *
 *   node scripts/renumber-medical-orders.mjs            # dry run: lists what would change
 *   node scripts/renumber-medical-orders.mjs --apply
 *
 * Keeps the digits (FOD-6731103120 -> MED-6731103120) and records the old
 * number in previousOrderIds, which the order lookups also match, so a link or
 * message carrying the old number still finds the order. Also updates the
 * order number copied onto returns. Writes a JSON backup of every order it
 * changes before changing it. Safe to run again: renumbered orders no longer
 * match.
 */
import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';

const apply = process.argv.includes('--apply');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) throw new Error('MONGO_URI is not set');
await mongoose.connect(uri);
const db = mongoose.connection.db;
const orders = db.collection('qc_orders');
const returns = db.collection('qc_returns');

const targets = await orders
  .find({ 'prescription.required': true, order_id: /^FOD-/ })
  .project({ _id: 1, order_id: 1, orderId: 1, previousOrderIds: 1 })
  .toArray();
console.log(`${targets.length} medical order(s) still numbered FOD-`);

const plan = [];
for (const o of targets) {
  const next = `MED-${String(o.order_id).slice(4)}`;
  // eslint-disable-next-line no-await-in-loop
  const clash = await orders.findOne({ _id: { $ne: o._id }, $or: [{ order_id: next }, { orderId: next }] }, { projection: { _id: 1 } });
  plan.push({ _id: o._id, from: o.order_id, to: clash ? `MED-${String(o._id).slice(-10).toUpperCase()}` : next });
}
for (const p of plan) console.log(`  ${p.from} -> ${p.to}`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to change them.');
  await mongoose.disconnect();
  process.exit(0);
}

const backup = `medical-order-numbers-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(backup, JSON.stringify(targets, null, 2));
console.log(`\nBackup written: ${backup}`);

let changed = 0;
for (const p of plan) {
  // eslint-disable-next-line no-await-in-loop
  const r = await orders.updateOne(
    { _id: p._id, order_id: p.from },
    { $set: { order_id: p.to, orderId: p.to }, $addToSet: { previousOrderIds: p.from } },
  );
  changed += r.modifiedCount;
  // eslint-disable-next-line no-await-in-loop
  await returns.updateMany({ orderId: p._id, orderNumber: p.from }, { $set: { orderNumber: p.to } });
}
console.log(`${changed} order(s) renumbered.`);
await mongoose.disconnect();
