/**
 * The bill backfill, against a corpus that looks like production.
 *
 * Two things this has to prove, and the second is the one that would hurt:
 *
 *   1. A legacy food order comes out carrying the fields the payout path and
 *      the bill screens read, with values that are exact rather than guessed.
 *   2. A quick-commerce order comes out UNTOUCHED. Both modules write the same
 *      `food_orders` collection through the same connection with no vertical
 *      discriminator between them, so an unscoped migration would stamp
 *      food-shaped fields onto quick-commerce orders.
 *
 * It also holds the migration to being idempotent, since a run can be
 * interrupted and will be repeated.
 *
 * Run:  node tests/backfill.smoke.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'backfill-bill-fields.js');

const mem = await MongoMemoryServer.create();
const uri = mem.getUri('backfilltest');
await mongoose.connect(uri);
const orders = mongoose.connection.db.collection('food_orders');

let pass = 0, fail = 0;
const check = (n, c, d = '') => {
    if (c) { pass++; console.log(`    PASS  ${n.padEnd(58)}${d}`); }
    else { fail++; console.log(`    FAIL  ${n.padEnd(58)}${d}`); }
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const run = (apply) => {
    const args = apply ? [SCRIPT, '--apply'] : [SCRIPT];
    return spawnSync(process.execPath, args, {
        cwd: path.join(HERE, '..'),
        env: { ...process.env, MONGODB_URI: uri, NODE_ENV: 'test' },
        encoding: 'utf8',
    });
};

/** A food order as it was stored before any of the bill fields existed. */
const legacy = (id, pricing) => ({
    _id: id,
    userId: new mongoose.Types.ObjectId(),
    restaurantId: new mongoose.Types.ObjectId(),
    items: [{ itemId: 'x', name: 'dish', price: pricing.subtotal, quantity: 1 }],
    deliveryAddress: { street: 's', city: 'Palampur', state: 'HP' },
    pricing: { currency: 'INR', ...pricing },
    payment: { method: 'cash', status: 'cod_pending' },
    orderStatus: 'delivered',
    createdAt: new Date('2026-01-01T00:00:00Z'),
});

const FOOD_A = new mongoose.Types.ObjectId();
const FOOD_B = new mongoose.Types.ObjectId();
const FOOD_NO_PACK = new mongoose.Types.ObjectId();
const QC = new mongoose.Types.ObjectId();
const ALREADY = new mongoose.Types.ObjectId();

try {
    await orders.insertMany([
        legacy(FOOD_A, { subtotal: 200, tax: 11.2, packagingFee: 20, deliveryFee: 25, platformFee: 10, discount: 0, total: 266.2 }),
        legacy(FOOD_B, { subtotal: 357, tax: 19.99, packagingFee: 0, deliveryFee: 0, platformFee: 10, discount: 50, total: 336.99 }),
        // packagingFee absent entirely, not zero -- plenty of real rows look like this.
        legacy(FOOD_NO_PACK, { subtotal: 100, tax: 5.6, deliveryFee: 25, platformFee: 10, discount: 0, total: 140.6 }),
        // A quick-commerce order. Same collection, different vertical.
        {
            ...legacy(QC, { subtotal: 500, tax: 25, packagingFee: 15, deliveryFee: 30, platformFee: 12, discount: 0, total: 582 }),
            _id: QC,
            pricing: {
                currency: 'INR', subtotal: 500, tax: 25, packagingFee: 15, deliveryFee: 30,
                platformFee: 12, discount: 0, total: 582,
                deliveryMode: 'basic', quickDeliveryFee: 0,
            },
        },
        // An order already migrated, or written after the fields shipped.
        {
            ...legacy(ALREADY, { subtotal: 100, tax: 5.6, packagingFee: 0, deliveryFee: 0, platformFee: 0, discount: 0, total: 105.6 }),
            _id: ALREADY,
            pricing: {
                currency: 'INR', subtotal: 100, tax: 5.6, packagingFee: 0, deliveryFee: 0,
                platformFee: 0, discount: 0, total: 105.6,
                pricesIncludeGst: true, commissionableAmount: 94.7,
                netItemAmount: 94.7, netPackagingFee: 0, totalBeforeTip: 105.6,
            },
        },
    ]);

    // ---------------------------------------------------------------
    console.log('\n  ===== 1. a dry run writes nothing =====');
    const dry = run(false);
    if (dry.status !== 0) {
        console.log(dry.stdout, dry.stderr);
        throw new Error('dry run exited ' + dry.status);
    }
    console.log(dry.stdout.split('\n').filter((l) => l.trim()).map((l) => '  ' + l).join('\n'));

    const afterDry = await orders.findOne({ _id: FOOD_A });
    check('a dry run leaves the documents alone',
        afterDry.pricing.commissionableAmount === undefined,
        `${afterDry.pricing.commissionableAmount}`);
    check('it reports the quick-commerce order as out of scope',
        /quick-commerce \(skipped\)\s+1/.test(dry.stdout));
    check('and counts the food orders it would touch',
        /food orders in scope\s+4/.test(dry.stdout));

    // ---------------------------------------------------------------
    console.log('\n  ===== 2. applying it =====');
    const applied = run(true);
    if (applied.status !== 0) {
        console.log(applied.stdout, applied.stderr);
        throw new Error('apply exited ' + applied.status);
    }
    console.log(applied.stdout.split('\n').filter((l) => l.trim()).map((l) => '  ' + l).join('\n'));

    const a = (await orders.findOne({ _id: FOOD_A })).pricing;
    console.log('');
    check('commissionableAmount is the listed food', near(a.commissionableAmount, 200), `${a.commissionableAmount}`);
    check('netItemAmount is the listed food', near(a.netItemAmount, 200), `${a.netItemAmount}`);
    check('netPackagingFee is the packaging charged', near(a.netPackagingFee, 20), `${a.netPackagingFee}`);
    check('pricesIncludeGst is false', a.pricesIncludeGst === false, `${a.pricesIncludeGst}`);
    check('totalBeforeTip is the total', near(a.totalBeforeTip, 266.2), `${a.totalBeforeTip}`);
    check('the charged total is NOT rewritten', near(a.total, 266.2), `${a.total}`);
    check('no bill is invented', a.bill === undefined, `${a.bill}`);
    check('no gstRate is guessed', a.gstRate === undefined, `${a.gstRate}`);

    const b = (await orders.findOne({ _id: FOOD_B })).pricing;
    check('a discounted order is commissioned on the pre-discount food',
        near(b.commissionableAmount, 357), `${b.commissionableAmount}`);

    const np = (await orders.findOne({ _id: FOOD_NO_PACK })).pricing;
    check('an order with no packagingFee gets no netPackagingFee',
        np.netPackagingFee === undefined, `${np.netPackagingFee}`);
    check('but still gets the fields it can have',
        near(np.commissionableAmount, 100) && np.pricesIncludeGst === false);

    // ---------------------------------------------------------------
    console.log('\n  ===== 3. quick commerce is untouched =====');
    const qc = (await orders.findOne({ _id: QC })).pricing;
    console.log('    QC pricing keys:', Object.keys(qc).sort().join(', '));
    console.log('');
    check('no commissionableAmount was stamped on it', qc.commissionableAmount === undefined);
    check('no netItemAmount was stamped on it', qc.netItemAmount === undefined);
    check('no pricesIncludeGst was stamped on it', qc.pricesIncludeGst === undefined);
    check('its own fields survive', qc.deliveryMode === 'basic' && qc.total === 582);

    // ---------------------------------------------------------------
    console.log('\n  ===== 4. an already-migrated order is not overwritten =====');
    const already = (await orders.findOne({ _id: ALREADY })).pricing;
    check('its pricesIncludeGst is left true', already.pricesIncludeGst === true);
    check('its commissionableAmount is left alone', near(already.commissionableAmount, 94.7),
        `${already.commissionableAmount}`);

    // ---------------------------------------------------------------
    console.log('\n  ===== 5. running it twice changes nothing =====');
    const before = await orders.find({}).sort({ _id: 1 }).toArray();
    const second = run(true);
    const after = await orders.find({}).sort({ _id: 1 }).toArray();
    check('the second run exits clean', second.status === 0);
    check('and every document is byte-for-byte the same',
        JSON.stringify(before) === JSON.stringify(after));
    check('it reports nothing left to do',
        (second.stdout.match(/nothing to do/g) || []).length === 5,
        `${(second.stdout.match(/nothing to do/g) || []).length}/5 steps idle`);

} catch (err) {
    fail++;
    console.log('\n    UNCAUGHT: ' + err.message);
    console.log((err.stack || '').split('\n').slice(1, 6).join('\n'));
} finally {
    console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
    await mongoose.disconnect();
    await mem.stop();
    process.exit(fail ? 1 : 0);
}
