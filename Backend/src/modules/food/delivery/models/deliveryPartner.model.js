import mongoose from 'mongoose';

const normalizeRatingValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(5, Number(numeric.toFixed(1))));
};

const deliveryPartnerSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        phone: {
            type: String,
            required: true,
            trim: true,
            unique: true
        },
        email: { type: String, trim: true },
        countryCode: {
            type: String,
            default: '+91'
        },
        address: {
            type: String
        },
        city: {
            type: String
        },
        state: {
            type: String
        },
        /**
     * What the partner said they have at onboarding, and which of the
     * options under it they ticked.
     *
     * This is a REQUEST, not a grant. The admin reads it on the approval
     * screen and decides which capabilities to hand over; nothing here
     * puts the partner into a dispatch pool.
     */
    driverClass: {
        type: String,
        // 'parcel_vehicle' is retired (parcel delivery removed); kept for old records.
        enum: ['two_wheeler', 'passenger_taxi', 'parcel_vehicle', ''],
        default: '',
        index: true,
    },
    /**
     * Whatever the admin asked this class of driver for, as uploaded.
     *
     * Keyed by the catalogue entry, so a document added in the panel
     * lands here without a schema change. Deliberately NOT where the four
     * original fields live: aadhar, PAN, licence and the profile photo are
     * read by name all over the admin panel and by every partner that
     * predates this, and moving them would break both.
     */
    onboardingDocuments: [
        {
            _id: false,
            key: { type: String, default: '', trim: true },
            name: { type: String, default: '', trim: true },
            number: { type: String, default: '', trim: true },
            frontUrl: { type: String, default: '', trim: true },
            backUrl: { type: String, default: '', trim: true },
        },
    ],
    serviceIntents: {
        type: [String],
        default: [],
    },
    vehicleType: {
            type: String
        },
        vehicleName: {
            type: String
        },
        vehicleNumber: {
            type: String,
            unique: true,
            sparse: true
        },
        panNumber: {
            type: String
        },
        aadharNumber: {
            type: String
        },
        drivingLicenseNumber: {
            type: String,
            trim: true
        },
        profilePhoto: {
            type: String
        },
        fcmTokens: {
            type: [String],
            default: []
        },
        fcmTokenMobile: {
            type: [String],
            default: []
        },
        aadharPhoto: {
            type: String
        },
        panPhoto: {
            type: String
        },
        drivingLicensePhoto: {
            type: String
        },
        // Vehicle registration certificate (SOW plan §4.11): required at signup
        // for a motorised vehicle. The admin review already reads these names.
        vehicleRcNumber: {
            type: String,
            trim: true
        },
        vehicleRcPhoto: {
            type: String
        },
        /** When payout details last changed: withdrawals pause for 24h after. */
        bankDetailsChangedAt: { type: Date, default: null },
        status: {
            type: String,
            // 'deactivated': removed by an admin. Kept, not deleted, so the
            // wallet, cash owed and order history stay; the app is refused.
            enum: ['pending', 'approved', 'rejected', 'deactivated'],
            default: 'pending'
        },
        rejectionReason: { type: String },
        rejectedAt: { type: Date },
        approvedAt: { type: Date },
        bankAccountHolderName: { type: String },
        bankAccountNumber: { type: String },
        bankIfscCode: { type: String },
        bankName: { type: String },
        upiId: { type: String },
        upiQrCode: { type: String },
        availabilityStatus: {
            type: String,
            enum: ['online', 'offline'],
            default: 'offline'
        },
        // Unified-driver link (Phase 1: set by the backfill; the unified Driver is the source of
        // truth for availability/busy-state once dispatch is migrated). Retired at contract.
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TaxiDriver',
            default: null,
            index: true
        },
        lastLocation: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] }
        },
        lastLat: { type: Number },
        lastLng: { type: Number },
        // Zones the rider has delivered in (core/zones/riderZones.js): with their
        // last location, what shows them to a zone-limited sub-admin.
        zoneIds: { type: [mongoose.Schema.Types.ObjectId], default: [], index: true },
        lastLocationAt: { type: Date },
        referralCode: { type: String, index: true },
        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodDeliveryPartner',
            default: null,
            index: true
        },
        referralCount: { type: Number, default: 0, min: 0 },
        rating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5,
            set: normalizeRatingValue
        },
        totalRatings: { type: Number, default: 0, min: 0 }
    },
    {
        collection: 'food_delivery_partners',
        timestamps: true
    }
);

// Indices
deliveryPartnerSchema.index({ lastLocation: '2dsphere' });

export const FoodDeliveryPartner = mongoose.model('FoodDeliveryPartner', deliveryPartnerSchema);

