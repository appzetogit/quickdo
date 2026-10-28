import mongoose from "mongoose";

/**
 * One document per closed billing month — used for idempotency and
 * catch-up of months missed while the billing worker was down.
 */
const subscriptionBillingRunSchema = new mongoose.Schema(
  {
    billingMonth: { type: String, required: true, unique: true }, // 'YYYY-MM'
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
      index: true,
    },
    invoicedCount: { type: Number, default: 0 },
    skippedZeroGmvCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    errors: { type: [String], default: [] },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  {
    collection: "food_subscription_billing_runs",
    timestamps: true,
  }
);

export const FoodSubscriptionBillingRun = mongoose.models.QCSubscriptionBillingRun || mongoose.model('QCSubscriptionBillingRun', subscriptionBillingRunSchema, 'qc_subscription_billing_runs');
