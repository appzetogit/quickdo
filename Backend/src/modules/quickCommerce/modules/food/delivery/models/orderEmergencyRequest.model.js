import mongoose from 'mongoose';

const orderEmergencyRequestSchema = new mongoose.Schema(
    {
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCOrder',
            required: true,
            index: true
        },
        deliveryPartnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCDeliveryPartner',
            required: true,
            index: true
        },
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCRestaurant',
            required: true,
            index: true
        },
        reason: { type: String, required: true, trim: true },
        status: {
            type: String,
            enum: ['open', 'in_progress', 'processing', 'resolved', 'closed'],
            default: 'open',
            index: true
        },
        adminResponse: { type: String, default: '', trim: true },
        failureReason: { type: String, default: '', trim: true },
        activeKey: { type: String, unique: true, sparse: true },
        deassignedAt: { type: Date, default: null },
        resolvedAt: { type: Date, default: null },
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCAdmin',
            default: null
        }
    },
    {
        collection: 'food_delivery_order_emergency_requests',
        timestamps: true
    }
);

orderEmergencyRequestSchema.index({ deliveryPartnerId: 1, createdAt: -1 });
orderEmergencyRequestSchema.index({ status: 1, createdAt: -1 });

export const DeliveryOrderEmergencyRequest = mongoose.models.QCDeliveryOrderEmergencyRequest || mongoose.model('QCDeliveryOrderEmergencyRequest', orderEmergencyRequestSchema, 'qc_delivery_order_emergency_requests');
