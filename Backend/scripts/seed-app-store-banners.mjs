/**
 * Fill every EMPTY banner slot with the Quick Drop artwork in
 * scripts/app-store-banners/ -- a temporary set for App Store review.
 *
 * The artwork is original vector art: no third-party names, logos, vehicle
 * badges or app-store badges, no prices, discounts, "free" or "coming soon".
 * Banners are stored without a title, because the customer app turns a titled
 * banner into a small text card; the words are already in the image.
 *
 * Safe to re-run: a slot that already has any banner (active or not) is left
 * alone, so this never duplicates or overrides what an admin uploaded. Replace
 * these from the admin panel whenever real campaign banners are ready.
 *
 *   node scripts/seed-app-store-banners.mjs            # dry run: what it would add
 *   node scripts/seed-app-store-banners.mjs --apply    # add them
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const apply = process.argv.includes('--apply');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app-store-banners');
const file = (name) => ({ buffer: fs.readFileSync(path.join(dir, name)), originalname: name, mimetype: 'image/png' });

const foodHero = await import('../src/modules/food/landing/services/heroBanner.service.js');
const dining = await import('../src/modules/food/landing/services/diningBanner.service.js');
const under250 = await import('../src/modules/food/landing/services/under250Banner.service.js');
const qcHero = await import('../src/modules/quickCommerce/modules/food/landing/services/heroBanner.service.js');
const { FoodHeroBanner } = await import('../src/modules/food/landing/models/heroBanner.model.js');
const { FoodDiningBanner } = await import('../src/modules/food/landing/models/diningBanner.model.js');
const { FoodUnder250Banner } = await import('../src/modules/food/landing/models/under250Banner.model.js');
const { FoodHeroBanner: QCHeroBanner } = await import('../src/modules/quickCommerce/modules/food/landing/models/heroBanner.model.js');

// [label, model, filter that defines the slot, files, create(files)]
const SLOTS = [
  ...[
    ['food', ['food-hero-1.png', 'food-hero-2.png']],
    ['quick_commerce', ['quick-hero.png']],
    ['medical', ['medical-hero.png']],
    ['taxi', ['taxi-hero.png']],
    ['porter', ['porter-hero.png']],
    ['rental', ['rental-hero.png']],
    ['services', ['services-hero.png']],
  ].map(([module, files]) => [
    `hero banners (${module})`,
    FoodHeroBanner,
    // Food rows created before the module field existed have none.
    module === 'food' ? { $or: [{ module: 'food' }, { module: { $exists: false } }] } : { module },
    files,
    (fs_) => foodHero.createHeroBannersFromFiles(fs_, { module }),
  ]),
  ['dining banners', FoodDiningBanner, {}, ['dining-1.png', 'dining-2.png'], (fs_) => dining.createDiningBannersFromFiles(fs_, {})],
  ['under-250 banners', FoodUnder250Banner, {}, ['value-1.png', 'value-2.png'], (fs_) => under250.createUnder250BannersFromFiles(fs_, {})],
  ['quick-commerce hero banners', QCHeroBanner, {}, ['quick-hero.png'], (fs_) => qcHero.createHeroBannersFromFiles(fs_, {})],
];

await mongoose.connect(process.env.MONGODB_URI);
let failed = 0;
try {
  for (const [label, Model, filter, names, create] of SLOTS) {
    const existing = await Model.countDocuments(filter);
    if (existing > 0) {
      console.log(`skip  ${label}: already has ${existing}`);
      continue;
    }
    if (!apply) {
      console.log(`would add  ${label}: ${names.join(', ')}`);
      continue;
    }
    // One file per call so each gets its own sortOrder.
    for (const [i, name] of names.entries()) {
      const [result] = await create([file(name)]);
      if (!result?.success) {
        failed += 1;
        console.log(`FAIL  ${label}: ${name}: ${result?.error || 'unknown error'}`);
        continue;
      }
      const id = result.banner._id;
      await Model.updateOne({ _id: id }, { $set: { sortOrder: i } });
      console.log(`added ${label}: ${name} -> ${result.banner.imageUrl || result.banner.image}`);
    }
  }
} finally {
  await mongoose.disconnect();
}
if (!apply) console.log('\nDry run. Re-run with --apply to add them.');
process.exit(failed ? 1 : 0);
