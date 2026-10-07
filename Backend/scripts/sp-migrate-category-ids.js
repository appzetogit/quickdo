/**
 * Fill Vendor.categoryIds / Worker.categoryIds from the legacy category name
 * arrays (plan §3.3). The name arrays are left in place: assignment and the
 * dashboards still read them, and new writes keep both in step
 * (utils/categoryRefs.js).
 *
 *   node scripts/sp-migrate-category-ids.js            # dry run (default)
 *   node scripts/sp-migrate-category-ids.js --dry-run  # same
 *   node scripts/sp-migrate-category-ids.js --apply    # write
 *
 * Names are matched to Category.title (case-insensitive) or slug. Names with no
 * matching category are reported and left as names only.
 */
import mongoose from 'mongoose';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const migrateCategoryIds = async ({ apply = false, log = console.log } = {}) => {
  const Category = require('../src/modules/serviceProvider/models/Category.js');
  const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
  const Worker = require('../src/modules/serviceProvider/models/Worker.js');

  const cats = await Category.find({}).select('title slug').lean();
  const byKey = new Map();
  for (const c of cats) {
    byKey.set(String(c.title).trim().toLowerCase(), c._id);
    if (c.slug) byKey.set(String(c.slug).trim().toLowerCase(), c._id);
  }

  const report = { vendor: { scanned: 0, changed: 0 }, worker: { scanned: 0, changed: 0 }, unmatched: {} };
  const run = async (Model, role, fields) => {
    const ops = [];
    const cursor = Model.collection.find({}, { projection: { categoryIds: 1, ...Object.fromEntries(fields.map((f) => [f, 1])) } });
    for await (const doc of cursor) {
      report[role].scanned += 1;
      const names = [...new Set(fields.flatMap((f) => (Array.isArray(doc[f]) ? doc[f] : [])).map((n) => String(n || '').trim()).filter(Boolean))];
      const ids = [];
      for (const n of names) {
        const id = byKey.get(n.toLowerCase());
        if (id) { if (!ids.some((x) => String(x) === String(id))) ids.push(id); }
        else report.unmatched[n] = (report.unmatched[n] || 0) + 1;
      }
      const existing = (doc.categoryIds || []).map(String).sort().join(',');
      const merged = [...new Set([...(doc.categoryIds || []).map(String), ...ids.map(String)])];
      if (merged.sort().join(',') !== existing) {
        report[role].changed += 1;
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { categoryIds: merged.map((i) => new mongoose.Types.ObjectId(i)) } } } });
      }
    }
    if (apply && ops.length) {
      for (let i = 0; i < ops.length; i += 500) await Model.collection.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  };
  await run(Vendor, 'vendor', ['categories', 'service']);
  await run(Worker, 'worker', ['serviceCategories']);
  log(`[category-ids] vendors: ${report.vendor.changed}/${report.vendor.scanned} to update; workers: ${report.worker.changed}/${report.worker.scanned} to update`);
  const unmatched = Object.entries(report.unmatched);
  if (unmatched.length) log(`[category-ids] names with no category (left as names): ${unmatched.map(([n, c]) => `${n} (${c})`).join(', ')}`);
  log(apply ? '[category-ids] applied' : '[category-ids] dry run: nothing written (pass --apply to write)');
  return report;
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
    .then(() => migrateCategoryIds({ apply }))
    .then(() => mongoose.disconnect())
    .catch((err) => { console.error(err); process.exit(1); });
}
