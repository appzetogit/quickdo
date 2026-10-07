import mongoose from 'mongoose';

/**
 * Delivery slots (plan §5.3): the windows an admin opens for scheduled delivery,
 * per vertical and optionally per zone, each with a capacity.
 *
 * Times are wall-clock in the platform's time zone (IST unless SLOT_TZ_OFFSET_MINUTES
 * says otherwise) as "HH:MM", on the listed days of the week (0 = Sunday).
 * A slot with no zone applies to every zone of its vertical; a zone that has
 * slots of its own uses only those.
 */
const deliverySlotSchema = new mongoose.Schema(
    {
        vertical: { type: String, required: true, default: 'quickCommerce', index: true },
        zoneId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        label: { type: String, trim: true, default: '' },
        daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
        startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
        endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
        /** Orders this slot takes per day. */
        capacity: { type: Number, required: true, min: 1 },
        /** A slot closes for booking this many minutes before it starts. */
        cutoffMinutes: { type: Number, default: 60, min: 0 },
        isActive: { type: Boolean, default: true, index: true },
        sortOrder: { type: Number, default: 0 },
    },
    { collection: 'delivery_slots', timestamps: true },
);

/** One row per slot per day: how many orders it holds, and which. */
const slotBookingSchema = new mongoose.Schema(
    {
        slotId: { type: mongoose.Schema.Types.ObjectId, required: true },
        date: { type: String, required: true },
        count: { type: Number, default: 0, min: 0 },
        orderIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    },
    { collection: 'delivery_slot_bookings', timestamps: true },
);
slotBookingSchema.index({ slotId: 1, date: 1 }, { unique: true });

export const DeliverySlot = mongoose.models.DeliverySlot || mongoose.model('DeliverySlot', deliverySlotSchema);
export const DeliverySlotBooking =
    mongoose.models.DeliverySlotBooking || mongoose.model('DeliverySlotBooking', slotBookingSchema);
