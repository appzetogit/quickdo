import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * One rider, one balance, one cash-in-hand -- across taxi, food and groceries.
 *
 * The same person drives a taxi and delivers food, and until now each vertical
 * answered "what do you have?" from its own arithmetic:
 *
 *   taxi  serializeDriverWallet()            -> taxidrivers.wallet.balance
 *   food  getDeliveryPartnerWalletEnhanced() -> derived from orders/bonuses/etc
 *
 * So a driver holding cash from deliveries could still take rides, a rider
 * blocked on the food side saw a healthy taxi wallet, and no screen anywhere
 * showed what the person was actually owed. This module is the single answer
 * both sides now read.
 *
 * Two things had to be reconciled first, and they are the reason this is not
 * simply "add the two numbers":
 *
 * 1. The two sides encode cash-in-hand differently. Food carries an explicit
 *    cashInHand figure. Taxi has no such field -- it encodes cash the rider owes
 *    as a NEGATIVE wallet balance, blocking once the balance falls to
 *    minimumBalanceForOrders (a negative number, e.g. -500). So the signed taxi
 *    balance is two figures superimposed, and is split apart below: the positive
 *    part is money owed TO the rider, the negative part is cash owed BY them.
 *
 * 2. Nothing needed migrating. food_delivery_wallets is a designed-but-dead
 *    collection -- zero documents, no reader, no writer -- and the food side has
 *    always derived its wallet on read. The taxi ledger (wallettransactions)
 *    agrees with its snapshot to the rupee. So unification is a read-path change,
 *    not a data move, and there is no cutover to stage.
 *
 * Deliberately depends on MODELS ONLY, never on the two wallet services that now
 * call it -- otherwise walletService -> riderFinance -> walletService. The few
 * service-level helpers it does need are pulled in with dynamic import inside the
 * function, the pattern order.service.js already uses for the same reason.
 */

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const toObjectId = (value) => {
    const raw = String(value?._id || value || '');
    return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

/**
 * Every identity the same person holds, from any one of them.
 *
 * taxidrivers is the hub: it carries legacyDeliveryPartnerId and
 * legacyQcPartnerId, and both partner records carry driverId back. So the walk
 * is at most two hops whichever end the caller starts from.
 *
 * A partner with no driverId is NOT an error -- riders who signed up through the
 * delivery app before unification are unlinked, and they get their food figures
 * with no taxi contribution rather than a failure.
 */
export const resolveRiderIdentity = async (anyId) => {
    const identity = await resolveHubIdentity(anyId);
    return withQcRiderLink(identity);
};

/**
 * The Quick Commerce rider record a Food rider delivers those orders as, and back.
 *
 * The delivery app only talks to /food/delivery/*; a Quick order is
 * accepted and completed as the linked QC rider record (core/delivery/qcRiderLink),
 * which is matched by driverId or phone and never written to
 * Driver.legacyQcPartnerId. Reading only the hub left qcPartnerId null for every
 * such rider, so their QC earnings were not withdrawable and the cash they
 * collected on QC orders never reached the shared cash limit. Mirrors the same
 * fallback in incentiveService.resolveDriverContext.
 *
 * Fills a MISSING id only: a hub-linked id is never replaced, so a rider whose
 * legacyQcPartnerId is set (and equal to the linked record) is counted once.
 */
const withQcRiderLink = async (identity) => {
    if (!identity || (identity.foodPartnerId && identity.qcPartnerId)) return identity;
    if (!identity.foodPartnerId && !identity.qcPartnerId) return identity;
    try {
        const link = await import('../delivery/qcRiderLink.js');
        if (identity.foodPartnerId && !identity.qcPartnerId) {
            const qcId = toObjectId(await link.qcRiderIdForFoodRider(identity.foodPartnerId));
            if (qcId && String(qcId) !== String(identity.foodPartnerId)) {
                return { ...identity, qcPartnerId: qcId };
            }
        } else if (identity.qcPartnerId && !identity.foodPartnerId) {
            const foodId = toObjectId(await link.foodRiderIdForQcRider(identity.qcPartnerId));
            if (foodId && String(foodId) !== String(identity.qcPartnerId)) {
                return { ...identity, foodPartnerId: foodId };
            }
        }
    } catch (err) {
        logger.warn(`resolveRiderIdentity: qc rider link unavailable: ${err.message}`);
    }
    return identity;
};

/** The hub walk: taxidrivers and the two partner records' driverId. */
const resolveHubIdentity = async (anyId) => {
    const id = toObjectId(anyId);
    if (!id) return { driverId: null, foodPartnerId: null, qcPartnerId: null, linked: false };

    const { Driver } = await import('../../modules/taxi/driver/models/Driver.js');

    const startedFrom = { foodPartnerId: null, qcPartnerId: null };
    let driver = await Driver.findById(id)
        .select('_id legacyDeliveryPartnerId legacyQcPartnerId')
        .lean();

    // Not a driver id, so it is one of the two partner ids: hop to the hub and
    // re-read it, which is what picks up the OTHER vertical's partner id.
    if (!driver) {
        const [{ FoodDeliveryPartner }, { FoodDeliveryPartner: QCDeliveryPartner }] = await Promise.all([
            import('../../modules/food/delivery/models/deliveryPartner.model.js'),
            import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js'),
        ]);

        const foodPartner = await FoodDeliveryPartner.findById(id).select('_id driverId').lean();
        const partner = foodPartner || (await QCDeliveryPartner.findById(id).select('_id driverId').lean());

        if (!partner) {
            return { driverId: null, foodPartnerId: null, qcPartnerId: null, linked: false };
        }
        // Labelled by the collection it was found in. This used to call every
        // unlinked partner a food partner, quick-commerce riders included.
        const unlinked = foodPartner
            ? { driverId: null, foodPartnerId: partner._id, qcPartnerId: null, linked: false }
            : { driverId: null, foodPartnerId: null, qcPartnerId: partner._id, linked: false };

        if (foodPartner) startedFrom.foodPartnerId = partner._id;
        else startedFrom.qcPartnerId = partner._id;

        if (!partner.driverId) {
            // Unlinked: this partner id is the only identity there is.
            return unlinked;
        }

        driver = await Driver.findById(partner.driverId)
            .select('_id legacyDeliveryPartnerId legacyQcPartnerId')
            .lean();

        if (!driver) {
            // Dangling driverId. Treat as unlinked rather than losing the partner.
            return unlinked;
        }
    }

    return {
        driverId: driver._id,
        // The partner id the caller started from is theirs even when the hub does
        // not name it (a hub carrying only the other vertical's id).
        foodPartnerId: driver.legacyDeliveryPartnerId || startedFrom.foodPartnerId || null,
        qcPartnerId: driver.legacyQcPartnerId || startedFrom.qcPartnerId || null,
        linked: true,
    };
};

/**
 * The one shared cash ceiling.
 *
 * Taken from the food admin setting because it is the only cash limit anybody
 * actually administers -- FoodFeeSettings.codOrderLimit, falling back to
 * food_delivery_cash_limits.deliveryCashLimit.
 *
 * The taxi side's own derived cashLimit is NOT a candidate: it is
 * |min(minimumBalanceForOrders, 0)| and reads 0 for the live drivers, so
 * treating "shared" as "the stricter of the two" would block every rider the
 * moment they held a single rupee. The taxi minimum-balance rule stays a
 * separate wallet-minimum concern, applied alongside this in resolveBlockState.
 */
export const resolveSharedCashLimit = async ({ partnerId } = {}) => {
    let legacy = null;
    let withdrawalLimit = 100;
    try {
        const { getDeliveryCashLimitSettings } = await import(
            '../../modules/food/admin/services/admin.service.js'
        );
        const settings = await getDeliveryCashLimitSettings();
        legacy = Math.max(0, Number(settings?.deliveryCashLimit) || 0);
        withdrawalLimit = Math.max(0, Number(settings?.deliveryWithdrawalLimit) || 100);
    } catch (err) {
        logger.warn(`resolveSharedCashLimit: food setting unavailable: ${err.message}`);
    }

    /*
     * The platform setting decides; the food admin figure is today's value and the
     * fallback until someone sets `finance.cashLimit` in Platform settings.
     *
     * No vertical: a rider's limit is ONE figure across taxi, food and quick
     * commerce -- the whole point of riderFinance -- so it is set globally, or per
     * partner (keyed on the rider's hub id). Vertical overrides are for partners who
     * work one vertical, such as service providers.
     */
    const { resolveCashLimit } = await import('./cashLimit.service.js');
    const resolved = await resolveCashLimit({ partnerId, legacy });
    return {
        cashLimit: resolved.cashLimit,
        configuredCashLimit: resolved.configuredCashLimit,
        enforceCashLimit: resolved.enforce,
        cashLimitSource: resolved.source,
        withdrawalLimit,
    };
};

/** The taxi wallet rules, read straight from app settings to avoid a cycle. */
const resolveTaxiWalletRules = async () => {
    const { getWalletSettings } = await import('../../modules/taxi/services/appSettingsService.js');
    const { env } = await import('../../config/env.js');

    const settings = await getWalletSettings();
    const configured = Number(settings?.driver_wallet_minimum_amount_to_get_an_order);
    const minimumBalanceForOrders = Number.isFinite(configured)
        ? round2(configured)
        : -Math.max(0, Number(env?.driverWallet?.defaultCashLimit) || 500);

    const isEnabled = (value, fallback = true) => {
        if (value === undefined || value === null || value === '') return fallback;
        return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
    };

    return {
        minimumBalanceForOrders,
        minimumTopUpAmount: Math.max(0, Number(settings?.minimum_amount_added_to_wallet) || 0),
        minimumTransferAmount: Math.max(0, Number(settings?.minimum_wallet_amount_for_transfer) || 0),
        isWalletEnabled: isEnabled(settings?.show_wallet_feature_for_driver, true),
        isTransferEnabled: isEnabled(settings?.enable_wallet_transfer_driver, true),
    };
};

/**
 * Split the signed taxi balance into the two figures the unified model needs.
 *
 * A balance of +500 is five hundred rupees owed to the rider and no cash held.
 * A balance of -200 is nothing owed to them and two hundred rupees of platform
 * cash in their pocket. Exported for the checks, because getting this backwards
 * is the single easiest way to turn money owed into money owing.
 */
export const splitSignedTaxiBalance = (signedBalance) => {
    const signed = round2(signedBalance);
    return {
        signed,
        walletPortion: signed > 0 ? signed : 0,
        cashHeldPortion: signed < 0 ? round2(-signed) : 0,
    };
};

/*
 * Where a rider's delivery money lives, per vertical. NOT shared collections.
 *
 * This used to say quick commerce wrote to the food_* collections, because its
 * models declare `collection: 'food_orders'` and so on. But each one also passes
 * an explicit third argument to mongoose.model(), and that wins:
 *
 *     mongoose.model('QCOrder', orderSchema, 'qc_orders')
 *
 * So every quick-commerce order, deposit, withdrawal and bonus is in a qc_*
 * collection, and reading only the food models meant this "single source of truth"
 * never saw any of them: QC earnings were not withdrawable, QC cash on delivery
 * never counted toward the shared cash limit, and -- the dangerous one -- an
 * APPROVED QC withdrawal was never subtracted, so money paid out through the
 * grocery app still showed as available to withdraw again. Confirmed by resolving
 * the models' collection names at runtime, not by reading schema options.
 */
const DELIVERY_MONEY_SOURCES = [
    {
        vertical: 'food',
        load: () => Promise.all([
            import('../../modules/food/orders/models/order.model.js'),
            import('../../modules/food/delivery/models/foodDeliveryCashDeposit.model.js'),
            import('../../modules/food/delivery/models/foodDeliveryWithdrawal.model.js'),
            import('../../modules/food/admin/models/deliveryBonusTransaction.model.js'),
        ]),
    },
    {
        vertical: 'quickCommerce',
        load: () => Promise.all([
            import('../../modules/quickCommerce/modules/food/orders/models/order.model.js'),
            import('../../modules/quickCommerce/modules/food/delivery/models/foodDeliveryCashDeposit.model.js'),
            import('../../modules/quickCommerce/modules/food/delivery/models/foodDeliveryWithdrawal.model.js'),
            import('../../modules/quickCommerce/modules/food/admin/models/deliveryBonusTransaction.model.js'),
        ]),
    },
];

const EMPTY_DELIVERY_MONEY = Object.freeze({
    totalEarned: 0,
    grossCashCollected: 0,
    totalDeposited: 0,
    cashInHandRaw: 0,
    cashInHand: 0,
    totalBonus: 0,
    totalWithdrawn: 0,
    pendingWithdrawals: 0,
    pocketBalanceRaw: 0,
    pocketBalance: 0,
    totalDeliveries: 0,
});

/**
 * Food + quick-commerce money, for every partner identity the rider holds.
 *
 * Every id is matched against BOTH verticals' collections, rather than the food id
 * against food and the QC id against QC. Pairing them depends on the identity
 * labels being right, and they were not (an unlinked QC partner was labelled a
 * food partner). Matching everywhere cannot double-count: the verticals are
 * separate collections, and a row carries exactly one deliveryPartnerId.
 */
const resolveDeliveryMoney = async (partnerIds) => {
    // De-duplicated: the same id reached two ways (hub link and qcRiderLink) must
    // be one identity, never two.
    const ids = [...new Map(partnerIds.map(toObjectId).filter(Boolean).map((id) => [String(id), id])).values()];
    if (!ids.length) return { ...EMPTY_DELIVERY_MONEY, byVertical: {} };

    const perVertical = await Promise.all(DELIVERY_MONEY_SOURCES.map((source) => sumDeliveryMoney(source, ids)));
    const byVertical = Object.fromEntries(
        DELIVERY_MONEY_SOURCES.map((source, i) => [source.vertical, perVertical[i]]),
    );
    return { ...combineDeliveryMoney(perVertical), byVertical };
};

/** One vertical's money, derived exactly as before, from its own collections. */
const sumDeliveryMoney = async (source, ids) => {
    const [{ FoodOrder }, { FoodDeliveryCashDeposit }, { FoodDeliveryWithdrawal }, { DeliveryBonusTransaction }] =
        await source.load();

    const [orderAgg, depositAgg, bonusAgg, withdrawalAgg] = await Promise.all([
        // Earnings and gross COD cash in one pass over the same matched set.
        FoodOrder.aggregate([
            { $match: { 'dispatch.deliveryPartnerId': { $in: ids }, orderStatus: 'delivered' } },
            {
                $group: {
                    _id: null,
                    totalEarned: { $sum: { $ifNull: ['$riderEarning', 0] } },
                    totalDeliveries: { $sum: 1 },
                    grossCashCollected: {
                        $sum: {
                            $cond: [
                                { $eq: ['$payment.method', 'cash'] },
                                { $ifNull: ['$pricing.total', 0] },
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
        FoodDeliveryCashDeposit.aggregate([
            { $match: { deliveryPartnerId: { $in: ids }, status: 'Completed' } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } },
        ]),
        DeliveryBonusTransaction.aggregate([
            { $match: { deliveryPartnerId: { $in: ids } } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } },
        ]),
        FoodDeliveryWithdrawal.aggregate([
            { $match: { deliveryPartnerId: { $in: ids } } },
            {
                $group: {
                    _id: null,
                    totalWithdrawn: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amount', 0] } },
                    pendingWithdrawals: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
                },
            },
        ]),
    ]);

    return {
        totalEarned: round2(orderAgg?.[0]?.totalEarned),
        grossCashCollected: round2(orderAgg?.[0]?.grossCashCollected),
        totalDeposited: round2(depositAgg?.[0]?.total),
        totalBonus: round2(bonusAgg?.[0]?.total),
        totalWithdrawn: round2(withdrawalAgg?.[0]?.totalWithdrawn),
        pendingWithdrawals: round2(withdrawalAgg?.[0]?.pendingWithdrawals),
        totalDeliveries: Number(orderAgg?.[0]?.totalDeliveries) || 0,
    };
};

/**
 * Sum the verticals' raw figures, then derive. Pure, for the checks.
 *
 * Summed BEFORE deriving: cashInHandRaw and pocketBalanceRaw are computed once over
 * the totals, so a deposit or withdrawal made through one app settles money earned
 * through the other.
 */
export const combineDeliveryMoney = (perVertical = []) => {
    const total = (key) => round2(perVertical.reduce((acc, v) => acc + (Number(v?.[key]) || 0), 0));

    const totalEarned = total('totalEarned');
    const grossCashCollected = total('grossCashCollected');
    const totalDeposited = total('totalDeposited');
    const totalBonus = total('totalBonus');
    const totalWithdrawn = total('totalWithdrawn');
    const pendingWithdrawals = total('pendingWithdrawals');

    return {
        totalEarned,
        grossCashCollected,
        totalDeposited,
        // Deposits settle cash already collected, so this nets to zero once the
        // rider has paid in -- which is why the one live deposit on production
        // was never "missing" from anywhere. It was already being subtracted here.
        //
        // Unclamped for the same reason as pocketBalanceRaw. A rider holding Rs 200
        // of taxi-collected cash and none from deliveries can now settle it through
        // the delivery app's deposit flow; if the food figure clamped at zero first,
        // that deposit would vanish and the combined cash would still read 200 --
        // the rider could pay the same money in forever and stay blocked.
        cashInHandRaw: round2(grossCashCollected - totalDeposited),
        cashInHand: Math.max(0, round2(grossCashCollected - totalDeposited)),
        totalBonus,
        totalWithdrawn,
        pendingWithdrawals,
        // Pending is subtracted too: money already requested is not available to
        // request again.
        //
        // Two figures on purpose. `pocketBalanceRaw` may go NEGATIVE and is the one
        // the unified balance is built from; `pocketBalance` is the clamped
        // delivery-only view kept for the breakdown.
        //
        // Clamping before the verticals are summed would let a rider withdraw the
        // same money forever: a rider with no food earnings and Rs 500 of taxi
        // balance withdraws 500 through the delivery app, the food side computes
        // max(0, -500) = 0, and the unified balance still reads 500. Every repeat
        // request would be approved. Clamping only once, after summing, is what
        // makes a withdrawal actually reduce the balance it was paid from.
        pocketBalanceRaw: round2(totalEarned + totalBonus - totalWithdrawn - pendingWithdrawals),
        pocketBalance: Math.max(0, round2(totalEarned + totalBonus - totalWithdrawn - pendingWithdrawals)),
        totalDeliveries: perVertical.reduce((acc, v) => acc + (Number(v?.totalDeliveries) || 0), 0),
    };
};

/**
 * Whether the rider may be offered work, from both rules at once.
 *
 * Two independent gates, and both must pass:
 *
 *   - the taxi minimum-balance rule, unchanged, on the SIGNED taxi balance. Kept
 *     as-is so no existing taxi behaviour regresses.
 *   - the shared cash ceiling, on COMBINED cash in hand. This is the new one: a
 *     rider over the limit from deliveries now stops being offered rides too,
 *     which is the whole point of a shared limit.
 */
const resolveBlockState = ({ taxiSigned, cashInHand, cashLimit, rules, snapshotBlocked }) => {
    if (!rules.isWalletEnabled) {
        return { isBlocked: true, reason: 'wallet_disabled' };
    }
    if (taxiSigned <= rules.minimumBalanceForOrders) {
        return { isBlocked: true, reason: 'below_minimum_balance' };
    }
    if (cashLimit > 0 && cashInHand >= cashLimit) {
        return { isBlocked: true, reason: 'cash_limit_reached' };
    }
    // An admin hold on the taxi record still blocks; nothing above overrides it.
    if (snapshotBlocked) {
        return { isBlocked: true, reason: 'blocked_by_admin' };
    }
    return { isBlocked: false, reason: null };
};

/**
 * The single source of truth. Everything else in this file exists to serve it.
 *
 * @param {string|object} anyId  a taxi driver id, a food partner id, or a QC partner id
 */
export const getRiderFinance = async (anyId, { driverWallet = null } = {}) => {
    const identity = await resolveRiderIdentity(anyId);

    let wallet = driverWallet;

    /*
     * `driverWallet` exists for callers holding a driver document that is newer
     * than the database: applyDriverWalletAdjustment serializes the wallet inside
     * its own transaction, and a fresh read here would not see the uncommitted
     * balance -- so a rider who just topped up would be shown their old figure.
     *
     * Identity is still read fresh either way. The legacy partner links do not
     * change during a wallet transaction, and a caller may well have passed a
     * document those fields were never selected onto.
     */
    if (!wallet && identity.driverId) {
        const { Driver } = await import('../../modules/taxi/driver/models/Driver.js');
        const driver = await Driver.findById(identity.driverId).select('_id wallet').lean();
        wallet = driver?.wallet || null;
    }

    const [rules, limits, delivery] = await Promise.all([
        resolveTaxiWalletRules(),
        // Partner overrides are keyed on the rider's hub identity: the taxi driver id
        // for a linked rider, else their own partner id.
        resolveSharedCashLimit({
            partnerId: identity.driverId || identity.foodPartnerId || identity.qcPartnerId || undefined,
        }),
        resolveDeliveryMoney([identity.foodPartnerId, identity.qcPartnerId]),
    ]);

    const taxi = splitSignedTaxiBalance(wallet?.balance || 0);

    // One balance: what the platform owes this person, whichever stream earned it.
    // Built from the UNCLAMPED delivery figure, then clamped once -- see the note
    // on pocketBalanceRaw for the double-withdrawal this prevents.
    const walletBalance = Math.max(0, round2(taxi.walletPortion + delivery.pocketBalanceRaw));
    // One cash-in-hand: platform money in their pocket, whichever stream collected it.
    // Clamped once, after summing -- see the note on cashInHandRaw.
    const cashInHand = Math.max(0, round2(taxi.cashHeldPortion + delivery.cashInHandRaw));

    const block = resolveBlockState({
        taxiSigned: taxi.signed,
        cashInHand,
        cashLimit: limits.cashLimit,
        rules,
        snapshotBlocked: Boolean(wallet?.isBlocked),
    });

    // How much more work they can take on: whichever of the two gates binds first.
    const taxiHeadroom = round2(taxi.signed - rules.minimumBalanceForOrders);
    const cashHeadroom = limits.cashLimit > 0 ? round2(limits.cashLimit - cashInHand) : Infinity;
    const availableForOrders = Math.max(0, Math.min(taxiHeadroom, cashHeadroom));

    return {
        driverId: identity.driverId ? String(identity.driverId) : null,
        foodPartnerId: identity.foodPartnerId ? String(identity.foodPartnerId) : null,
        qcPartnerId: identity.qcPartnerId ? String(identity.qcPartnerId) : null,
        linked: identity.linked,

        // The unified figures. Every screen shows these.
        walletBalance,
        cashInHand,
        cashLimit: limits.cashLimit,
        availableCashLimit: Math.max(0, round2(limits.cashLimit - cashInHand)),
        availableForOrders: Number.isFinite(availableForOrders) ? availableForOrders : 0,
        isBlocked: block.isBlocked,
        blockReason: block.reason,

        // Where each figure came from, so a disagreement is diagnosable rather
        // than a mystery in one of two codebases.
        breakdown: {
            taxi: {
                signedBalance: taxi.signed,
                walletPortion: taxi.walletPortion,
                cashHeldPortion: taxi.cashHeldPortion,
            },
            delivery,
        },
        rules: {
            ...rules,
            withdrawalLimit: limits.withdrawalLimit,
            // Where the cash limit came from, for the admin and support screens.
            cashLimitSource: limits.cashLimitSource,
            enforceCashLimit: limits.enforceCashLimit,
        },
    };
};

export const __testables = {
    round2,
    splitSignedTaxiBalance,
    resolveBlockState,
};

/**
 * One vertical's delivery models and raw money figures, for the ledger projector
 * and its reconciler -- so the ledger is checked against the SAME derivation every
 * rider balance uses, not a second copy of it.
 */
export const DELIVERY_VERTICALS = Object.freeze(DELIVERY_MONEY_SOURCES.map((s) => s.vertical));

export const loadDeliveryModels = async (vertical) => {
    const source = DELIVERY_MONEY_SOURCES.find((s) => s.vertical === vertical);
    if (!source) throw new Error(`Unknown delivery vertical: ${vertical}`);
    const [{ FoodOrder }, { FoodDeliveryCashDeposit }, { FoodDeliveryWithdrawal }, { DeliveryBonusTransaction }] =
        await source.load();
    return {
        Order: FoodOrder,
        CashDeposit: FoodDeliveryCashDeposit,
        Withdrawal: FoodDeliveryWithdrawal,
        Bonus: DeliveryBonusTransaction,
    };
};

export const sumDeliveryMoneyForVertical = async (vertical, partnerIds) => {
    const source = DELIVERY_MONEY_SOURCES.find((s) => s.vertical === vertical);
    if (!source) throw new Error(`Unknown delivery vertical: ${vertical}`);
    const ids = partnerIds.map(toObjectId).filter(Boolean);
    return combineDeliveryMoney([await sumDeliveryMoney(source, ids)]);
};
