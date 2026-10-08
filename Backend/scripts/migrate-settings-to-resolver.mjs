/**
 * Copy the per-service settings that moved into the config resolver (Phase 6)
 * into it, as vertical overrides.
 *
 *   node scripts/migrate-settings-to-resolver.mjs            # dry run (default): report only
 *   node scripts/migrate-settings-to-resolver.mjs --dry-run  # same
 *   node scripts/migrate-settings-to-resolver.mjs --apply    # write
 *
 * What moves, and the precedence rule that keeps behaviour identical, is in
 * src/core/config/legacySettings.js. In short: a value is copied only where the
 * service's own value is what readers use today, and only when no vertical
 * override exists yet, so every effective value is the same before and after.
 * The report prints each setting's effective value and source before and after,
 * and the run exits 1 if any value would change. Idempotent: a second --apply
 * finds everything 'in-sync'.
 *
 * Nothing in the old models is changed or removed; the old admin screens keep
 * working and are mirrored onto the new rows when saved.
 *
 * Reads MONGO_URI / MONGODB_URI from the environment (.env).
 */
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

const show = (v) => (v === null || v === undefined ? '-' : JSON.stringify(v));

export const migrateSettingsToResolver = async ({ apply = false, log = console.log } = {}) => {
    const { migrateLegacySettings } = await import('../src/core/config/legacySettings.js');
    const report = await migrateLegacySettings({ apply });
    let changed = 0;
    for (const r of report) {
        const same = JSON.stringify(r.before.value) === JSON.stringify(r.after.value);
        if (!same) changed += 1;
        log(
            `[settings] ${r.key.padEnd(38)} ${r.vertical.padEnd(14)} ${r.action.padEnd(8)} `
            + `own=${show(r.legacyValue)} effective ${show(r.before.value)} (${r.before.origin}) -> ${show(r.after.value)} (${r.after.origin})`
            + `${r.note ? `  -- ${r.note}` : ''}${same ? '' : '  !! VALUE CHANGED'}`,
        );
    }
    const counts = report.reduce((acc, r) => ({ ...acc, [r.action]: (acc[r.action] || 0) + 1 }), {});
    log(`[settings] ${apply ? 'applied' : 'dry run (pass --apply to write)'}: ${JSON.stringify(counts)}`);
    return { report, counts, changed };
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
        .then(() => migrateSettingsToResolver({ apply }))
        .then(async ({ changed }) => {
            await mongoose.disconnect();
            if (changed) {
                console.error(`[settings] ${changed} effective value(s) changed -- investigate before relying on this run`);
                process.exit(1);
            }
            process.exit(0);
        })
        .catch((err) => { console.error(err); process.exit(1); });
}
