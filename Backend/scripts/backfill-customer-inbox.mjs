/**
 * Move customer notifications filed under a service's own user id onto the
 * customer's platform account, where the app's inbox reads them.
 *
 * Before core/notifications/customerInbox.js, Services mirrored its customer
 * notifications into the shared inbox under its sp_users id, so they were
 * stored and never shown. This re-points those rows (and any filed under a
 * qc_users id) using the same lookup the recorder now uses: platformUserId,
 * else the same phone in `users`.
 *
 * Dry run by default; prints what it would move. --apply writes. Each moved row
 * keeps its old owner in metadata.serviceUserId, so the move can be undone.
 *
 *   node scripts/backfill-customer-inbox.mjs            # dry run
 *   node scripts/backfill-customer-inbox.mjs --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const apply = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
const { platformUserIdFor } = await import('../src/core/notifications/customerInbox.js');
const db = mongoose.connection;
const inbox = db.collection('food_notifications');

const platformIds = new Set((await db.collection('users').distinct('_id')).map(String));
const owners = await inbox.distinct('ownerId', { ownerType: 'USER' });
const foreign = owners.filter((id) => !platformIds.has(String(id)));

let moved = 0;
let unresolved = 0;
for (const ownerId of foreign) {
  const resolved = await platformUserIdFor(ownerId);
  const count = await inbox.countDocuments({ ownerType: 'USER', ownerId });
  if (!resolved) {
    unresolved += count;
    console.log(`  leave   ${ownerId}: ${count} note(s), no platform account found`);
    continue;
  }
  console.log(`  ${apply ? 'moved' : 'would move'} ${ownerId} -> ${resolved.platformId} (${resolved.vertical || 'platform'}): ${count} note(s)`);
  if (apply) {
    await inbox.updateMany(
      { ownerType: 'USER', ownerId },
      {
        $set: {
          ownerId: new mongoose.Types.ObjectId(resolved.platformId),
          'metadata.serviceUserId': String(ownerId),
          ...(resolved.vertical ? { vertical: resolved.vertical } : {}),
        },
      },
    );
  }
  moved += count;
}
console.log(`\n${apply ? 'Moved' : 'Would move'} ${moved} note(s); left ${unresolved} with no platform account.${apply ? '' : ' Run with --apply to write.'}`);
await mongoose.disconnect();
process.exit(0);
