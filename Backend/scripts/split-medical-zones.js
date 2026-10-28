/**
 * Give medical its own zones, without moving a single seller.
 *
 * Run:  node scripts/split-medical-zones.js            (report only)
 *       node scripts/split-medical-zones.js --apply
 *       node scripts/split-medical-zones.js --undo
 *
 * Pharmacies are quick-commerce sellers and shared quick commerce's zones, so a
 * zone drawn for groceries decided where medicine could go and a zone drawn in
 * the Medical panel appeared under Quick Shop. They are now separate
 * collections; this fills the new one.
 *
 * THE WHOLE TRICK IS THE IDS. Every zone a pharmacy currently sits in is copied
 * into `medical_zones` KEEPING ITS `_id`. A pharmacy's `zoneId`, and the
 * `zoneId` on every order ever placed with one, therefore still resolves -- the
 * value did not change, only which collection it is read against. Nothing is
 * rewritten, so there is nothing to roll back if this is wrong, and --undo is
 * simply dropping the copies.
 *
 * Zones NOT used by any pharmacy are left behind deliberately. Medical starts
 * with the map it is actually working in; the rest are quick commerce's, and
 * copying them would hand the Medical panel a list of places it does not serve
 * and invite somebody to edit a grocery zone believing it was theirs.
 *
 * Idempotent: a zone already copied is skipped, and its contents are not
 * touched, because after the split the two are allowed to differ and the copy
 * is the medical one.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const run = async () => {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    await mongoose.connect(uri);

    const base = '../src/modules/quickCommerce/modules/food';
    const { QCZone } = await import(`${base}/admin/models/zone.model.js`);
    const { MedicalZone } = await import(`${base}/admin/models/medicalZone.model.js`);
    const { FoodRestaurant } = await import(`${base}/restaurant/models/restaurant.model.js`);
    const { MEDICAL_STORE_TYPE } = await import(`${base}/shared/storeType.js`);

    const apply = process.argv.includes('--apply');
    const undo = process.argv.includes('--undo');

    if (undo) {
        const removed = await MedicalZone.deleteMany({});
        console.log(`Removed ${removed.deletedCount} medical zones.`);
        console.log('Quick-commerce zones were never touched, so pharmacies fall back');
        console.log('to them the moment the code is reverted.');
        await mongoose.disconnect();
        return;
    }

    const pharmacies = await FoodRestaurant.find({ storeType: MEDICAL_STORE_TYPE })
        .select('restaurantName zoneId').lean();

    const wanted = [...new Set(
        pharmacies.map((p) => (p.zoneId ? String(p.zoneId) : '')).filter(Boolean),
    )];

    console.log(`pharmacies                 : ${pharmacies.length}`);
    console.log(`distinct zones they sit in : ${wanted.length}`);

    const unzoned = pharmacies.filter((p) => !p.zoneId);
    if (unzoned.length) {
        console.log(`\n! ${unzoned.length} pharmacies have no zone at all:`);
        for (const p of unzoned) console.log(`    ${p.restaurantName}`);
        console.log('  They are unaffected either way -- a seller with no zone is matched');
        console.log('  by the address, not by its own.');
    }

    const source = await QCZone.find({ _id: { $in: wanted } }).lean();
    const already = new Set(
        (await MedicalZone.find({ _id: { $in: wanted } }).select('_id').lean())
            .map((z) => String(z._id)),
    );

    const missing = wanted.filter((id) => !source.some((z) => String(z._id) === id));
    if (missing.length) {
        console.log(`\n! ${missing.length} zone ids on pharmacies do not exist in qc_zones:`);
        for (const id of missing) console.log(`    ${id}`);
        console.log('  Those pharmacies are already pointing at nothing; copying cannot fix it.');
    }

    const toCopy = source.filter((z) => !already.has(String(z._id)));

    console.log('\nzones to copy into medical_zones (same _id):');
    for (const zone of source) {
        const state = already.has(String(zone._id)) ? 'already there' : 'copy';
        const count = pharmacies.filter((p) => String(p.zoneId) === String(zone._id)).length;
        console.log(`  ${String(zone.name).slice(0, 28).padEnd(28)} ${String(count).padStart(2)} pharmacies   ${state}`);
    }

    if (!apply) {
        console.log(`\n${toCopy.length} to copy. Nothing written -- pass --apply.`);
        await mongoose.disconnect();
        return;
    }

    if (toCopy.length) {
        await MedicalZone.insertMany(toCopy, { ordered: false });
    }
    const total = await MedicalZone.countDocuments();
    console.log(`\nCopied ${toCopy.length}. medical_zones now holds ${total}.`);
    console.log('No seller or order document was modified.');

    await mongoose.disconnect();
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
