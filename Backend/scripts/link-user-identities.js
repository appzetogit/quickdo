/**
 * Identity merge, phase 1 backfill: stamp `platformUserId` on every sp_user and
 * qc_user, creating platform identities where none exist.
 *
 * New registrations link themselves (see identityLink.service.js); this repairs the
 * documents that predate the link. Idempotent -- already-linked documents are
 * skipped, so re-running after a partial failure is safe. Nothing is deleted or
 * overwritten: satellites gain one field, `users` gains rows only for customers who
 * exist solely in a satellite.
 *
 * Usage:  node scripts/link-user-identities.js            (dry run, default)
 *         node scripts/link-user-identities.js --commit
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMMIT = process.argv.includes('--commit');

const uriFromEnv = () => {
    if (process.env.MONGO_URI) return process.env.MONGO_URI;
    const envPath = path.join(__dirname, '..', '.env');
    const m = fs.readFileSync(envPath, 'utf8').match(/^MONGODB_URI=(.*)$/m);
    if (!m) throw new Error('no MONGODB_URI');
    return m[1].trim();
};

const toTenDigits = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
};

async function run() {
    await mongoose.connect(uriFromEnv());
    const db = mongoose.connection.db;
    console.log(`db=${db.databaseName}  mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

    const users = db.collection('users');

    // One in-memory suffix -> _id map beats a regex query per satellite row.
    // ponytail: fine at current scale (tens of thousands); stream it if users
    // ever stops fitting in memory.
    const suffixToId = new Map();
    for await (const u of users.find({}, { projection: { phone: 1 } })) {
        const s = toTenDigits(u.phone);
        if (s && !suffixToId.has(s)) suffixToId.set(s, u._id);
    }
    console.log(`platform users indexed: ${suffixToId.size}`);

    const totals = { linked: 0, created: 0, alreadyLinked: 0, unusablePhone: 0 };

    for (const coll of ['sp_users', 'qc_users']) {
        const satellites = db.collection(coll);
        const counts = { linked: 0, created: 0, alreadyLinked: 0, unusablePhone: 0 };

        for await (const doc of satellites.find({}, { projection: { phone: 1, name: 1, email: 1, platformUserId: 1 } })) {
            if (doc.platformUserId) { counts.alreadyLinked++; continue; }

            const suffix = toTenDigits(doc.phone);
            if (!suffix) { counts.unusablePhone++; console.log(`  ! ${coll}/${doc._id}: unusable phone ${JSON.stringify(doc.phone)}`); continue; }

            let platformId = suffixToId.get(suffix);
            if (!platformId) {
                counts.created++;
                if (COMMIT) {
                    const r = await users.insertOne({
                        phone: suffix,
                        ...(doc.name ? { name: doc.name } : {}),
                        ...(doc.email ? { email: doc.email } : {}),
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                    platformId = r.insertedId;
                    suffixToId.set(suffix, platformId);
                } else {
                    // Dry run: reserve the suffix so a second satellite with the same
                    // phone counts as linked-to-the-new-user, not created twice.
                    suffixToId.set(suffix, 'would-create');
                    continue;
                }
            }

            counts.linked++;
            if (COMMIT) {
                await satellites.updateOne({ _id: doc._id }, { $set: { platformUserId: platformId } });
            }
        }

        console.log(`${coll}: linked=${counts.linked} created-platform-users=${counts.created} already-linked=${counts.alreadyLinked} unusable=${counts.unusablePhone}`);
        for (const k of Object.keys(totals)) totals[k] += counts[k];
    }

    console.log(`\n${COMMIT ? 'DONE' : 'DRY-RUN'}  linked=${totals.linked} created=${totals.created} already=${totals.alreadyLinked} unusable=${totals.unusablePhone}`);
    if (!COMMIT) console.log('Re-run with --commit to apply.');
    await mongoose.disconnect();
}

await run().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
