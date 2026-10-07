/**
 * Move old flat Booking.workPhotos arrays into workPhotos.after (plan §3.5).
 *
 *   node scripts/sp-migrate-work-photos.js            # dry run (default): report only
 *   node scripts/sp-migrate-work-photos.js --dry-run  # same
 *   node scripts/sp-migrate-work-photos.js --apply    # write
 *
 * Reads MONGO_URI / MONGODB_URI from the environment (.env). Idempotent: only
 * documents whose workPhotos is still an array are touched. Reads already
 * tolerate both shapes, so this can run any time after deploy.
 */
import mongoose from 'mongoose';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const migrateWorkPhotos = async ({ apply = false, log = console.log } = {}) => {
  const Booking = require('../src/modules/serviceProvider/models/Booking.js');
  const { normalizeWorkPhotos } = require('../src/modules/serviceProvider/utils/workPhotos.js');
  const cursor = Booking.collection.find({ workPhotos: { $type: 'array' } }, { projection: { workPhotos: 1, bookingNumber: 1, completedAt: 1, updatedAt: 1 } });
  let scanned = 0;
  let photos = 0;
  const ops = [];
  for await (const doc of cursor) {
    scanned += 1;
    const next = normalizeWorkPhotos(doc.workPhotos);
    // Old photos have no timestamp; the completion time is the best we know.
    const when = doc.completedAt || doc.updatedAt || null;
    next.after = next.after.map((p) => ({ ...p, uploadedAt: p.uploadedAt || when }));
    photos += next.after.length;
    ops.push({ updateOne: { filter: { _id: doc._id, workPhotos: { $type: 'array' } }, update: { $set: { workPhotos: next } } } });
  }
  log(`[work-photos] ${scanned} booking(s) with the old array shape, ${photos} photo(s) -> after`);
  let modified = 0;
  if (apply && ops.length) {
    for (let i = 0; i < ops.length; i += 500) {
      const r = await Booking.collection.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      modified += r.modifiedCount;
    }
    log(`[work-photos] updated ${modified} booking(s)`);
  } else if (!apply) {
    log('[work-photos] dry run: nothing written (pass --apply to write)');
  }
  return { scanned, photos, modified };
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
    .then(() => migrateWorkPhotos({ apply }))
    .then(() => mongoose.disconnect())
    .catch((err) => { console.error(err); process.exit(1); });
}
