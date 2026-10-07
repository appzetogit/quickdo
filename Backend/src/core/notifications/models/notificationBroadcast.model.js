import mongoose from 'mongoose';

const broadcastTargetSchema = new mongoose.Schema(
    {
        ownerType: {
            type: String,
            // DRIVER (taxi), VENDOR and WORKER (services) came with Master broadcasts
            // (core/notifications/platformBroadcast.service.js).
            enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'DRIVER', 'VENDOR', 'WORKER'],
            required: true
        },
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        label: {
            type: String,
            default: '',
            trim: true
        },
        vertical: {
            type: String,
            default: '',
            trim: true
        },
        subLabel: {
            type: String,
            default: '',
            trim: true
        }
    },
    { _id: false }
);

const notificationBroadcastSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        message: {
            type: String,
            required: true,
            trim: true
        },
        targetType: {
            type: String,
            // TAXI_DRIVER / SP_WORKER / SP_VENDOR: one role across the platform;
            // SEGMENT: Master broadcasts addressed by roles + zone + vertical + activity.
            enum: ['ALL', 'USER', 'RESTAURANT', 'DELIVERY', 'CUSTOM', 'TAXI_DRIVER', 'SP_WORKER', 'SP_VENDOR', 'SEGMENT'],
            required: true,
            index: true
        },
        targetIds: {
            type: [mongoose.Schema.Types.ObjectId],
            default: []
        },
        targets: {
            type: [broadcastTargetSchema],
            default: []
        },
        link: {
            type: String,
            default: '',
            trim: true
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodAdmin',
            required: true,
            index: true
        },
        targetCount: {
            type: Number,
            default: 0
        },
        // --- Master broadcasts (platformBroadcast.service.js). Absent on panel ones.
        scope: {
            type: String,
            enum: ['panel', 'platform'],
            default: 'panel',
            index: true
        },
        channels: {
            type: [String],
            default: undefined
        },
        segment: {
            type: mongoose.Schema.Types.Mixed,
            default: undefined
        },
        status: {
            type: String,
            enum: ['sending', 'sent', 'failed', null],
            default: undefined
        },
        stats: {
            type: mongoose.Schema.Types.Mixed,
            default: undefined
        }
    },
    {
        collection: 'food_notification_broadcasts',
        timestamps: { createdAt: true, updatedAt: false }
    }
);

notificationBroadcastSchema.index({ createdAt: -1 });

export const BroadcastNotification = mongoose.model('BroadcastNotification', notificationBroadcastSchema);
