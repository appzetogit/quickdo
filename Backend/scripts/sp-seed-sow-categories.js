/**
 * Seed every service category the SOW lists (plan §3.4). Idempotent: a category
 * whose title already exists (case-insensitive) is skipped, never changed.
 *
 *   node scripts/sp-seed-sow-categories.js            # dry run (default)
 *   node scripts/sp-seed-sow-categories.js --apply    # create the missing ones
 *
 * Quote-based categories (isConsultancy) and categories without before/after
 * work photos (requireWorkPhotos) are preset; admins can change both later.
 */
import mongoose from 'mongoose';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const SOW_CATEGORIES = [
  { title: 'Electrician' },
  { title: 'Plumber' },
  { title: 'Carpenter' },
  { title: 'AC Repair' },
  { title: 'Cleaning' },
  { title: 'Painting', isConsultancy: true },
  { title: 'Beauty Services' },
  { title: 'Appliance Repair' },
  { title: 'Doctor Consultation', requireWorkPhotos: false },
  { title: 'Pandit Booking', requireWorkPhotos: false },
  { title: 'Packers & Movers', isConsultancy: true },
  { title: 'Pest Control' },
  { title: 'Gardening' },
  { title: 'Laundry' }
];

const slugify = (t) => t.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const seedSowCategories = async ({ apply = false, log = console.log } = {}) => {
  const Category = require('../src/modules/serviceProvider/models/Category.js');
  const created = [];
  const skipped = [];
  let order = (await Category.findOne({}).sort({ homeOrder: -1 }).select('homeOrder').lean())?.homeOrder || 0;
  for (const c of SOW_CATEGORIES) {
    const exists = await Category.findOne({ title: { $regex: new RegExp(`^${escapeRegex(c.title)}$`, 'i') } }).select('_id').lean();
    if (exists) { skipped.push(c.title); continue; }
    let slug = slugify(c.title);
    if (await Category.exists({ slug })) slug = `${slug}-${Date.now().toString(36)}`;
    order += 1;
    if (apply) {
      await Category.create({
        title: c.title,
        slug,
        isConsultancy: !!c.isConsultancy,
        requireWorkPhotos: c.requireWorkPhotos !== false,
        showOnHome: true,
        homeOrder: order,
        status: 'active'
      });
    }
    created.push(c.title);
  }
  log(`[seed-categories] ${apply ? 'created' : 'would create'} ${created.length}: ${created.join(', ') || '-'}`);
  log(`[seed-categories] skipped (already exist) ${skipped.length}: ${skipped.join(', ') || '-'}`);
  if (!apply) log('[seed-categories] dry run: nothing written (pass --apply to write)');
  return { created, skipped };
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
    .then(() => seedSowCategories({ apply }))
    .then(() => mongoose.disconnect())
    .catch((err) => { console.error(err); process.exit(1); });
}
