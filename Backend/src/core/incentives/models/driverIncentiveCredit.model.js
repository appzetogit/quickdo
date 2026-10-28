import mongoose from 'mongoose';

/**
 * One row per (rider, rule, TIER, day) a reward was actually paid out for.
 *
 * This is the idempotency guard, not just a log: the unique index below is
 * what stops two order-completion events racing to credit the same rider
 * twice for the same tier on the same day. Insert first, credit the wallet
 * only if the insert wins — see maybeCreditIncentive in incentiveService.js.
 *
 * tierId (not just ruleId) is part of the key because a rule is now a
 * ladder of tiers (1-5 → ₹100, 5-10 → ₹150, ...) and each rung is credited
 * independently as the rider reaches it — one row per rung reached, not one
 * row for the whole rule.
 *
 * driverKey is a plain string rather than an ObjectId ref because it can
 * point at three different identities depending on how this rider is
 * provisioned (a unified TaxiDriver, a standalone FoodDeliveryPartner, or a
 * standalone quick-commerce partner) — see resolveDriverContext.
 */
const driverIncentiveCreditSchema = new mongoose.Schema(
    {
        driverKey: { type: String, required: true, index: true },
        ruleId: { type: mongoose.Schema.Types.ObjectId, ref: 'DriverIncentiveRule', required: true },
        tierId: { type: mongoose.Schema.Types.ObjectId, required: true },
        segment: { type: String, enum: ['foodAndQuick', 'taxiAndPorter', 'heavyParcel'], required: true },
        periodKey: { type: String, required: true },
        completedOrders: { type: Number, required: true },
        rewardAmount: { type: Number, required: true },
        /** Which wallet path actually got the money — for support/debugging. */
        creditedVia: { type: String, enum: ['taxi_driver_wallet', 'delivery_bonus_transaction'], required: true },
    },
    { collection: 'driver_incentive_credits', timestamps: true },
);

driverIncentiveCreditSchema.index({ driverKey: 1, tierId: 1, periodKey: 1 }, { unique: true });
driverIncentiveCreditSchema.index({ driverKey: 1, ruleId: 1, periodKey: 1 });

export const DriverIncentiveCredit =
    mongoose.models.DriverIncentiveCredit || mongoose.model('DriverIncentiveCredit', driverIncentiveCreditSchema);
