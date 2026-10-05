/**
 * Move the Firebase configuration out of .env and into the admin-managed settings
 * document, so it can be changed from the admin panel without a redeploy.
 *
 * Reads the current values from this backend's .env and writes them into the
 * `firebase` block of the third-party settings document -- the same block the panel
 * edits via PATCH /api/v1/taxi/admin/integration-settings/firebase.
 *
 * Dry run by default. Existing non-empty values in the database are NOT overwritten
 * unless --force: the panel is meant to be the source of truth once populated.
 *
 *   node scripts/seed-firebase-settings.js
 *   node scripts/seed-firebase-settings.js --apply
 *   node scripts/seed-firebase-settings.js --apply --force
 */

import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');

const URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!URI) {
    console.error('\nMONGO_URI / MONGODB_URI is not set.\n');
    process.exit(1);
}

const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '');

// env var -> settings key. Names match what the admin panel already uses.
const FROM_ENV = {
    firebase_api_key: process.env.VITE_FIREBASE_API_KEY,
    firebase_auth_domain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    firebase_project_id: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
    firebase_database_url: process.env.VITE_FIREBASE_DATABASE_URL,
    firebase_storage_bucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    firebase_messaging_sender_id: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    firebase_app_id: process.env.VITE_FIREBASE_APP_ID,
    firebase_measurement_id: process.env.VITE_FIREBASE_MEASUREMENT_ID,
    firebase_vapid_key: process.env.VITE_FIREBASE_VAPID_KEY,
    firebase_service_account: process.env.FIREBASE_SERVICE_ACCOUNT,
};

// Never printed in full. The service account is a private key.
const SECRET_KEYS = new Set(['firebase_service_account']);
const show = (k, v) => {
    if (!v) return '(empty)';
    if (!SECRET_KEYS.has(k)) return v;
    try {
        const sa = JSON.parse(v);
        return `{service account for ${sa.project_id}, ${v.length} chars}`;
    } catch {
        return `{${v.length} chars, NOT VALID JSON}`;
    }
};

await mongoose.connect(URI);

// Derive the collection from the MODEL, never from a guessed name. The model is
// registered as TaxiAdminThirdPartySetting, so mongoose pluralises it to
// `taxiadminthirdpartysettings` -- an earlier version of this script hardcoded
// `adminthirdpartysettings` and wrote every value into a stray collection that
// nothing reads, while the admin panel showed an empty form.
const { AdminThirdPartySetting } = await import('../src/modules/taxi/admin/models/AdminThirdPartySetting.js');
const conn = { db: mongoose.connection.db, close: () => mongoose.disconnect() };
const col = mongoose.connection.db.collection(AdminThirdPartySetting.collection.name);
console.log(`\ncollection: ${AdminThirdPartySetting.collection.name} (from the model)`);

let doc = await col.findOne({});
if (!doc) {
    console.log(`\nNo third-party settings document in "${conn.db.databaseName}" yet; one will be created.`);
}
const current = doc?.firebase || {};

console.log(`\ndatabase: ${conn.db.databaseName}`);
console.log(`mode    : ${APPLY ? 'APPLY' : 'DRY RUN'}${FORCE ? ' +FORCE' : ''}\n`);
console.log(`  ${'field'.padEnd(30)} ${'in database'.padEnd(34)} action`);

const next = { ...current };
let changes = 0;
for (const [key, rawEnv] of Object.entries(FROM_ENV)) {
    const envValue = clean(rawEnv);
    const dbValue = clean(current[key]);

    let action;
    if (!envValue) {
        action = 'nothing in env, skipped';
    } else if (dbValue && !FORCE) {
        action = dbValue === envValue ? 'already matches env' : 'DB differs — kept (use --force to overwrite)';
    } else {
        action = dbValue ? 'OVERWRITE from env' : 'set from env';
        next[key] = envValue;
        changes++;
    }
    console.log(`  ${key.padEnd(30)} ${String(show(key, dbValue)).slice(0, 33).padEnd(34)} ${action}`);
}

if (!changes) {
    console.log('\nNothing to change.\n');
    await conn.close();
    process.exit(0);
}

if (!APPLY) {
    console.log(`\nDRY RUN — ${changes} field(s) would be written. Re-run with --apply.\n`);
    await conn.close();
    process.exit(0);
}

await col.updateOne({}, { $set: { firebase: next } }, { upsert: true });
const after = (await col.findOne({}))?.firebase || {};
console.log(`\napplied. ${Object.keys(after).filter((k) => clean(after[k])).length} field(s) now set in the database.`);
console.log('The admin panel is now the source of truth; restart the API so it picks up the service account.\n');

await conn.close();
