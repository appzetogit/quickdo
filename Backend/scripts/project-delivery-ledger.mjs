/**
 * Project food and quick-commerce rider money into the master ledger, then prove
 * the ledger agrees with riderFinance.
 *
 * See core/finance/deliveryLedgerProjector.js for why this is a projection and not
 * a dual-write, and why running it repeatedly is safe.
 *
 * Usage:
 *   node scripts/project-delivery-ledger.mjs                       dry run, both verticals
 *   node scripts/project-delivery-ledger.mjs --vertical food       one vertical
 *   node scripts/project-delivery-ledger.mjs --partner <id> --vertical quickCommerce
 *   node scripts/project-delivery-ledger.mjs --commit              append, then reconcile
 *
 * Dry run is READ-ONLY: it reads orders, deposits, withdrawals, bonuses and the
 * ledger, and prints what it would append. Nothing reads the ledger in the app, so
 * even --commit changes no balance any rider or admin sees.
 *
 * Exit code 1 if any partner failed, or if --commit leaves any partner disagreeing
 * with riderFinance.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);

const uriFromEnv = () => {
    if (process.env.MONGO_URI) return process.env.MONGO_URI;
    const envPath = path.join(__dirname, '..', '.env');
    const m = fs.readFileSync(envPath, 'utf8').match(/^MONGODB_URI=(.*)$/m);
    if (!m) throw new Error('no MONGODB_URI');
    return m[1].trim();
};

async function run() {
    await mongoose.connect(uriFromEnv());
    const db = mongoose.connection.db;
    console.log(`db=${db.databaseName}  mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

    const { DELIVERY_VERTICALS } = await import('../src/core/finance/riderFinance.service.js');
    const projector = await import('../src/core/finance/deliveryLedgerProjector.js');

    if (COMMIT) {
        // Both are what make an append safe; refuse rather than write without them.
        const hello = await db.admin().command({ hello: 1 });
        if (!hello.setName) throw new Error('not a replica set: ledger.append needs transactions. Nothing written.');

        const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
        await LedgerEntry.init();
        const indexes = await LedgerEntry.collection.indexes();
        const unique = indexes.some((i) => i.unique && i.key?.idempotencyKey === 1);
        if (!unique) throw new Error('ledger_entries has no unique idempotencyKey index. Nothing written.');
    }

    const verticalArg = arg('--vertical');
    const verticals = verticalArg ? [verticalArg] : DELIVERY_VERTICALS;
    const partnerArg = arg('--partner');
    let failed = 0;
    let dirty = 0;

    for (const vertical of verticals) {
        const partners = partnerArg ? [partnerArg] : await projector.listPartnersWithMoney(vertical);
        const totals = { partners: partners.length, entries: 0, corrections: 0, appended: 0, duplicates: 0, sum: 0 };

        for (const partnerId of partners) {
            try {
                const r = await projector.projectPartner({ partnerId, vertical, commit: COMMIT });
                totals.entries += r.entries.length;
                totals.corrections += r.corrections;
                totals.appended += r.appended;
                totals.duplicates += r.duplicates;
                totals.sum += r.entries.reduce((s, e) => s + e.amount, 0);
                if (partnerArg) {
                    for (const e of r.entries) {
                        console.log(`  ${e.idempotencyKey}  ${e.type}  amount=${e.amount}  cash=${e.cashDelta}`);
                    }
                }
            } catch (err) {
                failed += 1;
                console.error(`  FAILED ${vertical} ${partnerId}: ${err.message}`);
            }
        }

        console.log(
            `${vertical}: ${totals.partners} partners, ${totals.entries} entries `
            + `(${totals.corrections} corrections, net ${Math.round(totals.sum * 100) / 100})`
            + (COMMIT ? `, appended ${totals.appended}, already present ${totals.duplicates}` : ''),
        );

        if (!COMMIT) continue;

        let verticalDirty = 0;
        for (const partnerId of partners) {
            const r = await projector.reconcilePartner({ partnerId, vertical });
            if (!r.clean) {
                verticalDirty += 1;
                console.error(
                    `  DISAGREES ${vertical} ${partnerId}: ledger ${JSON.stringify(r.ledger)} `
                    + `riderFinance ${JSON.stringify(r.derived)}`,
                );
            }
        }
        dirty += verticalDirty;
        console.log(`${vertical}: reconciled, ${verticalDirty} of ${partners.length} partners disagree with riderFinance`);
    }

    if (!COMMIT) console.log('\nDRY-RUN: nothing written. Re-run with --commit to append.');
    await mongoose.disconnect();
    process.exit(failed || dirty ? 1 : 0);
}

run().catch(async (err) => {
    console.error(`ABORTED: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
