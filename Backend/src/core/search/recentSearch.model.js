import mongoose from 'mongoose';

/**
 * A customer's recent searches (plan §5.5), newest first, per vertical. One
 * row per customer and vertical holding a short capped list, so reading it is
 * one indexed lookup.
 */
const recentSearchSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true },
        vertical: { type: String, required: true },
        terms: {
            type: [new mongoose.Schema({ term: String, at: Date }, { _id: false })],
            default: [],
        },
    },
    { collection: 'recent_searches', timestamps: true },
);
recentSearchSchema.index({ userId: 1, vertical: 1 }, { unique: true });

export const RecentSearch = mongoose.models.RecentSearch || mongoose.model('RecentSearch', recentSearchSchema);
