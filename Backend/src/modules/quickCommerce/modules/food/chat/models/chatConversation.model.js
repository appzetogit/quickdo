import mongoose from 'mongoose';

/**
 * A support conversation thread.
 *
 * Conversations were previously DERIVED from the messages themselves — grouping
 * food_chat_messages by conversationId gave a peer, a last message and an unread
 * count, and nothing else. That is enough for an order chat, but not for support:
 * a thread the user opened as "I want to cancel my order" and an agent later
 * closed has a subject and a lifecycle that no message carries.
 *
 * This document holds only that extra state. Messages remain the source of truth
 * for lastMessage / lastAt / unread, so a conversation with no document here still
 * lists correctly and nothing had to be backfilled.
 */
const chatConversationSchema = new mongoose.Schema(
    {
        // Same deterministic id the messages carry, so the two join cleanly.
        conversationId: { type: String, required: true, unique: true, index: true },

        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCOrder',
            default: null,
            index: true
        },

        /** Subject the user picked, e.g. "I want to cancel my order". */
        title: { type: String, trim: true, default: '', maxlength: 200 },

        status: {
            type: String,
            enum: ['open', 'in_progress', 'closed'],
            default: 'open',
            index: true
        },

        /** Only set once status becomes 'closed'; cleared if it is reopened. */
        closedAt: { type: Date, default: null },

        /** Who the opener is talking to: 'ADMIN' or 'DELIVERY_PARTNER:<id>'. */
        peerToken: { type: String, required: true },

        /** The party that opened the thread, in the same token form. */
        openedByToken: { type: String, required: true },

        participants: { type: [String], required: true }
    },
    { collection: 'food_chat_conversations', timestamps: true }
);

// Serves the per-order listing: "this order's threads, newest first".
chatConversationSchema.index({ orderId: 1, createdAt: -1 });
chatConversationSchema.index({ participants: 1, createdAt: -1 });

export const FoodChatConversation = mongoose.models.QCChatConversation || mongoose.model('QCChatConversation', chatConversationSchema, 'qc_chat_conversations');
