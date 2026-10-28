import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true
        },
        token: {
            type: String,
            required: true,
            unique: true
        },
        device: {
            type: String,
            required: false,
            default: null
        },
        ipAddress: {
            type: String,
            required: false,
            default: null
        },
        expiresAt: {
            type: Date,
            required: true
        }
    },
    {
        collection: 'food_refresh_tokens',
        timestamps: true
    }
);

// TTL index for automatic expiration
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const FoodRefreshToken = mongoose.model('FoodRefreshToken', refreshTokenSchema);

/**
 * Quick commerce's refresh tokens, from the SAME schema, in their OWN collection.
 *
 * The fork's copy of this file was byte-identical to this one apart from the
 * registration line, so the schema is shared and that copy is gone.
 *
 * The COLLECTION deliberately is not. `qc_refresh_tokens` holds every live
 * quick-commerce session; pointing those lookups at `food_refresh_tokens` would
 * log out every QC customer, restaurant and rider the moment it deployed. The
 * duplication worth removing here is the code, not the data.
 *
 * Merging the two collections is a later, deliberate step with a migration and a
 * chosen moment -- not a side effect of deleting a duplicate file.
 */
export const QCRefreshToken =
    mongoose.models.QCRefreshToken
    || mongoose.model('QCRefreshToken', refreshTokenSchema, 'qc_refresh_tokens');

