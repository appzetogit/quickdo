import mongoose from "mongoose";

const dayTimingSchema = new mongoose.Schema(
  {
    day: { type: String, required: true, trim: true },
    isOpen: { type: Boolean, default: true },
    openingTime: { type: String, trim: true }, // "HH:mm"
    closingTime: { type: String, trim: true }, // "HH:mm"
  },
  { _id: false },
);

const outletTimingsSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QCRestaurant",
      required: true,
      unique: true,
      index: true,
    },
    timings: {
      type: [dayTimingSchema],
      default: [],
    },
  },
  {
    collection: "food_restaurant_outlet_timings",
    timestamps: true,
  },
);

export const FoodRestaurantOutletTimings = mongoose.models.QCRestaurantOutletTimings || mongoose.model(
  'QCRestaurantOutletTimings',
  outletTimingsSchema,
  'qc_restaurant_outlet_timings',
);
