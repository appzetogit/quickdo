import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        variantId: { type: String, trim: true, default: '' },
        variantName: { type: String, trim: true, default: '' },
        variantPrice: { type: Number, min: 0, default: 0 },
        price: { type: Number, required: true, min: 0 },
        /** Compare-at / other-platform unit price snapshot at order time. */
        otherPrice: { type: Number, min: 0, default: 0 },
        quantity: { type: Number, required: true, min: 1 },
        isVeg: { type: Boolean, default: true },
        /**
         * Rate this line was taxed at, snapshotted like the price is: a
         * product's GST slab can be reclassified, and the invoice has to keep
         * saying what was actually charged. null means the order-wide rate.
         */
        gstRate: { type: Number, min: 0, max: 100, default: null },
        brand: { type: String, trim: true, default: '' },
        packSize: { type: String, trim: true, default: '' },
        /**
         * Category this line belonged to, snapshotted at order time.
         *
         * Without it, "top selling categories" had to join order lines back to
         * the live catalogue by product name -- which silently drops every
         * product since renamed or deleted, and mis-attributes any two sellers
         * that use the same name. Recorded like the price is, and for the same
         * reason: the report must describe what was sold, not what the
         * catalogue happens to say today.
         */
        categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
        categoryName: { type: String, trim: true, default: '' },
        image: { type: String, default: '' },
        notes: { type: String, default: '' },
        /**
         * Add-ons chosen for this line, priced and named as at order time.
         *
         * Recorded rather than derived: an add-on's price can change, and the
         * order must keep what the customer was actually charged. `price` here
         * is per unit of the line, already folded into `price` above.
         *
         * The field did not exist before, so add-ons the customer selected were
         * dropped entirely — not billed, not shown, not recoverable afterwards.
         */
        addons: {
            type: [
                new mongoose.Schema(
                    {
                        addonId: { type: String, trim: true, default: '' },
                        name: { type: String, trim: true, default: '' },
                        price: { type: Number, min: 0, default: 0 }
                    },
                    { _id: false }
                )
            ],
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
        /**
         * The order-wide GST rate that lines with no slab of their own (gstRate null)
         * were taxed at. Snapshotted because the fee settings can change afterwards,
         * and a return must refund such a line at the rate it was charged. null on
         * orders placed before it was recorded; returns then derive it from `tax`.
         */
        gstFallbackRate: { type: Number, default: null, min: 0, max: 100 },
        packagingFee: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        deliveryFeeGst: { type: Number, default: 0, min: 0 },
        /** GST on the platform fee (Master rate), collected for the government. */
        platformFeeGst: { type: Number, default: 0, min: 0 },
        platformFeeGstRate: { type: Number, default: 0, min: 0 },
        // Total rounded to the rupee; may be negative (336.60 -> 337 is +0.40, 337.40 -> 337 is -0.40).
        roundOff: { type: Number, default: 0 },
        platformFee: { type: Number, default: 0, min: 0 },
        /** Extra surcharge when user selects Quick Mode (also included in platformFee). */
        quickDeliveryFee: { type: Number, default: 0, min: 0 },
        deliveryMode: { type: String, enum: ['basic', 'quick'], default: 'basic' },
        restaurantCommission: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        /**
         * Whether the PLATFORM funded the coupon rather than the seller.
         *
         * Decides what GST was charged on, and therefore what a return refunds.
         * Declared here because the schema is strict: a field the services set
         * but the model does not name is dropped on every save.
         */
        discountFundedByPlatform: { type: Boolean },
        /** Whether GST was charged on the pre-coupon value. Absent on older orders, which
         *  were taxed pre-coupon whenever discountFundedByPlatform was true. */
        gstOnPreDiscountValue: { type: Boolean },
        couponCode: { type: String, default: null, trim: true, uppercase: true },
        total: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'INR' },
        /** Straight-line restaurant ↔ customer km (fee calculation) */
        distanceKm: { type: Number, default: null, min: 0 },
        /** Driving / road restaurant ↔ customer km (Directions API) */
        roadDistanceKm: { type: Number, default: null, min: 0 },
        roadDurationMins: { type: Number, default: null, min: 0 },
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
        deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCDeliveryPartner', default: null },
        assignedAt: { type: Date },
        acceptedAt: { type: Date },
        /** List of partners who were offered this order (to avoid repeats and track timeouts) */
        offeredTo: [{
            partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCDeliveryPartner' },
            at: { type: Date, default: Date.now },
            action: { type: String, enum: ['offered', 'rejected', 'timeout', 'deassigned'], default: 'offered' }
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

/** One rated dish. itemId matches items[].itemId on the same order. */
const orderItemRatingSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, default: '', trim: true },
        rating: { type: Number, min: 1, max: 5, required: true },
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
        customer: { type: orderEntityRatingSchema, default: undefined },
        /** Per-dish ratings from the customer. */
        items: { type: [orderItemRatingSchema], default: [] }
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
            ref: 'QCUser',
            required: true
        },
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCRestaurant',
            required: true
        },
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCZone',
            index: true
        },
        transactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCTransaction',
            index: true
        },
        /**
         * Paise already paid back to the customer through returns on this order.
         *
         * The single counter every return refund reserves against, with a
         * compare-and-swap, before any money moves (return.service.js refundReturn).
         * Summing refunded returns instead let two refunds that started together both
         * see the same headroom and pay out more than the order was worth. Integer
         * paise so repeated increments never drift. Absent on orders that predate it;
         * the first refund seeds it from the returns already refunded.
         */
        returnRefundedPaise: { type: Number, min: 0 },
        /**
         * At least one line -- except on a prescription-only order, which is placed
         * from a photograph and carries no items until the pharmacist prices it (see
         * prescriptionOnly below). Refusing it here meant no prescription order could
         * ever be saved. A function, not an arrow, so `this` is the order.
         */
        items: {
            type: [orderItemSchema],
            required: true,
            validate: {
                validator: function (v) {
                    if (Array.isArray(v) && v.length > 0) return true;
                    return this?.prescriptionOnly === true;
                },
                message: 'An order needs at least one item',
            }
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
        /**
         * Prescription, for orders placed with a medical store.
         *
         * `required` is stamped from the seller's storeType when the order is created,
         * not read from the seller at review time: a shop that changes type later must
         * not retroactively change what an existing order needed.
         *
         * The seller reviews it, because they are the pharmacist — but they cannot
         * confirm the order until they have, which is what stops medicine going out
         * against nothing. See shared/prescriptionRules.js.
         */
        /**
         * True when this order was placed by photographing a prescription
         * rather than by adding catalogue items to a cart.
         *
         * It carries no items and no price until the pharmacist reads the photo
         * and enters what they will dispense, so several ordinary invariants —
         * "an order has a total", "the customer has paid or owes a known
         * amount" — do not hold for it until then. Indexed because both the
         * seller queue and the customer's order list have to tell the two kinds
         * apart to render them at all. See shared/prescriptionOrder.js.
         */
        prescriptionOnly: { type: Boolean, default: false, index: true },
        prescription: {
            required: { type: Boolean, default: false },
            imageUrl: { type: String, trim: true, default: '' },
            uploadedAt: { type: Date, default: null },
            status: {
                type: String,
                enum: ['not_required', 'pending_review', 'approved', 'rejected'],
                default: 'not_required',
                index: true,
            },
            reviewedAt: { type: Date, default: null },
            reviewedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
            rejectionReason: { type: String, trim: true, default: '' },
            /** Removed from the admin prescription queue (the order itself is kept). */
            adminRemovedAt: { type: Date, default: null },
            adminRemovedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
            adminRemovedReason: { type: String, trim: true, default: '' },
            /**
             * The pharmacy's own bill, and the customer's answer to it.
             *
             * A prescription order is priced by the pharmacist after reading
             * the photo, so the customer agreed to no amount when they placed
             * it. They are shown this bill and either pay it or decline; until
             * they do, the order may not be prepared or dispatched -- see
             * shared/prescriptionOrder.js.
             *
             * `imageUrl` is the paper bill itself, kept because the amount is
             * typed by hand: without the document beside it, a disputed charge
             * is one person's figure against another's.
             */
            bill: {
                imageUrl: { type: String, trim: true, default: '' },
                /** What the pharmacist read off that bill, for the medicines alone. */
                amount: { type: Number, default: 0, min: 0 },
                uploadedAt: { type: Date, default: null },
                uploadedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
                status: {
                    type: String,
                    enum: ['none', 'submitted', 'approved', 'rejected'],
                    default: 'none',
                    index: true,
                },
                approvedAt: { type: Date, default: null },
                declinedAt: { type: Date, default: null },
                declineReason: { type: String, trim: true, default: '' },
            },
            /**
             * The sealed packet, photographed by the pharmacy as it hands the
             * order to the delivery partner.
             *
             * Not the same as the photo the partner takes at pickup. That one
             * says what the partner received; this says what the pharmacy
             * packed, and the gap between them is the only evidence either
             * side has when a customer says something was missing.
             *
             * Recorded at dispatch, which is refused until the customer has
             * paid -- see dispatchPrescriptionOrder.
             */
            packet: {
                imageUrl: { type: String, trim: true, default: '' },
                dispatchedAt: { type: Date, default: null },
                dispatchedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
            },
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
        /** Why the order was cancelled, as shown to the customer. Set by the pharmacy/store
         *  rejection and by a declined pharmacy bill; the schema is strict, so it must be declared. */
        cancellationReason: { type: String, default: '', trim: true },
        deliveryInstructions: { type: String, default: '', trim: true },
        acceptanceWindowSeconds: { type: Number, default: 240, min: 1 },
        acceptanceDeadlineAt: { type: Date, default: null },
        /** Idempotency guard so retries/duplicate calls never double-push the "new order" alert. */
        restaurantNotifiedAt: { type: Date, default: null },
        /** Set once stock was decremented for this order; absent on pre-inventory orders. */
        stockReservedAt: { type: Date, default: null },
        /**
         * Set once stock was given back. Guards the restock, which is reachable
         * from user cancel, seller cancel, admin cancel, the acceptance-timeout
         * sweep and two delete paths — several of which can race. Restocking
         * twice silently inflates inventory, and nothing downstream would notice.
         */
        stockRestoredAt: { type: Date, default: null },
        sendCutlery: { type: Boolean, default: true },
        deliveryFleet: { type: String, default: 'standard', trim: true },
        scheduledAt: { type: Date, default: null },
        riderEarning: { type: Number, default: 0, min: 0 },
        // The hold before the restaurant sees a new order (core/orders/orderHold.js):
        // when it ends, and when the order was actually released to the restaurant.
        restaurantReleaseAt: { type: Date, default: null },
        restaurantReleasedAt: { type: Date, default: null },
        // Can be negative when discounts/rider pay exceed platform income; keep the real value visible.
        platformProfit: { type: Number, default: 0 },
        /** Restaurant ↔ customer driving distance (km) for delivery-partner offer UI */
        tripDistanceKm: { type: Number, default: null, min: 0 },
        tripDurationMins: { type: Number, default: null, min: 0 },
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
        }
    },
    {
        collection: 'food_orders',
        timestamps: true
    }
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
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

// Numbers an order used to carry (FOD- before medical orders became MED-), so a
// link or message with the old number still finds it.
orderSchema.add({ previousOrderIds: { type: [String], default: undefined } });
orderSchema.index({ previousOrderIds: 1 }, { sparse: true });

orderSchema.pre('save', async function (next) {
    try {
        if (!this.order_id) {
            // Medical (pharmacy) orders read MED-, everything else FOD- as before.
            // Only new orders: an existing number is never rewritten.
            const prefix = this.prescription?.required === true ? 'MED' : 'FOD';
            // 6 timestamp digits + 4 random digits, verified against the collection.
            // The old 4+3 format collided after a few thousand orders (birthday paradox),
            // which made display-id lookups match the wrong order.
            for (let attempt = 0; attempt < 5 && !this.order_id; attempt += 1) {
                const timestamp = Date.now().toString().slice(-6);
                const random = Math.floor(1000 + Math.random() * 9000);
                const candidate = `${prefix}-${timestamp}${random}`;
                const exists = await this.constructor.exists({
                    $or: [{ order_id: candidate }, { orderId: candidate }],
                });
                if (!exists) this.order_id = candidate;
            }
            if (!this.order_id) {
                // Guaranteed unique: derived from this document's own ObjectId.
                this.order_id = `${prefix}-${this._id.toString().slice(-10).toUpperCase()}`;
            }
        }
        // Synchronize camelCase alias to satisfy unique index 'orderId_1'
        if (this.order_id) {
            this.orderId = this.order_id;
        }
        next();
    } catch (err) {
        next(err);
    }
});

export const FoodOrder = mongoose.models.QCOrder || mongoose.model('QCOrder', orderSchema, 'qc_orders');

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

export const FoodSettings = mongoose.models.QCSettings || mongoose.model('QCSettings', settingsSchema, 'qc_settingses');
