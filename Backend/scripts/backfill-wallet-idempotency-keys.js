/**
 * Give every existing wallet transaction a name, so a unique index can be built.
 *
 * The unique index on `idempotencyKey` is what actually makes a retry harmless --
 * an application-level `findOne(...)` then write is two steps, and two concurrent
 * callers walk through the gap. But the index cannot be created over a collection
 * where the field does not exist: Mongo treats every missing value as `null`, and
 * the second document collides with the first.
 *
 * So this runs first. It stamps a key on every historical row:
 *
 *   - rows already carrying `metadata.referenceKey` keep that identity, prefixed,
 *     so the rows the old check-then-act dedupe considered "the same" stay the
 *     same under the index;
 *   - everything else gets `legacy:<_id>`, which is unique by construction and
 *     says plainly that this row predates the scheme. It does NOT claim the row
 *     was idempotent -- it claims only that it is distinct.
 *
 * It will NOT create the index. That is a separate, deliberate step, because the
 * build must happen after this reports zero collisions, and building a unique
 * index is the irreversible half.
 *
 * Usage:  node scripts/backfill-wallet-idempotency-keys.js            (dry run, default)
 *         node scripts/backfill-wallet-idempotency-keys.js --commit
 *
 * Idempotent: rows that already have the field are skipped, so re-running after a
 * partial failure resumes rather than restamping.
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

/**
 * Mirrors core/finance/idempotencyKeys.js. Deliberately duplicated rather than
 * imported: a migration must keep producing the keys it produced on the day it
 * ran, even if the taxonomy changes later. An import would silently rewrite
 * history the next time someone edits that file.
 */
const keyForRow = (row) => {
    const ref = String(row?.metadata?.referenceKey || '').trim();
    if (ref) return `legacy_ref:${ref}`;
    return `legacy:${String(row._id)}`;
};

async function run() {
    await mongoose.connect(uriFromEnv());
    const db = mongoose.connection.db;
    const col = db.collection('wallettransactions');

    console.log(`db=${db.databaseName}  mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

    const total = await col.countDocuments({});
    const already = await col.countDocuments({ idempotencyKey: { $exists: true, $ne: null } });
    const todo = total - already;

    console.log(`wallettransactions: ${total} rows, ${already} already keyed, ${todo} to stamp`);

    /*
     * The whole point of the dry run: find the rows that would collide BEFORE the
     * index exists to reject them. Two rows sharing a referenceKey means the old
     * check-then-act dedupe already lost a race and double-credited somebody --
     * a real incident to investigate, not something to paper over by picking a
     * different key.
     */
    const collisions = await col
        .aggregate([
            { $match: { 'metadata.referenceKey': { $exists: true, $nin: [null, ''] } } },
            { $group: { _id: { d: '$driverId', r: '$metadata.referenceKey' }, n: { $sum: 1 }, ids: { $push: '$_id' }, amounts: { $push: '$amount' } } },
            { $match: { n: { $gt: 1 } } },
        ])
        .toArray();

    if (collisions.length) {
        console.log(`\n!! ${collisions.length} referenceKey collision(s) -- these are real duplicate credits:\n`);
        for (const c of collisions.slice(0, 50)) {
            console.log(`   driver=${c._id.d} ref=${c._id.r} rows=${c.n} amounts=${JSON.stringify(c.amounts)}`);
            console.log(`     ids: ${c.ids.map(String).join(', ')}`);
        }
        if (collisions.length > 50) console.log(`   ... and ${collisions.length - 50} more`);
        console.log(
            '\n   Each of these needs a decision before the unique index can exist:\n' +
            '   was the money genuinely paid twice (reverse one), or are they distinct\n' +
            '   mutations that happen to share a reference (give one a new key)?\n' +
            '   NOT stamping these. Re-run once they are resolved.\n'
        );
    } else {
        console.log('no referenceKey collisions -- the unique index will build cleanly\n');
    }

    const collidingIds = new Set(collisions.flatMap((c) => c.ids.map(String)));

    let stamped = 0;
    let skippedColliding = 0;
    const cursor = col.find({ idempotencyKey: { $exists: false } }).project({ _id: 1, metadata: 1 });

    let batch = [];
    const flush = async () => {
        if (!batch.length) return;
        if (COMMIT) await col.bulkWrite(batch, { ordered: false });
        batch = [];
    };

    while (await cursor.hasNext()) {
        const row = await cursor.next();
        if (collidingIds.has(String(row._id))) {
            skippedColliding += 1;
            continue;
        }
        batch.push({
            updateOne: {
                filter: { _id: row._id, idempotencyKey: { $exists: false } },
                update: { $set: { idempotencyKey: keyForRow(row) } },
            },
        });
        stamped += 1;
        if (batch.length >= 500) await flush();
    }
    await flush();

    console.log(`${COMMIT ? 'stamped' : 'would stamp'}: ${stamped}`);
    if (skippedColliding) console.log(`skipped (colliding, need a human): ${skippedColliding}`);

    const ready = collisions.length === 0 && skippedColliding === 0;
    console.log(
        `\n${COMMIT ? 'DONE' : 'DRY-RUN'}  index-ready: ${ready ? 'YES' : 'NO'}`
    );
    if (!COMMIT) console.log('Re-run with --commit to apply.');
    if (ready && COMMIT) {
        console.log(
            '\nNext, deliberately and separately:\n' +
            "  db.wallettransactions.createIndex({ idempotencyKey: 1 }, { unique: true, background: true })\n"
        );
    }

    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error(`FAILED: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
