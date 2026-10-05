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
        vehicleType: {
            type: String
        },
        vehicleName: {
            type: String
        },
        vehicleNumber: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
            uppercase: true
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
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'deactivated'],
            default: 'pending'
        },
        /**
         * The unified TaxiDriver this partner belongs to.
         *
         * Quick-commerce forked from food before driver unification, so this pool
         * had no link back to the shared identity: a driver could hold the
         * quickCommerce capability and still never be gated by their cross-service
         * busy-lock, which is how the same person gets handed a ride and a grocery
         * order at once. null means not yet linked, and dispatch keeps those
         * partners rather than dropping them.
         */
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TaxiDriver',
            default: null,
            index: true
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
            ref: 'QCDeliveryPartner',
            default: null,
            index: true
        },
        referralCount: { type: Number, default: 0, min: 0 },
        // Admin-defined dynamic registration answers, keyed by field.key.
        customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
        // Admin-defined document uploads, keyed by field.key → stored URL.
        customDocuments: { type: mongoose.Schema.Types.Mixed, default: {} },
        rating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5,
            set: normalizeRatingValue
        },
        totalRatings: { type: Number, default: 0, min: 0 },
        // Lifetime count of completed deliveries, shown on the customer tracking screen.
        totalDeliveries: { type: Number, default: 0, min: 0 },
        /**
         * Bumped on every successful login, and embedded in the JWT that login
         * issues. A token whose version is behind the stored one is rejected, so
         * signing in on a new device silently invalidates every older device
         * rather than leaving the account live in two places at once.
         */
        tokenVersion: { type: Number, default: 0 }
    },
    {
        collection: 'food_delivery_partners',
        timestamps: true
    }
);

// Indices
deliveryPartnerSchema.index({ lastLocation: '2dsphere' });

export const FoodDeliveryPartner = mongoose.models.QCDeliveryPartner || mongoose.model('QCDeliveryPartner', deliveryPartnerSchema, 'qc_delivery_partners');

