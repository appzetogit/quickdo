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
    /**
     * @deprecated Restaurant vocabulary inherited from the food module this vertical
     * was forked from. A grocery seller has departments, not cuisines. Still written
     * by legacy onboarding screens, so it stays until those are migrated onto
     * `storeType` + category assignment below. Do not read it in new code.
     */
    cuisines: {
      type: [String],
      default: [],
    },

    /**
     * What kind of shop this is.
     *
     * Drives three things that a single "restaurant" type cannot express: which
     * category tree the seller may list under, which licence is mandatory at
     * onboarding (FSSAI for anything edible, a drug licence for pharmacy), and
     * whether an order from this seller may be pooled with another on one trip —
     * medicine and raw meat should not share a bag with vegetables.
     */
    storeType: {
      type: String,
      enum: ['grocery', 'kirana', 'supermarket', 'pharmacy', 'pet', 'electronics', 'stationery', 'general'],
      default: 'grocery',
      index: true,
    },

    /**
     * The temperature bands this seller can actually hold stock in.
     *
     * A product's `perishability` says what it needs; this says what the shop has.
     * Listing frozen goods from a seller with no freezer is how a customer receives
     * thawed ice cream and the platform pays for the return — so the two are checked
     * against each other rather than assumed to match.
     *
     * Ambient is always implied; the array records what is available beyond it.
     */
    storageCapability: {
      type: [{ type: String, enum: ['chilled', 'frozen'] }],
      default: [],
    },

    /**
     * Drug licence, mandatory for storeType 'pharmacy' and meaningless otherwise.
     *
     * Kept alongside the FSSAI fields rather than replacing them: FSSAI is required
     * for any business handling food, which includes a kirana store, so both licences
     * genuinely coexist in this vertical.
     */
    drugLicenseNumber: {
      type: String,
      trim: true,
      default: '',
    },
    drugLicenseExpiry: {
      type: Date,
      default: null,
    },
    drugLicenseImage: {
      type: String,
      trim: true,
      default: '',
    },

    /*
     * Pharmacy onboarding, beyond the licence. What the list of required
     * documents in shared/partnerOnboarding.js asks for, and what the admin
     * reviews before approving. Empty on every seller that registered before
     * these existed, which the review page flags rather than suspending them.
     */
    pharmacist: {
      name: { type: String, trim: true, default: '' },
      registrationNumber: { type: String, trim: true, default: '' },
      certificateImage: { type: String, trim: true, default: '' },
    },
    businessRegistrationImage: { type: String, trim: true, default: '' },
    /*
     * The front photo is how an admin checks the shop is real, so it is
     * mandatory for a pharmacy; the other two help and are optional.
     */
    storePhotos: {
      front: { type: String, trim: true, default: '' },
      inside: { type: String, trim: true, default: '' },
      signboard: { type: String, trim: true, default: '' },
    },
    /** When the application was last submitted or resubmitted for review. */
    applicationSubmittedAt: { type: Date, default: null },

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
     * Manual availability override controlled by restaurant dashboard Online/Offline toggle.
     * false = force offline (ignore outlet timings).
     * true = follow outlet timings only (no force-online outside hours).
     */,
    isAcceptingOrders: {
      type: Boolean,
      default: true,
      index: true,
    },
    /**
     * Confirm this seller's orders the moment they are placed, and start
     * hunting a rider immediately, instead of waiting for someone to tap
     * Accept.
     *
     * The acceptance window exists because a third-party kitchen might be
     * slammed and need to refuse. A seller running to a delivery promise
     * measured in minutes cannot afford it: four minutes of someone not
     * looking at a tablet is most of the budget gone before anybody picks a
     * single item.
     *
     * Off by default, so nothing changes for a seller until an admin decides
     * they are reliable enough. Turning it on does not remove the ability to
     * cancel -- it removes the wait.
     */
    autoAcceptOrders: {
      type: Boolean,
      default: false,
      index: true,
    },
    /**
     * Legacy field. No longer used to keep a restaurant online outside outlet hours.
     * Cleared whenever the Online/Offline toggle is updated.
     */
    outsideHoursOverride: {
      type: Boolean,
      default: false,
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
    /** Single hero/cover image for the restaurant page. Falls back to coverImages[0]. */
    coverImage: {
      type: String,
      default: '',
    },
    /**
     * Photos of the physical premises — storefront, entrance, signage. Shown to the
     * delivery partner at pickup so they can visually identify the place, and on the
     * customer-facing page.
     */
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
    /** Proposed location awaiting admin approval (published location stays live for users). */
    pendingLocation: {
      type: geoPointSchema,
      default: undefined,
    },
    pendingZoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QCZone",
      default: undefined,
    },
    locationUpdateStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
      index: true,
    },
    locationUpdateRequestedAt: { type: Date },
    locationUpdateReviewedAt: { type: Date },
    locationRejectionReason: { type: String, trim: true, default: "" },
    /** Optional service zone id (can be computed from location). */
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QCZone",
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
    /**
     * @deprecated Restaurant vocabulary. A grocery seller promotes a product, and a
     * product already carries `isRecommended` on the item itself — which is where a
     * featured line belongs, because it survives price changes and stays linked to
     * real stock. These two are a name and a loose number with neither property.
     * Still written by legacy onboarding screens; do not read them in new code.
     */
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
    /**
     * @deprecated Table booking. There is no dine-in at a grocery store. Retained
     * only because existing qc_restaurants documents carry the sub-document and
     * removing it would rewrite every row for no gain; nothing in this vertical reads
     * it. Drop it when the collection is next migrated.
     */
    diningSettings: {
      isEnabled: { type: Boolean, default: false },
      maxGuests: { type: Number, default: 6 },
      diningType: { type: String, default: "family-dining" },
    },
    /**
     * @deprecated A restaurant's menu is a small, curated, seller-authored document,
     * so embedding it made sense. A grocery catalogue is thousands of independently
     * priced, stocked and expiring SKUs — those live in qc_food_items keyed by
     * sellerId, where they can be indexed, searched and stock-checked. Embedding them
     * here would put the whole catalogue in every seller read.
     */
    menu: {
      sections: { type: Array, default: [] },
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
    onboardingFeePaid: {
      type: Boolean,
      default: false,
    },
    onboardingFeeAmount: {
      type: Number,
      default: 0,
    },
    onboardingFeePaidAt: {
      type: Date,
    },
    onboardingFeePaymentMethod: {
      type: String,
      trim: true,
    },
    onboardingFeePaymentOrderId: {
      type: String,
      trim: true,
    },
    onboardingFeePaymentId: {
      type: String,
      trim: true,
    },
    onboardingFeePaymentSignature: {
      type: String,
      trim: true,
    },
    subscriptionPlan: {
      type: String,
    },
    subscriptionAmount: {
      type: Number,
      default: 0,
    },
    subscriptionPaidAmount: {
      type: Number,
      default: 0,
    },
    subscriptionAutoDeductedAmount: {
      type: Number,
      default: 0,
    },
    subscriptionDueAmount: {
      type: Number,
      default: 0,
    },
    subscriptionStatus: {
      type: String,
      enum: ['due', 'paid'],
      default: 'due',
    },
    subscriptionValidTill: {
      type: Date,
    },
    /**
     * Bumped on every successful login, and embedded in the JWT that login issues.
     * A token whose version is behind the stored one is rejected, so signing in on
     * a new device silently invalidates every older device rather than leaving the
     * account live in two places at once.
     */
    tokenVersion: { type: Number, default: 0 },
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
      // Coordinates are the 2dsphere source of truth — always overwrite stale lat/lng.
      const [clng, clat] = this.location.coordinates;
      if (Number.isFinite(clat)) this.location.latitude = clat;
      if (Number.isFinite(clng)) this.location.longitude = clng;
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

export const FoodRestaurant = mongoose.models.QCRestaurant || mongoose.model(
  'QCRestaurant',
  restaurantSchema,
  'qc_restaurants',
);
