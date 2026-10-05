import mongoose from 'mongoose';

/**
 * One chat message between two parties.
 *
 * A "party token" identifies a participant:
 *   USER:<id> | RESTAURANT:<id> | DELIVERY_PARTNER:<id> | ADMIN
 * ADMIN is a single logical endpoint — any admin can read/reply, so its token
 * carries no id. senderId still stores the real admin who sent it (for audit).
 */
const chatMessageSchema = new mongoose.Schema(
    {
        conversationId: { type: String, required: true, index: true },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCOrder', default: null, index: true },

        senderRole: { type: String, enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN'], required: true },
        senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
        senderToken: { type: String, required: true },

        recipientRole: { type: String, enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN'], required: true },
        recipientId: { type: mongoose.Schema.Types.ObjectId, default: null },
        recipientToken: { type: String, required: true },

        // [senderToken, recipientToken] — lets us find "my conversations" with one indexed match.
        participants: { type: [String], required: true },

        text: { type: String, required: true, trim: true, maxlength: 2000 },
        readAt: { type: Date, default: null }
    },
    { collection: 'food_chat_messages', timestamps: true }
);

chatMessageSchema.index({ conversationId: 1, createdAt: -1 });
chatMessageSchema.index({ participants: 1, createdAt: -1 });
chatMessageSchema.index({ recipientToken: 1, readAt: 1 });

export const FoodChatMessage = mongoose.models.QCChatMessage || mongoose.model('QCChatMessage', chatMessageSchema, 'qc_chat_messages');
