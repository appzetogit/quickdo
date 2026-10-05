/**
 * Seed the platform-wide legal pages (Master settings -> Legal pages) with the
 * full default Privacy Policy and Terms & Conditions, under this site's own
 * brand and, when known, its registered company name.
 *
 *   node scripts/seed-legal-pages.mjs           # dry run: prints what it would do
 *   node scripts/seed-legal-pages.mjs --apply
 *
 * Each page is written only when empty: a page an admin already wrote is never
 * overwritten. Every app with no page of its own shows these; the running API
 * picks them up on its next settings refresh (30s).
 *
 * One repair on the way: a delivery-partner agreement saved as the CUSTOMER terms
 * (food "terms" page -- Quick Drop's Gig Worker Onboarding Agreement was) is
 * copied to the delivery partner app's own terms page, where riders read it. The
 * original is left in place, only outranked by the customer terms.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { defaultPrivacyPolicyHtml } from '../src/core/settings/defaultPrivacyPolicy.js';
import { defaultTermsHtml } from '../src/core/settings/defaultTerms.js';

const apply = process.argv.includes('--apply');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) throw new Error('MONGO_URI is not set');

await mongoose.connect(uri);
const db = mongoose.connection.db;
const say = (msg) => console.log(`${apply ? '' : '[dry run] '}${msg}`);

const profile = (await db.collection('platform_profile').findOne({ _id: 'platform' })) || {};
const settings = (await db.collection('foodbusinesssettings').findOne({})) || (await db.collection('qc_business_settingses').findOne({})) || {};
const foodTerms = await db.collection('food_page_contents').findOne({ key: 'terms' });
const foodTermsHtml = String(foodTerms?.legal?.content || '');

const brand = String(profile.brand?.name || settings.companyName || 'Quick Drop').trim();
// The registered name, if the operator has given it anywhere: Master settings, or
// the heading of a document they wrote themselves.
const titleCase = (t) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const namesInDoc = [...foodTermsHtml.replace(/<[^>]+>/g, ' ')
  .matchAll(/\b((?:[A-Z][A-Za-z0-9&.]*\s+){1,4}(?:PRIVATE LIMITED|Private Limited|PVT\.? LTD\.?|Pvt\.? Ltd\.?))/g)]
  .map((m) => m[1].replace(/\s+/g, ' ').trim());
const operator = String(
  profile.business?.legalName
  || namesInDoc.find((n) => n !== n.toUpperCase()) // as the operator wrote it, e.g. "QuickDrop Private Limited"
  || (namesInDoc[0] ? titleCase(namesInDoc[0]) : ''),
).trim();
console.log(`Brand: ${brand}\nOperator: ${operator || '(not known -- brand name used)'}`);

const pages = {
  privacy: () => defaultPrivacyPolicyHtml({ brand }),
  terms: () => defaultTermsHtml({ brand, operator }),
};
for (const [kind, build] of Object.entries(pages)) {
  const existing = String(profile.legal?.[kind] || '').trim();
  if (existing) {
    console.log(`${kind}: already set (${existing.length} chars) -- left alone.`);
    continue;
  }
  const html = build();
  say(`${kind}: writing ${html.length} chars.`);
  if (apply) {
    await db.collection('platform_profile').updateOne(
      { _id: 'platform' },
      { $set: { [`legal.${kind}`]: html, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  }
}

if (/gig\s+worker|delivery\s+partner\s+agreement/i.test(foodTermsHtml)) {
  const riderPage = await db.collection('platform_app_legal').findOne({ app: 'food_delivery', kind: 'terms' });
  if (String(riderPage?.content || '').trim()) {
    console.log('Partner agreement: delivery app already has its own terms -- left alone.');
  } else {
    say('Partner agreement found in the customer terms: copying it to the delivery partner app\'s terms.');
    if (apply) {
      await db.collection('platform_app_legal').updateOne(
        { app: 'food_delivery', kind: 'terms' },
        {
          $set: { title: 'Gig Worker Onboarding Agreement', content: foodTermsHtml, updatedBy: 'seed-legal-pages', updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    }
  }
}
await mongoose.disconnect();
