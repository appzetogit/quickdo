/**
 * Put every already-approved dish priced at or under Rs 99 on the Rs 99 shelf.
 *
 * The flag was opt-in, so dishes approved before auto-marking existed carry no
 * flag however cheap they are. Going forward, approval and admin price edits
 * set it; this catches up everything that predates that.
 *
 * Only sets the flag, never clears it -- an admin who has deliberately
 * unticked a cheap dish keeps that decision. Idempotent.
 *
 *   node scripts/backfill-99-store.mjs --dry-run
 *   node scripts/backfill-99-store.mjs
 */
import '../src/config/env.js';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { shouldAutoMark99, NINETY_NINE_STORE_MAX_PRICE } from '../src/modules/food/shared/ninetyNineStore.js';

const dryRun = process.argv.includes('--dry-run');

await connectDB();

// Everything approved and not yet flagged; the price rule is applied in code
// because the effective price of a variant dish is not a stored field.
const candidates = await FoodItem.find({
    approvalStatus: 'approved',
    showIn99Store: { $ne: true },
}).select('name price variants variantsEnabled approvalStatus showIn99Store').lean();

const eligible = candidates.filter(shouldAutoMark99);

console.log(`approved and unflagged : ${candidates.length}`);
console.log(`at or under Rs ${NINETY_NINE_STORE_MAX_PRICE}     : ${eligible.length}`);
for (const item of eligible.slice(0, 20)) {
    console.log(`  ${String(item.name).slice(0, 28).padEnd(29)} -> on the shelf`);
}
if (eligible.length > 20) console.log(`  ... and ${eligible.length - 20} more`);

if (dryRun) {
    console.log('\n(dry run - nothing written)');
} else if (eligible.length) {
    const result = await FoodItem.updateMany(
        { _id: { $in: eligible.map((i) => i._id) } },
        { $set: { showIn99Store: true } },
    );
    console.log(`\nflagged: ${result.modifiedCount}`);
    try {
        const { invalidatePriceCaches } = await import('../src/middleware/cache.js');
        await invalidatePriceCaches();
        console.log('public caches cleared');
    } catch (err) {
        console.log(`cache clear skipped: ${err.message}`);
    }
} else {
    console.log('\nnothing to do');
}

await disconnectDB();
process.exit(0);
