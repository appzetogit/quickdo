import mongoose from 'mongoose';

/**
 * Who moved money, whose money, why, and what happened.
 *
 * Distinct from `activities` on purpose. That collection is a CUSTOMER feed -- one
 * row per order/ride/booking, indexed by userId, meant to answer "what has this
 * customer done". This answers a different question, asked by a different person,
 * usually after something has gone wrong: "an admin changed this driver's balance
 * -- which admin, when, on what authority, and did it actually succeed?"
 *
 * Today nothing answers that. Financial admin routes are gated on
 * `role === 'ADMIN'` and write nothing, so a balance that changed overnight has no
 * attributable cause.
 *
 * Deliberately append-only and deliberately outside the mutation's own transaction
 * for now. Recording the AUTHORIZATION DECISION and the OUTCOME is achievable
 * without touching fourteen handlers; making the audit row atomic with the money
 * move means changing each of them, and is the follow-up. So a row here means
 * "this request was made and returned this status", not yet "this money moved" --
 * the `outcome` field says which, and never pretends to more certainty than it has.
 */
const adminAuditSchema = new mongoose.Schema(
    {
        /** The authenticated admin. Never derived from the request body. */
        actorId: { type: mongoose.Schema.Types.ObjectId, index: true },
        actorEmail: { type: String, default: '' },
        actorRole: { type: String, default: '' },

        /** The permission that was required, and whether they actually held it. */
        resource: { type: String, required: true, index: true },
        action: { type: String, required: true },
        permitted: { type: Boolean, required: true },
        /**
         * True when the admin did NOT hold the permission but was let through
         * anyway because enforcement is still in tolerant mode. These rows are the
         * entire point of the tolerant release: they are the list of grants to fix
         * before enforcement is switched on.
         */
        toleratedViolation: { type: Boolean, default: false, index: true },

        method: { type: String, default: '' },
        path: { type: String, default: '' },
        /** Who the money belongs to, where the route makes that knowable. */
        targetType: { type: String, default: '' },
        targetId: { type: String, default: '', index: true },

        /** Operator-supplied justification. Required by policy on money moves. */
        reason: { type: String, default: '' },
        /** Client-generated, one per form submission -- also the idempotency key. */
        clientRequestId: { type: String, default: '' },

        /**
         * 'succeeded' | 'rejected' | 'failed'. Taken from the response status, so a
         * handler that threw leaves a row saying so rather than leaving no trace.
         */
        outcome: { type: String, default: '', index: true },
        statusCode: { type: Number, default: 0 },

        requestId: { type: String, default: '' },
        ip: { type: String, default: '' },
    },
    { collection: 'admin_audits', timestamps: true },
);

adminAuditSchema.index({ createdAt: -1 });
adminAuditSchema.index({ actorId: 1, createdAt: -1 });
adminAuditSchema.index({ targetId: 1, createdAt: -1 });

export const AdminAudit =
    mongoose.models.AdminAudit || mongoose.model('AdminAudit', adminAuditSchema);
