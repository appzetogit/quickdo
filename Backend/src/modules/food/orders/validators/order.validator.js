import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const orderItemSchema = z.object({
    itemId: z.string().min(1, 'Item id required'),
    name: z.string().min(1, 'Item name required'),
    variantId: z.string().optional(),
    variantName: z.string().optional(),
    variantPrice: z.number().min(0).optional(),
    price: z.number().min(0),
    quantity: z.number().int().min(1),
    isVeg: z.boolean().optional().default(true),
    image: z.string().optional(),
    notes: z.string().optional(),
    /*
     * The add-ons chosen for this line. The web sends ids as `addonIds`; the
     * Flutter app sends them as `addons` (a list of id strings). Neither was
     * declared, so zod stripped both before pricing saw them: a Rs 200 dish with
     * a Rs 30 add-on was billed Rs 200 and the kitchen never saw the add-on.
     * Only ids get through. Pricing looks each one up in the published record
     * and refuses any add-on the dish does not offer, so a price sent here is
     * never used.
     */
    addonIds: z.array(z.string()).optional(),
    addons: z.array(z.union([z.string(), z.object({}).passthrough()])).optional()
});

const addressSchema = z.object({
    // Any label the app sends ("Current Location", "home") maps onto the three kept.
    label: z.preprocess((v) => (v == null || v === '' ? v : ({ home: 'Home', office: 'Office', work: 'Office' }[String(v).trim().toLowerCase()] || 'Other')), z.enum(['Home', 'Office', 'Other'])).optional(),
    name: z.string().optional(),
    fullName: z.string().optional(),
    street: z.string().min(1, 'Street required'),
    additionalDetails: z.string().optional(),
    city: z.string().min(1, 'City required'),
    state: z.string().min(1, 'State required'),
    zipCode: z.string().optional(),
    phone: z.string().optional(),
    location: z
        .object({
            type: z.literal('Point').optional(),
            coordinates: z.tuple([z.number(), z.number()]).optional()
        })
        .optional()
});

const calculateAddressSchema = z.object({
    // Any label the app sends ("Current Location", "home") maps onto the three kept.
    label: z.preprocess((v) => (v == null || v === '' ? v : ({ home: 'Home', office: 'Office', work: 'Office' }[String(v).trim().toLowerCase()] || 'Other')), z.enum(['Home', 'Office', 'Other'])).optional(),
    name: z.string().optional(),
    fullName: z.string().optional(),
    street: z.string().optional(),
    additionalDetails: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    phone: z.string().optional(),
    formattedAddress: z.string().optional(),
    address: z.string().optional(),
    location: z
        .object({
            type: z.literal('Point').optional(),
            coordinates: z.tuple([z.number(), z.number()]).optional()
        })
        .optional()
});

const pricingSchema = z.object({
    subtotal: z.number().min(0),
    tax: z.number().min(0).optional(),
    packagingFee: z.number().min(0).optional(),
    deliveryFee: z.number().min(0).optional(),
    platformFee: z.number().min(0).optional(),
    surgeAmount: z.number().min(0).optional(),
    discount: z.number().min(0).optional(),
    total: z.number().min(0),
    currency: z.string().optional(),
    // Both apps send the coupon only here, echoing /calculate's pricing. It is
    // nullable because /calculate reports `couponCode: null` when there is none,
    // and refusing that would refuse every order placed without a coupon.
    couponCode: z.string().nullable().optional()
});

function zodMessage(error) {
    const first = error?.issues?.[0] || error?.errors?.[0];
    const path = first?.path?.length ? first.path.join('.') : '';
    return path ? `${path}: ${first?.message || 'Validation failed'}` : first?.message || 'Validation failed';
}

function normalizePaymentMethod(value) {
    const method = String(value || '').trim().toLowerCase();
    if (['cod', 'cash_on_delivery'].includes(method)) return 'cash';
    if (['online', 'online_payment', 'digital', 'upi', 'card'].includes(method)) return 'razorpay';
    return method;
}

export function validateCalculateOrderDto(body) {
    const schema = z.object({
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        restaurantId: z.string().min(1, 'Restaurant id required'),
        // Either shape of address: the object, or the id of one of the user's
        // saved addresses. Pricing resolves whichever arrives.
        address: calculateAddressSchema.optional(),
        deliveryAddress: calculateAddressSchema.optional(),
        deliveryAddressId: z.string().optional(),
        zoneId: z.string().optional(),
        couponCode: z.string().optional(),
        // The rider's, and the customer's to choose. Undeclared, zod stripped it
        // before pricing ever saw it, so the tip line could never be anything but
        // zero however much the client sent. Bounds are enforced server-side in
        // shared/billing.js; this only has to let the number through.
        tip: z.number().min(0).optional(),
        deliveryFleet: z.string().optional(),
        // Same failure mode as tip above, and just as silent: undeclared here,
        // zod strips it before order-pricing.service.js ever sees it, so
        // `Boolean(dto.claimFreebie)` is always false and the Add button's
        // request never lands — no error, just a claim that quietly never
        // took, indistinguishable from the button "not working".
        claimFreebie: z.boolean().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    const data = result.data;
    if (data.deliveryAddress && !data.address) {
        return {
            ...data,
            address: data.deliveryAddress
        };
    }
    return data;
}

export function validateCreateOrderDto(body) {
    const schema = z.object({
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        address: addressSchema,
        restaurantId: z.string().min(1, 'Restaurant id required'),
        restaurantName: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        pricing: pricingSchema,
        deliveryFleet: z.string().optional(),
        note: z.string().optional(),
        // Same failure mode as tip/claimFreebie above: undeclared here, zod
        // stripped it before the order was ever built, so a customer's chip
        // selection ("Leave at door", "Don't ring bell") never reached the
        // order or the rider. See order.service.js and order.helpers.js.
        deliveryInstructions: z.array(z.string()).optional(),
        sendCutlery: z.boolean().optional(),
        // 'razorpay_qr' means COD-style flow, but payment is collected via Razorpay QR at delivery.
        paymentMethod: z.preprocess(
            normalizePaymentMethod,
            z.enum(['cash', 'razorpay', 'razorpay_qr', 'wallet'])
        ),
        couponCode: z.string().optional(),
        // See the note on the calculate schema: without this the tip is stripped
        // and the order is placed without the one the customer just agreed to.
        tip: z.number().min(0).optional(),
        zoneId: z.string().nullable().optional(),
        // See the note on the calculate schema: without this, an order placed
        // right after claiming a free item drops the claim silently and
        // re-prices without it, since order-pricing.service.js re-runs the
        // same freebie resolution at placement time.
        claimFreebie: z.boolean().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    /*
     * The coupon, wherever the client put it.
     *
     * Placement re-prices from the top-level couponCode, but the shipped web and
     * Flutter apps send it only inside `pricing`, echoing /calculate. So the cart
     * quoted Rs 199 with the coupon, and the order charged Rs 252 without it
     * and never counted a use. Reading both keeps the apps already installed
     * working. The code is re-validated from scratch by pricing, so accepting it
     * here grants nothing /calculate would not.
     */
    const data = result.data;
    const couponCode = data.couponCode || data.pricing?.couponCode || undefined;
    return couponCode ? { ...data, couponCode } : data;
}

export function validateVerifyPaymentDto(body) {
    const schema = z.object({
        orderId: z.string().min(1, 'Order id required'),
        razorpayOrderId: z.string().min(1, 'Razorpay order id required'),
        razorpayPaymentId: z.string().min(1, 'Razorpay payment id required'),
        razorpaySignature: z.string().min(1, 'Razorpay signature required')
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateCancelOrderDto(body) {
    const schema = z.object({
        reason: z.string().optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateOrderStatusDto(body) {
    const schema = z.object({
        orderStatus: z.enum([
            'confirmed',
            'preparing',
            'ready_for_pickup',
            'picked_up',
            'delivered',
            'cancelled_by_restaurant'
        ]),
        note: z.string().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateAssignDeliveryDto(body) {
    const schema = z.object({
        deliveryPartnerId: z.string().min(1, 'Delivery partner id required')
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateDispatchSettingsDto(body) {
    const schema = z.object({
        dispatchMode: z.enum(['auto', 'manual'])
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateOrderRatingsDto(body) {
    const schema = z.object({
        restaurantRating: z.number().min(1).max(5),
        deliveryPartnerRating: z.number().min(1).max(5).optional(),
        restaurantComment: z.string().max(500).optional(),
        deliveryPartnerComment: z.string().max(500).optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

/** The other direction: the delivery partner rating the customer after handover. */
export function validateCustomerRatingDto(body) {
    const schema = z.object({
        rating: z.number().min(1).max(5),
        comment: z.string().max(500).optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}
