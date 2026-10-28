import mongoose from 'mongoose';

/**
 * A commission rate that applies only for a period -- a festive week, a launch
 * promotion, a renegotiated month.
 *
 * Separate from FoodRestaurantCommission, which holds one standing rate per
 * restaurant and is unique on restaurantId. That uniqueness is why seasonal
 * rates could not live there: a restaurant has one default and any number of
 * dated overrides, and the only way to run a festive rate was to edit the
 * default on the day and remember to change it back.
 *
 * `restaurantId: null` means the schedule applies to every restaurant, so a
 * platform-wide festive rate is one row rather than one per seller. A
 * restaurant-specific schedule beats a platform-wide one for the same dates --
 * see shared/commissionSchedule.js, which owns that rule.
 */
const commissionScheduleSchema = new mongoose.Schema(
    {
        /** null = every restaurant. */
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            default: null,
            index: true,
        },
        /** Shown in the admin list and stamped on the order, so a rate can be explained later. */
        label: { type: String, trim: true, default: '' },
        commission: {
            type: {
                type: String,
                enum: ['percentage', 'amount'],
                default: 'percentage',
            },
            value: { type: Number, default: 0, min: 0 },
        },
        startsAt: { type: Date, required: true, index: true },
        endsAt: { type: Date, required: true, index: true },
        status: { type: Boolean, default: true, index: true },
        notes: { type: String, trim: true, default: '' },
        createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'food_commission_schedules', timestamps: true }
);

// The lookup is always "which schedules cover this instant", optionally for one
// restaurant, so both are indexed together with the window.
commissionScheduleSchema.index({ status: 1, startsAt: 1, endsAt: 1 });
commissionScheduleSchema.index({ restaurantId: 1, status: 1, startsAt: 1, endsAt: 1 });

export const FoodCommissionSchedule = mongoose.model('FoodCommissionSchedule', commissionScheduleSchema);
