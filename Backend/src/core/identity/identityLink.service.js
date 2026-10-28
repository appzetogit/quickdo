import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * Phase 1 of the identity merge: every customer gets exactly ONE platform identity.
 *
 * Today a customer exists as up to three documents -- `users` (food + taxi),
 * `sp_users`, `qc_users` -- glued together at read time by matching the last ten
 * digits of a phone number (see core/activity/identityResolver.js). That works, but
 * it is a heuristic: it runs a regex query per lookup, breaks if a satellite stores
 * a malformed phone, and nothing in the data says these documents ARE one person.
 *
 * This service makes the link explicit. Satellite documents carry a
 * `platformUserId` pointing at the shared `users` collection:
 *
 *   - at REGISTRATION: SP and QC user creation call ensurePlatformUser() and stamp
 *     the link on the new document (write-time, so new data is born linked)
 *   - for EXISTING documents: scripts/link-user-identities.js backfills the same
 *     field (run with --dry-run first)
 *
 * Phase 2 (later, per SUPERAPP_DATA_MODEL.md) moves auth itself onto the platform
 * identity and retires the satellites. Until then the satellites stay the source of
 * truth for their vertical's profile; the platform user is the identity spine.
 */

export const toTenDigits = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Find or create the platform user for a phone number. Idempotent and race-safe.
 *
 * Matching is by last-ten-digits suffix, the same rule the SP identity bridge and the
 * activity resolver use, so '+919876543210' and '9876543210' resolve to one person.
 *
 * @param {{phone: string, name?: string, email?: string}} details
 * @returns {Promise<mongoose.Types.ObjectId|null>} the platform users._id, or null
 *          when the phone is unusable (fewer than 10 digits) -- callers treat that
 *          as "unlinked", never as an error, because a failed link must not fail a
 *          registration that already succeeded.
 */
export const ensurePlatformUser = async ({ phone, name, email } = {}) => {
    const suffix = toTenDigits(phone);
    if (!suffix) return null;

    const { FoodUser } = await import('../users/user.model.js');

    try {
        const existing = await FoodUser.findOne({ phone: new RegExp(`${suffix}$`) })
            .select('_id')
            .lean();
        if (existing) return existing._id;

        const created = await FoodUser.create({
            // Stored normalized. The suffix match above still finds prefixed variants,
            // and new platform identities should not inherit satellite formatting.
            phone: suffix,
            ...(name ? { name } : {}),
            ...(email ? { email } : {}),
        });
        return created._id;
    } catch (err) {
        // Two registrations racing on the same phone: the unique index on users.phone
        // makes one create lose. The winner's document is the identity; fetch it.
        if (err?.code === 11000) {
            const winner = await FoodUser.findOne({ phone: new RegExp(`${suffix}$`) })
                .select('_id')
                .lean();
            if (winner) return winner._id;
        }
        logger.warn(`[Identity] could not ensure platform user for ${suffix}: ${err.message}`);
        return null;
    }
};

/**
 * Stamp `platformUserId` on a satellite document that was just created.
 * Never throws: the registration already succeeded, and an unlinked document is
 * exactly what the backfill script exists to repair.
 */
export const linkSatellite = async (model, satelliteId, { phone, name, email } = {}) => {
    try {
        const platformUserId = await ensurePlatformUser({ phone, name, email });
        if (!platformUserId) return null;
        await model.updateOne({ _id: satelliteId }, { $set: { platformUserId } });
        return platformUserId;
    } catch (err) {
        logger.warn(`[Identity] linking ${satelliteId} failed: ${err.message}`);
        return null;
    }
};
