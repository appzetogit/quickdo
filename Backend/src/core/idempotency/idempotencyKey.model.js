import mongoose from 'mongoose';

/**
 * Idempotency ledger for state-changing HTTP requests.
 *
 * A client sends an `Idempotency-Key` header; the first request executes and its
 * response is stored here, keyed by (key, scope). A retry with the same key replays
 * the stored response instead of executing again — which is what stops a double-tap,
 * a flaky mobile connection, or an automatic client retry from turning one order into
 * two, or one refund into two payouts.
 */
const idempotencyKeySchema = new mongoose.Schema(
    {
        /** Client-supplied Idempotency-Key header value. */
        key: { type: String, required: true, trim: true },

        /**
         * Disambiguates the same key across endpoints and users: "METHOD:path:ownerId".
         * Without the owner in the scope, a key guessed or reused by one account could
         * replay another account's stored response back to them.
         */
        scope: { type: String, required: true },

        /**
         * sha256 of the request body. Catches a key reused with DIFFERENT content,
         * which is a client bug rather than a retry — replaying the first response
         * there would silently discard the second request.
         */
        fingerprint: { type: String, default: '' },

        status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
        responseStatus: { type: Number, default: null },
        responseBody: { type: mongoose.Schema.Types.Mixed, default: null },

        createdAt: { type: Date, default: Date.now },
    },
    // minimize:false so an empty-object response body is stored as {} rather than
    // being stripped, which would make a completed record look like it never ran.
    { minimize: false },
);

// One record per (key, scope). The unique index is what makes concurrent duplicate
// requests race to a single winner: the loser's insert fails with E11000 and it takes
// the replay path instead of executing.
idempotencyKeySchema.index({ key: 1, scope: 1 }, { unique: true });

// Self-cleaning: retries arrive within seconds, so a day is generous.
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const IdempotencyKey = mongoose.models.IdempotencyKey
    || mongoose.model('IdempotencyKey', idempotencyKeySchema, 'idempotency_keys');
