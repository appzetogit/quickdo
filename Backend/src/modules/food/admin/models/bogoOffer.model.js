import mongoose from 'mongoose';

/**
 * A restaurant's "buy one, get one free" dishes.
 *
 * One document per restaurant holding every row, rather than one document per
 * dish: both panels edit the whole list as a single form, and keeping it together
 * means saving it is one atomic write instead of a create/update/delete
 * reconciliation that can half-apply. Same shape, and the same reasoning, as the
 * spend-threshold freebie ladder next door.
 *
 * Kept out of the FoodItem document on purpose. A dish on offer this fortnight is
 * a promotion with its own lifecycle, and storing it on the item would mean the
 * menu forms, the bulk uploader and the approval workflow all had to learn about
 * a field none of them own.
 */
const bogoOfferItemSchema = new mongoose.Schema(
    {
        itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', required: true },
        /** Buy N, get M. Defaults are the classic offer, which is what nearly everyone configures. */
        buyQty: { type: Number, default: 1, min: 1 },
        getQty: { type: Number, default: 1, min: 1 },
        /**
         * Free units this dish may give away on a single order, across every
         * variant of it. Null means uncapped; the cap exists so one 40-unit order
         * cannot empty a kitchen the restaurant expected to serve all evening.
         */
        maxFreeUnitsPerOrder: { type: Number, default: null, min: 1 },
        /** Optional run window. Absent means always on; the end is exclusive. */
        startDate: { type: Date, default: null },
        endDate: { type: Date, default: null },
    },
    { _id: true }
);

const bogoOfferSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true,
            unique: true,
            index: true,
        },
        /**
         * A restaurant that has configured rows but switched the promotion off
         * should keep them, so turning it back on does not mean rebuilding the
         * list.
         */
        isActive: { type: Boolean, default: true, index: true },
        offers: { type: [bogoOfferItemSchema], default: [] },
        /** Which panel last saved it -- both admin and the restaurant can edit. */
        updatedByRole: { type: String, enum: ['ADMIN', 'RESTAURANT'], default: 'RESTAURANT' },
    },
    {
        collection: 'food_bogo_offers',
        timestamps: true,
    }
);

export const FoodBogoOffer =
    mongoose.models.FoodBogoOffer || mongoose.model('FoodBogoOffer', bogoOfferSchema);
