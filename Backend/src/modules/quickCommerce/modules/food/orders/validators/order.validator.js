import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const orderItemSchema = z.object({
    itemId: z.string().min(1, 'Item id required'),
    name: z.string().min(1, 'Item name required'),
    variantId: z.string().optional(),
    variantName: z.string().optional(),
    variantPrice: z.number().min(0).optional(),
    price: z.number().min(0),
    otherPrice: z.number().min(0).optional(),
    quantity: z.number().int().min(1),
    isVeg: z.boolean().optional().default(true),
    image: z.string().optional(),
    notes: z.string().optional(),
    /**
     * Add-ons chosen for this line.
     *
     * Zod strips keys it does not declare, so omitting this discarded the
     * customer's add-ons before any pricing code could see them — the reason
     * they were never billed and never appeared on the order.
     *
     * Ids or names, as strings or objects, because the shipped apps send names
     * while a corrected client sends ids. Nothing here is trusted for price:
     * resolveOrderCartItems looks each one up against the restaurant's
     * published add-ons and ignores anything it cannot identify.
     */
    addons: z
        .array(
            z.union([
                z.string(),
                z.object({
                    addonId: z.string().optional(),
                    id: z.string().optional(),
                    name: z.string().optional()
                })
            ])
        )
        .optional()
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
    // Flat coordinates are accepted alongside the nested GeoJSON pair. The
    // saved-address API returns them flat and /orders/calculate reads them that
    // way, so a client handing an address from one endpoint to the other had
    // them silently stripped here by Zod and placed an order with no location
    // at all -- which the 2dsphere index then rejected with a raw driver error.
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
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
    discount: z.number().min(0).optional(),
    total: z.number().min(0),
    currency: z.string().optional(),
    couponCode: z.string().nullable().optional()
});

export function validateCalculateOrderDto(body) {
    const schema = z.object({
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        restaurantId: z.string().min(1, 'Restaurant id required'),
        deliveryAddressId: z.string().optional(),
        zoneId: z.string().optional(),
        couponCode: z.string().optional(),
        deliveryFleet: z.string().optional(),
        deliveryMode: z.enum(['basic', 'quick']).optional(),
        deliveryAddress: z
            .object({
                location: z
                    .object({
                        coordinates: z.tuple([z.number(), z.number()]).optional()
                    })
                    .optional()
            })
            .passthrough()
            .optional(),
        scheduledAt: z.string().datetime().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const first = result.error.issues?.[0];
        const path = first?.path?.length ? first.path.join('.') : '';
        const msg = path ? `${path}: ${first?.message || 'Validation failed'}` : first?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
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
        deliveryInstructions: z.string().optional(),
        deliveryMode: z.enum(['basic', 'quick']).optional(),
        sendCutlery: z.boolean().optional(),
        // 'cash' is true COD, collected as notes at the door.
        // 'razorpay_qr' is the same pay-at-delivery flow, collected by QR instead.
        // 'cash' is accepted here regardless so the service can return the friendly
        // "not available" message when COD_ENABLED is off, rather than a generic
        // enum error that names every method.
        paymentMethod: z.enum(['razorpay', 'razorpay_qr', 'card', 'wallet', 'cash'], {
            errorMap: () => ({ message: 'Unsupported payment method' }),
        }),
        zoneId: z.string().nullable().optional(),
        scheduledAt: z.string().datetime().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const msg = result.error.errors?.[0]?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
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
        const msg = result.error.errors?.[0]?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
}

export function validateCancelOrderDto(body) {
    const schema = z.object({
        reason: z.string().optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
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
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateAssignDeliveryDto(body) {
    const schema = z.object({
        deliveryPartnerId: z.string().min(1, 'Delivery partner id required')
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateDispatchSettingsDto(body) {
    const schema = z.object({
        dispatchMode: z.enum(['auto', 'manual'])
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateOrderRatingsDto(body) {
    const schema = z.object({
        restaurantRating: z.number().min(1).max(5),
        deliveryPartnerRating: z.number().min(1).max(5).optional(),
        restaurantComment: z.string().max(500).optional(),
        deliveryPartnerComment: z.string().max(500).optional(),
        // Per-dish ratings. Optional, so a customer can rate the restaurant
        // without being forced to score every item.
        itemRatings: z
            .array(
                z.object({
                    itemId: z.string().min(1),
                    rating: z.number().min(1).max(5),
                    comment: z.string().max(500).optional()
                })
            )
            .max(50)
            .optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

/** Delivery partner rating the customer after handover. */
export function validateCustomerRatingDto(body) {
    const schema = z.object({
        rating: z.number().min(1).max(5),
        comment: z.string().max(500).optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}
