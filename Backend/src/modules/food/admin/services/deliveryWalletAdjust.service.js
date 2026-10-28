/**
 * Admin sets a rider's pocket balance or cash in hand from the Deliveryman list.
 *
 * Neither figure is stored: both are derived from the rider's records
 * (core/finance/riderFinance.service.js) --
 *
 *   pocket = taxi wallet + delivery earnings + bonuses - withdrawals (approved and pending)
 *   cash   = taxi cash held + cash collected on COD orders - completed deposits
 *
 * so "set it to 1000" is written as a record for the difference, of a kind the
 * derivation already counts, and every rupee stays traceable to who changed it:
 *
 *   pocket up    -> a bonus transaction ("Admin wallet adjustment")
 *   pocket down  -> an approved withdrawal, paymentMethod 'admin_adjustment'
 *   cash down    -> a completed cash deposit with the admin's note
 *   cash up      -> refused: cash in hand only rises from cash orders
 *
 * The page sends both figures on every save; a figure equal to what is shown is
 * left alone. Differences are taken from the unclamped figures, so the screen
 * reads exactly what the admin typed afterwards even for a rider in debt.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { getRiderFinance, resolveRiderIdentity } from '../../../../core/finance/riderFinance.service.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { DeliveryBonusTransaction } from '../models/deliveryBonusTransaction.model.js';
import { FoodDeliveryWithdrawal } from '../../delivery/models/foodDeliveryWithdrawal.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const NOTE = 'Admin wallet adjustment';

const readTarget = (value, label) => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be a number of 0 or more`);
    return round2(n);
};

const view = (finance, walletId) => ({
    walletId: walletId || null,
    pocketBalance: finance.walletBalance,
    cashInHand: finance.cashInHand,
    remainingCashLimit: finance.availableCashLimit,
    availableCashLimit: finance.availableCashLimit,
});

export async function setDeliveryWalletFigures(deliveryId, body = {}, { adminId = null } = {}) {
    if (!deliveryId || !mongoose.Types.ObjectId.isValid(String(deliveryId))) {
        throw new ValidationError('Invalid delivery partner');
    }
    const partner = await FoodDeliveryPartner.findById(deliveryId).select('_id name').lean();
    if (!partner) throw new NotFoundError('Delivery partner not found');

    const pocketTarget = readTarget(body.pocketBalance, 'Pocket balance');
    const cashTarget = readTarget(body.cashInHand, 'Cash in hand');
    const note = String(body.note || '').trim().slice(0, 200);
    const label = note ? `${NOTE}: ${note}` : NOTE;
    const adminRef = adminId && mongoose.Types.ObjectId.isValid(String(adminId))
        ? new mongoose.Types.ObjectId(String(adminId))
        : undefined;

    // Records go on the rider's food partner identity, which the derivation sums.
    const identity = await resolveRiderIdentity(deliveryId).catch(() => null);
    const riderId = identity?.foodPartnerId || partner._id;

    const finance = await getRiderFinance(deliveryId);
    const taxi = finance.breakdown?.taxi || {};
    const delivery = finance.breakdown?.delivery || {};
    // The shown pocket balance, before clamping: it also counts a security
    // deposit the rider has paid in, where that feature is live.
    const pocketUnclamped = round2(
        Number(taxi.walletPortion || 0) + Number(delivery.pocketBalanceRaw || 0) + Number(finance.securityDeposited || 0),
    );
    const cashUnclamped = round2(Number(taxi.cashHeldPortion || 0) + Number(delivery.cashInHandRaw || 0));

    const pocketDelta = pocketTarget === undefined || Math.abs(pocketTarget - finance.walletBalance) < 0.005
        ? 0
        : round2(pocketTarget - pocketUnclamped);
    const cashDelta = cashTarget === undefined || Math.abs(cashTarget - finance.cashInHand) < 0.005
        ? 0
        : round2(cashTarget - cashUnclamped);

    if (cashDelta > 0) {
        throw new ValidationError(
            `Cash in hand only goes up when the rider collects cash on an order. It is Rs ${finance.cashInHand}; you can lower it (that records a deposit), not raise it.`,
        );
    }
    if (pocketDelta < 0 && pocketDelta > -1) {
        throw new ValidationError('Pocket balance can be lowered by Rs 1 or more at a time.');
    }
    if (!pocketDelta && !cashDelta) {
        return { changed: false, ...view(finance) };
    }

    const reference = `ADJ-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    if (pocketDelta > 0) {
        await DeliveryBonusTransaction.create({
            deliveryPartnerId: riderId,
            transactionId: reference,
            amount: pocketDelta,
            reference: label,
            ...(adminRef ? { createdByAdminId: adminRef } : {}),
        });
    } else if (pocketDelta < 0) {
        await FoodDeliveryWithdrawal.create({
            deliveryPartnerId: riderId,
            amount: -pocketDelta,
            status: 'approved',
            paymentMethod: 'admin_adjustment',
            adminNote: label,
            transactionId: reference,
            processedAt: new Date(),
        });
    }
    if (cashDelta < 0) {
        await FoodDeliveryCashDeposit.create({
            deliveryPartnerId: riderId,
            amount: -cashDelta,
            paymentMethod: 'cash',
            status: 'Completed',
            ...(adminRef ? { adminId: adminRef } : {}),
            adminNote: label,
        });
    }

    const after = await getRiderFinance(deliveryId);
    return {
        changed: true,
        reference,
        pocketChange: pocketDelta,
        cashChange: cashDelta,
        ...view(after),
    };
}
