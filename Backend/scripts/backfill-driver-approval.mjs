/**
 * Write down the approval every existing taxi driver already has (plan §4.9).
 *
 *   node scripts/backfill-driver-approval.mjs            # dry run (default): report only
 *   node scripts/backfill-driver-approval.mjs --dry-run  # same
 *   node scripts/backfill-driver-approval.mjs --apply    # write
 *
 * The Driver model's defaults change from approve:true / status:'approved' to
 * approve:false / status:'pending', so a driver created without saying
 * otherwise waits for review. Mongoose applies a default to a document
 * missing the field when it LOADS it, so an old driver stored without
 * `approve` or `status` would silently read as pending -- and drop out of
 * dispatch -- the moment this deploys. This stores the value those drivers
 * have today. Only documents missing the field are touched; idempotent.
 *
 * Run it BEFORE (or together with) the deploy that changes the default.
 * Reads MONGO_URI / MONGODB_URI from the environment (.env).
 */
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

export const backfillDriverApproval = async ({ apply = false, log = console.log } = {}) => {
  const drivers = mongoose.connection.db.collection('taxidrivers');
  const missingApprove = { approve: { $exists: false } };
  const missingStatus = { status: { $exists: false } };
  const [approveCount, statusCount] = await Promise.all([
    drivers.countDocuments(missingApprove),
    drivers.countDocuments(missingStatus),
  ]);
  log(`[driver-approval] ${approveCount} driver(s) without approve, ${statusCount} without status`);

  if (!apply) {
    log('[driver-approval] dry run: nothing written (pass --apply to write)');
    return { approveCount, statusCount, modified: 0 };
  }

  const a = await drivers.updateMany(missingApprove, { $set: { approve: true } });
  const s = await drivers.updateMany(missingStatus, { $set: { status: 'approved' } });
  log(`[driver-approval] set approve on ${a.modifiedCount}, status on ${s.modifiedCount}`);
  return { approveCount, statusCount, modified: a.modifiedCount + s.modifiedCount };
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  dotenv.config({ path: path.resolve(here, '../.env') });
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI / MONGODB_URI is not set');
    process.exit(1);
  }
  mongoose.connect(uri)
    .then(() => backfillDriverApproval({ apply }))
    .then(() => mongoose.disconnect())
    .catch((err) => { console.error(err); process.exit(1); });
}
