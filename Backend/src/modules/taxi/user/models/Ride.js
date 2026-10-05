import mongoose from 'mongoose';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../../constants/index.js';

const rideMessageSchema = new mongoose.Schema(
  {
    senderRole: {
      type: String,
      enum: ['user', 'driver'],
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const rideSchema = new mongoose.Schema(
  {
    /** Removed from the admin trips list by an admin. The ride itself is kept
     *  (earnings, payments and reports still read it). */
    adminHiddenAt: { type: Date, default: null },
    adminHiddenBy: { type: String, default: '' },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiUser',
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      default: null,
    },
    vehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiVehicle',
      default: null,
    },
    dispatchVehicleTypeIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'TaxiVehicle',
        },
      ],
      default: [],
    },
    vehicleIconType: {
      type: String,
      default: '',
      trim: true,
    },
    vehicleIconUrl: {
      type: String,
      default: '',
      trim: true,
    },
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Delivery',
      default: null,
    },
    serviceType: {
      type: String,
      enum: ['ride', 'parcel', 'intercity'],
      default: 'ride',
      lowercase: true,
      trim: true,
    },
    intercity: {
      bookingId: {
        type: String,
        default: '',
        trim: true,
      },
      fromCity: {
        type: String,
        default: '',
        trim: true,
      },
      toCity: {
        type: String,
        default: '',
        trim: true,
      },
      tripType: {
        type: String,
        default: '',
        trim: true,
      },
      travelDate: {
        type: String,
        default: '',
        trim: true,
      },
      passengers: {
        type: Number,
        default: 1,
        min: 1,
      },
      distance: {
        type: Number,
        default: 0,
        min: 0,
      },
      vehicleName: {
        type: String,
        default: '',
        trim: true,
      },
    },
    parcel: {
      category: {
        type: String,
        default: '',
        trim: true,
      },
      weight: {
        type: String,
        default: '',
        trim: true,
      },
      // The weight slot picked at booking. Label and charge are copied from the
      // goods type then, and the charge is already inside `fare`.
      goodsTypeId: { type: String, default: '', trim: true },
      weightSlotId: { type: String, default: '', trim: true },
      weightSlotLabel: { type: String, default: '', trim: true },
      weightCharge: { type: Number, default: 0, min: 0 },
      description: {
        type: String,
        default: '',
        trim: true,
      },
      deliveryCategory: {
        type: String,
        default: '',
        trim: true,
      },
      goodsTypeFor: {
        type: String,
        default: '',
        trim: true,
      },
      // Photographs of the parcel, as Cloudinary URLs.
      //
      // `photos` is what the sender showed at booking; the other two are what
      // the captain photographed at each end. They are kept apart on purpose:
      // the whole value of a delivery photo is that it can be held against the
      // booking photo, which one merged list would make impossible.
      photos: {
        type: [String],
        default: [],
      },
      pickupPhotos: {
        type: [String],
        default: [],
      },
      deliveryPhotos: {
        type: [String],
        default: [],
      },
      deliveryScope: {
        type: String,
        enum: ['city', 'outstation'],
        default: 'city',
        lowercase: true,
        trim: true,
      },
      isOutstation: {
        type: Boolean,
        default: false,
      },
      senderName: {
        type: String,
        default: '',
        trim: true,
      },
      senderMobile: {
        type: String,
        default: '',
        trim: true,
      },
      receiverName: {
        type: String,
        default: '',
        trim: true,
      },
      receiverMobile: {
        type: String,
        default: '',
        trim: true,
      },
    },
    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(RIDE_STATUS),
      default: RIDE_STATUS.SEARCHING,
    },
    liveStatus: {
      type: String,
      enum: Object.values(RIDE_LIVE_STATUS),
      default: RIDE_LIVE_STATUS.SEARCHING,
    },
    pickupLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    pickupAddress: {
      type: String,
      default: '',
      trim: true,
    },
    dropLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    dropAddress: {
      type: String,
      default: '',
      trim: true,
    },
    fare: {
      type: Number,
      required: true,
      min: 0,
    },
    baseFare: {
      type: Number,
      default: 0,
      min: 0,
    },
    waitingChargeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    distanceChargeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    timeChargeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    additionalCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    adminExtraCharge: {
      amount: {
        type: Number,
        default: 0,
        min: 0,
      },
      reason: {
        type: String,
        default: '',
        trim: true,
      },
      addedAt: {
        type: Date,
        default: null,
      },
    },
    bookingMode: {
      type: String,
      enum: ['normal', 'bidding'],
      default: 'normal',
      lowercase: true,
      trim: true,
    },
    pricingNegotiationMode: {
      type: String,
      enum: ['none', 'driver_bid', 'user_increment_only'],
      default: 'none',
      lowercase: true,
      trim: true,
    },
    biddingStatus: {
      type: String,
      enum: ['none', 'open', 'accepted', 'expired', 'cancelled'],
      default: 'none',
      lowercase: true,
      trim: true,
    },
    bidStepAmount: {
      type: Number,
      default: 10,
      min: 1,
    },
    bidFloorFare: {
      type: Number,
      default: 0,
      min: 0,
    },
    userMaxBidFare: {
      type: Number,
      default: 0,
      min: 0,
    },
    bidCeilingMaxFare: {
      type: Number,
      default: 0,
      min: 0,
    },
    fareIncreaseWaitMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextFareIncreaseAt: {
      type: Date,
      default: null,
    },
    acceptedBidId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRideBid',
      default: null,
    },
    estimatedDistanceMeters: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimatedDurationMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'online'],
      default: 'cash',
      lowercase: true,
      trim: true,
    },
    otp: {
      type: String,
      trim: true,
      minlength: 4,
      maxlength: 4,
    },
    driverPaymentCollection: {
      provider: {
        type: String,
        default: '',
        trim: true,
      },
      providerId: {
        type: String,
        default: '',
        trim: true,
      },
      providerOrderId: {
        type: String,
        default: '',
        trim: true,
      },
      providerPaymentId: {
        type: String,
        default: '',
        trim: true,
      },
      providerMode: {
        type: String,
        default: '',
        trim: true,
      },
      source: {
        type: String,
        default: '',
        trim: true,
      },
      status: {
        type: String,
        enum: ['pending', 'created', 'active', 'issued', 'closed', 'paid', 'captured', 'completed', 'expired', 'cancelled', 'failed'],
        default: 'pending',
      },
      amount: {
        type: Number,
        default: 0,
        min: 0,
      },
      currency: {
        type: String,
        default: 'INR',
        trim: true,
      },
      linkUrl: {
        type: String,
        default: '',
        trim: true,
      },
      paidAt: {
        type: Date,
        default: null,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    subscriptionUsage: {
      covered: {
        type: Boolean,
        default: false,
      },
      subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiUserSubscription',
        default: null,
      },
      planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiSubscriptionPlan',
        default: null,
      },
      planName: {
        type: String,
        default: '',
        trim: true,
      },
      vehicleTypeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiVehicle',
        default: null,
      },
      benefitType: {
        type: String,
        enum: ['limited', 'unlimited', ''],
        default: '',
      },
      fareCovered: {
        type: Number,
        default: 0,
        min: 0,
      },
      ridesUsedBefore: {
        type: Number,
        default: 0,
        min: 0,
      },
      ridesRemainingBefore: {
        type: Number,
        default: null,
        min: 0,
      },
      ridesUsedAfter: {
        type: Number,
        default: null,
        min: 0,
      },
      ridesRemainingAfter: {
        type: Number,
        default: null,
        min: 0,
      },
    },
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      default: null,
    },
    poolGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiInstantPoolGroup',
      default: null,
      index: true,
    },
    isPoolRide: {
      type: Boolean,
      default: false,
      index: true,
    },
    poolSeats: {
      type: Number,
      default: 1,
      min: 1,
    },
    routeVersion: {
      type: Number,
      default: 0,
    },
    transport_type: {
      type: String,
      enum: ['taxi', 'delivery', 'intercity', 'all'],
      default: 'taxi',
      trim: true,
    },
    pricingSnapshot: {
      setPriceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiSetPrice',
        default: null,
      },
      starting_fare: {
        type: Number,
        default: 0,
        min: 0,
      },
      admin_commission_type_from_driver: {
        type: Number,
        default: 1,
      },
      admin_commission_from_driver: {
        type: Number,
        default: 0,
      },
      waiting_charge: {
        type: Number,
        default: 0,
        min: 0,
      },
      free_waiting_before: {
        type: Number,
        default: 0,
        min: 0,
      },
      free_waiting_after: {
        type: Number,
        default: 0,
        min: 0,
      },
      time_price: {
        type: Number,
        default: 0,
        min: 0,
      },
      ride_surge_enabled: {
        type: Boolean,
        default: false,
      },
      ride_surge_amount: {
        type: Number,
        default: 0,
        min: 0,
      },
      fare_before_surge: {
        type: Number,
        default: 0,
        min: 0,
      },
      /*
       * The fare the rider agreed to before any charge the trip itself adds
       * (waiting, an admin's extra, a recovered cancellation fee): the priced
       * fare less a promo, plus surge -- or the driver's bid the rider accepted.
       * Completion builds the final fare from this. It used to rebuild it from
       * starting_fare, which silently dropped the promo and the accepted bid.
       * null on rides booked before this existed; see resolveAgreedFare.
       */
      agreed_fare: {
        type: Number,
        default: null,
        min: 0,
      },
      // How much of agreed_fare's reduction is a promo. The platform funds it,
      // so the driver is settled on agreed_fare + this.
      promo_discount_applied: {
        type: Number,
        default: null,
        min: 0,
      },
      surge_zone_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiZone',
        default: null,
      },
      // Set when an admin's time-slot surge priced the ride (percent of the fare).
      surge_percent: {
        type: Number,
        default: 0,
        min: 0,
      },
      surge_slot_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiSurgeSlot',
        default: null,
      },
      surge_slot_name: {
        type: String,
        default: '',
        trim: true,
      },
      // Ride insurance the rider chose at booking, frozen (common/rideInsurance.js).
      insurance: {
        type: new mongoose.Schema({
          plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRideInsurancePlan' },
          name: { type: String, default: '' },
          provider: { type: String, default: '' },
          cover_amount: { type: Number, default: 0, min: 0 },
          premium_type: { type: String, default: 'flat' },
          premium_value: { type: Number, default: 0, min: 0 },
          premium: { type: Number, default: 0, min: 0 },
        }, { _id: false }),
        default: null,
      },
      surge_zone_name: {
        type: String,
        default: '',
        trim: true,
      },
      allowed_payment_methods: {
        type: [String],
        default: ['cash', 'online'],
      },
      user_cancellation_fee_type: {
        type: String,
        default: 'percentage',
        trim: true,
      },
      user_cancellation_fee: {
        type: Number,
        default: 0,
        min: 0,
      },
      driver_cancellation_fee_type: {
        type: String,
        default: 'percentage',
        trim: true,
      },
      driver_cancellation_fee: {
        type: Number,
        default: 0,
        min: 0,
      },
      enable_cancellation_charge: {
        type: Boolean,
        default: true,
      },
      free_cancellation_time: {
        type: Number,
        default: 2,
      },
      fixed_cancellation_charge: {
        type: Number,
        default: 0,
      },
      percentage_cancellation_charge: {
        type: Number,
        default: 0,
      },
      charge_after_driver_accepted: {
        type: Boolean,
        default: true,
      },
      charge_after_driver_reached_pickup: {
        type: Boolean,
        default: true,
      },
      charge_after_otp: {
        type: Boolean,
        default: false,
      },
      max_cancellation_fee: {
        type: Number,
        default: 0,
      },
      enable_cancellation_reasons: {
        type: Boolean,
        default: true,
      },
      cancellation_policy_message: {
        type: String,
        default: '',
      },
      // Who a rider's cancellation fee on this ride is paid to. Not being in
      // the schema, it was stripped on save and every fee read as the admin's.
      cancellation_fee_goes_to: {
        type: String,
        enum: ['admin', 'driver'],
        default: 'admin',
      },
      resolvedAt: {
        type: Date,
        default: null,
      },
    },
    commissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    driverEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    /*
     * The platform incentive included in `driverEarnings` above, from
     * Master > Delivery Earnings. Kept separately so a payout can be explained:
     * what the ride earned, and what the platform added on top of it.
     *
     * Declared here because the schema is strict -- a field the service sets but
     * the model does not name is dropped on save, and the incentive would be
     * paid with no record of why the earnings were higher.
     */
    driverIncentiveAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    walletSettledAt: {
      type: Date,
      default: null,
    },
    /*
     * When an online ride's earnings reached the driver's wallet. That happens
     * once the rider's payment is confirmed, not at completion -- an unpaid
     * online ride used to be paid out of the platform's pocket. The atomic
     * claim on this field is what keeps the credit to exactly once.
     */
    driverEarningsCreditedAt: {
      type: Date,
      default: null,
    },
    cancelled_by: {
      type: String,
      default: '',
      trim: true,
    },
    cancellation_reason: {
      type: String,
      default: '',
      trim: true,
    },
    cancellation_charge: {
      type: Number,
      default: 0,
    },
    cancellation_status: {
      type: String,
      enum: ['none', 'pending', 'recovered', 'no_charge'],
      default: 'none',
    },
    cancellation_time: {
      type: Date,
      default: null,
    },
    pending_cancellation_due: {
      type: Number,
      default: 0,
    },
    recovery_status: {
      type: String,
      enum: ['none', 'pending', 'recovered'],
      default: 'none',
    },
    recovered_in_ride: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRide',
      default: null,
    },
    recovered_at: {
      type: Date,
      default: null,
    },
    recovered_cancellation_due: {
      type: Number,
      default: 0,
    },
    // The ride insurance premium charged at completion; 0 when uninsured or not completed.
    insurance_fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    promo: {
      code: {
        type: String,
        default: '',
        trim: true,
        uppercase: true,
      },
      promo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiPromoCode',
        default: null,
      },
      discount_amount: {
        type: Number,
        default: 0,
        min: 0,
      },
      fare_before_discount: {
        type: Number,
        default: 0,
        min: 0,
      },
      fare_after_discount: {
        type: Number,
        default: 0,
        min: 0,
      },
      service_location_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiServiceLocation',
        default: null,
      },
      transport_type: {
        type: String,
        enum: ['taxi', 'delivery', 'intercity', 'all'],
        default: 'taxi',
        trim: true,
      },
      applied_at: {
        type: Date,
        default: null,
      },
    },
    lastDriverLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: undefined,
      },
      heading: {
        type: Number,
        default: null,
      },
      speed: {
        type: Number,
        default: null,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    messages: {
      type: [rideMessageSchema],
      default: [],
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    arrivedAt: {
      type: Date,
      default: null,
    },
    destinationArrivedAt: {
      type: Date,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    feedback: {
      rating: {
        type: Number,
        default: null,
        min: 0,
        max: 5,
      },
      comment: {
        type: String,
        default: '',
        trim: true,
        maxlength: 500,
      },
      tipAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      tipPaymentId: {
        type: String,
        default: '',
        trim: true,
      },
      tipOrderId: {
        type: String,
        default: '',
        trim: true,
      },
      tipPaidAt: {
        type: Date,
        default: null,
      },
      submittedAt: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true },
);

rideSchema.index({ userId: 1, createdAt: -1 });
rideSchema.index({ driverId: 1, createdAt: -1 });
rideSchema.index({ poolGroupId: 1 });

export const Ride = mongoose.models.TaxiRide || mongoose.model('TaxiRide', rideSchema);
