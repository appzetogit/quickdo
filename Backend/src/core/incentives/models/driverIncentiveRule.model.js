import mongoose from 'mongoose';

/**
 * One rung of the ladder: "complete orders fromOrders..toOrders, get
 * rewardAmount" — e.g. 1-5 → ₹100, 5-10 → ₹150, 10-15 → ₹200.
 *
 * toOrders is what crediting actually keys on (see maybeCreditIncentive in
 * incentiveService.js); fromOrders is presentational, so the admin form and
 * the rider's card can both label the band the way it was drawn rather than
 * every screen re-deriving it from the previous tier's toOrders.
 *
 * Kept as its own subdocument (with an _id) rather than a plain object so a
 * credit can reference exactly which tier it paid — DriverIncentiveCredit's
 * idempotency key includes tierId precisely so each tier on the ladder can
 * be credited independently as the rider reaches it, not just the rule as a
 * whole.
 */
const incentiveTierSchema = new mongoose.Schema({
    fromOrders: { type: Number, required: true, min: 1 },
    toOrders: { type: Number, required: true, min: 1 },
    rewardAmount: { type: Number, required: true, min: 0 },
});

/**
 * An admin-configured order-count ladder for one duty segment — mirrors the
 * Flutter rider app's DutySegment split:
 *   - foodAndQuick: food, quick-commerce and medicine deliveries.
 *   - taxiAndPorter: rides and parcel/porter jobs.
 *
 * Edits insert a new active version and deactivate the previous one (see
 * upsertIncentiveRuleController in incentiveController.js) rather than
 * mutating in place — same "latest active wins" pattern as FoodFeeSettings —
 * so a concurrent read never sees a half-written rule, and history isn't
 * destroyed on edit.
 */
const driverIncentiveRuleSchema = new mongoose.Schema(
    {
        segment: {
            type: String,
            // foodAndQuick: food, daily needs, medical AND bike parcels (the
            //   "Food + Daily needs + Medical + Bike parcel" rider).
            // taxiAndPorter: passenger rides only, any vehicle (key kept for
            //   the ladders already on file; shown as "Taxi").
            // heavyParcel: parcel/porter jobs on anything but a 2-wheeler.
            enum: ['foodAndQuick', 'taxiAndPorter', 'heavyParcel'],
            required: true,
            index: true,
        },
        /*
         * The zone this ladder is for; null is the default ladder, used for
         * orders in every zone without one of its own. A food, quick, medical
         * or taxi zone id, whichever the order or ride belongs to.
         */
        zoneId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        zoneName: { type: String, trim: true, default: '' },
        /*
         * taxiAndPorter only: the vehicle type this ladder is for (a
         * TaxiVehicle id) — an e-rickshaw and a cab earn at different rates
         * for the same trip count, so one zone can carry several ladders,
         * one per vehicle type, same "null is the default" convention as
         * zoneId. foodAndQuick rules leave this null; there is no vehicle
         * type to key on there.
         */
        vehicleTypeId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        vehicleTypeName: { type: String, trim: true, default: '' },
        /** Admin-authored headline shown as-is on the rider's card. */
        title: { type: String, trim: true, default: '' },
        /** Ascending by toOrders — validated on write, see incentiveRule.validator.js. */
        tiers: {
            type: [incentiveTierSchema],
            required: true,
            validate: {
                validator: (arr) => Array.isArray(arr) && arr.length > 0,
                message: 'At least one tier is required',
            },
        },
        /** Counted per calendar day (IST) or per calendar week (Mon-Sun IST) —
         *  see istDayBounds/istWeekBounds in incentiveService.js. */
        windowType: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
        /*
         * Optional run dates for a limited-time ladder ("this week only").
         * Outside them the ladder does not apply, and only orders from
         * startsAt on count. null = no limit on that side.
         */
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null },
        isActive: { type: Boolean, default: true, index: true },
        createdByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { collection: 'driver_incentive_rules', timestamps: true },
);

driverIncentiveRuleSchema.index({ segment: 1, isActive: 1, createdAt: -1 });
driverIncentiveRuleSchema.index({ segment: 1, zoneId: 1, isActive: 1, createdAt: -1 });
driverIncentiveRuleSchema.index({ segment: 1, zoneId: 1, vehicleTypeId: 1, isActive: 1, createdAt: -1 });

export const DriverIncentiveRule =
    mongoose.models.DriverIncentiveRule || mongoose.model('DriverIncentiveRule', driverIncentiveRuleSchema);
