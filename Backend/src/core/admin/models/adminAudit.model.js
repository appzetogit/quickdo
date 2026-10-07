import mongoose from 'mongoose';

/**
 * Who changed what, as an admin: every admin write on every panel (2.7), and the
 * finance permission decisions on money moves.
 *
 * Two kinds of row:
 *   kind 'finance'   written by requireFinancePermission -- who moved money, whose
 *                    money, why, the permission decision and what happened;
 *   kind 'activity'  written by adminActivityLog for every other admin write --
 *                    method, path, module, target ids, a REDACTED summary of the
 *                    body (never passwords, OTPs, tokens, card or bank numbers),
 *                    status and ip.
 *
 * The rest of this note is about the finance rows.
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

        /** 'finance' | 'activity' -- see above. Rows from before 2.7 have none and are finance rows. */
        kind: { type: String, default: 'finance', index: true },
        /** 'food' | 'quickCommerce' | 'taxi' | 'serviceProvider' | 'platform' */
        module: { type: String, default: '', index: true },

        /**
         * Finance rows: the permission that was required, and whether they held it.
         * Activity rows: the section written to (e.g. 'restaurants') and the verb
         * ('create' | 'update' | 'delete').
         */
        resource: { type: String, default: '', index: true },
        action: { type: String, default: '', index: true },
        permitted: { type: Boolean, default: true },
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
        /** Every id the request named (path segments, route params, body *Id fields). */
        targetIds: { type: [String], default: undefined },

        /**
         * What was sent, with every secret replaced by '[REDACTED]' and long values
         * cut short (core/admin/auditRedact.js). Enough to see WHAT was changed,
         * never enough to replay a credential.
         */
        bodySummary: { type: mongoose.Schema.Types.Mixed, default: undefined },
        durationMs: { type: Number, default: undefined },

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
adminAuditSchema.index({ module: 1, createdAt: -1 });
adminAuditSchema.index({ targetIds: 1 });

export const AdminAudit =
    mongoose.models.AdminAudit || mongoose.model('AdminAudit', adminAuditSchema);
