import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * A customer deleting their own account: a SOFT delete.
 *
 * The record stays -- past orders, payments, refunds and wallet history keep
 * pointing at it for the platform's accounts -- but it is closed:
 *   - marked deletedAt / isActive:false (and taxi's `active:false`), so the
 *     auth middleware refuses its tokens on the next request;
 *   - its phone is set aside (phone unique), so the number can sign up again
 *     as a brand-new account with nothing carried over;
 *   - every login is revoked (Food and Quick refresh tokens), push tokens
 *     cleared;
 *   - the customer's Quick record (qc_users) is closed the same way.
 *
 * Plain $set on the raw collections: two schemas (Food and Taxi) share
 * `users`, and a full-document save through either can drop the other's fields.
 */
export async function softDeleteCustomer(userId, { reason = 'Deleted by the customer from the app' } = {}) {
    if (!mongoose.Types.ObjectId.isValid(String(userId))) return null;
    const _id = new mongoose.Types.ObjectId(String(userId));
    const db = mongoose.connection.db;
    const users = db.collection('users');
    const user = await users.findOne({ _id }, { projection: { phone: 1, deletedAt: 1 } });
    if (!user) return null;
    if (user.deletedAt) return { id: String(_id), deletedAt: user.deletedAt, alreadyDeleted: true };

    const now = new Date();
    const stamp = `#deleted-${now.getTime()}`;
    const phone = String(user.phone || '');
    await users.updateOne({ _id }, {
        $set: {
            deletedAt: now,
            isActive: false,
            active: false,
            deletionReason: String(reason).slice(0, 300),
            ...(phone && !phone.includes('#deleted-') ? { phone: `${phone}${stamp}`, deletedPhone: phone } : {}),
            fcmTokens: [],
            fcmTokenMobile: [],
        },
    });

    // The customer's Quick record: linked by platformUserId, else by phone.
    const ten = phone.replace(/\D/g, '').slice(-10);
    const qcUsers = db.collection('qc_users');
    const qcRows = await qcUsers.find({
        $or: [{ platformUserId: _id }, ...(ten ? [{ phone: { $regex: `${ten}$` } }] : [])],
        deletedAt: { $in: [null] },
    }, { projection: { phone: 1 } }).toArray();
    for (const q of qcRows) {
        const qPhone = String(q.phone || '');
        // eslint-disable-next-line no-await-in-loop
        await qcUsers.updateOne({ _id: q._id }, {
            $set: {
                deletedAt: now,
                isActive: false,
                ...(qPhone && !qPhone.includes('#deleted-') ? { phone: `${qPhone}${stamp}`, deletedPhone: qPhone } : {}),
            },
        });
    }

    try {
        const { FoodRefreshToken, QCRefreshToken } = await import('../refreshTokens/refreshToken.model.js');
        await Promise.all([
            FoodRefreshToken.deleteMany({ userId: _id }),
            QCRefreshToken.deleteMany({ userId: { $in: [_id, ...qcRows.map((q) => q._id)] } }),
        ]);
    } catch (err) {
        logger.warn(`softDeleteCustomer: sign-out failed for ${_id}: ${err.message}`);
    }

    logger.info(`softDeleteCustomer: customer ${_id} deleted their account (quick records closed: ${qcRows.length})`);
    return { id: String(_id), deletedAt: now };
}
