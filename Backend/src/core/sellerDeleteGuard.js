/**
 * What has to be settled before a seller -- restaurant, store or medical store --
 * may delete its own account.
 *
 * Deleting is permanent: the seller, its menu and its wallet go. Orders and
 * transactions stay as the financial record, but nothing stopped a seller
 * deleting itself mid-order or while the platform still owed it money, which
 * left a customer's order with no kitchen and an unpaid balance with no
 * account to pay it into. Riders have long had the same checks
 * (delivery.service.js deleteDeliveryPartnerAccount).
 *
 * Each caller hands in its own models and how to read what it is owed, since
 * Food and quick commerce keep their books differently.
 */
import mongoose from 'mongoose';
import { ValidationError } from './auth/errors.js';

// Orders a kitchen or shop still has to fulfil. 'pending_payment' is a checkout
// the customer never paid for, so it does not hold the seller back.
const ACTIVE_ORDER_STATUSES = [
    'created',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'reached_pickup',
    'picked_up',
    'reached_drop',
];

const rupees = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function assertSellerCanDelete(sellerId, { Order, Withdrawal, owedToSeller } = {}) {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid account');
    }
    const id = new mongoose.Types.ObjectId(String(sellerId));

    const inProgress = await Order.countDocuments({ restaurantId: id, orderStatus: { $in: ACTIVE_ORDER_STATUSES } });
    if (inProgress > 0) {
        throw new ValidationError(
            `You have ${inProgress} order${inProgress === 1 ? '' : 's'} in progress. Finish or cancel ${inProgress === 1 ? 'it' : 'them'} before deleting your account.`,
        );
    }

    const pendingPayout = await Withdrawal.exists({ restaurantId: id, status: { $regex: /^\s*pending\s*$/i } });
    if (pendingPayout) {
        throw new ValidationError('You have a payout request waiting. Wait until it is paid or rejected before deleting your account.');
    }

    let owed;
    try {
        owed = rupees(await owedToSeller(id));
    } catch {
        // Unknown is not zero: refusing is safer than deleting an account that
        // may still be owed money.
        throw new ValidationError('Could not check your balance right now. Please try again in a moment.');
    }
    if (owed >= 1) {
        throw new ValidationError(
            `Rs ${owed} is still owed to you. Request a payout of your balance (or contact support) before deleting your account.`,
        );
    }
}
