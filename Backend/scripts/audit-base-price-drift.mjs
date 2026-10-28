/**
 * Has basePrice moved, and what moved it?
 *
 * Read-only. priceAdjustmentSnapshots record each item's basePrice as it was
 * before a run, so the earliest snapshot mentioning a dish is the closest thing
 * to its original base. Comparing that to the base stored now says whether the
 * base has drifted -- and drift is always a bug: runs adjust percentages, never
 * the base.
 *
 *   node scripts/audit-base-price-drift.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const n = (v) => (v === null || v === undefined ? null : round2(v));

const main = async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection;

    // Earliest recorded base per item, from every snapshot that names it.
    const earliest = new Map();
    const snaps = await db.collection('food_price_adjustment_snapshots')
        .find({}).sort({ createdAt: 1 }).toArray();

    console.log(`\n${snaps.length} adjustment snapshot(s)\n`);

    // One snapshot document per item: itemId, price and basePrice sit at the top
    // level. Sorted oldest-first above, so the first sighting of an item is its
    // earliest recorded base.
    for (const s of snaps) {
        const id = String(s.itemId || '');
        if (!id || earliest.has(id)) continue;
        const recorded = s.basePrice !== null && s.basePrice !== undefined ? s.basePrice : s.price;
        if (recorded === null || recorded === undefined) continue;
        earliest.set(id, {
            basePrice: round2(recorded),
            at: s.createdAt,
            runId: String(s.adjustmentId || s._id),
        });
    }
    console.log(`${earliest.size} item(s) have a recorded original base\n`);

    const items = await db.collection('food_items').find({}, {
        projection: {
            name: 1, price: 1, basePrice: 1, formulationPrice: 1,
            formulationStrikePrice: 1, formulationMarkupPercent: 1,
            formulationDiscountPercent: 1, formulationPercent: 1,
        },
    }).toArray();

    let drifted = 0;
    let inconsistent = 0;

    console.log('='.repeat(96));
    for (const it of items) {
        const id = String(it._id);
        const orig = earliest.get(id);
        const base = n(it.basePrice);
        const disc = round2(it.formulationDiscountPercent || 0);
        const mark = round2(it.formulationMarkupPercent || 0);

        // What the base implies the charged price should be.
        const expectedPay = base === null ? null : round2(base * (1 - disc / 100));
        const storedPay = n(it.formulationPrice) ?? n(it.price);

        const notes = [];
        if (orig && base !== null && Math.abs(base - orig.basePrice) >= 0.005) {
            drifted += 1;
            const dir = base < orig.basePrice ? 'DECREASED' : 'increased';
            notes.push(`base ${dir}: ${orig.basePrice} -> ${base}  (delta ${round2(base - orig.basePrice)})`);
        }
        if (base === null || !(base > 0)) {
            notes.push('no basePrice stored');
        }
        if (expectedPay !== null && storedPay !== null && Math.abs(expectedPay - storedPay) >= 0.02) {
            inconsistent += 1;
            notes.push(`charged ${storedPay} != base ${base} less ${disc}% (= ${expectedPay})`);
        }

        if (notes.length) {
            console.log(`${String(it.name || '(unnamed)').slice(0, 34).padEnd(36)} ${id}`);
            console.log(`   price=${n(it.price)}  base=${base}  formPrice=${n(it.formulationPrice)}  strike=${n(it.formulationStrikePrice)}  mark=${mark}%  disc=${disc}%`);
            for (const note of notes) console.log(`   !! ${note}`);
            console.log('');
        }
    }
    console.log('='.repeat(96));
    console.log(`\n${items.length} dish(es) examined`);
    console.log(`  base drifted from its recorded original : ${drifted}`);
    console.log(`  charged price inconsistent with base    : ${inconsistent}\n`);

    await mongoose.disconnect();
};

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
