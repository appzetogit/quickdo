/**
 * Make users.phone unique only among accounts that HAVE a phone (SOW plan 2.3/2.4).
 *
 *   node scripts/migrate-users-phone-index.mjs --dry-run   # default: report only
 *   node scripts/migrate-users-phone-index.mjs --apply
 *
 * Why: customers can now sign up with email + password or with Google / Apple, and
 * such an account has no phone until they add one. The old index
 * `{ phone: 1 }, { unique: true }` counts a missing phone as null, so it allows
 * exactly ONE phone-less account; the second email sign-up fails with a duplicate
 * key error (the API answers 503 "Email sign-up is not available yet").
 *
 * What it does, on the `users` collection only:
 *   1. checks no two accounts share a phone (the new index would refuse to build);
 *   2. drops `phone_1` if it is the old, non-partial index;
 *   3. creates `phone_1` as unique with partialFilterExpression { phone: { $type: 'string' } }
 *      -- the exact spec both core/users/user.model.js and taxi's User model declare.
 *
 * Between steps 2 and 3 the collection has no phone uniqueness for a moment; run it
 * at a quiet time. Safe to run again: an index already in the new shape is left alone.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const apply = process.argv.includes('--apply');
const dryRun = !apply || process.argv.includes('--dry-run');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) throw new Error('MONGO_URI is not set');

const NEW_SPEC = { key: { phone: 1 }, unique: true, partialFilterExpression: { phone: { $type: 'string' } } };

await mongoose.connect(uri);
const users = mongoose.connection.db.collection('users');

const indexes = await users.indexes();
const current = indexes.find((i) => i.name === 'phone_1');
const isNewShape = current
  && current.unique
  && JSON.stringify(current.partialFilterExpression || null) === JSON.stringify(NEW_SPEC.partialFilterExpression);

console.log(`users.phone_1: ${current ? JSON.stringify({ unique: current.unique, partialFilterExpression: current.partialFilterExpression }) : 'missing'}`);

if (isNewShape) {
  console.log('Already in the new shape. Nothing to do.');
  await mongoose.disconnect();
  process.exit(0);
}

const dupes = await users.aggregate([
  { $match: { phone: { $type: 'string' } } },
  { $group: { _id: '$phone', n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
  { $limit: 20 },
]).toArray();
if (dupes.length) {
  console.error(`Refusing: ${dupes.length}+ phone numbers are shared by more than one account, e.g. ${dupes.map((d) => d._id).join(', ')}`);
  await mongoose.disconnect();
  process.exit(1);
}
const phoneless = await users.countDocuments({ phone: { $not: { $type: 'string' } } });
console.log(`Accounts without a phone today: ${phoneless}`);

if (dryRun) {
  console.log('Dry run: would drop phone_1 (if present) and create it as unique + partial on { phone: { $type: "string" } }.');
  await mongoose.disconnect();
  process.exit(0);
}

if (current) {
  await users.dropIndex('phone_1');
  console.log('Dropped the old phone_1');
}
await users.createIndex(NEW_SPEC.key, { name: 'phone_1', unique: true, partialFilterExpression: NEW_SPEC.partialFilterExpression });
console.log('Created phone_1 (unique, partial). Done.');
await mongoose.disconnect();
