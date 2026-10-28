import mongoose from 'mongoose';

/**
 * One favourited restaurant or dish.
 *
 * Stored as its own collection rather than arrays on FoodUser so a favourite can be
 * added or removed with a single atomic write, without reading and rewriting a list
 * that grows unbounded — and so rapid taps cannot interleave into a lost update.
 */
const userFavoriteSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCUser',
            required: true,
            index: true
        },

        entityType: {
            type: String,
            enum: ['restaurant', 'food'],
            required: true
        },

        entityId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        }
    },
    { collection: 'food_user_favorites', timestamps: true }
);

/**
 * The duplicate guard.
 *
 * A double-tapped heart fires two adds; without this the second would insert a
 * second row and removing once would leave the item still favourited. With it the
 * second insert collides and is treated as already-favourited, which is the correct
 * outcome and needs no client-side debounce to be safe.
 */
userFavoriteSchema.index(
    { userId: 1, entityType: 1, entityId: 1 },
    { unique: true }
);

// Serves the listing: everything a user favourited, newest first.
userFavoriteSchema.index({ userId: 1, entityType: 1, createdAt: -1 });

export const FoodUserFavorite = mongoose.models.QCUserFavorite || mongoose.model('QCUserFavorite', userFavoriteSchema, 'qc_user_favorites');
