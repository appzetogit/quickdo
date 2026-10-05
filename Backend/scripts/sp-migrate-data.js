/**
 * Service-Provider data migration: Truliq cluster -> master (K9) cluster.
 *
 * The two projects live on SEPARATE Atlas clusters, so this is a cross-cluster copy
 * with a rename, not an in-place `renameCollection`.
 *
 *   source  <SP_SOURCE_MONGO_URI>  e.g. cluster0.../Truliq
 *   target  <MONGO_URI>            e.g. k9.../K9
 *
 * SAFETY
 *   - Dry run by DEFAULT. Nothing is written without --apply.
 *   - Never drops, never renames, never deletes anything on either side.
 *   - Idempotent: documents are upserted by _id, so re-running converges.
 *   - Refuses to touch a non-empty target collection unless --force, so a second
 *     run cannot quietly clobber data written since the first.
 *   - Reads only from the source. The source cluster is never modified.
 *
 * USAGE
 *   node scripts/sp-migrate-data.js                      # dry run, full report
 *   node scripts/sp-migrate-data.js --apply              # perform the copy
 *   node scripts/sp-migrate-data.js --apply --only=vendors,workers
 *   node scripts/sp-migrate-data.js --verify             # compare counts after
 *
 * ADMINS are special: they merge into master's shared `admins` collection (which
 * FoodAdmin and TaxiAdmin already use) and are stamped with
 * servicesAccess: ['serviceProvider']. An email that already exists on the target is
 * REPORTED AND SKIPPED, never overwritten -- that is someone's live login.
 */

import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Target cluster config comes from Backend/.env, the same file the server reads.
// Resolved relative to this file so the script works from any cwd.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const VERIFY = args.includes('--verify');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const BATCH = 500;

/**
 * Read MONGO_URI / MONGODB_URI straight out of an .env file.
 *
 * Preferred over passing the connection string on the command line: argv is visible
 * in process listings and lands in shell history, and the value never needs to be
 * echoed anywhere. Nothing in this script ever prints a URI -- only database names,
 * collection names and counts.
 */
const readUriFromEnvFile = (envPath) => {
  const resolved = path.resolve(envPath);
  if (!fs.existsSync(resolved)) return { error: `no such file: ${resolved}` };
  const text = fs.readFileSync(resolved, 'utf8');
  const match = text.match(/^\s*MONGO(?:DB)?_URI\s*=\s*(.+)$/m);
  if (!match) return { error: `no MONGO_URI / MONGODB_URI in ${resolved}` };
  return { uri: match[1].trim().replace(/^["']|["']$/g, '') };
};

const SOURCE_ENV = (args.find((a) => a.startsWith('--source-env=')) || '').replace('--source-env=', '');
let SOURCE_URI = process.env.SP_SOURCE_MONGO_URI;
let SOURCE_ORIGIN = 'SP_SOURCE_MONGO_URI';

if (!SOURCE_URI && SOURCE_ENV) {
  const { uri, error } = readUriFromEnvFile(SOURCE_ENV);
  if (error) {
    console.error(`\n--source-env: ${error}\n`);
    process.exit(1);
  }
  SOURCE_URI = uri;
  SOURCE_ORIGIN = `--source-env=${SOURCE_ENV}`;
}
const TARGET_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

// DO NOT default this to MONGODB_DB_NAME. That variable is read nowhere in the
// application -- src/config/db.js calls mongoose.connect(uri) with no dbName, so the
// database comes from the URI path alone (and is `test` when the URI has none).
// Honouring MONGODB_DB_NAME here would migrate every document into a database the
// app never opens, and the migration would look like it silently did nothing.
// Migrate where the app actually reads; --target-db= is an explicit override.
const TARGET_DB = (args.find((a) => a.startsWith('--target-db=')) || '').replace('--target-db=', '') || undefined;

/**
 * source collection (mongoose-pluralised from the old model name) -> target collection.
 * Kept explicit rather than derived, so a rename here is a deliberate edit.
 */
const COLLECTION_MAP = {
  admins: 'admins', // MERGE into the shared collection -- see mergeAdmins()
  users: 'sp_users',
  bookings: 'sp_bookings',
  bookingrequests: 'sp_booking_requests',
  brands: 'sp_brands',
  carts: 'sp_carts',
  categories: 'sp_categories',
  cities: 'sp_cities',
  homecontents: 'sp_home_contents',
  notifications: 'sp_notifications',
  notificationlogs: 'sp_notification_logs',
  plans: 'sp_plans',
  platformearnings: 'sp_platform_earnings',
  reviews: 'sp_reviews',
  scraps: 'sp_scraps',
  services: 'sp_services',
  settings: 'sp_settings',
  settlements: 'sp_settlements',
  tokens: 'sp_tokens',
  transactions: 'sp_transactions',
  userservices: 'sp_user_services',
  vendors: 'sp_vendors',
  vendorbills: 'sp_vendor_bills',
  vendorpartscatalogs: 'sp_vendor_parts_catalogs',
  vendorservices: 'sp_vendor_services',
  vendorservicecatalogs: 'sp_vendor_service_catalogs',
  withdrawals: 'sp_withdrawals',
  workers: 'sp_workers',
  workersubscriptionplans: 'sp_worker_subscription_plans',
};

const pad = (s, n) => String(s).padEnd(n);
const num = (n) => String(n).padStart(7);

async function connect(uri, dbName) {
  const conn = await mongoose.createConnection(uri, dbName ? { dbName } : {}).asPromise();
  return conn;
}

async function copyCollection(srcDb, tgtDb, from, to) {
  const srcCol = srcDb.collection(from);
  const tgtCol = tgtDb.collection(to);

  const srcCount = await srcCol.countDocuments();
  const tgtCountBefore = await tgtCol.countDocuments();

  if (srcCount === 0) {
    return { from, to, srcCount, tgtCountBefore, copied: 0, status: 'source empty, skipped' };
  }
  if (tgtCountBefore > 0 && !FORCE) {
    return {
      from, to, srcCount, tgtCountBefore, copied: 0,
      status: `target has ${tgtCountBefore} docs -- skipped (use --force to upsert into it)`,
    };
  }
  if (!APPLY) {
    return { from, to, srcCount, tgtCountBefore, copied: 0, status: 'DRY RUN would copy' };
  }

  let copied = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    await tgtCol.bulkWrite(batch, { ordered: false });
    copied += batch.length;
    batch = [];
  };

  const cursor = srcCol.find({});
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    batch.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  return { from, to, srcCount, tgtCountBefore, copied, status: 'copied' };
}

/**
 * Admins merge into a live shared collection, so this is deliberately conservative:
 * insert only, never update, and report every collision instead of resolving it.
 */
async function mergeAdmins(srcDb, tgtDb) {
  const src = srcDb.collection('admins');
  const tgt = tgtDb.collection('admins');

  const spAdmins = await src.find({}).toArray();
  const collisions = [];
  const toInsert = [];

  for (const admin of spAdmins) {
    const email = String(admin.email || '').trim().toLowerCase();
    if (!email) {
      collisions.push({ email: '(missing)', reason: 'source admin has no email -- skipped' });
      continue;
    }
    const existing = await tgt.findOne({ email });
    if (existing) {
      const access = Array.isArray(existing.servicesAccess) ? existing.servicesAccess : [];
      collisions.push({
        email,
        reason: access.includes('serviceProvider')
          ? 'already exists WITH serviceProvider access -- nothing to do'
          : `already exists on target (servicesAccess: [${access.join(', ') || 'none'}]) -- NOT modified, grant access manually`,
      });
      continue;
    }
    toInsert.push({
      ...admin,
      email,
      servicesAccess: ['serviceProvider'],
      adminLevel: 'sp_superadmin',
      admin_type: admin.role === 'super_admin' ? 'superadmin' : 'subadmin',
      isActive: admin.isActive !== false,
    });
  }

  if (APPLY && toInsert.length) {
    await tgt.bulkWrite(
      toInsert.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
      { ordered: false },
    );
  }

  return { total: spAdmins.length, inserted: toInsert.length, collisions };
}

/** Phone overlap between SP users and the shared `users` collection. Report only. */
async function reportUserOverlap(srcDb, tgtDb) {
  const normalise = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const spPhones = new Set(
    (await srcDb.collection('users').find({}, { projection: { phone: 1 } }).toArray())
      .map((u) => normalise(u.phone)).filter((p) => p.length === 10),
  );
  if (spPhones.size === 0) return { spUsers: 0, masterUsers: 0, overlap: 0 };

  const masterPhones = (await tgtDb.collection('users').find({}, { projection: { phone: 1 } }).toArray())
    .map((u) => normalise(u.phone)).filter((p) => p.length === 10);

  let overlap = 0;
  for (const p of new Set(masterPhones)) if (spPhones.has(p)) overlap++;
  return { spUsers: spPhones.size, masterUsers: new Set(masterPhones).size, overlap };
}

async function main() {
  if (!SOURCE_URI) {
    console.error('\nNo source connection string.\n');
    console.error('Point the script at the Service-Provider .env (preferred -- keeps the URI');
    console.error('out of argv and shell history):\n');
    console.error('  node scripts/sp-migrate-data.js --source-env=../../service-provider/Backend/.env\n');
    console.error('or set SP_SOURCE_MONGO_URI in the environment.\n');
    process.exit(1);
  }
  if (!TARGET_URI) {
    console.error('\nMONGO_URI / MONGODB_URI is not set (target cluster).\n');
    process.exit(1);
  }

  console.log(`\nmode: ${VERIFY ? 'VERIFY' : APPLY ? 'APPLY (writes to target)' : 'DRY RUN (no writes)'}${FORCE ? ' +FORCE' : ''}`);
  console.log(`source from: ${SOURCE_ORIGIN}`);

  const srcConn = await connect(SOURCE_URI);
  const tgtConn = await connect(TARGET_URI, TARGET_DB);
  const srcDb = srcConn.db;
  const tgtDb = tgtConn.db;

  console.log(`source db: ${srcDb.databaseName}`);
  console.log(`target db: ${tgtDb.databaseName}${tgtDb.databaseName === 'test' ? '   (from the URI — the app reads this one)' : ''}`);
  if (process.env.MONGODB_DB_NAME && process.env.MONGODB_DB_NAME !== tgtDb.databaseName) {
    console.log(`  NOTE: MONGODB_DB_NAME=${process.env.MONGODB_DB_NAME} is set but the app ignores it`);
    console.log(`        (config/db.js passes no dbName), so migrating into "${tgtDb.databaseName}" is correct.`);
  }
  console.log('');

  // --list-dbs: the connection string pins one database, and it is easy to point this
  // at a staging db by mistake. This shows the siblings so you can confirm you picked
  // the right one before --apply.
  if (args.includes('--list-dbs')) {
    const { databases } = await srcConn.getClient().db().admin().listDatabases();
    console.log('databases on the SOURCE cluster:');
    for (const d of databases) {
      if (['admin', 'local', 'config'].includes(d.name)) continue;
      const cols = await srcConn.getClient().db(d.name).listCollections().toArray();
      let docs = 0;
      for (const c of cols) docs += await srcConn.getClient().db(d.name).collection(c.name).countDocuments();
      console.log(`  ${pad(d.name, 26)} ${String(cols.length).padStart(3)} collections, ${String(docs).padStart(7)} docs${d.name === srcDb.databaseName ? '   <-- selected' : ''}`);
    }
    console.log('');
    await srcConn.close();
    await tgtConn.close();
    return;
  }

  // --- nothing-left-behind check: every source collection must be accounted for ---
  const actual = (await srcDb.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  const unmapped = actual.filter((n) => !COLLECTION_MAP[n]);
  const missing = Object.keys(COLLECTION_MAP).filter((n) => !actual.includes(n));

  console.log(`source has ${actual.length} collections; map covers ${Object.keys(COLLECTION_MAP).length}`);
  if (unmapped.length) {
    console.log(`\n  !! ${unmapped.length} SOURCE COLLECTION(S) NOT IN THE MAP -- these would be left behind:`);
    for (const n of unmapped) console.log(`     ${pad(n, 34)} ${await srcDb.collection(n).countDocuments()} docs`);
  }
  if (missing.length) console.log(`\n  (mapped but absent from source, harmless: ${missing.join(', ')})`);

  if (VERIFY) {
    console.log('\n--- VERIFY: source vs target counts ---');
    console.log(`  ${pad('source', 30)}${pad('target', 32)}${num('src')} ${num('tgt')}  match`);
    let bad = 0;
    for (const [from, to] of Object.entries(COLLECTION_MAP)) {
      if (!actual.includes(from)) continue;
      const s = await srcDb.collection(from).countDocuments();
      const t = await tgtDb.collection(to).countDocuments();
      // >= not ==: the target may legitimately hold more (admins already there,
      // or docs created after the copy).
      const ok = t >= s;
      if (!ok) bad++;
      console.log(`  ${pad(from, 30)}${pad(to, 32)}${num(s)} ${num(t)}  ${ok ? 'ok' : 'MISMATCH'}`);
    }
    console.log(`\n${bad === 0 ? 'VERIFY PASS' : `VERIFY FAIL -- ${bad} collection(s) short`}\n`);
    await srcConn.close(); await tgtConn.close();
    process.exit(bad === 0 ? 0 : 1);
  }

  // --- admins (merge, insert-only) ---
  console.log('\n--- admins (merge into the shared collection) ---');
  if (actual.includes('admins') && (!ONLY.length || ONLY.includes('admins'))) {
    const r = await mergeAdmins(srcDb, tgtDb);
    console.log(`  source admins       : ${r.total}`);
    console.log(`  ${APPLY ? 'inserted' : 'would insert'}     : ${r.inserted}  (stamped servicesAccess:['serviceProvider'], adminLevel:'sp_superadmin')`);
    console.log(`  collisions (skipped): ${r.collisions.length}`);
    for (const c of r.collisions) console.log(`     ${pad(c.email, 38)} ${c.reason}`);
  } else {
    console.log('  skipped');
  }

  // --- everything else ---
  console.log('\n--- collections ---');
  console.log(`  ${pad('source', 30)}${pad('-> target', 32)}${num('docs')}  status`);
  const results = [];
  for (const [from, to] of Object.entries(COLLECTION_MAP)) {
    if (from === 'admins') continue;
    if (!actual.includes(from)) continue;
    if (ONLY.length && !ONLY.includes(from)) continue;
    const r = await copyCollection(srcDb, tgtDb, from, to);
    results.push(r);
    console.log(`  ${pad(r.from, 30)}${pad('-> ' + r.to, 32)}${num(r.srcCount)}  ${r.status}`);
  }

  // --- referential integrity, informational ---
  // Copying a collection whose parents are missing produces a panel full of blanks that
  // looks like a migration bug. Better to know before --apply than after.
  const REF_CHECKS = [
    { from: 'bookings', field: 'vendorId', to: 'vendors' },
    { from: 'bookings', field: 'userId', to: 'users' },
    { from: 'bookings', field: 'workerId', to: 'workers' },
    { from: 'bookings', field: 'serviceId', to: 'services' },
    { from: 'vendorbills', field: 'vendorId', to: 'vendors' },
    { from: 'userservices', field: 'categoryId', to: 'categories' },
    { from: 'carts', field: 'userId', to: 'users' },
  ];
  const dangling = [];
  for (const { from, field, to } of REF_CHECKS) {
    if (!actual.includes(from)) continue;
    const ids = await srcDb.collection(from).distinct(field, { [field]: { $ne: null } });
    if (ids.length === 0) continue;
    const present = await srcDb.collection(to).countDocuments({ _id: { $in: ids } });
    if (present < ids.length) {
      dangling.push({ from, field, to, referenced: ids.length, found: present, missing: ids.length - present });
    }
  }
  if (dangling.length) {
    console.log('\n--- DANGLING REFERENCES IN THE SOURCE (pre-existing, not caused by migrating) ---');
    for (const d of dangling) {
      console.log(`  ${pad(`${d.from}.${d.field}`, 30)} -> ${pad(d.to, 14)} ${d.missing} of ${d.referenced} referenced id(s) do not exist`);
    }
    console.log('  These will copy across as-is and render as blanks in the admin panel.');
  }

  // --- identity overlap, informational (drives the later user merge) ---
  if (actual.includes('users')) {
    console.log('\n--- identity overlap (informational, nothing is merged) ---');
    const o = await reportUserOverlap(srcDb, tgtDb);
    console.log(`  SP users with a usable phone     : ${o.spUsers}`);
    console.log(`  master users with a usable phone : ${o.masterUsers}`);
    console.log(`  same phone on both sides         : ${o.overlap}`);
    console.log('  -> these are the accounts the later users-collection merge would link.');
  }

  const totalDocs = results.reduce((a, r) => a + r.srcCount, 0);
  const totalCopied = results.reduce((a, r) => a + r.copied, 0);
  console.log(`\n${APPLY ? `copied ${totalCopied} of ${totalDocs} documents` : `DRY RUN -- ${totalDocs} documents would be copied. Re-run with --apply.`}`);
  if (unmapped.length) console.log(`WARNING: ${unmapped.length} source collection(s) are unmapped and were NOT copied.`);
  console.log('');

  await srcConn.close();
  await tgtConn.close();
}

main().catch((err) => {
  console.error('\nMIGRATION ERROR:', err.message);
  process.exit(1);
});
