import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const VEHICLE_ICON_TYPES = [
  'car',
  'bike',
  'auto',
  'truck',
  'ehcb',
  'HCV',
  'LCV',
  'MCV',
  'Luxary',
  'premium',
  'suv',
];

const DELIVERY_CATEGORY_TYPES = [
  '',
  'trucks',
  '2wheeler',
  'movers',
];

const DELIVERY_DISTANCE_PRICING_DEFAULTS = {
  enabled: false,
  base_price: 0,
  free_distance: 0,
  distance_price: 0,
  free_time: 0,
  time_price: 0,
};

const vehicleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    short_description: {
      type: String,
      default: '',
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    transport_type: {
      type: String,
      enum: ['taxi', 'delivery', 'pooling', 'both'],
      required: true,
      trim: true,
    },
    dispatch_type: {
      type: String,
      enum: ['normal', 'bidding', 'both'],
      default: 'normal',
      trim: true,
    },
    /**
 * How much a rider may add to speed a booking up, on this vehicle.
 *
 * Only read when dispatch_type allows bidding. The rider is offered
 * bid_step_count buttons of bid_step_amount each -- +10 +20 +30 +40 --
 * and may not go past bid_max_increase in total.
 *
 * Per vehicle because the sensible bump is not the same for a bike and
 * a premium car: Rs 10 moves nobody on a Rs 900 fare.
 */
    bid_step_amount: {
      type: Number,
      default: 10,
      min: 1,
    },
    bid_step_count: {
      type: Number,
      default: 4,
      min: 1,
      max: 10,
    },
    /** 0 means step x count, which is what the buttons already add up to. */
    bid_max_increase: {
      type: Number,
      default: 0,
      min: 0,
    },
    icon_types: {
      type: String,
      enum: VEHICLE_ICON_TYPES,
      default: 'car',
      trim: true,
    },
    capacity: {
      type: Number,
      default: 0,
    },
    ride_surge_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    size: {
      type: String,
      default: '',
    },
    is_taxi: {
      type: String,
      enum: ['taxi', 'delivery', 'pooling', 'both'],
      default: 'taxi',
    },
    is_accept_share_ride: {
      type: Number,
      enum: [0, 1],
      default: 0,
    },
    delivery_category: {
      type: String,
      enum: DELIVERY_CATEGORY_TYPES,
      default: '',
      trim: true,
    },
    delivery_distance_pricing: {
      enabled: {
        type: Boolean,
        default: DELIVERY_DISTANCE_PRICING_DEFAULTS.enabled,
      },
      base_price: {
        type: Number,
        default: DELIVERY_DISTANCE_PRICING_DEFAULTS.base_price,
      },
      free_distance: {
        type: Number,
        default: DELIVERY_DISTANCE_PRICING_DEFAULTS.free_distance,
      },
      distance_price: {
        type: Number,
        default: DELIVERY_DISTANCE_PRICING_DEFAULTS.distance_price,
      },
      free_time: {
        type: Number,
        default: DELIVERY_DISTANCE_PRICING_DEFAULTS.free_time,
      },
      time_price: {
        type: Number,
        default: DELIVERY_DISTANCE_PRICING_DEFAULTS.time_price,
      },
    },
    image: {
      type: String,
      default: '',
      trim: true,
    },
    icon: {
      type: String,
      default: '',
      trim: true,
    },
    map_icon: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: Number,
      enum: [0, 1],
      default: 1,
    },
    active: {
      type: Boolean,
      default: true,
    },
    /**
     * The home-screen modules that offer this vehicle type.
     *
     * Ids of TaxiAppModule documents — Bike Taxi, Car Taxi, Bike Parcel and
     * so on — so the set is whatever the admin has created rather than a
     * list frozen in code.
     *
     * EMPTY MEANS EVERY MODULE. Every vehicle type that predates this field
     * has none, and must go on being offered everywhere it is offered today;
     * treating empty as "no modules" would empty the booking screen for the
     * whole platform the moment this shipped.
     */
    app_modules: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'TaxiAppModule',
      default: [],
      index: true,
    },
    supported_other_vehicle_types: {
      type: [ObjectId],
      ref: 'TaxiVehicle',
      default: [],
    },
    vehicle_preference: {
      type: [ObjectId],
      ref: 'TaxiPreference',
      default: [],
    },
  },
  { timestamps: true },
);

vehicleSchema.pre('save', function syncActiveStatus() {
  if (this.isModified('status')) {
    this.active = this.status === 1;
  } else if (this.isModified('active')) {
    this.status = this.active ? 1 : 0;
  }
});

vehicleSchema.index({ name: 1 });
vehicleSchema.index({ transport_type: 1, status: 1 });

export const Vehicle = mongoose.models.TaxiVehicle || mongoose.model('TaxiVehicle', vehicleSchema);
