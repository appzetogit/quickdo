import mongoose from "mongoose";

const subscriptionHistorySchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QCRestaurant",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "subscription_renewal_due_added",
        "subscription_payment",
        "subscription_auto_deduct",
      ],
      required: true,
      index: true,
    },
    plan: { type: String, default: "" },
    paymentType: { type: String, default: "" },
    amount: { type: Number, default: 0, min: 0 },
    dueBefore: { type: Number, default: 0, min: 0 },
    dueAfter: { type: Number, default: 0, min: 0 },
    paidBefore: { type: Number, default: 0, min: 0 },
    paidAfter: { type: Number, default: 0, min: 0 },
    gmvLast30Days: { type: Number, default: 0, min: 0 },
    note: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    collection: "food_restaurant_subscription_history",
    timestamps: true,
  }
);

subscriptionHistorySchema.index({ restaurantId: 1, createdAt: -1 });

export const FoodRestaurantSubscriptionHistory = mongoose.models.QCRestaurantSubscriptionHistory || mongoose.model('QCRestaurantSubscriptionHistory', subscriptionHistorySchema, 'qc_restaurant_subscription_histories');

