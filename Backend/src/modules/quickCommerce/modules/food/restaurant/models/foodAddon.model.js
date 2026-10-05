import mongoose from 'mongoose';

const addonPayloadSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        description: { type: String, trim: true, default: '' },
        foodType: { type: String, enum: ['veg', 'non-veg'], default: 'veg' },
        price: { type: Number, required: true, min: 0 },
        image: { type: String, trim: true, default: '' },
        images: { type: [String], default: [] }
    },
    { _id: false }
);

/**
 * Grouping + selection rules, so the user app can render the Zomato-style item
 * sheet ("Upgrade Your Base — Select up to 1 option") instead of a flat list.
 *
 * Stored on each add-on rather than in its own collection, and the public endpoint
 * derives the groups by name. That keeps this to one migration-free field, at the
 * cost of the rules being repeated across a group's members — so treat the lowest
 * sortOrder member as authoritative when they disagree (see buildAddonGroups).
 */
const addonGroupSchema = new mongoose.Schema(
    {
        /** Empty = ungrouped; the app shows these under a generic "Add-ons" heading. */
        name: { type: String, trim: true, default: '' },
        /** > 0 makes the group mandatory before the item can be added to the cart. */
        minSelect: { type: Number, min: 0, default: 0 },
        /** 1 renders radio buttons, >1 renders checkboxes capped at this count. */
        maxSelect: { type: Number, min: 1, default: 1 },
        sortOrder: { type: Number, default: 0 }
    },
    { _id: false }
);

const foodAddonSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCRestaurant',
            required: true,
            index: true
        },
        // Menu items this add-on can be attached to.
        //
        // EMPTY MEANS RESTAURANT-WIDE, which is how every add-on behaved before this
        // field existed — so old documents keep working untouched.
        //
        // Deliberately top-level rather than inside draft/published: admin approval
        // exists to moderate content (name, price, image), and attaching an approved
        // "Extra cheese" to a newly added burger is not a content change. Putting it
        // in the draft would send the add-on back to pending every time the menu
        // changed.
        foodIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'QCItem' }],
            default: []
        },
        // Presentation only, like foodIds — not moderated content, so changing it
        // must not push the add-on back to pending.
        group: { type: addonGroupSchema, default: () => ({}) },
        // Draft is what restaurant is editing and what admin approves/rejects.
        draft: { type: addonPayloadSchema, required: true },
        // Published is what the user app can see (kept while draft is pending).
        published: { type: addonPayloadSchema, default: null },
        approvalStatus: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
            index: true
        },
        rejectionReason: { type: String, trim: true, default: '' },
        requestedAt: { type: Date, default: null, index: true },
        approvedAt: { type: Date, default: null },
        rejectedAt: { type: Date, default: null },
        // Operational toggle controlled by restaurant; user app filters on this.
        isAvailable: { type: Boolean, default: true, index: true },
        // Soft delete for safety + auditability.
        isDeleted: { type: Boolean, default: false, index: true }
    },
    { collection: 'food_addons', timestamps: true }
);

foodAddonSchema.index({ restaurantId: 1, isDeleted: 1, createdAt: -1 });
// Serves the user app's per-item lookup: approved + available + attached to this item.
foodAddonSchema.index({ restaurantId: 1, foodIds: 1, approvalStatus: 1, isAvailable: 1 });
foodAddonSchema.index({ approvalStatus: 1, isDeleted: 1, requestedAt: -1 });
foodAddonSchema.index({ restaurantId: 1, approvalStatus: 1, isDeleted: 1, requestedAt: -1 });

export const FoodAddon = mongoose.models.QCAddon || mongoose.model('QCAddon', foodAddonSchema, 'qc_addons');
