import mongoose from 'mongoose';

/**
 * One row per customer-facing transaction, across every vertical.
 *
 * This is deliberately a thin INDEX, not a merged aggregate. A food order has 130
 * fields, a ride 173, a service booking 119, and they share about five. Forcing them
 * into one document would produce a row that is ~90% null whichever vertical wrote it,
 * with four contradictory status machines fighting over one enum.
 *
 * So the detail stays in each vertical's own collection and this holds only what a
 * unified activity feed actually needs: who, which product, what state, how much,
 * when, and a pointer to the real document. See SUPERAPP_DATA_MODEL.md.
 *
 * Answers, in one query, questions that previously needed four:
 *   - "everything this customer has done, newest first"
 *   - "what is currently in flight for them"
 *   - "what have they spent with us across the platform"
 */

export const ACTIVITY_VERTICALS = Object.freeze(['food', 'quickCommerce', 'taxi', 'serviceProvider']);

/**
 * Normalised lifecycle, shared by all four. The verticals disagree on almost
 * everything else -- food says `delivered`, taxi `completed`, service-provider
 * `work_done` -- so the feed needs one vocabulary or the client ends up reimplementing
 * this mapping per vertical.
 */
export const ACTIVITY_STATUS = Object.freeze({
    PENDING: 'pending',     // created, not yet acted on
    ACTIVE: 'active',       // in flight
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
});

const activitySchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        vertical: { type: String, enum: ACTIVITY_VERTICALS, required: true, index: true },

        /** Pointer to the real document. Kept polymorphic on purpose -- see refPath. */
        refModel: { type: String, required: true },
        refId: { type: mongoose.Schema.Types.ObjectId, refPath: 'refModel', required: true },

        status: { type: String, enum: Object.values(ACTIVITY_STATUS), required: true, index: true },
        /** The vertical's own status, kept for support: 'work_done' is more use than 'completed'. */
        rawStatus: { type: String, default: '' },

        amount: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'INR' },

        /** Human label for the feed row: 'Dinner from Olive Kitchen', 'Ride to Airport'. */
        title: { type: String, default: '', trim: true },

        occurredAt: { type: Date, required: true, index: true },
        metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    },
    { collection: 'activities', timestamps: true },
);

// The feed query: one customer, newest first.
activitySchema.index({ userId: 1, occurredAt: -1 });
// "What is in flight for this customer" without scanning their whole history.
activitySchema.index({ userId: 1, status: 1, occurredAt: -1 });
// One row per source document -- the upsert key, and it makes double-writes impossible.
activitySchema.index({ vertical: 1, refId: 1 }, { unique: true });

export const Activity = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
