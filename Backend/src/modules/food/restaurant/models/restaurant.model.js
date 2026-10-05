import mongoose from "mongoose";

const normalizeRatingValue = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(5, Number(numeric.toFixed(1))));
};

const geoPointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: {
      type: [Number], // [lng, lat]
      default: undefined,
      validate: {
        validator(v) {
          return (
            !v ||
            (Array.isArray(v) &&
              v.length === 2 &&
              v.every((n) => typeof n === "number" && Number.isFinite(n)))
          );
        },
        message: "location.coordinates must be [lng, lat]",
      },
    },
    // Address fields stored alongside geo so UI can consume a single object.
    latitude: { type: Number },
    longitude: { type: Number },
    formattedAddress: { type: String, trim: true },
    address: { type: String, trim: true },
    addressLine1: { type: String, trim: true },
    addressLine2: { type: String, trim: true },
    area: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    landmark: { type: String, trim: true },
  },
  { _id: false },
);

const restaurantSchema = new mongoose.Schema(
  {
    restaurantName: {
      type: String,
      required: true,
      trim: true,
    },
    ownerName: {
      type: String,
      required: true,
      trim: true,
    },
    ownerEmail: {
      type: String,
      trim: true,
    },
    ownerPhone: {
      type: String,
      trim: true,
    },
    // Normalized fields for fast lookup + uniqueness guarantees.
    // These are derived from restaurantName/ownerPhone at write time.
    restaurantNameNormalized: {
      type: String,
      trim: true,
    },
    ownerPhoneDigits: {
      type: String,
      trim: true,
    },
    ownerPhoneLast10: {
      type: String,
      trim: true,
    },
    primaryContactNumber: {
      type: String,
      trim: true,
    },
    pureVegRestaurant: {
      type: Boolean,
      required: true,
      default: false,
    },
    addressLine1: {
      type: String,
    },
    addressLine2: {
      type: String,
    },
    area: {
      type: String,
    },
    city: {
      type: String,
    },
    state: {
      type: String,
    },
    pincode: {
      type: String,
    },
    landmark: {
      type: String,
    },
    cuisines: {
      type: [String],
      default: [],
    },
    openingTime: {
      type: String,
    },
    closingTime: {
      type: String,
    },
    openDays: {
      type: [String],
      default: [],
    } /**
     * Operational toggle controlled by restaurant dashboard.
     * When false, restaurant is shown as offline / not accepting orders even within open hours.
     */,
    isAcceptingOrders: {
      type: Boolean,
      default: true,
      index: true,
    },
    panNumber: {
      type: String,
    },
    nameOnPan: {
      type: String,
    },
    gstRegistered: {
      type: Boolean,
      default: false,
    },
    gstNumber: {
      type: String,
    },
    gstLegalName: {
      type: String,
    },
    gstAddress: {
      type: String,
    },
    fssaiNumber: {
      type: String,
    },
    fssaiExpiry: {
      type: Date,
    },
    accountNumber: {
      type: String,
    },
    ifscCode: {
      type: String,
    },
    accountHolderName: {
      type: String,
    },
    accountType: {
      type: String,
    },
    upiId: {
      type: String,
      trim: true,
    },
    upiQrImage: {
      type: String,
      trim: true,
    },
    menuImages: {
      type: [String],
      default: [],
    },
    coverImages: {
      type: [String],
      default: [],
    },
    /**
     * The single main cover image, set through `/restaurant/media/cover-image`.
     *
     * Separate from `coverImages` above, which is the legacy list written by
     * `/profile/cover-images` — that route also resets `status` to 'pending',
     * so it cannot be used for routine photo edits without taking a live
     * restaurant offline.
     */
    coverImage: {
      type: String,
      default: "",
      trim: true,
    },
    /** Premises photos: what the rider uses to recognise the pickup point. */
    galleryImages: {
      type: [String],
      default: [],
    },
    profileImage: {
      type: String,
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
    fcmTokenMobile: {
      type: [String],
      default: [],
    },
    /** GeoJSON point used for distance queries. */
    location: {
      type: geoPointSchema,
      default: undefined,
    },
    /** Optional service zone id (can be computed from location). */
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FoodZone",
      index: true,
    },
    businessModel: {
      type: String,
      trim: true,
    },
    panImage: {
      type: String,
    },
    gstImage: {
      type: String,
    },
    fssaiImage: {
      type: String,
    },
    estimatedDeliveryTime: { type: String },
    /** Numeric delivery time in minutes for filtering/sorting. */
    estimatedDeliveryTimeMinutes: { type: Number, index: true },
    featuredDish: { type: String },
    featuredPrice: { type: Number },
    offer: { type: String },
    /** Rating fields for filtering/sorting (defaults to 0 if never rated). */
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      index: true,
      set: normalizeRatingValue,
    },
    totalRatings: { type: Number, default: 0, min: 0 },
    diningSettings: {
      isEnabled: { type: Boolean, default: false },
      maxGuests: { type: Number, default: 6 },
      diningType: { type: String, default: "family-dining" },
    },
    menu: {
      sections: { type: Array, default: [] },
    },
    petpoojaEnabled: {
      type: Boolean,
      default: false,
    },
    petpoojaOutletId: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    approvedAt: {
      type: Date,
    },
    rejectedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    /*
     * Free delivery for this restaurant specifically.
     *
     * Absent means 'inherit', which is what every existing restaurant does, so
     * adding this changes nothing until an admin sets it. 'off' excludes this
     * restaurant from a platform-wide promotion and beats the global switch;
     * 'custom' runs its own radius and minimum instead.
     *
     * Admin-only, like the platform rule: waiving the fee costs the platform,
     * not the restaurant, and the rider is still paid in full.
     */
    /*
     * Whether this restaurant's menu prices already contain GST.
     *
     * False is what every restaurant did before this existed -- the stored
     * price is net and tax is added on top -- so leaving it alone changes no
     * bill. Set per restaurant rather than per dish: a kitchen prices one way
     * or the other, and a 500-dish menu should not carry 500 chances to get it
     * wrong.
     */
    priceIncludesGst: { type: Boolean, default: false },
    freeDeliveryRule: {
      mode: {
        type: String,
        enum: ["inherit", "off", "custom"],
        default: "inherit",
      },
      maxDistanceKm: { type: Number, min: 0, default: 3 },
      minOrderAmount: { type: Number, min: 0, default: 300 },
    },
    /*
     * How far this restaurant delivers, in km from its own location. Null means
     * it has set no radius and only the zone decides -- what every restaurant
     * did before this existed.
     *
     * The one stored copy. The restaurant app and the admin panel both write it
     * through restaurant/services/serviceRadius.service.js, and the listing, the
     * cart and order placement all read it through shared/serviceRadius.js.
     * Never write it directly: the platform ceiling is checked there.
     */
    serviceRadiusKm: { type: Number, min: 0, default: null },
    /** Who last changed it, so either side can see the other did. */
    serviceRadiusUpdatedBy: {
      type: String,
      enum: ["restaurant", "admin", null],
      default: null,
    },
    serviceRadiusUpdatedAt: { type: Date, default: null },
  },
  {
    collection: "food_restaurants",
    timestamps: true,
  },
);

restaurantSchema.pre("validate", function normalizeDerivedFields(next) {
  const name =
    typeof this.restaurantName === "string" ? this.restaurantName : "";
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, " ");
  this.restaurantNameNormalized = normalizedName || undefined;

  const phoneRaw =
    typeof this.ownerPhone === "string" || typeof this.ownerPhone === "number"
      ? String(this.ownerPhone)
      : "";
  const digits = phoneRaw.replace(/\D/g, "").slice(-15); // guard against country prefixes
  this.ownerPhoneDigits = digits || undefined;
  this.ownerPhoneLast10 = digits ? digits.slice(-10) : undefined;

  // Keep `location` in sync when flat address fields exist (backward-compatible migration).
  // Prefer explicit location.* fields if provided.
  const hasAnyFlatAddress =
    this.addressLine1 ||
    this.addressLine2 ||
    this.area ||
    this.city ||
    this.state ||
    this.pincode ||
    this.landmark;
  if (this.location) {
    // If a location object exists but has no usable geo coordinates,
    // keep flat address fields only and drop location to avoid 2dsphere write errors.
    const hasCoordinates =
      Array.isArray(this.location.coordinates) &&
      this.location.coordinates.length === 2 &&
      this.location.coordinates.every(
        (n) => typeof n === "number" && Number.isFinite(n),
      );
    const hasLatLng =
      typeof this.location.latitude === "number" &&
      Number.isFinite(this.location.latitude) &&
      typeof this.location.longitude === "number" &&
      Number.isFinite(this.location.longitude);
    if (!hasCoordinates && !hasLatLng) {
      if (!this.addressLine1 && this.location.addressLine1)
        this.addressLine1 = this.location.addressLine1;
      if (!this.addressLine2 && this.location.addressLine2)
        this.addressLine2 = this.location.addressLine2;
      if (!this.area && this.location.area) this.area = this.location.area;
      if (!this.city && this.location.city) this.city = this.location.city;
      if (!this.state && this.location.state) this.state = this.location.state;
      if (!this.pincode && this.location.pincode)
        this.pincode = this.location.pincode;
      if (!this.landmark && this.location.landmark)
        this.landmark = this.location.landmark;
      this.location = undefined;
    }
  }

  if (this.location) {
    // Sync coords <-> lat/lng
    const lat =
      typeof this.location.latitude === "number"
        ? this.location.latitude
        : undefined;
    const lng =
      typeof this.location.longitude === "number"
        ? this.location.longitude
        : undefined;
    if (
      (!this.location.coordinates || this.location.coordinates.length !== 2) &&
      typeof lng === "number" &&
      typeof lat === "number"
    ) {
      this.location.coordinates = [lng, lat];
    }
    if (
      Array.isArray(this.location.coordinates) &&
      this.location.coordinates.length === 2
    ) {
      const [clng, clat] = this.location.coordinates;
      if (typeof this.location.latitude !== "number" && Number.isFinite(clat))
        this.location.latitude = clat;
      if (typeof this.location.longitude !== "number" && Number.isFinite(clng))
        this.location.longitude = clng;
    }

    // Sync flat -> location for address fields if location fields are empty.
    if (hasAnyFlatAddress) {
      if (!this.location.addressLine1 && this.addressLine1)
        this.location.addressLine1 = this.addressLine1;
      if (!this.location.addressLine2 && this.addressLine2)
        this.location.addressLine2 = this.addressLine2;
      if (!this.location.area && this.area) this.location.area = this.area;
      if (!this.location.city && this.city) this.location.city = this.city;
      if (!this.location.state && this.state) this.location.state = this.state;
      if (!this.location.pincode && this.pincode)
        this.location.pincode = this.pincode;
      if (!this.location.landmark && this.landmark)
        this.location.landmark = this.landmark;
    }
  }

  // Derive estimatedDeliveryTimeMinutes from the human string if not explicitly set.
  // Accepts formats like "25-30 mins", "30 mins", "45".
  if (
    this.estimatedDeliveryTimeMinutes === undefined ||
    this.estimatedDeliveryTimeMinutes === null
  ) {
    const raw =
      typeof this.estimatedDeliveryTime === "string"
        ? this.estimatedDeliveryTime
        : "";
    const match = raw.match(/(\d{1,3})/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      if (Number.isFinite(minutes)) {
        this.estimatedDeliveryTimeMinutes = minutes;
      }
    }
  }
  next();
});

restaurantSchema.index({ ownerPhone: 1 });
restaurantSchema.index({ restaurantName: 1 });
restaurantSchema.index({ restaurantNameNormalized: 1 });
restaurantSchema.index({ city: 1 });
restaurantSchema.index({ "location.city": 1 });
restaurantSchema.index({ location: "2dsphere" });
restaurantSchema.index({ restaurantName: 1, ownerPhone: 1 });
// Enforce uniqueness at the database level to avoid race conditions in registration.
// Uses partial filter to avoid blocking older documents that may not yet have normalized fields.
restaurantSchema.index(
  { restaurantNameNormalized: 1, ownerPhoneLast10: 1 },
  {
    unique: true,
    partialFilterExpression: {
      restaurantNameNormalized: { $type: "string" },
      ownerPhoneLast10: { $type: "string" },
    },
  },
);
restaurantSchema.index({ status: 1, createdAt: -1 });

export const FoodRestaurant = mongoose.model(
  "FoodRestaurant",
  restaurantSchema,
);
