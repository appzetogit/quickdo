import mongoose from 'mongoose';
import { env } from '../../../../config/env.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { SetPrice } from '../../admin/models/SetPrice.js';
import { Driver } from '../models/Driver.js';
import { WalletTransaction } from '../models/WalletTransaction.js';
import { Ride } from '../../user/models/Ride.js';
import { getWalletSettings } from '../../services/appSettingsService.js';
import { getRiderFinance, resolveSharedCashLimit } from '../../../../core/finance/riderFinance.service.js';
import { mirrorToLedger, taxiWalletRowToEntry } from '../../../../core/finance/ledgerMirror.js';

const normalizeAmount = (value, fieldName = 'amount') => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    throw new ApiError(400, `${fieldName} must be a valid number`);
  }

  return Math.round(amount * 100) / 100;
};

const normalizePaymentMethod = (value) => (
  String(value || '').trim().toLowerCase() === 'cash' ? 'cash' : 'online'
);

const normalizeCommissionType = (value) => {
  const numericValue = Number(value);
  return numericValue === 1 ? 'percentage' : 'fixed';
};

const computeCommissionAmount = ({ fare, type, value }) => {
  const safeFare = normalizeAmount(fare, 'fare');
  const safeValue = Math.max(normalizeAmount(value || 0, 'commission'), 0);

  if (normalizeCommissionType(type) === 'percentage') {
    return Math.min(Math.round((safeFare * safeValue)) / 100, safeFare);
  }

  return Math.min(safeValue, safeFare);
};

const resolveCommissionConfigForRide = async (ride, session) => {
  if (ride?.pricingSnapshot?.admin_commission_from_driver !== undefined) {
    return {
      source: ride.pricingSnapshot?.setPriceId ? 'ride_snapshot' : 'ride_snapshot_fallback',
      type: Number(ride.pricingSnapshot?.admin_commission_type_from_driver ?? 1),
      value: Number(ride.pricingSnapshot?.admin_commission_from_driver ?? 0),
    };
  }

  if (ride?.vehicleTypeId) {
    const normalizedServiceType = String(ride?.serviceType || '').trim().toLowerCase();
    const savedTransportType = String(ride.transport_type || '').trim().toLowerCase();
    const normalizedTransportType =
      normalizedServiceType === 'parcel'
        ? (savedTransportType === 'delivery' || savedTransportType === 'both' ? savedTransportType : 'delivery')
        : (savedTransportType || 'taxi');
    const filters = [
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        ...(ride.service_location_id ? { service_location_id: ride.service_location_id } : {}),
        transport_type: normalizedTransportType,
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        ...(ride.service_location_id ? { service_location_id: ride.service_location_id } : {}),
        transport_type: 'both',
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        transport_type: normalizedTransportType,
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        transport_type: 'both',
      },
    ];

    for (const filter of filters) {
      const setPrice = await SetPrice.findOne(filter).sort({ updatedAt: -1, createdAt: -1 }).session(session).lean();
      if (setPrice) {
        return {
          source: 'set_price_lookup',
          type: Number(setPrice.admin_commission_type_from_driver ?? 1),
          value: Number(setPrice.admin_commission_from_driver ?? 0),
          setPriceId: setPrice._id,
        };
      }
    }
  }

  return {
    source: 'env_fallback',
    type: 1,
    value: Number(env.driverWallet.commissionPercent || 0),
  };
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
};

const isEnabledSetting = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const resolveWalletRules = async () => {
  const walletSettings = await getWalletSettings();
  const configuredMinimumBalance = Number(walletSettings.driver_wallet_minimum_amount_to_get_an_order);
  const minimumBalanceForOrders = Number.isFinite(configuredMinimumBalance)
    ? Math.round(configuredMinimumBalance * 100) / 100
    : -toNonNegativeNumber(env.driverWallet.defaultCashLimit, 500);

  return {
    minimumBalanceForOrders,
    cashLimit: Math.abs(Math.min(minimumBalanceForOrders, 0)),
    minimumTopUpAmount: toNonNegativeNumber(walletSettings.minimum_amount_added_to_wallet, 0),
    minimumTransferAmount: toNonNegativeNumber(walletSettings.minimum_wallet_amount_for_transfer, 0),
    isWalletEnabled: isEnabledSetting(walletSettings.show_wallet_feature_for_driver, true),
    isTransferEnabled: isEnabledSetting(walletSettings.enable_wallet_transfer_driver, true),
  };
};

const getWalletSnapshot = async (driver) => {
  const rules = await resolveWalletRules();
  const balance = Number(driver?.wallet?.balance || 0);

  return {
    balance,
    cashLimit: rules.cashLimit,
    minimumBalanceForOrders: rules.minimumBalanceForOrders,
    availableForOrders: Math.round((balance - rules.minimumBalanceForOrders) * 100) / 100,
    isBlocked: Boolean(driver?.wallet?.isBlocked),
    rules,
  };
};

/*
 * The driver app's wallet, now answered by the unified rider finance service.
 *
 * `balance` is no longer this vertical's own figure: it is ONE balance covering
 * rides, deliveries and groceries, because the person driving the taxi is the
 * person delivering the food and they were being shown two unrelated numbers.
 *
 * Every key the app already read keeps its name and meaning. What changed is
 * where the numbers come from, plus three additions -- cashInHand,
 * availableCashLimit and blockReason -- that the taxi side never had a way to
 * express. `taxiSignedBalance` is kept alongside so this vertical's own ledger
 * position is still inspectable when the unified figure is queried.
 *
 * The driver document is passed through rather than re-read: this is called from
 * inside applyDriverWalletAdjustment's transaction, where a fresh read would miss
 * the uncommitted balance and show the rider their pre-top-up figure.
 */
export const serializeDriverWallet = async (driver) => {
  const finance = await getRiderFinance(driver?._id, { driverWallet: driver?.wallet || null });

  return {
    balance: finance.walletBalance,
    cashInHand: finance.cashInHand,
    cashLimit: finance.cashLimit,
    availableCashLimit: finance.availableCashLimit,
    minimumBalanceForOrders: finance.rules.minimumBalanceForOrders,
    availableForOrders: finance.availableForOrders,
    isWalletEnabled: finance.rules.isWalletEnabled,
    isTransferEnabled: finance.rules.isTransferEnabled,
    minimumTopUpAmount: finance.rules.minimumTopUpAmount,
    minimumTransferAmount: finance.rules.minimumTransferAmount,
    isBlocked: finance.isBlocked,
    blockReason: finance.blockReason,
    taxiSignedBalance: finance.breakdown.taxi.signedBalance,
    breakdown: finance.breakdown,
  };
};

export const ensureDriverWalletCanAcceptRide = async (driverOrId, { session } = {}) => {
  const driver =
    typeof driverOrId === 'object' && driverOrId?._id
      ? driverOrId
      : await Driver.findById(driverOrId).session(session);

  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  /*
   * Cash collected on deliveries now blocks rides.
   *
   * This is the behaviour the shared cash limit exists for: a rider over the
   * ceiling was previously refused food orders and free to keep taking rides
   * against the very same uncollected cash. getRiderFinance applies both gates --
   * this vertical's minimum-balance rule, unchanged, and the shared ceiling over
   * combined cash in hand.
   *
   * The session-loaded wallet is passed through so the check sees the same
   * balance as the surrounding transaction.
   */
  const finance = await getRiderFinance(driver._id, { driverWallet: driver?.wallet || null });

  if (finance.isBlocked) {
    await Driver.findByIdAndUpdate(driver._id, {
      'wallet.cashLimit': finance.cashLimit,
      'wallet.isBlocked': true,
    });

    const messages = {
      wallet_disabled: 'Driver wallet is disabled by admin.',
      below_minimum_balance: 'Driver wallet minimum balance is not met. Please top up to accept rides.',
      cash_limit_reached: `Cash in hand of Rs ${finance.cashInHand} has reached the limit of Rs ${finance.cashLimit}. Please deposit collected cash to continue.`,
      blocked_by_admin: 'Driver wallet is blocked by admin.',
    };
    throw new ApiError(403, messages[finance.blockReason] || 'Driver wallet cannot accept rides right now.');
  }

  if (Number(driver?.wallet?.cashLimit) !== finance.cashLimit || driver?.wallet?.isBlocked) {
    await Driver.findByIdAndUpdate(driver._id, {
      'wallet.cashLimit': finance.cashLimit,
      'wallet.isBlocked': false,
    });
  }

  return finance;
};

export const applyDriverWalletAdjustment = async ({
  driverId,
  amount,
  type,
  rideId = null,
  description = '',
  metadata = {},
  session = null,
}) => {
  const normalizedAmount = normalizeAmount(amount);

  if (!normalizedAmount) {
    throw new ApiError(400, 'Wallet adjustment amount cannot be zero');
  }

  const driver = await Driver.findById(driverId).session(session);

  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const before = await getWalletSnapshot(driver);

  /*
   * wallet.cashLimit stores the SHARED ceiling, not this vertical's derived one.
   *
   * ensureDriverWalletCanAcceptRide writes the shared figure, and if this path
   * kept writing the taxi-local |min(minimumBalanceForOrders, 0)| the two writers
   * would overwrite each other on every ride and every top-up, leaving the field
   * meaning whichever ran last.
   *
   * Only the limit is fetched, not the whole finance view: this runs on every ride
   * settlement and every top-up, and the delivery aggregates behind a full
   * getRiderFinance call would be paid for on that hot path to read one number.
   */
  const { cashLimit: sharedCashLimit } = await resolveSharedCashLimit({ partnerId: driverId });

  // ponytail: compute balance AND isBlocked in one atomic aggregation-pipeline update so the
  // block flag is derived from the real post-balance. Deriving it from the pre-read snapshot
  // (then $set) lost the update under concurrent adjustments.
  //
  // Only the minimum-balance rule is applied here. The shared cash ceiling needs
  // the delivery aggregates, which an aggregation-pipeline update cannot reach --
  // so wallet.isBlocked stays this vertical's fast cache, while the authoritative
  // answer is recomputed on every read by serializeDriverWallet and enforced by
  // ensureDriverWalletCanAcceptRide before any ride is accepted.
  const walletEnabled = before.rules.isWalletEnabled;
  const minBal = before.minimumBalanceForOrders;
  const updatedDriver = await Driver.findByIdAndUpdate(
    driverId,
    [
      {
        $set: {
          'wallet.balance': {
            $round: [{ $add: [{ $ifNull: ['$wallet.balance', 0] }, normalizedAmount] }, 2],
          },
          'wallet.cashLimit': sharedCashLimit,
        },
      },
      {
        $set: {
          'wallet.isBlocked': walletEnabled ? { $lte: ['$wallet.balance', minBal] } : true,
        },
      },
    ],
    { returnDocument: 'after', session },
  );

  const balanceAfter = Math.round((updatedDriver.wallet.balance) * 100) / 100;
  const balanceBefore = Math.round((balanceAfter - normalizedAmount) * 100) / 100;
  const isBlockedAfter = Boolean(updatedDriver.wallet.isBlocked);

  const [transaction] = await WalletTransaction.create(
    [
      {
        driverId,
        rideId,
        type,
        amount: normalizedAmount,
        balanceBefore,
        balanceAfter,
        cashLimit: sharedCashLimit,
        isBlockedAfter,
        description,
        metadata,
      },
    ],
    { session },
  );

  // Dual-write to the master ledger (off unless LEDGER_DUAL_WRITE_ENABLED). Not
  // awaited, cannot throw, and inside a transaction it waits for the commit --
  // see core/finance/ledgerMirror.js.
  mirrorToLedger(taxiWalletRowToEntry(transaction), { session });

  return {
    driver: updatedDriver,
    wallet: await serializeDriverWallet(updatedDriver),
    transaction,
  };
};

export const topUpDriverWallet = async ({ driverId, amount, metadata = {} }) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const walletSettings = await getWalletSettings();
    if (!isEnabledSetting(walletSettings.show_wallet_feature_for_driver, true)) {
      throw new ApiError(403, 'Driver wallet is disabled by admin');
    }

    const minimumTopUpAmount = toNonNegativeNumber(walletSettings.minimum_amount_added_to_wallet, 0);
    const normalizedTopUpAmount = Math.abs(normalizeAmount(amount));

    if (minimumTopUpAmount > 0 && normalizedTopUpAmount < minimumTopUpAmount) {
      throw new ApiError(400, `amount must be at least ${minimumTopUpAmount}`);
    }

    const result = await applyDriverWalletAdjustment({
      driverId,
      amount: normalizedTopUpAmount,
      type: 'top_up',
      description: 'Driver wallet top-up',
      metadata: {
        ...metadata,
        minimumTopUpAmount,
      },
      session,
    });

    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/*
 * The promo discount on this ride, which the platform funds. pricingSnapshot
 * carries it for rides booked since it existed (0 when an accepted bid
 * replaced the promo price); older rides fall back to the promo record.
 */
const resolvePlatformFundedPromoDiscount = (ride) => {
  const snapshotted = ride?.pricingSnapshot?.promo_discount_applied;
  if (snapshotted !== null && snapshotted !== undefined && Number.isFinite(Number(snapshotted))) {
    return Math.max(0, normalizeAmount(snapshotted, 'promoDiscount'));
  }

  return ride?.acceptedBidId ? 0 : Math.max(0, normalizeAmount(ride?.promo?.discount_amount || 0, 'promoDiscount'));
};

const PAID_COLLECTION_STATUSES = new Set(['paid', 'captured', 'completed']);

/*
 * Whether an online ride's fare is already in the platform's hands by a route
 * only the server writes: a subscription that covered it at booking, or a
 * driver-raised Razorpay QR / payment link that refreshDriverPaymentCollection
 * confirmed with Razorpay and that covers the fare. The driver's app can no
 * longer write an online ride's collection (rideService.updateRideLifecycle).
 */
export const isOnlineCollectionConfirmed = (ride) => {
  const collection = ride?.driverPaymentCollection || {};
  const status = String(collection.status || '').trim().toLowerCase();
  if (!PAID_COLLECTION_STATUSES.has(status)) {
    return false;
  }

  const provider = String(collection.provider || '').trim().toLowerCase();
  if (provider === 'subscription') {
    return Boolean(ride?.subscriptionUsage?.covered);
  }

  return provider === 'razorpay'
    && Boolean(String(collection.providerId || '').trim())
    && Number(collection.amount || 0) + 0.001 >= Number(ride?.fare || 0);
};

export const settleCompletedRideWallet = async ({ rideId }) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, walletSettledAt: null, driverId: { $ne: null } },
      { $set: { walletSettledAt: new Date() } },
      { returnDocument: 'after', session },
    );

    if (!ride) {
      await session.commitTransaction();
      return null;
    }

    /*
     * `fare` is everything the rider is charged: the agreed fare (after any
     * promo), waiting, an admin's extra, and a cancellation fee they owed from
     * an earlier ride (rideService.updateRideLifecycle adds it at completion).
     */
    const fare = normalizeAmount(ride.fare || 0, 'fare');

    /*
     * The recovered cancellation fee is the platform's, whichever way the
     * price row sends cancellation fees. If it goes to the admin, it is the
     * admin's. If it goes to the driver, the driver of the CANCELLED ride was
     * already paid it from the platform at cancellation
     * (dispatchService.settleUserCancellationFee), and this recovery pays the
     * platform back. The driver of this ride earns nothing on it -- and loses
     * nothing to it: he is settled on the fare net of the fee.
     */
    const recoveredDue = Math.min(fare, Math.max(0, normalizeAmount(ride.recovered_cancellation_due || 0, 'recoveredDue')));

    /*
     * A promo is funded by the platform. The promo record has no field saying
     * otherwise (admin/promotions/models/PromoCode.js), so every promo is. The
     * driver is settled on the pre-promo fare -- commission included -- and
     * the platform absorbs the discount. It used to be taken off both the
     * commissionable fare and the driver's earnings, so the driver funded it.
     */
    const promoDiscountAmount = resolvePlatformFundedPromoDiscount(ride);
    /*
     * Ride insurance is the platform's (owed to the insurer), like the
     * recovered fee: in the fare the rider pays, out of what the driver is
     * settled on. On a cash ride he hands it over with the commission.
     */
    const insuranceFee = Math.min(
      Math.max(0, fare - recoveredDue),
      Math.max(0, normalizeAmount(ride.insurance_fee || 0, 'insuranceFee')),
    );
    const grossFare = Math.max(0, normalizeAmount(fare - recoveredDue - insuranceFee + promoDiscountAmount, 'grossFare'));

    const surgeAmount = Math.max(0, normalizeAmount(ride?.pricingSnapshot?.ride_surge_amount || 0, 'surgeAmount'));
    const commissionableFare = Math.max(0, normalizeAmount(grossFare - surgeAmount, 'commissionableFare'));
    const commissionConfig = await resolveCommissionConfigForRide(ride, session);
    const commissionAmount = computeCommissionAmount({
      fare: commissionableFare,
      type: commissionConfig.type,
      value: commissionConfig.value,
    });
    const paymentMethod = normalizePaymentMethod(ride.paymentMethod);
    const cancellationFeeGoesTo = ride?.pricingSnapshot?.cancellation_fee_goes_to === 'driver' ? 'driver' : 'admin';
    /*
     * The platform incentive, from Master > Delivery Earnings.
     *
     * Taxi drivers sat outside that engine: an admin who set an incentive for
     * "All modules" paid food and quick-commerce riders and silently paid taxi
     * drivers nothing. The fare TABLE is still taxi's own -- a ride is priced by
     * base fare, per km and per minute, which no delivery distance band can
     * express -- but the incentive is the same shape everywhere, so it is the
     * part that unifies.
     *
     * Paid on the fare the driver actually earns from, and it needs no separate
     * settlement: adding it here carries it through BOTH paths below. On cash,
     * `driverEarnings - fare` turns into a smaller debit, or a credit when the
     * incentive exceeds the commission. On online, it is part of what is
     * credited. Zero unless an admin has set a rule, so nothing changes until
     * they do.
     */
    let incentiveAmount = 0;
    try {
        const { resolveIncentive } = await import('../../../../core/finance/deliveryEarnings.service.js');
        const { taxiZoneIdOfRide } = await import('../../../../core/zones/taxiZone.js');
        // The pickup's zone: a zone's own incentive beats taxi's and the global one.
        const rule = await resolveIncentive({ vertical: 'taxi', zoneId: await taxiZoneIdOfRide(ride), legacy: null });
        if (rule.isEnabled && rule.incentivePercent > 0 && grossFare >= rule.minOrderAmount) {
            incentiveAmount = normalizeAmount(
                Math.round(grossFare * (rule.incentivePercent / 100) * 100) / 100,
                'incentiveAmount',
            );
        }
    } catch (err) {
        // A settings read must never stop a completed ride being settled. No
        // incentive is the safe direction: the driver is paid his fare either
        // way, and an unpaid incentive is recoverable where a stuck ride is not.
        console.warn(`[taxi wallet] incentive unavailable, settling without it: ${err.message}`);
    }

    const driverEarnings = Math.max(
        normalizeAmount(grossFare - commissionAmount + incentiveAmount, 'driverEarnings'),
        0,
    );

    /*
     * Cash: the driver is holding the whole fare. His wallet moves by what he
     * earned less what he holds -- a debit of commission + recovered fee, less
     * any promo the platform owes him (a credit, when the promo is bigger).
     *
     * Online: the money is with the platform, and only once the rider has
     * actually paid. The earnings used to be credited here, at completion, so
     * a rider who never paid was paid for by the platform. They are credited
     * now when the payment is confirmed (creditOnlineRideEarnings), or here if
     * it already was: a subscription ride, or a driver QR the server has
     * confirmed with Razorpay.
     */
    const earningsSettledNow = paymentMethod === 'cash' || isOnlineCollectionConfirmed(ride);
    const amount = paymentMethod === 'cash'
      ? normalizeAmount(driverEarnings - fare, 'cashSettlement')
      : (earningsSettledNow ? driverEarnings : 0);
    const type = amount < 0 ? 'commission_deduction' : 'ride_earning';

    ride.paymentMethod = paymentMethod;
    ride.commissionAmount = commissionAmount;
    ride.driverEarnings = driverEarnings;
    // Recorded so a payout can be explained: what the ride earned and what the
    // platform added on top of it.
    ride.driverIncentiveAmount = incentiveAmount;
    if (earningsSettledNow) {
      ride.driverEarningsCreditedAt = new Date();
    }
    ride.pricingSnapshot = {
      ...(ride.pricingSnapshot?.toObject ? ride.pricingSnapshot.toObject() : ride.pricingSnapshot || {}),
      setPriceId: ride.pricingSnapshot?.setPriceId || commissionConfig.setPriceId || null,
      admin_commission_type_from_driver: Number(commissionConfig.type ?? ride.pricingSnapshot?.admin_commission_type_from_driver ?? 1),
      admin_commission_from_driver: Number(commissionConfig.value ?? ride.pricingSnapshot?.admin_commission_from_driver ?? 0),
      cancellation_fee_goes_to: cancellationFeeGoesTo,
      resolvedAt: ride.pricingSnapshot?.resolvedAt || new Date(),
    };
    await ride.save({ session });

    if (!amount) {
      await session.commitTransaction();
      return null;
    }

    const result = await applyDriverWalletAdjustment({
      driverId: ride.driverId,
      rideId: ride._id,
      amount,
      type,
      description: paymentMethod === 'cash'
        ? (amount > 0
          ? 'Promo discount reimbursed for cash ride'
          : (recoveredDue > 0 ? 'Commission & previous user cancellation due deducted' : 'Commission deducted for cash ride'))
        : 'Driver earning credited for online ride',
      metadata: {
        fare,
        grossFare,
        incentiveAmount,
        promoDiscountAmount,
        promoFundedBy: 'platform',
        cashCollected: paymentMethod === 'cash' ? fare : 0,
        surgeAmount,
        commissionableFare,
        commissionAmount,
        driverEarnings,
        paymentMethod,
        commissionSource: commissionConfig.source,
        commissionType: normalizeCommissionType(commissionConfig.type),
        commissionValue: Number(commissionConfig.value || 0),
        recoveredCancellationDue: recoveredDue,
        insuranceFee,
        cancellationFeeGoesTo,
      },
      session,
    });

    await session.commitTransaction();
    return {
      ...result,
      ride,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/*
 * Pays an online ride's earnings into the driver's wallet, once the rider's
 * payment is confirmed. Called by every path that confirms one: the rider
 * app's Razorpay and wallet payments (rideController.finalizeRideCompletion)
 * and the driver's QR (driverController.refreshDriverPaymentCollection).
 *
 * Exactly once: the atomic claim on driverEarningsCreditedAt means a second
 * confirmation -- a retry, or the QR and the app both reporting -- finds
 * nothing to claim. A cash ride is claimed at settlement, so it never matches.
 * An online ride settled before this change was credited at completion; its
 * settlement transaction is found and it is not paid again.
 *
 * `requireConfirmedCollection` is for the QR path, where the payment is only
 * proven by the ride's own verified collection record.
 */
export const creditOnlineRideEarnings = async ({ rideId, session = null, requireConfirmedCollection = false, source = '' }) => {
  if (!session) {
    const ownSession = await mongoose.startSession();
    try {
      ownSession.startTransaction();
      const result = await creditOnlineRideEarnings({ rideId, session: ownSession, requireConfirmedCollection, source });
      await ownSession.commitTransaction();
      return result;
    } catch (error) {
      await ownSession.abortTransaction();
      throw error;
    } finally {
      ownSession.endSession();
    }
  }

  if (requireConfirmedCollection) {
    const current = await Ride.findById(rideId).session(session);
    if (!current || !isOnlineCollectionConfirmed(current)) {
      return null;
    }
  }

  const ride = await Ride.findOneAndUpdate(
    {
      _id: rideId,
      driverId: { $ne: null },
      walletSettledAt: { $ne: null },
      driverEarningsCreditedAt: null,
    },
    { $set: { driverEarningsCreditedAt: new Date() } },
    { returnDocument: 'after', session },
  );

  if (!ride) {
    return null;
  }

  const earlierSettlement = await WalletTransaction.findOne({
    rideId: ride._id,
    type: { $in: ['ride_earning', 'commission_deduction'] },
  }).select('_id').session(session).lean();

  if (earlierSettlement) {
    return null;
  }

  const amount = Math.max(0, normalizeAmount(ride.driverEarnings || 0, 'driverEarnings'));
  if (!amount) {
    return null;
  }

  return applyDriverWalletAdjustment({
    driverId: ride.driverId,
    rideId: ride._id,
    amount,
    type: 'ride_earning',
    description: 'Driver earning credited for online ride',
    metadata: {
      source: source || 'online_ride_payment',
      fare: Number(ride.fare || 0),
      commissionAmount: Number(ride.commissionAmount || 0),
      driverEarnings: amount,
      paymentMethod: 'online',
    },
    session,
  });
};
