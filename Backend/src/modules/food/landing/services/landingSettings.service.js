import { FoodLandingSettings } from '../models/landingSettings.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../../admin/models/food.model.js';
import {
    describeCapChange,
    resolveNinetyNineCap,
    shouldBackfillInto99Store,
} from '../../shared/ninetyNineStore.js';
import { invalidateNinetyNineCapCache } from '../../shared/ninetyNineStoreCap.js';

export const getLandingSettings = async () => {
    let doc = await FoodLandingSettings.findOne().lean();
    if (!doc) {
        doc = (await FoodLandingSettings.create({})).toObject();
    }
    return doc;
};

/**
 * Put every now-eligible dish on the shelf after the cap has been raised.
 *
 * Without this the shelf fills in gradually, as dishes happen to be saved for
 * unrelated reasons, which from the admin's side looks like the setting did not
 * take. Raising the cap should populate the shelf immediately.
 *
 * Only ever sets the flag. Dishes an admin removed by hand carry
 * ninetyNineStoreExcluded and are skipped, so a cap change cannot quietly undo
 * curation -- which is the whole reason that second flag exists.
 *
 * The price test runs in code rather than in the query, because the effective
 * price of a dish sold by variants is not a stored field.
 */
const backfillNinetyNineStore = async (cap) => {
    const candidates = await FoodItem.find({
        approvalStatus: 'approved',
        showIn99Store: { $ne: true },
        ninetyNineStoreExcluded: { $ne: true },
    }).select('price variants variantsEnabled approvalStatus showIn99Store ninetyNineStoreExcluded').lean();

    const eligible = candidates.filter((doc) => shouldBackfillInto99Store(doc, cap));
    if (!eligible.length) return 0;

    const result = await FoodItem.updateMany(
        { _id: { $in: eligible.map((d) => d._id) } },
        { $set: { showIn99Store: true } },
    );
    return result.modifiedCount || 0;
};

export const updateLandingSettings = async (payload) => {
    // The cap before the write, so a change can be judged as a transition.
    let previousCap = null;
    if (payload && payload.ninetyNineStoreMaxPrice !== undefined) {
        // findOneAndUpdate does not run schema validators, so the model's min:1
        // would not catch a bad value here. A zero or negative cap would empty
        // the shelf silently, and a huge one would put the entire menu on it.
        const wanted = Number(payload.ninetyNineStoreMaxPrice);
        if (!Number.isFinite(wanted) || wanted <= 0) {
            throw new ValidationError('Set a price above zero for the Rs 99 store.');
        }
        if (wanted > 10000) {
            throw new ValidationError('That price looks too large for a value shelf. Use 10000 or less.');
        }
        payload.ninetyNineStoreMaxPrice = wanted;

        const before = await FoodLandingSettings.findOne().select('ninetyNineStoreMaxPrice').lean();
        previousCap = resolveNinetyNineCap(before?.ninetyNineStoreMaxPrice);
    }

    const doc = await FoodLandingSettings.findOneAndUpdate({}, payload, {
        new: true,
        upsert: true
    }).lean();

    if (previousCap !== null) {
        // Read on every feed request and every dish write, so a stale cache would
        // keep serving the old shelf.
        invalidateNinetyNineCapCache();

        const change = describeCapChange(previousCap, doc?.ninetyNineStoreMaxPrice);
        if (change.needsBackfill) {
            try {
                const flagged = await backfillNinetyNineStore(change.after);
                console.log(`Rs 99 store cap ${change.before} -> ${change.after}: flagged ${flagged} dishes`);
            } catch (err) {
                // A failed backfill must not fail the settings save; the shelf
                // simply fills in more slowly, as it did before.
                console.error('Rs 99 store backfill failed:', err?.message || err);
            }
        }

        // The shelf is served from cached feed responses either way.
        try {
            const { invalidatePriceCaches } = await import('../../../../middleware/cache.js');
            await invalidatePriceCaches();
        } catch (cacheErr) {
            console.error('Cache clear after cap change failed:', cacheErr?.message || cacheErr);
        }
    }

    return doc;
};
