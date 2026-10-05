/**
 * Record the zones every delivery partner has already delivered in
 * (rider.zoneIds), from their delivered Food and Quick & Medical orders.
 *
 *   node scripts/backfill-rider-zones.mjs           # dry run: prints what it would do
 *   node scripts/backfill-rider-zones.mjs --apply
 *
 * New deliveries record their zone as they happen (core/zones/riderZones.js);
 * this covers the riders who delivered before that. Only ever adds zones
 * ($addToSet), so it is safe to run more than once.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const apply = process.argv.includes('--apply');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) throw new Error('MONGO_URI is not set');
await mongoose.connect(uri);
const db = mongoose.connection.db;

const SOURCES = [
  { label: 'Food', orders: 'food_orders', riders: 'food_delivery_partners' },
  { label: 'Quick & Medical', orders: 'qc_orders', riders: 'qc_delivery_partners' },
];

for (const { label, orders, riders } of SOURCES) {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  if (!names.includes(orders) || !names.includes(riders)) {
    console.log(`${label}: ${!names.includes(orders) ? orders : riders} not found -- skipped`);
    continue;
  }
  const rows = await db.collection(orders).aggregate([
    { $match: { orderStatus: 'delivered', 'dispatch.deliveryPartnerId': { $ne: null }, zoneId: { $ne: null } } },
    { $group: { _id: '$dispatch.deliveryPartnerId', zones: { $addToSet: '$zoneId' } } },
  ]).toArray();
  let changed = 0;
  for (const { _id, zones } of rows) {
    if (!apply) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await db.collection(riders).updateOne({ _id }, { $addToSet: { zoneIds: { $each: zones } } });
    changed += r.modifiedCount;
  }
  console.log(`${label}: ${rows.length} riders have delivered in a zone${apply ? `; ${changed} updated` : ' (dry run)'}`);
}
await mongoose.disconnect();
