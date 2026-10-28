import mongoose from 'mongoose';

/**
 * Audit trail for global menu price adjustments.
 *
 * The adjustment is applied as a real write to every matched FoodItem rather
 * than as a multiplier read at display time. That is deliberate: prices are
 * read by the menu, the cart, checkout, and the invoice through several
 * separate code paths, and a read-time multiplier that any one of them missed
 * would show the customer one price and charge them another.
 *
 * This log exists so an adjustment can be reviewed and reverted.
 */
const priceAdjustmentSchema = new mongoose.Schema(
    {
        /** Signed percent applied, e.g. 10 for +10%, -15 for a 15% cut. */
        percent: { type: Number, required: true },
        /** Multiplier actually used (1 + percent/100). Stored so a revert is exact. */
        factor: { type: Number, required: true, min: 0 },
        /**
         * Which number the run moved: the struck-through comparison figure, or
         * what customers are actually charged. Recorded because the history is
         * unreadable without it -- '+20%' means very different things.
         * Rows written before this default to 'price', which is what they did.
         */
        // 'formulation' is what every run records now: it stores a percent and
        // derives everything from basePrice. The older two named which field a
        // run multiplied, and remain only so historic rows still read and revert.
        target: { type: String, enum: ['formulation', 'price', 'otherPrice'], default: 'formulation' },
        /*
         * How the run wrote, and therefore how it must be undone.
         *
         * 'scale'    multiplies base and selling together; reverted by replaying
         *            the inverse factor, which needs nothing stored.
         * 'markdown' promotes the selling price to the strike-through so the cut
         *            is visible; this OVERWRITES the previous base price, so it
         *            is reverted from a snapshot instead.
         *
         * Rows written before this field default to 'scale', which is what they
         * all were.
         */
        // Likewise: 'scale' and 'markdown' were the two ways a run applied a
        // factor, and revert still branches on them for rows that predate this.
        strategy: { type: String, enum: ['formulation', 'scale', 'markdown'], default: 'formulation' },
        /** Null means the adjustment covered every restaurant. */
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', default: null },
        restaurantName: { type: String, trim: true, default: 'All restaurants' },
        itemsUpdated: { type: Number, default: 0 },
        // How many of those were held at their MRP instead of taking the full
        // percentage. Recorded so the history explains a run that did less than
        // the percent suggests.
        itemsCappedByMrp: { type: Number, default: 0 },
        /** Set when this entry is itself the undo of an earlier adjustment. */
        revertsAdjustmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodPriceAdjustment', default: null },
        isReverted: { type: Boolean, default: false },
        appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        appliedByName: { type: String, trim: true, default: '' }
    },
    { collection: 'food_price_adjustments', timestamps: true }
);

priceAdjustmentSchema.index({ createdAt: -1 });

export const FoodPriceAdjustment = mongoose.model('FoodPriceAdjustment', priceAdjustmentSchema);
