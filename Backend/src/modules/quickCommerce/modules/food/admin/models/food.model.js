import mongoose from 'mongoose';

const foodVariantSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        price: { type: Number, required: true, min: 0 },
        otherPrice: { type: Number, min: 0, default: 0 },
        /** Units on hand for this variant. null = not tracked (always sellable). */
        stockQty: { type: Number, default: null, min: 0 },
        /** Flag to the seller below this. null = no flag. */
        lowStockThreshold: { type: Number, default: null, min: 0 },
        sku: { type: String, trim: true, default: '' },
        /**
         * GST % for this pack size. null = the product's rate (then the
         * order-wide rate). Sizes of one product can sit in different slabs.
         */
        gstRate: { type: Number, default: null, min: 0, max: 100 }
    },
    { _id: true }
);

const foodSchema = new mongoose.Schema(
    {
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCRestaurant', required: true, index: true },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCCategory', index: true },
        categoryName: { type: String, trim: true, default: '' },
        name: { type: String, required: true, trim: true, index: true },
        description: { type: String, trim: true, default: '' },
        price: { type: Number, required: true, min: 0 },
        /**
         * Pre-discount sticker price; `price` stays the selling price.
         * Mirrors the food module -- the admin item screens are shared between
         * food and quick commerce, so both sides must accept these or a save
         * made from the quick-commerce panel would silently drop them.
         * See modules/food/shared/itemDiscountPricing.js.
         */
        basePrice: { type: Number, min: 0, default: null },
        discountPercent: { type: Number, min: 0, max: 100, default: 0 },
        /** Compare-at / other-platform price for strikethrough UI. Existing items stay 0. */
        otherPrice: { type: Number, min: 0, default: 0 },
        /**
         * Whether this dish is sold by its variants.
         *
         * ON: each variant carries its own price (and add-on pairings), and the
         * item's price is the cheapest of them -- the "from" figure a listing
         * shows. OFF: the base price is what is charged, and the variants array
         * is RETAINED rather than cleared, so switching back on does not mean
         * retyping every size. The order path ignores a client-sent variantId
         * while this is off, so a stale cart line is charged the base price
         * instead of failing the order.
         */
        variantsEnabled: { type: Boolean, default: false },
        variants: { type: [foodVariantSchema], default: [] },
        /**
         * The dish's primary image, kept as the first entry of [images].
         *
         * Retained as its own field rather than being derived: every existing
         * document has it, and the user app, admin list, share previews and push
         * payloads all read it. Dropping it would have meant a migration plus a
         * change in four consumers to gain nothing.
         */
        image: { type: String, trim: true, default: '' },

        /**
         * All images for the dish, primary first.
         *
         * Empty on existing documents, which is why every read falls back to
         * `image` rather than assuming this is populated.
         */
        images: { type: [String], default: [] },
        foodType: { type: String, enum: ['Veg', 'Non-Veg'], default: 'Non-Veg' },
        /** Manufacturer, for the grocery listing where two sellers stock the same product. */
        brand: { type: String, trim: true, default: '' },
        /** What one unit is: "500 g", "1 L", "pack of 6". Free text, since packs are not standard. */
        packSize: { type: String, trim: true, default: '' },
        /**
         * The seller's own stock-keeping code.
         *
         * Indexed but deliberately not unique: sellers pick their own codes and
         * two of them will collide, so uniqueness could only ever be per-seller,
         * and enforcing it globally would reject a legitimate second seller.
         */
        sku: { type: String, trim: true, default: '', index: true },
        /**
         * Scanned barcode (EAN/UPC). Distinct from `sku`: a barcode identifies
         * the manufactured product, an SKU identifies the seller's shelf entry,
         * and searching by one must not silently match the other.
         */
        barcode: { type: String, trim: true, default: '', index: true },
        /**
         * Batch expiry. Null means non-perishable or simply not tracked — the
         * two are indistinguishable here and both mean "never flag this".
         *
         * Date, not string, so a range query can find what expires this week.
         */
        expiryDate: { type: Date, default: null, index: true },
        /**
         * How perishable the goods are, which is what the return window is derived
         * from — 7 days ambient, 24 hours chilled, and fresh produce returnable only
         * as a seller-fault report within 4 hours. See returns/services/
         * returnPolicy.service.js.
         *
         * Deliberately separate from expiryDate: a sealed carton of long-life milk
         * has an expiry date months out and is still `chilled`, while a loose bunch
         * of bananas has no printed date and is `fresh`. Shelf life and returnability
         * are different questions.
         *
         * Defaults to ambient because that is what most of a grocery catalogue is,
         * and because the existing rows predate this field — a stricter default would
         * silently make every legacy product non-returnable.
         */
        perishability: {
            type: String,
            enum: ['ambient', 'chilled', 'fresh'],
            default: 'ambient',
            index: true,
        },
        /**
         * Printed maximum retail price, shown struck through next to `price`.
         *
         * Kept separate from `otherPrice`, which is a compare-at price against
         * other platforms. Selling above MRP is illegal, so this one is a
         * constraint, not a marketing number, and conflating them would make
         * that check impossible to write.
         */
        mrp: { type: Number, min: 0, default: null },
        /**
         * GST percentage for this product. Groceries span 0/5/12/18, so the
         * single order-wide rate the food flow used is wrong here.
         *
         * `null` falls back to the order-wide rate in fee settings, which is
         * what every item created before this field existed does.
         */
        gstRate: { type: Number, min: 0, max: 100, default: null },
        isAvailable: { type: Boolean, default: true, index: true },
        /**
         * Units on hand. `null` means untracked — the item behaves exactly as it
         * did before inventory existed, which is what every already-created
         * document gets, so nothing needs a migration to keep selling.
         *
         * Tracked at item level, not per variant: a variant is a pack size, and
         * a seller counting "12 left" is counting the item.
         * ponytail: per-variant stock if sellers start listing sizes that
         * genuinely deplete independently.
         */
        stockQty: { type: Number, default: null, min: 0 },
        /** Below this, the item is flagged to the seller. `null` disables the flag. */
        lowStockThreshold: { type: Number, default: null, min: 0 },
        /** Cap per single order, so one buyer cannot clear the shelf. `null` = uncapped. */
        maxQtyPerOrder: { type: Number, default: null, min: 1 },
        /** Running average of per-dish ratings left by customers. */
        rating: { type: Number, default: 0, min: 0, max: 5 },
        totalRatings: { type: Number, default: 0, min: 0 },
        /** When set, item auto-restores to available after this time (server-side). */
        stockResumeAt: { type: Date, index: true },
        stockOffMode: {
            type: String,
            enum: ['manual', 'specific-time', 'next-business-day', 'custom-date-time'],
            default: undefined
        },
        isRecommended: { type: Boolean, default: false, index: true },
        preparationTime: { type: String, trim: true, default: '' },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
        rejectionReason: { type: String, trim: true, default: '' },
        requestedAt: { type: Date },
        approvedAt: { type: Date },
        rejectedAt: { type: Date }
    },
    {
        collection: 'food_items',
        timestamps: true
    }
);

foodSchema.index({ restaurantId: 1, createdAt: -1 });
foodSchema.index({ approvalStatus: 1, createdAt: -1 });
foodSchema.index({ approvalStatus: 1, requestedAt: -1 });
foodSchema.index({ restaurantId: 1, approvalStatus: 1, createdAt: -1 });

export const FoodItem = mongoose.models.QCItem || mongoose.model('QCItem', foodSchema, 'qc_items');
