import { recordActivity } from './activity.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Keep the activity feed in step by hooking the SCHEMAS, not the controllers.
 *
 * The alternative -- calling recordActivity at every place a status changes -- means
 * finding all of them across four verticals and then remembering forever. Food alone
 * changes orderStatus in a dozen services. One missed site is a transaction the
 * customer never sees in their history, and nothing fails loudly enough to notice.
 *
 * Hooking the schema covers both write styles mongoose offers:
 *   - post('save')            — doc.save(), the usual path
 *   - post('findOneAndUpdate')— the update path, which does NOT fire save hooks and is
 *                               where most status transitions actually happen
 *
 * Every hook is fire-and-forget and swallows its own errors. The feed is derived data;
 * it must never be able to fail the order, ride or booking that produced it.
 */

/**
 * @param {import('mongoose').Model} model
 * @param {object} spec
 * @param {string} spec.vertical
 * @param {string} spec.refModel    registered model name, for refPath
 * @param {(doc:any)=>object|null} spec.map  doc -> { userId, rawStatus, amount, title, occurredAt }
 */
export const attachActivityHooks = (model, { vertical, refModel, map }) => {
    if (!model?.schema) {
        logger.warn(`[Activity] cannot attach hooks for ${vertical}: model missing`);
        return;
    }
    if (model.schema.__activityHooksAttached) return;
    model.schema.__activityHooksAttached = true;

    const sync = (doc) => {
        try {
            if (!doc?._id) return;
            const fields = map(doc);
            if (!fields?.userId) return;
            // Not awaited: the caller's write must not wait on derived data.
            recordActivity({ vertical, refModel, refId: doc._id, ...fields });
        } catch (err) {
            logger.error(`[Activity] sync failed for ${vertical} — ${err.message}`);
        }
    };

    // NOT schema.post().
    //
    // Mongoose compiles middleware into the model at mongoose.model() time and SILENTLY
    // ignores anything registered afterwards. These models are all compiled by the time
    // this runs, so schema.post() hooks attach without error, log as attached, and never
    // fire -- a feed that is quietly always empty. Verified, not assumed.
    //
    // Wrapping the model's write methods works regardless of compile order.
    //
    // create() and save() return promises, so an async wrapper is right for them.
    const wrap = (target, name) => {
        const original = target[name];
        if (typeof original !== 'function' || original.__activityWrapped) return;

        async function wrapped(...args) {
            const result = await original.apply(this, args);
            try {
                // create()/save() hand back the current document.
                (Array.isArray(result) ? result : [result]).forEach(sync);
            } catch (err) {
                logger.error(`[Activity] sync failed for ${vertical}.${name} — ${err.message}`);
            }
            return result;
        }
        wrapped.__activityWrapped = true;
        target[name] = wrapped;
    };

    /*
     * The update methods are different, and treating them like create() broke food
     * dispatch in production for three weeks.
     *
     * findOneAndUpdate and findByIdAndUpdate return a mongoose QUERY, not a promise,
     * and callers chain on it -- .populate(), .lean(), .select(), .session() -- before
     * it runs. The previous wrapper was an async function: it returned a Promise and
     * executed the query at once, so every chained modifier threw "populate is not a
     * function". Rider accept (PATCH /food/delivery/orders/:id/accept) returned 500 on
     * every attempt from 2026-08-26, and auto-assign after a restaurant status change
     * failed silently behind a [DEBUG] log -- 39 failures in the production log.
     *
     * So the query is returned untouched and the side effect hooks its exec().
     * .populate()/.lean()/.select() return the SAME query object, so an instance-level
     * exec survives the chaining; awaiting a query calls Query.prototype.then, which
     * calls this.exec(). Callers get their query, modifiers apply, the feed still syncs.
     */
    const wrapQuery = (target, name) => {
        const original = target[name];
        if (typeof original !== 'function' || original.__activityWrapped) return;

        function wrapped(...args) {
            const query = original.apply(this, args);
            if (!query || typeof query.exec !== 'function') return query;

            const originalExec = query.exec.bind(query);
            query.exec = async (...execArgs) => {
                const result = await originalExec(...execArgs);
                try {
                    // lean() gives a plain object; includeResultMetadata wraps the doc in
                    // { value }. Both shapes are looked through.
                    const doc = result?.value && !result?._id ? result.value : result;
                    if (doc?._id) {
                        // Without { new: true } the result is the PRE-update document, which
                        // would record the terminal state one transition stale -- permanently,
                        // since nothing follows it. Re-read to be correct.
                        const fresh = await model.findById(doc._id);
                        sync(fresh || doc);
                    }
                } catch (err) {
                    logger.error(`[Activity] sync failed for ${vertical}.${name} — ${err.message}`);
                }
                return result;
            };
            return query;
        }
        wrapped.__activityWrapped = true;
        target[name] = wrapped;
    };

    wrap(model, 'create');
    wrapQuery(model, 'findOneAndUpdate');
    wrapQuery(model, 'findByIdAndUpdate');
    wrap(model.prototype, 'save');

    // KNOWN GAP: updateMany() and bulkWrite() return write results, not documents, so a
    // bulk status transition does not reach the feed. Those are batch/admin paths; each
    // affected row self-corrects on its next single-document write.
};

/**
 * Wire every vertical. Called once at startup, after the models exist.
 * Import failures are non-fatal: a module that is not installed simply has no feed.
 */
export const attachAllActivityHooks = async () => {
    const attached = [];

    // ── food ────────────────────────────────────────────────────────────────
    try {
        const { FoodOrder } = await import('../../modules/food/orders/models/order.model.js');
        attachActivityHooks(FoodOrder, {
            vertical: 'food',
            refModel: 'FoodOrder',
            map: (d) => ({
                userId: d.userId,
                rawStatus: d.orderStatus,
                amount: d.pricing?.total ?? d.totalAmount ?? 0,
                title: d.restaurantName ? `Order from ${d.restaurantName}` : 'Food order',
                occurredAt: d.updatedAt || d.createdAt,
            }),
        });
        attached.push('food');
    } catch (err) { logger.warn(`[Activity] food hooks skipped: ${err.message}`); }

    // ── quick-commerce ──────────────────────────────────────────────────────
    try {
        const { FoodOrder: QCOrder } = await import('../../modules/quickCommerce/modules/food/orders/models/order.model.js');
        attachActivityHooks(QCOrder, {
            vertical: 'quickCommerce',
            refModel: 'QCOrder',
            map: (d) => ({
                userId: d.userId,
                rawStatus: d.orderStatus,
                amount: d.pricing?.total ?? d.totalAmount ?? 0,
                title: d.restaurantName ? `${d.restaurantName}` : 'Quick-commerce order',
                occurredAt: d.updatedAt || d.createdAt,
            }),
        });
        attached.push('quickCommerce');
    } catch (err) { logger.warn(`[Activity] quick-commerce hooks skipped: ${err.message}`); }

    // ── taxi ────────────────────────────────────────────────────────────────
    try {
        const { Ride } = await import('../../modules/taxi/user/models/Ride.js');
        attachActivityHooks(Ride, {
            vertical: 'taxi',
            refModel: 'TaxiRide',
            map: (d) => ({
                userId: d.userId,
                rawStatus: d.status,
                amount: d.fare ?? 0,
                title: d.dropLabel ? `Ride to ${d.dropLabel}` : 'Ride',
                occurredAt: d.updatedAt || d.createdAt,
            }),
        });
        attached.push('taxi');
    } catch (err) { logger.warn(`[Activity] taxi hooks skipped: ${err.message}`); }

    // ── service-provider (CommonJS) ─────────────────────────────────────────
    try {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const SPBooking = require('../../modules/serviceProvider/models/Booking.js');
        attachActivityHooks(SPBooking, {
            vertical: 'serviceProvider',
            refModel: 'SPBooking',
            map: (d) => ({
                userId: d.userId,
                rawStatus: d.status,
                amount: d.finalAmount ?? d.basePrice ?? 0,
                title: d.serviceName ? `${d.serviceName}` : 'Service booking',
                occurredAt: d.updatedAt || d.createdAt,
            }),
        });
        attached.push('serviceProvider');
    } catch (err) { logger.warn(`[Activity] service-provider hooks skipped: ${err.message}`); }

    logger.info(`Activity feed hooks attached: ${attached.join(', ') || 'none'}`);
    return attached;
};
