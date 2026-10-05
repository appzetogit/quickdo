/**
 * Restore a base price that a selling-price save overwrote.
 *
 * Only touches dishes where the base is recoverable without guessing and where
 * the repair changes NOTHING a customer pays:
 *
 *   basePrice === price          the base was replaced by the selling price
 *   formulationStrikePrice > 0   and the strike still records the real base
 *   discountPercent > 0          the discount that produced that selling price
 *
 * Gajrela is the live example: base 90, strike 100, discount 10%, selling 90. Its
 * siblings from the same adjustment run all read base 100 / discount 10% /
 * selling 90, so 100 is the base this dish had before the save. Restoring it
 * leaves the selling price at 90 -- unchanged -- and only repairs the number the
 * next edit and every future adjustment are derived from.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   node scripts/repair-clobbered-base-price.mjs
 *   node scripts/repair-clobbered-base-price.mjs --apply
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const main = async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
    await mongoose.connect(process.env.MONGODB_URI);
    const items = mongoose.connection.collection('food_items');

    const candidates = await items.find({
        formulationDiscountPercent: { $gt: 0 },
        formulationStrikePrice: { $gt: 0 },
    }).project({
        name: 1, price: 1, basePrice: 1, formulationPrice: 1,
        formulationStrikePrice: 1, formulationDiscountPercent: 1,
    }).toArray();

    console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} -- ${candidates.length} discounted dish(es) with a strike to check\n`);

    const repairs = [];
    for (const it of candidates) {
        const base = round2(it.basePrice);
        const strike = round2(it.formulationStrikePrice);
        const disc = round2(it.formulationDiscountPercent);
        const selling = round2(it.formulationPrice ?? it.price);

        // The tell: the base equals what is being charged, while the strike still
        // holds a higher figure. A healthy discounted dish has base === strike.
        const looksClobbered = Math.abs(base - selling) < 0.005 && strike > base + 0.005;
        if (!looksClobbered) continue;

        // The strike is only trustworthy as the old base if it reproduces the
        // selling price under the recorded discount. Anything else is a guess.
        const impliedSelling = round2(strike * (1 - disc / 100));
        if (Math.abs(impliedSelling - selling) >= 0.02) {
            console.log(`SKIP  ${String(it.name).slice(0, 30).padEnd(32)} strike ${strike} at ${disc}% gives ${impliedSelling}, not the ${selling} charged`);
            continue;
        }

        repairs.push({ _id: it._id, name: it.name, from: base, to: strike, selling, disc });
    }

    if (!repairs.length) {
        console.log('nothing to repair\n');
        await mongoose.disconnect();
        return;
    }

    for (const r of repairs) {
        console.log(`${String(r.name).slice(0, 30).padEnd(32)} base ${r.from} -> ${r.to}   (still sells at ${r.selling}, ${r.disc}% off)`);
        if (APPLY) {
            await items.updateOne({ _id: r._id }, { $set: { basePrice: r.to } });
        }
    }

    console.log(`\n${repairs.length} dish(es) ${APPLY ? 'repaired' : 'would be repaired -- rerun with --apply'}\n`);
    await mongoose.disconnect();
};

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
