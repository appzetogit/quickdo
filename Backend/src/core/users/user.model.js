import mongoose from 'mongoose';

const userAddressSchema = new mongoose.Schema(
    {
        label: {
            type: String,
            enum: ['Home', 'Office', 'Other'],
            default: 'Home',
            index: true
        },
        street: {
            type: String,
            required: true,
            trim: true
        },
        additionalDetails: {
            type: String,
            default: '',
            trim: true
        },
        city: {
            type: String,
            required: true,
            trim: true
        },
        state: {
            type: String,
            required: true,
            trim: true
        },
        zipCode: {
            type: String,
            default: '',
            trim: true
        },
        phone: {
            type: String,
            default: '',
            trim: true
        },
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                // [lng, lat]
                type: [Number],
                default: undefined,
                validate: {
                    validator: (v) =>
                        v === undefined ||
                        (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))),
                    message: 'location.coordinates must be [lng, lat]'
                }
            }
        },
        isDefault: {
            type: Boolean,
            default: false,
            index: true
        }
    },
    { _id: true, timestamps: true }
);

/** A Google or Apple account linked to this user (core/auth/socialAuth.service.js). */
const authProviderSchema = new mongoose.Schema(
    {
        provider: { type: String, enum: ['google', 'apple'], required: true },
        /** The provider's stable user id (the ID token's `sub`). */
        subject: { type: String, required: true, trim: true },
        email: { type: String, default: '', trim: true, lowercase: true },
        emailVerified: { type: Boolean, default: false },
        linkedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const userSchema = new mongoose.Schema(
    {
        /*
         * Required for phone sign-up, which is every account made before email and
         * social sign-in existed. An account made with email + password or with
         * Google / Apple may have none until the customer adds one
         * (POST /auth/user/phone/request-otp + /verify), so the app must ask for it
         * before the first order (auth responses carry needsPhone).
         */
        phone: {
            type: String,
            required: function phoneRequired() {
                return !this.loginEmail && !(this.authProviders && this.authProviders.length);
            },
            trim: true
        },
        countryCode: {
            type: String,
            default: '+91'
        },
        name: {
            type: String
        },
        email: {
            type: String
        },
        profileImage: {
            type: String,
            default: ''
        },
        fcmTokens: {
            type: [String],
            default: []
        },
        fcmTokenMobile: {
            type: [String],
            default: []
        },
        dateOfBirth: {
            type: Date,
            default: null
        },
        anniversary: {
            type: Date,
            default: null
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'other', 'prefer-not-to-say', ''],
            default: ''
        },
        referralCode: {
            type: String
        },
        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            default: null,
            index: true
        },
        referralCount: {
            type: Number,
            default: 0,
            min: 0
        },
        isVerified: {
            type: Boolean,
            default: false
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        },
        role: {
            type: String,
            default: 'USER'
        },
        addresses: {
            type: [userAddressSchema],
            default: []
        },
        isBlockedFromCOD: {
            type: Boolean,
            default: false
        },

        /* ----- Email + password sign-in (core/auth/emailAuth.service.js) ----- */

        /**
         * The address this customer signs in with, lowercased. Separate from
         * `email` (a free-text contact field that was never unique and already
         * holds duplicates), so uniqueness can be enforced on sign-in addresses
         * alone without touching existing data.
         */
        loginEmail: { type: String, trim: true, lowercase: true, default: undefined },
        /** True once the customer proved they own loginEmail with an emailed code (or Google/Apple said so). */
        emailVerified: { type: Boolean, default: false },
        /**
         * bcrypt hash. Not the `password` field: taxi's phone + password sign-in
         * owns that one, and fills it with a random hash for OTP sign-ups.
         */
        passwordHash: { type: String, select: false, default: undefined },
        passwordUpdatedAt: { type: Date, default: undefined },
        /** Wrong passwords in a row; reset by a successful sign-in or a password reset. */
        loginFailures: { type: Number, default: 0, select: false },
        /** Sign-in by password is refused until this time (brute-force lockout). */
        lockedUntil: { type: Date, default: undefined, select: false },

        /** Google / Apple accounts that sign in as this user. */
        authProviders: { type: [authProviderSchema], default: undefined }
    },
    {
        collection: 'users',
        timestamps: true
    }
);

/*
 * Unique among accounts that HAVE a phone. A plain unique index counts a missing
 * phone as null, so it would allow exactly one email- or social-only account.
 * Existing databases carry the old plain index under the same name: run
 * scripts/migrate-users-phone-index.mjs (dry run first) to swap it. Until then,
 * creating a second phone-less account fails with a duplicate-key error.
 * Taxi's model on this same collection declares the identical index.
 */
userSchema.index(
    { phone: 1 },
    { unique: true, partialFilterExpression: { phone: { $type: 'string' } } }
);
userSchema.index(
    { loginEmail: 1 },
    { unique: true, partialFilterExpression: { loginEmail: { $type: 'string' } }, name: 'loginEmail_unique' }
);
userSchema.index(
    { 'authProviders.provider': 1, 'authProviders.subject': 1 },
    { unique: true, partialFilterExpression: { 'authProviders.subject': { $type: 'string' } }, name: 'authProvider_subject_unique' }
);
userSchema.index({ 'addresses.location': '2dsphere' });

export const FoodUser = mongoose.model('FoodUser', userSchema);

