import mongoose from 'mongoose';
import { VEHICLE_TYPES } from '../../constants/index.js';

const geoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
      default: [0, 0],
    },
  },
  { _id: false },
);

/*
 * Single busy-lock shared across ride + delivery dispatch. null when the driver is free.
 *
 * Now a MIRROR of activeAssignments[0], maintained in the same atomic update by
 * core/assignment/assignment.service.js. Kept because a lot of code reads it --
 * three dispatchers filter on `activeAssignment: null` and there is a compound
 * index on `activeAssignment.type` -- and under the default one-job policy the
 * array holds 0 or 1 entries, so the mirror is exact and those readers stay
 * correct untouched. Write it only through the assignment service.
 */
const activeAssignmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['ride', 'delivery'] },
    id: { type: mongoose.Schema.Types.ObjectId },
    at: { type: Date },
  },
  { _id: false },
);

/*
 * The real busy-lock: every job this person is currently holding, any vertical.
 *
 * A single slot made "one job at a time" a property of the schema rather than a
 * policy, so stacking a second grocery order onto a food delivery was not
 * switched off -- it was unrepresentable. And quick-commerce, which forked before
 * the lock existed, never wrote the single slot at all, so a rider on a QC order
 * read as free and food or taxi would claim them.
 *
 * `vertical` is carried alongside `jobType` because reconciliation needs to know
 * WHICH collection to look the job up in: the old reconcile resolved every
 * delivery against FoodOrder, so a quick-commerce lock would have been judged
 * "job not found, therefore stale" and cleared on sight.
 */
const activeAssignmentEntrySchema = new mongoose.Schema(
  {
    vertical: { type: String, enum: ['food', 'quickCommerce', 'taxi', 'serviceProvider'] },
    jobType: {
      type: String,
      enum: ['foodDelivery', 'quickCommerceDelivery', 'taxiRide', 'serviceBooking'],
    },
    jobId: { type: mongoose.Schema.Types.ObjectId },
    at: { type: Date },
  },
  { _id: false },
);

const driverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
    },
    salary: {
      type: Number,
      default: 0,
      min: 0,
    },
    fcmTokenWeb: {
      type: String,
      default: '',
      trim: true,
    },
    fcmTokenMobile: {
      type: String,
      default: '',
      trim: true,
    },
    owner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiOwner',
      default: null,
      index: true,
    },
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      default: null,
      index: true,
    },
    country: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    profile_picture: {
      type: String,
      default: '',
      trim: true,
    },
    profileImage: {
      type: String,
      default: '',
      trim: true,
    },
    gender: {
      type: String,
      default: '',
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    isOnRide: {
      type: Boolean,
      default: false,
    },
    // ---- Unified multi-service fields (Phase 1: additive, not yet wired to dispatch) ----
    // What this driver is set up / approved to do. Onboarding or the backfill grants 'delivery'.
    // 'delivery' is food delivery; 'quickCommerce' is the grocery vertical, which
    // dispatches from its own pool and so is a capability of its own rather than
    // being folded into 'delivery'. A driver can hold any combination.
    serviceCapabilities: {
      type: [String],
      // 'parcel' is separate from 'taxi' on purpose. Parcel jobs ride the
      // same dispatcher as passenger trips, so without a capability of its
      // own a driver who signed up to carry boxes would be offered people.
      enum: ['taxi', 'delivery', 'quickCommerce', 'parcel'],
      default: ['taxi'],
    },
    /**
     * What the driver said they have, at onboarding: a two wheeler, a taxi
     * for passengers, or a vehicle for parcels.
     *
     * Decides which sub-options they were offered, which vehicle types they
     * could pick and which documents they had to upload. Kept so the admin
     * reviewing the application can see what was asked of them.
     */
    driverClass: {
      type: String,
      enum: ['two_wheeler', 'passenger_taxi', 'parcel_vehicle', ''],
      default: '',
      index: true,
    },
    /**
     * The tick-boxes under that choice -- what the driver ASKED to do.
     *
     * Deliberately not the same thing as serviceCapabilities, which is what
     * the admin GRANTED. Keeping the request apart from the grant is what
     * lets the approval screen show "they asked for food + parcel" next to
     * the boxes the admin is about to tick.
     */
    serviceIntents: {
      type: [String],
      default: [],
    },
    /**
     * The in-app toggle: which job streams the driver wants right now.
     *
     *   all      every stream the driver is capable of
     *   taxi     rides only
     *   delivery BOTH delivery verticals -- food and quick-commerce
     *
     * One toggle covers both deliveries deliberately: a rider turning deliveries
     * on wants jobs, not a choice between two apps they cannot tell apart from
     * the street. The separate capabilities still decide which pools they are in.
     *
     * 'quickCommerce' is retained only so a driver who stored it while it was
     * briefly selectable can still be read and saved; it is no longer offered.
     */
    workMode: {
      type: String,
      enum: ['all', 'taxi', 'delivery', 'quickCommerce'],
      default: 'all',
    },
    // Mirror of activeAssignments[0], for the readers that predate the array.
    // null = free. Written only by core/assignment/assignment.service.js.
    activeAssignment: {
      type: activeAssignmentSchema,
      default: null,
    },
    // Every job currently held, any vertical. The authoritative busy-lock.
    activeAssignments: {
      type: [activeAssignmentEntrySchema],
      default: [],
    },
    // Lightweight delivery dispatch hints kept on the core doc so matching needs no join.
    delivery: {
      vehicleType: { type: String, default: '' },
      vehicleName: { type: String, default: '' },
      vehicleNumber: { type: String, default: '' },
      // Per-driver COD cash ceiling snapshot (global default lives in FoodDeliveryCashLimit).
      codCashLimit: { type: Number, default: 0, min: 0 },
    },
    // Link to the legacy FoodDeliveryPartner during the dual-run phase (retired at contract).
    legacyDeliveryPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodDeliveryPartner',
      default: null,
      index: true,
    },
    // The quick-commerce half. Separate from the food link above because the two
    // verticals keep separate pools (food_delivery_partners vs
    // qc_delivery_partners) and a driver may be set up for one and not the other.
    legacyQcPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QCDeliveryPartner',
      default: null,
      index: true,
    },
    socketId: {
      type: String,
      default: null,
    },
    vehicleType: {
      type: String,
      required: true,
    },
    vehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiVehicle',
      default: null,
    },
    vehicleIconType: {
      type: String,
      default: 'car',
      trim: true,
    },
    vehicleMake: {
      type: String,
      default: '',
      trim: true,
    },
    vehicleModel: {
      type: String,
      default: '',
      trim: true,
    },
    registerFor: {
      type: String,
      default: 'taxi',
      trim: true,
    },
    isPoolEnabled: {
      type: Boolean,
      default: true,
    },
    activePoolGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiInstantPoolGroup',
      default: null,
    },
    poolOccupiedSeats: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxPoolSeats: {
      type: Number,
      default: 4,
      min: 1,
    },
    activePoolRideCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    serviceCategories: {
      type: [String],
      default: [],
    },
    vehicleNumber: {
      type: String,
      default: '',
      trim: true,
    },
    vehicleColor: {
      type: String,
      default: '',
      trim: true,
    },
    vehicleImage: {
      type: String,
      default: '',
      trim: true,
    },
    city: {
      type: String,
      default: '',
      trim: true,
    },
    referralCode: {
      type: String,
      default: '',
      trim: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      default: null,
      index: true,
    },
    referralCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    referredRideCompletionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    referralRewardGrantedAt: {
      type: Date,
      default: null,
    },
    approve: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      default: 'approved',
      trim: true,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRatingScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletion_reason: {
      type: String,
      default: '',
      trim: true,
    },
    deletionRequest: {
      status: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none',
        index: true,
      },
      reason: {
        type: String,
        default: '',
        trim: true,
      },
      requestedAt: {
        type: Date,
        default: null,
      },
      reviewedAt: {
        type: Date,
        default: null,
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null,
      },
      adminNote: {
        type: String,
        default: '',
        trim: true,
      },
    },
    wallet: {
      balance: {
        type: Number,
        default: 0,
      },
      cashLimit: {
        type: Number,
        default: 500,
        min: 0,
      },
      isBlocked: {
        type: Boolean,
        default: false,
      },
    },
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiZone',
      default: null,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
        default: [0, 0],
      },
    },
    routeBooking: {
      enabled: {
        type: Boolean,
        default: false,
      },
      anchorLocation: {
        type: geoPointSchema,
        default: null,
      },
      label: {
        type: String,
        default: '',
        trim: true,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    documents: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    emergencyContacts: {
      type: [
        {
          name: {
            type: String,
            required: true,
            trim: true,
          },
          phone: {
            type: String,
            required: true,
            trim: true,
          },
          source: {
            type: String,
            enum: ['manual', 'device'],
            default: 'manual',
          },
        },
      ],
      default: [],
    },
    onboarding: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    incentiveTracking: {
      currentOnlineStartedAt: {
        type: Date,
        default: null,
      },
      dailyActivity: {
        type: [
          {
            date: { type: String, required: true },
            activeMinutes: { type: Number, default: 0 },
          },
        ],
        default: [],
      },
      claimedRewards: {
        type: [
          {
            rewardType: { type: String, default: '' },
            rewardKey: { type: String, default: '' },
            periodKey: { type: String, default: '' },
            amount: { type: Number, default: 0 },
            claimedAt: { type: Date, default: Date.now },
            metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
          },
        ],
        default: [],
      },
    },
    todaySummary: {
      dateKey: {
        type: String,
        default: '',
        trim: true,
      },
      rides: {
        type: Number,
        default: 0,
      },
      earnings: {
        type: Number,
        default: 0,
      },
      distanceMeters: {
        type: Number,
        default: 0,
      },
      activeMinutes: {
        type: Number,
        default: 0,
      },
      activeSeconds: {
        type: Number,
        default: 0,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
  },
  { 
    collection: 'taxidrivers',
    timestamps: true,
  },
);

driverSchema.index({ 'deletionRequest.status': 1, deletedAt: 1 });
driverSchema.index({ deletedAt: 1, createdAt: -1 });
driverSchema.index({ approve: 1, deletedAt: 1, createdAt: -1 });
driverSchema.index({ status: 1, deletedAt: 1 });
driverSchema.index({ phone: 1, deletedAt: 1 });

driverSchema.index({ isOnline: 1, isOnRide: 1, isPoolEnabled: 1 });
// Unified dispatch: find online, free, capable drivers for a given service + work mode.
driverSchema.index({ isOnline: 1, serviceCapabilities: 1, workMode: 1, 'activeAssignment.type': 1 });
// The claim filter's own path. Kept alongside the mirror index rather than
// replacing it: the three dispatchers still query the mirror, and dropping an
// index they depend on in the same change that introduces the array would turn a
// correctness fix into a latency incident.
driverSchema.index({ 'activeAssignments.jobId': 1 });
driverSchema.index({ 'activeAssignments.jobType': 1 });
driverSchema.index({ location: '2dsphere' });
driverSchema.index({ 'routeBooking.anchorLocation': '2dsphere' });

export const Driver = mongoose.models.TaxiDriver || mongoose.model('TaxiDriver', driverSchema);

