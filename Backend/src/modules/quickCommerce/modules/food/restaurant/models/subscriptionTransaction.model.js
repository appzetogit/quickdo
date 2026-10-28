import mongoose from "mongoose";

export const SUBSCRIPTION_TRANSACTION_TYPES = [
  "invoice_generated",
  "wallet_deduction",
  "manual_payment",
  // Paid by the SELLER through the payment gateway, as opposed to
  // manual_payment, which means money that moved outside the platform.
  "online_payment",
  "waiver",
  "adjustment",
  "legacy_carryforward",
];

/**
 * Append-only audit trail of every subscription billing activity.
 * Never updated or deleted — corrections are new adjustment transactions.
 */
const subscriptionTransactionSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QCRestaurant",
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QCSubscriptionInvoice",
      required: true,
    },
    billingMonth: { type: String, required: true, index: true },

    type: {
      type: String,
      enum: SUBSCRIPTION_TRANSACTION_TYPES,
      required: true,
      index: true,
    },
    // Signed for adjustments; positive for payments/deductions/waivers/invoice totals.
    amount: { type: Number, required: true },
    outstandingAfter: { type: Number, required: true, min: 0 },
    invoiceStatusAfter: { type: String, required: true },

    processedBy: {
      role: { type: String, enum: ["SYSTEM", "ADMIN", "RESTAURANT"], default: "SYSTEM" },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, default: "" },
    },
    remarks: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    collection: "food_subscription_transactions",
    timestamps: true,
  }
);

subscriptionTransactionSchema.index({ restaurantId: 1, createdAt: -1 });
subscriptionTransactionSchema.index({ invoiceId: 1, createdAt: 1 });

export const FoodSubscriptionTransaction = mongoose.models.QCSubscriptionTransaction || mongoose.model('QCSubscriptionTransaction', subscriptionTransactionSchema, 'qc_subscription_transactions');
