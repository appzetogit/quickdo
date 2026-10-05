import mongoose from 'mongoose';
import { REQUEST_STATUS } from '../../shared/medicalRequest.js';

/**
 * One prescription, offered to several pharmacies, until one takes it.
 *
 * This is not an order and must not be mistaken for one: nothing has been
 * promised to the customer and no shop owes them anything until a pharmacy
 * accepts. The order is created at that moment, by the pharmacy that accepted,
 * and from then on it is an ordinary prescription order -- same queue, same
 * bill, same delivery. That is why `orderId` is written once and never
 * changes: it is the seam between the two, and the record of which shop won.
 *
 * The prescription image lives here for as long as the request does, which is
 * the one uncomfortable part of broadcasting: a health record is shown to every
 * invited shop. `invited` is therefore the audit trail of who could see it --
 * stored with the distance that let them in, so a later question about why a
 * particular pharmacy saw a particular prescription has an answer.
 */
const invitedSchema = new mongoose.Schema(
    {
        pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCRestaurant', required: true },
        name: { type: String, trim: true, default: '' },
        distanceKm: { type: Number, default: null },
        notifiedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const prescriptionRequestSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        zoneId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

        prescriptionImageUrl: { type: String, trim: true, required: true },
        note: { type: String, trim: true, default: '' },

        /** Where it is going, kept whole so the claiming pharmacy's order is built from it. */
        deliveryAddress: { type: mongoose.Schema.Types.Mixed, default: null },
        location: {
            lat: { type: Number, default: null },
            lng: { type: Number, default: null },
        },
        customerName: { type: String, trim: true, default: '' },
        customerPhone: { type: String, trim: true, default: '' },

        /**
         * The range in force when this went out, not the range in force now.
         *
         * An admin widening the radius must not retroactively add shops to a
         * request that has already been sent, and narrowing it must not remove a
         * pharmacy that was legitimately offered the prescription and may be
         * halfway through reading it.
         */
        radiusKm: { type: Number, required: true },
        expiresAt: { type: Date, required: true, index: true },

        status: {
            type: String,
            enum: Object.values(REQUEST_STATUS),
            default: REQUEST_STATUS.OPEN,
            index: true,
        },
        invited: { type: [invitedSchema], default: [] },
        /** Pharmacies that looked and passed; the request leaves their queue. */
        declinedBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },

        claimedBy: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        claimedAt: { type: Date, default: null },
        orderId: { type: mongoose.Schema.Types.ObjectId, default: null },

        cancelledAt: { type: Date, default: null },
    },
    { collection: 'qc_prescription_requests', timestamps: true },
);

// The pharmacy queue: my open requests, newest first.
prescriptionRequestSchema.index({ 'invited.pharmacyId': 1, status: 1, createdAt: -1 });

export const QCPrescriptionRequest = mongoose.models.QCPrescriptionRequest
    || mongoose.model('QCPrescriptionRequest', prescriptionRequestSchema, 'qc_prescription_requests');
