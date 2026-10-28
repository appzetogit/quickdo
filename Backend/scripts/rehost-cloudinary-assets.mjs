/**
 * Copy every surviving Cloudinary asset onto local disk, in place.
 *
 * The account is a Free plan sitting at 472% of quota. Cloudinary disables it
 * for overage and re-enables it at the monthly billing rollover, which is the
 * "images sometimes disappear" behaviour that started this whole thread. It is
 * serving right now only because the month just turned over, and it will go
 * dark again as soon as the quota is spent.
 *
 * So this is a rescue, not a migration: these are the assets that could not be
 * replaced with stock imagery because they are genuine records -- delivery
 * partners' Aadhaar/PAN/licence photos, restaurants' PAN and FSSAI documents,
 * photographs of real menu cards, and the platform's own logos. Re-hosting the
 * originals keeps them; letting the window close loses them for good.
 *
 * Walks every collection, rewrites each Cloudinary URL in place (including
 * nested and array fields), and leaves anything it cannot fetch untouched so a
 * failure is never silently turned into a broken link.
 *
 *   node scripts/rehost-cloudinary-assets.mjs --dry-run
 *   node scripts/rehost-cloudinary-assets.mjs
 */
import '../src/config/env.js';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { saveImageFromUrl } from '../src/services/storage.service.js';

const dryRun = process.argv.includes('--dry-run');
const CLOUDINARY = 'res.cloudinary.com';

/** Where a given field should land on disk, so the store stays browsable. */
const folderFor = (collection, path) => {
    const base = collection.replace(/^food_/, 'food/').replace(/^qc_/, 'qc/').replace(/s$/, '');
    const leaf = path.replace(/\.\d+/g, '').split('.').pop() || 'asset';
    return `${base}/${leaf}`.replace(/[^a-zA-Z0-9/_-]/g, '-');
};

/** Every string field holding a Cloudinary URL, with its dotted path. */
const collectUrls = (value, path, out) => {
    if (typeof value === 'string') {
        if (value.includes(CLOUDINARY)) out.push({ path, url: value });
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectUrls(item, `${path}.${index}`, out));
        return;
    }
    if (value && typeof value === 'object'
        && !(value instanceof Date)
        && !(value instanceof mongoose.Types.ObjectId)) {
        for (const [key, inner] of Object.entries(value)) {
            collectUrls(inner, path ? `${path}.${key}` : key, out);
        }
    }
};

const main = async () => {
    await connectDB();
    const db = mongoose.connection.db;

    let found = 0;
    let rehosted = 0;
    let failed = 0;

    for (const { name } of await db.listCollections().toArray()) {
        for (const doc of await db.collection(name).find({}).toArray()) {
            const hits = [];
            collectUrls(doc, '', hits);
            if (hits.length === 0) continue;
            found += hits.length;

            const $set = {};
            for (const { path, url } of hits) {
                const label = `${name}.${path}`.slice(0, 52).padEnd(52);

                if (dryRun) {
                    console.log(`  ${label} -> ${folderFor(name, path)}`);
                    continue;
                }

                try {
                    const stored = await saveImageFromUrl(url, folderFor(name, path));
                    $set[path] = stored.url;
                    console.log(`  ${label} ${(stored.size / 1024).toFixed(0).padStart(5)}KB  ok`);
                    rehosted += 1;
                } catch (error) {
                    // Leave the original URL alone: a broken fetch must not be
                    // upgraded into a dead local link.
                    console.log(`  ${label} !! ${(error?.message || error).toString().slice(0, 60)}`);
                    failed += 1;
                }
            }

            if (!dryRun && Object.keys($set).length > 0) {
                $set.updatedAt = new Date();
                await db.collection(name).updateOne({ _id: doc._id }, { $set });
            }
        }
    }

    console.log(
        dryRun
            ? `\n${found} Cloudinary asset(s) would be re-hosted`
            : `\ndone: ${rehosted} re-hosted, ${failed} failed, of ${found} found`
    );

    await disconnectDB();
    process.exit(0);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
