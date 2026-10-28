import mongoose from "mongoose";

export const SUBSCRIPTION_INVOICE_STATUSES = [
  "pending",
  "partially_settled",
  "settled",
  "waived",
];

export const SUBSCRIPTION_PLAN_NAMES = ["starter", "growth", "premium", "legacy"];

/**
 * One invoice per restaurant per calendar billing month (postpaid).
 * GMV, plan, and amounts are frozen at generation time — settlement only moves
 * paid/waived/adjustment/outstanding via appended FoodSubscriptionTransaction docs.
 * billingMonth 'legacy' holds pre-migration carried-forward dues.
 */
const subscriptionInvoiceSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QCRestaurant",
      required: true,
      index: true,
    },
    billingMonth: { type: String, required: true }, // 'YYYY-MM' or 'legacy'
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },

    gmv: { type: Number, default: 0, min: 0 },
    orderCount: { type: Number, default: 0, min: 0 },
    planName: {
      type: String,
      enum: SUBSCRIPTION_PLAN_NAMES,
      required: true,
    },
    planAmount: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },

    paidAmount: { type: Number, default: 0, min: 0 },
    waivedAmount: { type: Number, default: 0, min: 0 },
    // Signed: positive increases the due, negative reduces it.
    adjustmentAmount: { type: Number, default: 0 },
    outstandingAmount: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: SUBSCRIPTION_INVOICE_STATUSES,
      default: "pending",
      index: true,
    },

    isLegacyCarryForward: { type: Boolean, default: false },
    // Snapshot of plan prices/GMV bands used at generation (immutability/audit).
    settingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    generatedBy: {
      type: String,
      enum: ["system", "admin", "migration"],
      default: "system",
    },
    notes: { type: String, default: "" },
  },
  {
    collection: "food_subscription_invoices",
    timestamps: true,
  }
);

subscriptionInvoiceSchema.index({ restaurantId: 1, billingMonth: 1 }, { unique: true });
subscriptionInvoiceSchema.index({ billingMonth: 1, status: 1 });
subscriptionInvoiceSchema.index({ status: 1, outstandingAmount: 1 });

export const FoodSubscriptionInvoice = mongoose.models.QCSubscriptionInvoice || mongoose.model('QCSubscriptionInvoice', subscriptionInvoiceSchema, 'qc_subscription_invoices');
