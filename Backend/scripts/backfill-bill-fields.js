/**
 * Backfill the bill fields onto food orders placed before they existed.
 *
 *   node scripts/backfill-bill-fields.js            # dry run, writes nothing
 *   node scripts/backfill-bill-fields.js --apply    # writes
 *
 * WHAT IT WRITES, AND WHY EACH ONE IS EXACT
 *
 * Every order that predates these fields was priced EXCLUSIVE of GST -- the
 * inclusive setting did not exist, so no order could have used it. That single
 * fact is what makes four of the new fields recoverable exactly rather than
 * estimated:
 *
 *   commissionableAmount = subtotal      commission is charged on the listed
 *                                        food net of GST; net equals listed
 *                                        when the tax was added on top
 *   netItemAmount        = subtotal      the printed food line, same reason
 *   netPackagingFee      = packagingFee  the printed packaging line, same reason
 *   pricesIncludeGst     = false         it could not have been anything else
 *   totalBeforeTip       = total         a legacy order had no tip and no
 *                                        round-off, so the two are the same
 *                                        number
 *
 * WHAT IT DELIBERATELY DOES NOT WRITE
 *
 *   pricing.bill      A reconstruction is not the bill anyone was shown, and
 *                     its GST label would be a guess (see gstRate). The apps
 *                     render a legacy order from the flat fields instead, which
 *                     is what those fields are for. Left null.
 *   gstRate           Not recoverable. The old tax line was rounded to whole
 *                     rupees, so `100 * tax / subtotal` carries an error of up
 *                     to `50 / subtotal` percentage points -- on a Rs 100 order
 *                     that band admits both 5% and 5.6%. A rate is a label on
 *                     a bill; a wrong one is worse than none.
 *   packagingMode     Only decidable when the per-item charges reproduce the
 *                     stored fee, and undecidable exactly where an admin flat
 *                     charge happens to equal that sum. The payout ledger
 *                     already treats absence as the old behaviour.
 *   couponCode        Gone. It was never stored: the schema did not declare it,
 *                     so Mongoose dropped it on every save. Nothing else on the
 *                     order, the transaction or the offer records which coupon
 *                     was used.
 *   tip, roundOff,    Already 0 by schema default, and 0 is the true historical
 *   platformFeeGst    value rather than a guess -- the charged total was built
 *                     from six terms that included none of them.
 *
 * SCOPE
 *
 * `food_orders` is written by TWO Mongoose models: the food module's and quick
 * commerce's, both declaring the same collection on the same connection, with
 * no vertical discriminator between them. Quick-commerce orders carry
 * `pricing.deliveryMode` and `pricing.quickDeliveryFee`, which the food schema
 * has never had and, being strict, cannot acquire. Every query below is scoped
 * on their absence. Without that scope this migration writes food-shaped fields
 * onto quick-commerce orders.
 *
 * Idempotent: each step only matches documents missing the field it writes, so
 * a second run is a no-op and a half-finished run resumes.
 */
import '../src/config/env.js';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';

const APPLY = process.argv.includes('--apply');

/** Quick-commerce orders live in this collection too. Never touch them. */
const FOOD_ONLY = {
    'pricing.deliveryMode': { $exists: false },
    'pricing.quickDeliveryFee': { $exists: false },
};

const and = (...clauses) => ({ $and: [FOOD_ONLY, ...clauses] });

const money = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : String(n));

async function main() {
    await connectDB();
    const orders = mongoose.connection.db.collection('food_orders');

    const total = await orders.countDocuments({});
    const inScope = await orders.countDocuments(FOOD_ONLY);
    const quickCommerce = total - inScope;

    console.log('');
    console.log(`  ${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}`);
    console.log('');
    console.log(`  food_orders total          ${total}`);
    console.log(`  quick-commerce (skipped)   ${quickCommerce}`);
    console.log(`  food orders in scope       ${inScope}`);
    console.log('');

    /*
     * Each step names the field, the documents that still need it, and the
     * value. `value` is an aggregation-pipeline $set stage so a field can be
     * derived from another field on the same document.
     */
    const steps = [
        {
            field: 'pricing.pricesIncludeGst',
            why: 'the inclusive setting did not exist yet',
            filter: and({ 'pricing.pricesIncludeGst': { $exists: false } }),
            set: { 'pricing.pricesIncludeGst': false },
        },
        {
            field: 'pricing.commissionableAmount',
            why: 'commission is charged on the listed food; net equals listed when tax was added on top',
            filter: and({
                'pricing.commissionableAmount': { $exists: false },
                'pricing.subtotal': { $type: 'number' },
            }),
            set: { 'pricing.commissionableAmount': '$pricing.subtotal' },
        },
        {
            field: 'pricing.netItemAmount',
            why: 'the printed food line, same reason',
            filter: and({
                'pricing.netItemAmount': { $exists: false },
                'pricing.subtotal': { $type: 'number' },
            }),
            set: { 'pricing.netItemAmount': '$pricing.subtotal' },
        },
        {
            field: 'pricing.netPackagingFee',
            why: 'the printed packaging line, same reason',
            filter: and({
                'pricing.netPackagingFee': { $exists: false },
                'pricing.packagingFee': { $type: 'number' },
            }),
            set: { 'pricing.netPackagingFee': '$pricing.packagingFee' },
        },
        {
            field: 'pricing.totalBeforeTip',
            why: 'a legacy order had no tip and no round-off, so this is its total',
            filter: and({
                'pricing.totalBeforeTip': { $exists: false },
                'pricing.total': { $type: 'number' },
            }),
            set: { 'pricing.totalBeforeTip': '$pricing.total' },
        },
    ];

    let touched = 0;
    for (const step of steps) {
        const pending = await orders.countDocuments(step.filter);
        if (pending === 0) {
            console.log(`  ${step.field.padEnd(34)} nothing to do`);
            continue;
        }
        if (!APPLY) {
            const sample = await orders.findOne(step.filter, {
                projection: { 'pricing.subtotal': 1, 'pricing.packagingFee': 1, 'pricing.total': 1 },
            });
            console.log(`  ${step.field.padEnd(34)} ${String(pending).padStart(7)} to write   (${step.why})`);
            if (sample) {
                console.log(
                    `  ${''.padEnd(34)}         e.g. ${sample._id}: `
                    + `subtotal ${money(sample.pricing?.subtotal)}, `
                    + `packaging ${money(sample.pricing?.packagingFee)}, `
                    + `total ${money(sample.pricing?.total)}`,
                );
            }
            continue;
        }

        const res = await orders.updateMany(step.filter, [{ $set: step.set }]);
        touched += res.modifiedCount;
        console.log(`  ${step.field.padEnd(34)} ${String(res.modifiedCount).padStart(7)} written`);
    }

    /*
     * A reconciliation the migration cannot fix, only report.
     *
     * Since the itemised bill shipped, /orders/calculate quoted a grand total
     * that included the GST on the platform fee and a round-off, while
     * createOrder stored a total built from six terms that included neither.
     * Those orders were undercharged against the figure the customer was shown.
     * The money has already moved; nothing here should rewrite what was
     * charged. It is counted so the size of it is known.
     */
    if (!APPLY) {
        const withPlatformFee = await orders.countDocuments(
            and({ 'pricing.platformFee': { $gt: 0 }, 'pricing.bill': { $exists: false } }),
        );
        console.log('');
        console.log(`  orders carrying a platform fee but no bill: ${withPlatformFee}`);
        console.log('  Each was charged without the GST on that fee and without a round-off,');
        console.log('  because createOrder rebuilt the total by hand. That is fixed going');
        console.log('  forward; this migration does not restate what was already charged.');
    }

    console.log('');
    if (APPLY) {
        console.log(`  ${touched} field writes applied.`);
    } else {
        console.log('  Dry run. Re-run with --apply to write.');
    }
    console.log('');

    await disconnectDB();
}

main().catch(async (err) => {
    console.error('\n  Backfill failed:', err?.message || err);
    try { await disconnectDB(); } catch { /* already down */ }
    process.exit(1);
});
