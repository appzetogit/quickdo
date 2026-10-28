import mongoose from 'mongoose';
import { ValidationError } from '../auth/errors.js';
import { resolveRiderIdentity } from './riderFinance.service.js';

/**
 * A per-owner lock for money decisions that read a DERIVED balance.
 *
 * A rider's or restaurant's available balance is not a stored number that one
 * atomic $inc could guard -- it is recomputed on every read from orders,
 * bonuses and withdrawal rows. So "is there enough? then create the request"
 * is two steps, and two requests arriving together both read the same balance
 * before either writes: Rs 400 + Rs 400 against Rs 500 both passed, Rs 800 queued.
 *
 * A multi-document transaction would NOT close that gap on its own. Each
 * request only inserts its own new row, so there is no write conflict for the
 * database to detect -- snapshot isolation happily commits both (write skew).
 * What is needed is for the second request to wait until the first has
 * written, then read the balance again. That is what this lock does.
 *
 * Built on the same primitive idempotency.js uses: a unique key, where an
 * E11000 on insert means somebody else holds it. A held lock expires after
 * `holdMs`, so a process that dies mid-request cannot freeze an owner's money
 * forever, and the TTL index sweeps expired rows. Works on a standalone mongod
 * and a replica set alike, so nothing here depends on how production connects.
 */
const financeLockSchema = new mongoose.Schema(
    {
        _id: { type: String },
        token: { type: String, required: true },
        expiresAt: { type: Date, required: true },
    },
    { collection: 'finance_locks', versionKey: false }
);
financeLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const FinanceLock = mongoose.models.FinanceLock || mongoose.model('FinanceLock', financeLockSchema);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` while holding the lock `key`. A second caller WAITS (up to `waitMs`)
 * rather than failing, so it then runs against the balance the first one left
 * and gets the ordinary "insufficient balance" answer when that is the truth.
 */
export async function withFinanceLock(key, fn, {
    holdMs = 30_000,
    waitMs = 10_000,
    busyMessage = 'Another request is being processed. Please try again.',
} = {}) {
    const token = new mongoose.Types.ObjectId().toString();
    const giveUpAt = Date.now() + waitMs;

    for (;;) {
        const now = new Date();
        try {
            // Matches only a lock that has expired; otherwise the upsert tries to
            // insert a second row with the same _id and fails with E11000.
            await FinanceLock.collection.findOneAndUpdate(
                { _id: key, expiresAt: { $lte: now } },
                { $set: { token, expiresAt: new Date(now.getTime() + holdMs) } },
                { upsert: true }
            );
            break;
        } catch (err) {
            if (err?.code !== 11000) throw err;
            if (Date.now() >= giveUpAt) throw new ValidationError(busyMessage);
            await sleep(25 + Math.floor(Math.random() * 50));
        }
    }

    try {
        return await fn();
    } finally {
        // Token-scoped, so a holder that overran holdMs cannot release the lock
        // of whoever took it over.
        await FinanceLock.collection.deleteOne({ _id: key, token }).catch(() => {});
    }
}

/**
 * One key per PERSON, not per partner id. A rider's balance is one balance
 * across taxi, food and quick commerce, so a withdrawal from either delivery
 * app must queue behind the other. The taxi driver id is the hub identity;
 * an unlinked partner falls back to its own id.
 */
export const riderWithdrawalLockKey = async (anyId) => {
    const identity = await resolveRiderIdentity(anyId);
    return `rider-withdrawal:${String(identity.driverId || identity.foodPartnerId || identity.qcPartnerId || anyId)}`;
};

export const restaurantWithdrawalLockKey = (restaurantId) => `restaurant-withdrawal:${String(restaurantId)}`;
