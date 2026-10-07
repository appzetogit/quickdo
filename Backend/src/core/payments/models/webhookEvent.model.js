import mongoose from 'mongoose';

/**
 * One row per provider webhook delivery we have accepted (P0-5).
 *
 * Razorpay redelivers an event until it gets a 2xx, and may deliver the same event
 * more than once even after one. Every delivery of one event carries the same
 * `x-razorpay-event-id` header, so that id -- not the payload -- is the key. The
 * unique _id is what makes two concurrent deliveries race to one winner.
 *
 *   processing  a handler owns it right now (until lockedUntil)
 *   processed   done; any further delivery is acknowledged and ignored
 *   failed      the handler errored and returned 500; the next delivery retries it
 */
const webhookEventSchema = new mongoose.Schema(
    {
        /** `${provider}:${eventId}` -- or a payload hash when the header is missing. */
        _id: { type: String },
        provider: { type: String, default: 'razorpay' },
        event: { type: String, default: '' },
        status: { type: String, enum: ['processing', 'processed', 'failed'], default: 'processing', index: true },
        lockedUntil: { type: Date, default: null },
        attempts: { type: Number, default: 1 },
        lastError: { type: String, default: '' },
        processedAt: { type: Date, default: null },
    },
    { collection: 'webhook_events', timestamps: true, _id: false },
);

// Razorpay stops retrying after about 24 hours; keep the record well past that.
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookEvent =
    mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', webhookEventSchema);
