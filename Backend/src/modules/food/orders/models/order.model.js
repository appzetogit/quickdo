import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        variantId: { type: String, trim: true, default: '' },
        variantName: { type: String, trim: true, default: '' },
        variantPrice: { type: Number, min: 0, default: 0 },
        price: { type: Number, required: true, min: 0 },
        quantity: { type: Number, required: true, min: 1 },
        isVeg: { type: Boolean, default: true },
        image: { type: String, default: '' },
        notes: { type: String, default: '' },
        /** Per-unit packaging charge at order time (RESTAURANT packaging mode). */
        foodPackagingCharge: { type: Number, min: 0, default: 0 },
        /**
         * Add-ons chosen for this line, snapshotted at order time.
         *
         * Name and price are copied rather than referenced: an add-on renamed or
         * repriced next week must not change what this customer was shown and
         * charged, and the kitchen needs the name even if the add-on is later
         * deleted.
         *
         * Priced PER UNIT of the item, like foodPackagingCharge above -- two
         * burgers with extra cheese is two lots of cheese.
         */
        addons: {
            type: [new mongoose.Schema({
                addonId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAddon', required: true },
                name: { type: String, required: true, trim: true },
                /** Per piece; the line pays price x quantity for it. */
                price: { type: Number, required: true, min: 0 },
                /** "Ketchup x2" is 2. Absent on older orders, which is 1. */
                quantity: { type: Number, min: 1, default: 1 },
            }, { _id: false })],
            default: [],
        },
        /** Per-unit total of the add-ons above, stamped so pricing never re-derives it. */
        addonsTotal: { type: Number, min: 0, default: 0 },
        /**
         * A spend-threshold reward the server added, not something the customer
         * put in the cart. Stored so the kitchen knows to send it, the invoice
         * can say why a line costs nothing, and support can tell a genuine
         * freebie from an item mistakenly priced at zero.
         */
        isFreebie: { type: Boolean, default: false },
        freebie: {
            minOrderValue: { type: Number, min: 0, default: 0 },
            rewardType: { type: String, enum: ['item', 'addon'], default: 'item' },
        },
        /**
         * The free half of a buy-one-get-one line, split off the paid half at
         * pricing time. Stored for the same reasons as isFreebie above -- the
         * kitchen has to make it, the invoice has to say why it costs nothing, and
         * support has to be able to tell a granted free unit from a dish somebody
         * mispriced at zero.
         *
         * The paid and free halves are separate lines of the same dish, so an
         * order showing "Margherita x1 at 200" and "Margherita x1 at 0" is one
         * customer receiving two pizzas, not a duplicate.
         */
        isBogoFree: { type: Boolean, default: false },
        bogo: {
            buyQty: { type: Number, min: 1, default: 1 },
            getQty: { type: Number, min: 1, default: 1 },
            sourceItemId: { type: String, trim: true, default: '' },
        },
        /**
         * A combo: several dishes sold as one line at one fixed price.
         *
         * The components are copied onto the order rather than looked up later,
         * for the same reason the add-on snapshot above exists -- the kitchen has
         * to be able to make what was actually sold, and a combo whose components
         * were renamed, repriced or deleted next month must still print correctly
         * on an invoice raised today.
         *
         * `allocatedLineTotal` is that component's share of the combo price, split
         * pro-rata by list price. The shares sum to the line price, so per-dish
         * reporting adds up to exactly what the customer paid.
         */
        isCombo: { type: Boolean, default: false },
        comboComponents: {
            type: [new mongoose.Schema(
                {
                    itemId: { type: String, trim: true, default: '' },
                    variantId: { type: String, trim: true, default: '' },
                    quantity: { type: Number, min: 1, default: 1 },
                    name: { type: String, trim: true, default: '' },
                    variantName: { type: String, trim: true, default: '' },
                    listUnitPrice: { type: Number, min: 0, default: 0 },
                    allocatedLineTotal: { type: Number, min: 0, default: 0 }
                },
                { _id: false }
            )],
            default: []
        }
    },
    { _id: false }
);

const deliveryAddressSchema = new mongoose.Schema(
    {
        label: { type: String, enum: ['Home', 'Office', 'Other'], default: 'Home', set: (v) => (v == null || v === '' ? v : ({ home: 'Home', office: 'Office', work: 'Office' }[String(v).trim().toLowerCase()] || 'Other')) },
        name: { type: String, default: '', trim: true },
        fullName: { type: String, default: '', trim: true },
        street: { type: String, required: true, trim: true },
        additionalDetails: { type: String, default: '', trim: true },
        city: { type: String, required: true, trim: true },
        state: { type: String, required: true, trim: true },
        zipCode: { type: String, default: '', trim: true },
        phone: { type: String, default: '', trim: true },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: undefined }
        }
    },
    { _id: false }
);

const pricingSchema = new mongoose.Schema(
    {
        subtotal: { type: Number, required: true, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        deliveryFeeBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
        adminDeliveryCommissionEnabled: { type: Boolean, default: false },
        adminDeliveryCommissionPercent: { type: Number, default: 0, min: 0, max: 100 },
        adminDeliveryCommissionAmount: { type: Number, default: 0, min: 0 },
        riderDeliveryEarningAfterAdminCommission: { type: Number, default: 0, min: 0 },
        deliveryPartnerIncentiveEnabled: { type: Boolean, default: false },
        deliveryPartnerIncentivePercent: { type: Number, default: 0, min: 0, max: 100 },
        deliveryPartnerIncentiveAmount: { type: Number, default: 0, min: 0 },
        deliveryPartnerIncentiveEligible: { type: Boolean, default: false },
        platformFee: { type: Number, default: 0, min: 0 },
        surgeAmount: { type: Number, default: 0, min: 0 },
        restaurantCommission: { type: Number, default: 0, min: 0 },
        /**
         * Which model this order was billed under, captured when it was placed.
         *
         * No default, for the same reason as commissionableAmount below: an
         * order written before this field existed must fall through to the live
         * setting, and a `default: 'commission'` would be indistinguishable from
         * one deliberately stamped as commission. The payout path reads it in
         * preference to the platform setting, so switching the platform to plan
         * billing cannot retroactively zero the commission on orders already
         * placed -- nor charge commission on orders taken while it was off.
         */
        monetizationMode: { type: String, enum: ['commission', 'plan'] },
        discount: { type: Number, default: 0, min: 0 },
        /**
         * Whether the PLATFORM funded the coupon rather than the restaurant.
         *
         * Decides what GST was charged on (shared/billing.js): a platform-funded
         * coupon leaves the restaurant paid in full, so the supply is still
         * worth the pre-coupon amount and the tax is due on it.
         *
         * Declared here for the same reason `couponCode` above had to be: the
         * schema is strict, so a field the services set but the model does not
         * name is dropped on every save. Undefined on orders placed before this
         * existed, which read back as the older treatment and are not re-taxed.
         */
        discountFundedByPlatform: { type: Boolean },
        /**
         * What the buy-one-get-one units were worth.
         *
         * Recorded, not deducted: the free units were already split onto
         * zero-priced lines before `subtotal` was summed, so this is what the
         * customer saved rather than something still to come off the total.
         * Stored so an invoice or a report can say so without re-pricing the
         * order against offers that may since have changed.
         */
        bogoSavings: { type: Number, default: 0, min: 0 },
        /**
         * The customer's bill, line by line, exactly as it was shown.
         *
         * Stored rather than recomputed because every input can move -- the GST
         * rate, the platform fee, the restaurant's inclusive/exclusive setting.
         * A bill re-derived months later from today's settings would not be the
         * bill anyone agreed to. Mixed because its shape belongs to
         * shared/billing.js, which is where it is checked.
         */
        bill: { type: mongoose.Schema.Types.Mixed, default: null },
        /**
         * What restaurant commission is charged on: the food net of GST.
         *
         * Equal to `subtotal` for a restaurant that prices net, which is the
         * default. Smaller for one whose menu prices include GST, because the
         * tax inside those prices is collected for the government and taking a
         * commission percentage of it would be taking a cut of tax.
         */
        /*
         * No default, deliberately. The payout job reads this as
         * `commissionableAmount ?? subtotal` so an order placed before the
         * field existed still gets commissioned on its food. A `default: 0`
         * would hand a hydrated legacy order a 0 that is not nullish, kill the
         * fallback, and charge that restaurant commission on nothing -- while
         * crediting it nothing too.
         */
        commissionableAmount: { type: Number, min: 0 },
        pricesIncludeGst: { type: Boolean, default: false },
        /** How much of the food total already contained its tax, per dish. */
        gstInclusiveItemAmount: { type: Number, default: 0, min: 0 },
        /**
         * Who the packaging charge belongs to: 'RESTAURANT' for a per-item
         * charge the restaurant set, 'ADMIN' for the platform's flat one.
         *
         * The payout ledger reads it. Without it the restaurant was credited a
         * charge the platform had kept.
         */
        packagingMode: { type: String, default: '', trim: true },
        /*
         * The food and packaging lines as printed, net of the GST beside them.
         *
         * No defaults, for the same reason as commissionableAmount above.
         * netPackagingFee is read as `?? packagingFee` on the payout path, and
         * netItemAmount decides the printed food line -- a hydrated 0 would
         * serialise a legacy order with a Rs 0 item row where a lean read of the
         * same document omits the field and lets the client fall back.
         */
        netItemAmount: { type: Number, min: 0 },
        netPackagingFee: { type: Number, min: 0 },
        /*
         * No default: legacy orders WERE taxed, at a rate resolved from fee
         * settings long before this field existed. A hydrated 0 would assert a
         * zero-rated order that never happened, and a bill would print it.
         */
        gstRate: { type: Number, min: 0, max: 100 },
        /*
         * These four keep `default: 0`, and the difference is worth stating:
         * for them 0 is the true historical value rather than a guess. A legacy
         * order's charged total was built from six terms that included none of
         * the platform-fee GST, the tip or the round-off, so it genuinely had
         * none of them.
         */
        platformFeeGst: { type: Number, default: 0, min: 0 },
        platformFeeGstRate: { type: Number, default: 0, min: 0, max: 100 },
        /** The rider's money, never taxed and never commissioned. */
        tip: { type: Number, default: 0, min: 0 },
        /** Signed: the grand total is rounded up as often as down. */
        roundOff: { type: Number, default: 0 },
        /*
         * No default. Here 0 would not merely be unknown, it would be false: a
         * legacy order had no tip and no round-off, so its true totalBeforeTip
         * is its total.
         */
        totalBeforeTip: { type: Number, min: 0 },
        total: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'INR' },
        /**
         * Which coupon paid for the discount.
         *
         * Set by order.service.js since coupons existed, but never declared
         * here -- so the strict schema dropped both on every save, and the
         * payout ledger's attribution branch, which keys off couponCode, could
         * never fire. Without it a restaurant-funded discount came out of
         * nobody's share.
         */
        couponCode: { type: String, default: null, trim: true },
        appliedCoupon: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    { _id: false }
);

const paymentSchema = new mongoose.Schema(
    {
        method: {
            type: String,
            enum: ['cash', 'razorpay', 'razorpay_qr', 'wallet'],
            required: true
        },
        status: {
            type: String,
            enum: [
                'cod_pending',
                'created',
                'authorized',
                'paid',
                'failed',
                'refunded',
                'pending_qr'
            ],
            default: 'cod_pending'
        },
        amountDue: { type: Number, min: 0 },
        razorpay: {
            orderId: { type: String },
            paymentId: { type: String },
            signature: { type: String }
        },
        qr: {
            qrId: { type: String },
            imageUrl: { type: String },
            paymentLinkId: { type: String },
            shortUrl: { type: String },
            status: { type: String },
            expiresAt: { type: Date }
        },
        // ✅ NEW: Added refund object to track refund status without breaking existing flow
        refund: {
            status: { 
                type: String, 
                enum: ['none', 'pending', 'processed', 'failed'], 
                default: 'none' 
            },
            amount: { type: Number, default: 0 },
            refundId: { type: String, default: '' },
            processedAt: { type: Date }
        }
    },
    { _id: false }
);

const dispatchSchema = new mongoose.Schema(
    {
        modeAtCreation: { type: String, enum: ['auto'], default: 'auto' },
        status: {
            type: String,
            enum: ['unassigned', 'assigned', 'accepted', 'rejected', 'cancelled'],
            default: 'unassigned'
        },
        deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', default: null },
        assignedAt: { type: Date },
        acceptedAt: { type: Date },
        /** List of partners who were offered this order (to avoid repeats and track timeouts) */
        offeredTo: [{
            partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner' },
            at: { type: Date, default: Date.now },
            action: { type: String, enum: ['offered', 'rejected', 'timeout'], default: 'offered' }
        }],
        dispatchingAt: { type: Date },
        /*
         * Manual assignment (core/delivery/manualAssign.js). 'manual' while an
         * admin's pick is waiting on that rider: auto-dispatch leaves the order
         * alone until manualDeadlineAt, after which the expiry sweep hands it
         * back. Reset to 'auto' whenever the order returns to the pool.
         */
        assignMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
        assignedBy: {
            adminId: { type: mongoose.Schema.Types.ObjectId, default: null },
            name: { type: String, default: '' },
            at: { type: Date, default: null }
        },
        manualDeadlineAt: { type: Date }
    },
    { _id: false }
);

const deliveryStateSchema = new mongoose.Schema(
    {
        currentPhase: {
            type: String,
            enum: [
                'en_route_to_pickup',
                'at_pickup',
                'en_route_to_delivery',
                'at_drop',
                'delivered',
                'completed'
            ],
            default: 'en_route_to_pickup'
        },
        status: { type: String, default: '' },
        reachedPickupAt: { type: Date, default: null },
        reachedDropAt: { type: Date, default: null },
        pickedUpAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null }
    },
    { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
    {
        at: { type: Date, default: Date.now },
        byRole: { type: String, enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN', 'SYSTEM'] },
        byId: { type: mongoose.Schema.Types.ObjectId },
        from: { type: String },
        to: { type: String },
        note: { type: String, default: '' }
    },
    { _id: false }
);

const orderEntityRatingSchema = new mongoose.Schema(
    {
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String, default: '', trim: true },
        ratedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const orderRatingsSchema = new mongoose.Schema(
    {
        restaurant: { type: orderEntityRatingSchema, default: undefined },
        deliveryPartner: { type: orderEntityRatingSchema, default: undefined },
        /** The CUSTOMER, rated by the delivery partner after handover. */
        customer: { type: orderEntityRatingSchema, default: undefined }
    },
    { _id: false }
);

const deliveryVerificationSchema = new mongoose.Schema(
    {
        dropOtp: {
            required: { type: Boolean, default: false },
            verified: { type: Boolean, default: false }
        }
    },
    { _id: false }
);

const orderSchema = new mongoose.Schema(
    {
        order_id: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        /** Compatibility alias: satisfies rogue unique index 'orderId_1' found in legacy deployments. */
        orderId: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            required: true
        },
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true
        },
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            index: true
        },
        transactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodTransaction',
            index: true
        },
        items: {
            type: [orderItemSchema],
            required: true,
            validate: (v) => Array.isArray(v) && v.length > 0
        },
        deliveryAddress: {
            type: deliveryAddressSchema,
            required: true
        },
        customerName: { type: String, default: '', trim: true },
        customerPhone: { type: String, default: '', trim: true },
        pricing: {
            type: pricingSchema,
            required: false
        },
        /**
         * Denormalized payment snapshot for fast reads & legacy clients.
         * Authoritative audit trail: collection `food_order_payments` (FoodOrderPayment model).
         */
        payment: {
            type: paymentSchema,
            required: false
        },
        orderStatus: {
            type: String,
            enum: [
                'pending_payment',
                'created',
                'confirmed',
                'preparing',
                'ready_for_pickup',
                'reached_pickup',
                'picked_up',
                'reached_drop',
                'delivered',
                'cancelled_by_user',
                'cancelled_by_restaurant',
                'cancelled_by_admin'
            ],
            default: 'created'
        },
        dispatch: {
            type: dispatchSchema,
            default: () => ({})
        },
        deliveryState: {
            type: deliveryStateSchema,
            default: () => ({})
        },
        statusHistory: {
            type: [statusHistorySchema],
            default: []
        },
        ratings: {
            type: orderRatingsSchema,
            default: () => ({})
        },
        note: { type: String, default: '', trim: true },
        // The customer's selection off the admin-configured chip list
        // (`FoodDeliveryInstruction`) — free text picked from that list, not a
        // reference to it, so a later edit/removal of an option never rewrites
        // history on orders already placed with it.
        deliveryInstructions: { type: [String], default: [] },
        sendCutlery: { type: Boolean, default: true },
        deliveryFleet: { type: String, default: 'standard', trim: true },
        scheduledAt: { type: Date, default: null },
        riderBasePay: { type: Number, default: 0, min: 0 },
        riderSurgePay: { type: Number, default: 0, min: 0 },
        riderDeliveryFeeShare: { type: Number, default: 0, min: 0 },
        riderIncentivePay: { type: Number, default: 0, min: 0 },
        riderTotalPayout: { type: Number, default: 0, min: 0 },
        riderEarning: { type: Number, default: 0, min: 0 },
        // The hold before the restaurant sees a new order (core/orders/orderHold.js):
        // when it ends, and when the order was actually released to the restaurant.
        restaurantReleaseAt: { type: Date, default: null },
        restaurantReleasedAt: { type: Date, default: null },
        // Mirrors the ledger's platformNetProfit and, like it, can be negative:
        // an order on free delivery or a platform-funded coupon costs the
        // platform money, and a floor at 0 only stopped that being recorded.
        platformProfit: { type: Number, default: 0 },
        /**
         * Where this order's coupon stands in the offer's usage count: `pending`
         * for an online order not yet paid, `counted` once it is, and `released`
         * after a cancellation gives it back. Unset when there is no coupon, and
         * on orders placed before this existed, which were counted at placement
         * and are left alone. See services/couponUsage.service.js.
         */
        couponUsage: { type: String, enum: ['pending', 'counted', 'released'] },
        /** Plain 4-digit OTP for handover; cleared after successful verify (never expose to partner in API responses). */
        deliveryOtp: { type: String, default: '', select: false },
        deliveryVerification: {
            type: deliveryVerificationSchema,
            default: () => ({})
        },
        /** Latest rider location for this specific order (GeoJSON Point) */
        lastRiderLocation: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] }
        },
        /** PetPooja POS invoice data captured on successful sync */
        petpooja: {
            orderId: { type: String, default: '' },
            invoiceNo: { type: String, default: '' },
            invoiceUrl: { type: String, default: '' }
        }
    },
    {
        collection: 'food_orders',
        timestamps: true
    }
);

orderSchema.index({ 'deliveryAddress.location': '2dsphere' });
orderSchema.index({ lastRiderLocation: '2dsphere' });
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, orderStatus: 1, createdAt: -1 });
orderSchema.index({ 'dispatch.deliveryPartnerId': 1, orderStatus: 1 });
orderSchema.index({ 'dispatch.status': 1, orderStatus: 1 });
orderSchema.index({ 'dispatch.status': 1, orderStatus: 1, updatedAt: -1 });
orderSchema.index({ 'dispatch.deliveryPartnerId': 1, 'dispatch.status': 1, updatedAt: -1 });
// The manual-assignment expiry sweep (core/delivery/manualAssign.js), every 30s.
orderSchema.index({ 'dispatch.assignMode': 1, 'dispatch.status': 1, 'dispatch.manualDeadlineAt': 1 });
orderSchema.index({ 'payment.status': 1, createdAt: -1 });
orderSchema.index({ 'payment.method': 1, createdAt: -1 });

// A GeoJSON Point with no coordinates is rejected by the 2dsphere index
// ("Can't extract geo keys"), which made order creation fail for any address that
// lacked coordinates. location.type defaults to 'Point' while coordinates does not,
// so strip the whole sub-object unless we have a valid [lng, lat] pair.
orderSchema.pre('save', function (next) {
    const loc = this.deliveryAddress?.location;
    if (loc && (!Array.isArray(loc.coordinates) || loc.coordinates.length !== 2
        || loc.coordinates.some((n) => typeof n !== 'number' || !Number.isFinite(n)))) {
        this.deliveryAddress.location = undefined;
    }
    const rider = this.lastRiderLocation;
    if (rider && (!Array.isArray(rider.coordinates) || rider.coordinates.length !== 2)) {
        this.lastRiderLocation = undefined;
    }
    next();
});

orderSchema.pre('save', async function (next) {
    if (!this.order_id) {
        const timestamp = Date.now().toString().slice(-4);
        const random = Math.floor(100 + Math.random() * 900);
        this.order_id = `FOD-${timestamp}${random}`;
    }
    // Synchronize camelCase alias to satisfy unique index 'orderId_1'
    if (this.order_id) {
        this.orderId = this.order_id;
    }
    next();
});

export const FoodOrder = mongoose.model('FoodOrder', orderSchema);

const settingsSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, trim: true },
        dispatchMode: { type: String, enum: ['auto'], default: 'auto' },
        updatedBy: {
            role: { type: String },
            adminId: { type: mongoose.Schema.Types.ObjectId },
            at: { type: Date }
        }
    },
    { collection: 'food_settings', timestamps: true }
);

export const FoodSettings = mongoose.model('FoodSettings', settingsSchema);
