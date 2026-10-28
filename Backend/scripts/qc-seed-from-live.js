/**
 * Seed master's qc_* collections from the live quick-commerce database.
 *
 * The target database is SHARED WITH LIVE (master's MONGODB_URI has no database in its
 * path, so it resolves to `test`, the same database k9-backend serves). That single
 * fact drives every safety rule below:
 *
 *   - Only collections whose target name starts with `qc_` are ever written. The plan
 *     is built from the two codebases' models, and the one entry that mapped onto a
 *     shared collection (the unified notification inbox, food_notifications) is not in
 *     it. This is asserted again at runtime -- a bad plan entry aborts the run.
 *   - Nothing is ever dropped, updated or deleted. Inserts only.
 *   - _id is preserved, so references between the copied documents (order -> user,
 *     item -> category) still resolve after the copy.
 *   - Re-running is safe: duplicate _ids are counted and skipped, not overwritten.
 *
 * Usage:  node qc-seed.js --dry-run     (default)
 *         node qc-seed.js --commit
 */
const fs = require('fs');
const { MongoClient } = require('mongodb');

const COMMIT = process.argv.includes('--commit');
const BATCH = 500;

/**
 * Session and credential artifacts. These are derived state, not data worth seeding --
 * copying them hands master live sessions minted by the standalone quick-commerce app.
 *
 * Excluded here rather than by editing the plan, because the plan is regenerated from
 * the two codebases' models and would simply grow them back.
 */
const NEVER_COPY = new Set(['qc_refresh_tokens', 'qc_otps', 'qc_admin_reset_otps']);

const PLAN = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'qc-seed-plan.json'), 'utf8'))
    .filter((p) => !NEVER_COPY.has(p.to));

const uriFrom = (envPath) => {
    const m = fs.readFileSync(envPath, 'utf8').match(/^MONGODB_URI=(.*)$/m);
    if (!m) throw new Error(`no MONGODB_URI in ${envPath}`);
    return m[1].trim();
};

(async () => {
    // Refuse to run a plan that would touch anything outside the qc_ namespace.
    const illegal = PLAN.filter((p) => !p.to.startsWith('qc_'));
    if (illegal.length) {
        throw new Error(`plan targets non-qc collections: ${illegal.map((p) => p.to).join(', ')}`);
    }

    const src = await MongoClient.connect(uriFrom('/opt/quick-commerce/Backend/.env'));
    const dst = await MongoClient.connect(uriFrom('/opt/master/Backend/.env'));
    const sdb = src.db();
    const ddb = dst.db();

    console.log(`source=${sdb.databaseName}  target=${ddb.databaseName}  mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
    console.log('');

    let totalRead = 0;
    let totalWritten = 0;
    let totalDup = 0;

    for (const { from, to } of PLAN) {
        const n = await sdb.collection(from).countDocuments();
        if (!n) continue;

        const before = await ddb.collection(to).countDocuments();
        totalRead += n;

        if (!COMMIT) {
            console.log(`  ${String(n).padStart(5)}  ${from}  ->  ${to}  (target has ${before})`);
            continue;
        }

        let written = 0;
        let dup = 0;
        const cursor = sdb.collection(from).find({});
        let batch = [];
        const flush = async () => {
            if (!batch.length) return;
            try {
                const r = await ddb.collection(to).insertMany(batch, { ordered: false });
                written += r.insertedCount;
            } catch (err) {
                // ordered:false keeps going past duplicates; everything else is real.
                written += err.result?.nInserted ?? err.result?.insertedCount ?? 0;
                const errs = err.writeErrors || [];
                dup += errs.filter((e) => e.code === 11000).length;
                const other = errs.filter((e) => e.code !== 11000);
                if (other.length) console.error(`    ! ${to}: ${other[0].errmsg}`);
            }
            batch = [];
        };
        for await (const doc of cursor) {
            batch.push(doc);
            if (batch.length >= BATCH) await flush();
        }
        await flush();

        totalWritten += written;
        totalDup += dup;
        console.log(`  ${String(written).padStart(5)} inserted  ${String(dup).padStart(4)} dup  ${from} -> ${to}`);
    }

    console.log('');
    console.log(COMMIT
        ? `DONE  read=${totalRead}  inserted=${totalWritten}  skipped_duplicate=${totalDup}`
        : `DRY-RUN  would copy ${totalRead} documents into ${PLAN.length} qc_* collections. Re-run with --commit.`);

    await src.close();
    await dst.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
