#!/usr/bin/env node
/**
 * Who can be merged safely, who cannot, and who needs a human. Reads only.
 *
 * `link-user-identities.js` stamps `platformUserId` on every sp_user and qc_user by
 * matching the last ten digits of a phone number. That is the right shape, but it
 * decides silently in two places where it should stop and ask:
 *
 *   1. It indexes platform users into a suffix map with
 *
 *          if (s && !suffixToId.has(s)) suffixToId.set(s, u._id);
 *
 *      so when TWO rows in `users` share a phone suffix, the second is discarded
 *      and every satellite matching it links to whichever happened to be read
 *      first. Which one that is depends on collection scan order.
 *
 *   2. It never looks at names or emails. A phone number that has been recycled to
 *      a new subscriber -- which happens, and happens more in markets with high
 *      prepaid churn -- links a stranger to the previous owner's account, and with
 *      it their order history, their addresses and their wallet.
 *
 * Merging identities is the one operation on this list that cannot be undone by
 * reverting a commit. So this script exists to answer "what would happen" BEFORE
 * anything is written, and it has no --commit mode on purpose: analysis and
 * migration should not be the same command with a different flag, because that is
 * how somebody runs the migration while meaning to run the analysis.
 *
 *   node scripts/analyse-identity-merge.mjs                  human-readable report
 *   node scripts/analyse-identity-merge.mjs --json out.json   full detail for review
 *
 * What the buckets mean:
 *
 *   SAFE        exactly one platform user matches, and the identity evidence does
 *               not contradict it. Migrate these automatically.
 *   AMBIGUOUS   more than one candidate. NEVER auto-merge: the script cannot know
 *               which is the person, and picking one silently is the bug above.
 *   CONFLICTING one candidate, but the names look like different people. Most
 *               likely a recycled phone number.
 *   UNUSABLE    fewer than ten digits, or no phone at all. Nothing to match on.
 *   LINKED      already carries platformUserId. Left alone.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_OUT = process.argv.includes('--json')
    ? process.argv[process.argv.indexOf('--json') + 1]
    : null;

const uriFromEnv = () => {
    if (process.env.MONGO_URI) return process.env.MONGO_URI;
    const envPath = path.join(__dirname, '..', '.env');
    const m = fs.readFileSync(envPath, 'utf8').match(/^MONGODB_URI=(.*)$/m);
    if (!m) throw new Error('no MONGODB_URI');
    return m[1].trim();
};

/*
 * The matching rules come from src/core/identity/phoneMatch.js, not from a copy
 * here. They decide whether a stranger inherits somebody's wallet, so they belong
 * somewhere with checks against them -- and this script existing was itself the
 * third place the ten-digit rule had been written out by hand.
 */
import {
    toTenDigits,
    namesAgree,
    emailsAgree,
} from '../src/core/identity/phoneMatch.js';

async function run() {
    await mongoose.connect(uriFromEnv());
    const db = mongoose.connection.db;
    console.log(`db=${db.databaseName}   READ-ONLY ANALYSIS (this script never writes)\n`);

    // --- index every platform user by suffix, KEEPING COLLISIONS ---------------
    const bySuffix = new Map();
    let platformTotal = 0;
    let platformUnusable = 0;

    for await (const u of db.collection('users').find({}, { projection: { phone: 1, name: 1, email: 1 } })) {
        platformTotal += 1;
        const s = toTenDigits(u.phone);
        if (!s) { platformUnusable += 1; continue; }
        if (!bySuffix.has(s)) bySuffix.set(s, []);
        bySuffix.get(s).push(u);
    }

    const collided = [...bySuffix.entries()].filter(([, rows]) => rows.length > 1);

    console.log(`platform users            : ${platformTotal}`);
    console.log(`  indexable by phone      : ${bySuffix.size} distinct suffixes`);
    console.log(`  with an unusable phone  : ${platformUnusable}`);
    console.log(`  SUFFIXES SHARED BY >1 USER: ${collided.length}`);
    if (collided.length) {
        console.log('\n  These are why the existing script cannot be trusted to pick:');
        for (const [suffix, rows] of collided.slice(0, 15)) {
            console.log(`    ...${suffix}  ->  ${rows.map((r) => `${r._id} ${JSON.stringify(r.name || '')}`).join('   |   ')}`);
        }
        if (collided.length > 15) console.log(`    ... and ${collided.length - 15} more`);
    }

    // --- classify every satellite row -----------------------------------------
    const report = { generatedAt: new Date().toISOString(), platform: { total: platformTotal, collidedSuffixes: collided.length }, satellites: {} };
    const grand = { safe: 0, ambiguous: 0, conflicting: 0, unusable: 0, linked: 0 };

    for (const coll of ['sp_users', 'qc_users']) {
        const counts = { safe: 0, ambiguous: 0, conflicting: 0, unusable: 0, linked: 0 };
        const detail = { ambiguous: [], conflicting: [], unusable: [] };
        const seenSuffix = new Map();

        for await (const doc of db.collection(coll).find({}, { projection: { phone: 1, name: 1, email: 1, platformUserId: 1 } })) {
            if (doc.platformUserId) { counts.linked += 1; continue; }

            const suffix = toTenDigits(doc.phone);
            if (!suffix) {
                counts.unusable += 1;
                detail.unusable.push({ _id: String(doc._id), phone: doc.phone ?? null });
                continue;
            }

            // Two rows in the SAME satellite sharing a phone are themselves a
            // duplicate-account problem, and merging both into one platform user
            // would silently join two accounts. Flagged rather than counted safe.
            if (seenSuffix.has(suffix)) {
                counts.ambiguous += 1;
                detail.ambiguous.push({
                    _id: String(doc._id), suffix, reason: 'duplicate within this collection',
                    otherId: seenSuffix.get(suffix),
                });
                continue;
            }
            seenSuffix.set(suffix, String(doc._id));

            const candidates = bySuffix.get(suffix) || [];

            if (candidates.length > 1) {
                counts.ambiguous += 1;
                detail.ambiguous.push({
                    _id: String(doc._id), suffix, reason: 'several platform users share this phone',
                    candidates: candidates.map((c) => ({ _id: String(c._id), name: c.name ?? null })),
                });
                continue;
            }

            if (candidates.length === 0) {
                // No platform user yet: creating one is unambiguous and safe.
                counts.safe += 1;
                continue;
            }

            const [match] = candidates;
            if (!namesAgree(doc.name, match.name) || !emailsAgree(doc.email, match.email)) {
                counts.conflicting += 1;
                detail.conflicting.push({
                    _id: String(doc._id), suffix,
                    satellite: { name: doc.name ?? null, email: doc.email ?? null },
                    platform: { _id: String(match._id), name: match.name ?? null, email: match.email ?? null },
                });
                continue;
            }

            counts.safe += 1;
        }

        report.satellites[coll] = { counts, detail };
        for (const k of Object.keys(grand)) grand[k] += counts[k];

        console.log(`\n${coll}`);
        console.log(`  SAFE        ${counts.safe}\t(migrate automatically)`);
        console.log(`  AMBIGUOUS   ${counts.ambiguous}\t(never auto-merge)`);
        console.log(`  CONFLICTING ${counts.conflicting}\t(likely a recycled phone number)`);
        console.log(`  UNUSABLE    ${counts.unusable}\t(no phone to match on)`);
        console.log(`  LINKED      ${counts.linked}\t(already done)`);

        for (const row of detail.conflicting.slice(0, 5)) {
            console.log(`    ! ${row._id}: satellite ${JSON.stringify(row.satellite.name)} vs platform ${JSON.stringify(row.platform.name)}`);
        }
        if (detail.conflicting.length > 5) console.log(`    ... and ${detail.conflicting.length - 5} more`);
    }

    const needsHuman = grand.ambiguous + grand.conflicting;
    console.log('\n' + '-'.repeat(64));
    console.log(`SAFE to migrate automatically : ${grand.safe}`);
    console.log(`NEEDS A HUMAN                 : ${needsHuman}  (${grand.ambiguous} ambiguous, ${grand.conflicting} conflicting)`);
    console.log(`No phone to match on          : ${grand.unusable}`);
    console.log(`Already linked                : ${grand.linked}`);

    if (needsHuman === 0 && collided.length === 0) {
        console.log('\nNothing ambiguous. link-user-identities.js --commit is safe to run.');
    } else {
        console.log(
            '\nDO NOT run link-user-identities.js --commit yet. It would resolve the'
            + `\n${needsHuman} case(s) above by picking silently, and an identity merge is not`
            + '\nsomething a revert undoes. Resolve them first, or teach that script to'
            + '\nskip anything this one flags.',
        );
    }

    if (JSON_OUT) {
        fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
        console.log(`\nfull detail written to ${JSON_OUT}`);
    } else {
        console.log('\nRe-run with --json <file> for the full list of rows needing review.');
    }

    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error(`FAILED: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
