import mongoose from 'mongoose';
import { zoneMatchFrom } from '../../../../core/admin/adminZoneScope.js';
import { RELEASED_TO_RESTAURANT, isHeld } from '../../../../core/orders/orderHold.js';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
// import { paymentSnapshotFromOrder } from './foodOrderPayment.service.js';
import { logger } from '../../../../utils/logger.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { attachRestaurantPayout } from '../../shared/restaurantPayout.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';
import { FoodDeliverySurgeZone } from '../../admin/models/deliverySurgeZone.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodSupportTicket } from '../../user/models/supportTicket.model.js';
import { config } from '../../../../config/env.js';
import {
    createRazorpayCheckoutOrder,
    verifyPaymentSignature,
    isRazorpayConfigured,
    fetchRazorpayPayment
} from '../helpers/razorpay.helper.js';
import { refundGatewayPayment } from '../../../../core/payments/refund.service.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { fetchPolyline } from '../utils/googleMaps.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import * as foodTransactionService from './foodTransaction.service.js';
import * as userWalletService from '../../user/services/userWallet.service.js';
import { calculateOrderPricing, resolveOrderZoneId, resolveAuthoritativeItems } from './order-pricing.service.js';
import { computeBill } from '../../shared/billing.js';
import * as dispatchService from './order-dispatch.service.js';
import * as deliveryService from './order-delivery.service.js';
import * as paymentService from './order-payment.service.js';
import {
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  sanitizeOrderForExternal,
  emitDeliveryDropOtpToUser,
  notifyOwnersSafely,
  notifyOwnerSafely,
  buildOrderIdentityFilter,
  toGeoPoint,
  pushStatusHistory,
  normalizeOrderForClient,
  applyAggregateRating,
  buildDeliverySocketPayload,
  notifyRestaurantNewOrder,
  isStatusAdvance,
  STATUS_PRIORITY,
} from './order.helpers.js';
import {
  COUPON_USAGE,
  takeCouponUse,
  giveBackCouponUse,
  countCouponUseOnPayment,
  releaseCouponUse,
} from './couponUsage.service.js';
// 🗑️ Moved to foodTransaction.service.js to centralize finance logic.

async function getZoneSurgeSnapshot(zoneId) {
  if (!zoneId) return { surgeAmount: 0, isEnabled: false };
  const config = await FoodDeliverySurgeZone.findOne({ zoneId }).lean();
  if (!config?.isEnabled) return { surgeAmount: 0, isEnabled: false };
  const surgeAmount = Math.round((Number(config?.surgeAmount || 0) * 100)) / 100;
  return { surgeAmount: surgeAmount > 0 ? surgeAmount : 0, isEnabled: true };
}

/** Append-only food_order_payments row; never blocks main flow on failure */
// 🗑️ Deprecated in favor of FoodTransaction system.

// ----- Settings -----
export async function getDispatchSettings() {
  return dispatchService.getDispatchSettings();
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  return dispatchService.updateDispatchSettings(dispatchMode, adminId);
}

// ----- Calculate (validation + return pricing from payload) -----
export async function calculateOrder(userId, dto) {
  return calculateOrderPricing(userId, dto);
}

// Helper to safely convert string to ObjectId or throw ValidationError (400)
function toObjectId(id, fieldName = 'ID') {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new ValidationError(`Invalid ${fieldName} format`);
  }
  return new mongoose.Types.ObjectId(id);
}

// ----- Create order -----
export async function createOrder(userId, dto) {
  try {
    const restaurantId = toObjectId(dto.restaurantId, 'Restaurant ID');
    const restaurant = await FoodRestaurant.findById(restaurantId)
      .select("status restaurantName zoneId location isAcceptingOrders openingTime closingTime openDays")
      .lean();
    
    if (!restaurant) throw new ValidationError("Restaurant not found");
    if (restaurant.status !== "approved")
      throw new ValidationError("Restaurant not accepting orders");
    if (restaurant.isAcceptingOrders === false)
      throw new ValidationError("Restaurant not accepting orders");

    /*
     * Trading hours, enforced here and not only shown.
     *
     * The listing badge tells a customer an outlet is shut; this is what stops
     * the order if they get past it -- a stale app, a deep link, a cart opened
     * before closing time and paid for after. Without it the hours are
     * decoration, which is what they were: the app listed every outlet as
     * orderable around the clock because nothing ever consulted them.
     *
     * A restaurant that has entered no hours is unaffected; see
     * shared/outletHours.js for why that means open rather than closed.
     */
    {
      const { FoodRestaurantOutletTimings } = await import(
        "../../restaurant/models/outletTimings.model.js"
      );
      const { describeOutletHours } = await import("../../shared/outletHours.js");
      const timingsDoc = await FoodRestaurantOutletTimings.findOne({
        restaurantId: restaurant._id,
      })
        .select("timings")
        .lean();
      const hours = describeOutletHours({ timingsDoc, restaurant });
      if (!hours.isOpen) {
        throw new ValidationError(
          hours.opensAt
            ? `${restaurant.restaurantName || "This restaurant"} is closed right now. It opens at ${hours.opensAt}.`
            : `${restaurant.restaurantName || "This restaurant"} is closed right now.`
        );
      }
    }

    const settings = await getDispatchSettings();
    const dispatchMode = settings.dispatchMode;

    const deliveryAddress = {
      label: dto.address?.label || "Home",
      name: dto.address?.name || dto.address?.fullName || dto.customerName || "",
      fullName: dto.address?.fullName || dto.address?.name || dto.customerName || "",
      street: dto.address?.street || "",
      additionalDetails: dto.address?.additionalDetails || "",
      city: dto.address?.city || "",
      state: dto.address?.state || "",
      zipCode: dto.address?.zipCode || "",
      phone: dto.address?.phone || "",
      location: dto.address?.location?.coordinates
        ? { type: "Point", coordinates: dto.address.location.coordinates }
        : undefined,
    };

    const paymentMethod = dto.paymentMethod === "card" ? "razorpay" : dto.paymentMethod;
    const isCash = paymentMethod === "cash";
    const isWallet = paymentMethod === "wallet";

    if (isCash) {
      const user = await FoodUser.findById(userId).select("isBlockedFromCOD").lean();
      if (user?.isBlockedFromCOD) {
        throw new ValidationError("Cash on Delivery (COD) is blocked for your account. Please use online payment.");
      }
    }

    // Resolve server-authoritative prices from the live menu before anything reads dto.items
    // (the saved order.items, subtotal, and payout math all derive from this).
    dto.items = await resolveAuthoritativeItems(restaurantId, dto.items);

    // Ensure pricing is present and consistent.
    const computedSubtotal = (dto.items || []).reduce((sum, item) => {
      const price = Number(item?.price);
      const qty = Number(item?.quantity);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
      return sum + Math.max(0, price) * Math.max(0, qty);
    }, 0);

    const pricingResult = await calculateOrderPricing(userId, {
      ...dto,
      restaurantId: String(restaurantId),
      address: dto.address || dto.deliveryAddress,
      deliveryAddress: dto.deliveryAddress || dto.address,
    });
    if (!pricingResult?.pricing) {
      throw new ValidationError("Unable to calculate order pricing from fee settings");
    }

    // The restaurant's own delivery radius. The cart already showed this, but an
    // older app, a deep link or an address changed after the quote reaches here
    // regardless -- so this is the check that actually holds.
    if (pricingResult.pricing.serviceability?.deliverable === false) {
      throw new ValidationError(pricingResult.pricing.serviceability.reason);
    }

    // Adopt the lines pricing actually used. A spend-threshold reward is appended
    // there, and without this the order would be charged as if it had one while
    // saving items that do not include it -- so the kitchen would never see the
    // free dish it is meant to send.
    //
    // Buy-one-get-one lines are split there too, into a paid half and a
    // zero-priced half. Same consequence if they were not adopted, in reverse:
    // the customer would be charged the split price while the saved order still
    // showed one full-price line, and nothing downstream would know a unit was
    // free.
    if (Array.isArray(pricingResult.items) && pricingResult.items.length) {
      dto.items = pricingResult.items;
    }
    const normalizedPricing = {
      subtotal: Number(pricingResult.pricing.subtotal ?? computedSubtotal) || 0,
      tax: Number(pricingResult.pricing.tax ?? 0) || 0,
      packagingFee: Number(pricingResult.pricing.packagingFee ?? 0) || 0,
      deliveryFee: Number(pricingResult.pricing.deliveryFee ?? 0) || 0,
      deliveryFeeBreakdown: pricingResult.pricing.deliveryFeeBreakdown || null,
      adminDeliveryCommissionEnabled: Boolean(pricingResult.pricing.adminDeliveryCommissionEnabled || false),
      adminDeliveryCommissionPercent: Number(pricingResult.pricing.adminDeliveryCommissionPercent ?? 0) || 0,
      adminDeliveryCommissionAmount: Number(pricingResult.pricing.adminDeliveryCommissionAmount ?? 0) || 0,
      riderDeliveryEarningAfterAdminCommission: Number(pricingResult.pricing.riderDeliveryEarningAfterAdminCommission ?? 0) || 0,
      deliveryPartnerIncentiveEnabled: Boolean(pricingResult.pricing.deliveryPartnerIncentiveEnabled || false),
      deliveryPartnerIncentivePercent: Number(pricingResult.pricing.deliveryPartnerIncentivePercent ?? 0) || 0,
      deliveryPartnerIncentiveAmount: Number(pricingResult.pricing.deliveryPartnerIncentiveAmount ?? 0) || 0,
      deliveryPartnerIncentiveEligible: Boolean(pricingResult.pricing.deliveryPartnerIncentiveEligible || false),
      platformFee: Number(pricingResult.pricing.platformFee ?? 0) || 0,
      surgeAmount: Number(pricingResult.pricing.surgeAmount ?? 0) || 0,
      discount: Number(pricingResult.pricing.discount ?? 0) || 0,
      /*
       * Copied from the quote so the order is taxed on the same value it was
       * quoted on. This object is built field by field, so anything not named
       * here is dropped -- which is how the quote and the charge come to
       * disagree by the GST on the coupon.
       */
      discountFundedByPlatform: pricingResult.pricing.discountFundedByPlatform === true,
      // Recorded, not deducted -- the free units are already out of the subtotal.
      bogoSavings: Number(pricingResult.pricing.bogo?.savings ?? 0) || 0,
      /*
       * The bill as shown, and the figures downstream reads off it.
       *
       * commissionableAmount in particular: the payout job reads it to charge
       * commission on the food net of GST, and falls back to `subtotal` when it
       * is absent -- which would quietly charge a GST-inclusive restaurant
       * commission on tax it never keeps.
       */
      bill: pricingResult.pricing.bill || null,
      commissionableAmount:
        Number(pricingResult.pricing.commissionableAmount ?? pricingResult.pricing.subtotal ?? 0) || 0,
      pricesIncludeGst: pricingResult.pricing.pricesIncludeGst === true,
      gstInclusiveItemAmount: Number(pricingResult.pricing.gstInclusiveItemAmount ?? 0) || 0,
      packagingMode: String(pricingResult.pricing.packagingMode || ''),
      netItemAmount: Number(pricingResult.pricing.netItemAmount ?? pricingResult.pricing.subtotal ?? 0) || 0,
      netPackagingFee:
        Number(pricingResult.pricing.netPackagingFee ?? pricingResult.pricing.packagingFee ?? 0) || 0,
      gstRate: Number(pricingResult.pricing.gstRate ?? 0) || 0,
      platformFeeGst: Number(pricingResult.pricing.platformFeeGst ?? 0) || 0,
      platformFeeGstRate: Number(pricingResult.pricing.platformFeeGstRate ?? 0) || 0,
      tip: Number(pricingResult.pricing.tip ?? 0) || 0,
      roundOff: Number(pricingResult.pricing.roundOff ?? 0) || 0,
      totalBeforeTip: Number(pricingResult.pricing.totalBeforeTip ?? 0) || 0,
      total: Number(pricingResult.pricing.total ?? 0) || 0,
      currency: String(pricingResult.pricing.currency || "INR"),
      couponCode: pricingResult.pricing.couponCode || null,
      appliedCoupon: pricingResult.pricing.appliedCoupon || null,
    };

    const resolvedOrderZoneId = await resolveOrderZoneId(
      {
        ...dto,
        address: dto.address || dto.deliveryAddress,
        deliveryAddress: dto.deliveryAddress || dto.address,
      },
      restaurant
    );
    const orderZoneId = resolvedOrderZoneId
      ? toObjectId(resolvedOrderZoneId, 'Zone ID')
      : toObjectId(restaurant.zoneId, 'Restaurant Zone ID');
    const surgeSnapshot = await getZoneSurgeSnapshot(orderZoneId);
    normalizedPricing.surgeAmount = surgeSnapshot.surgeAmount;

    /*
     * The surge above is the only figure that can have moved since pricing ran,
     * so the bill is rebuilt with it rather than the total being re-derived by
     * hand. A second implementation of this arithmetic is what let the stored
     * total drift from the stored bill: it forgot the GST on the platform fee,
     * the tip and the round-off, and on a tax-inclusive menu it added the
     * listed price AND the tax already inside it.
     */
    const settledBill = computeBill({
      itemAmount: normalizedPricing.subtotal,
      gstInclusiveItemAmount: normalizedPricing.gstInclusiveItemAmount,
      packagingFee: normalizedPricing.packagingFee,
      deliveryFee: normalizedPricing.deliveryFee,
      platformFee: normalizedPricing.platformFee,
      surgeAmount: normalizedPricing.surgeAmount,
      discount: normalizedPricing.discount,
      /*
       * Taxed on the same value the quote used. Absent on anything priced
       * before this existed, which falls back to false -- the old treatment --
       * so no past order is re-taxed by being read back.
       */
      discountFundedByPlatform: normalizedPricing.discountFundedByPlatform === true,
      tip: normalizedPricing.tip,
      gstRate: normalizedPricing.gstRate,
      platformFeeGstRate: normalizedPricing.platformFeeGstRate,
      pricesIncludeGst: normalizedPricing.pricesIncludeGst === true,
      packagingBelongsToRestaurant: normalizedPricing.packagingMode === 'RESTAURANT',
    });

    normalizedPricing.bill = settledBill;
    normalizedPricing.tax = settledBill.gstOnItems;
    normalizedPricing.netItemAmount = settledBill.netItemAmount;
    normalizedPricing.netPackagingFee = settledBill.netPackagingFee;
    normalizedPricing.commissionableAmount = settledBill.commissionBase;
    normalizedPricing.platformFeeGst = settledBill.platformFeeGst;
    normalizedPricing.roundOff = settledBill.roundOff;
    normalizedPricing.totalBeforeTip = settledBill.totalBeforeTip;
    normalizedPricing.total = settledBill.grandTotal;

    if (isCash) {
      const { FoodFeeSettings } = await import('../../admin/models/feeSettings.model.js');
      const feeDoc = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 });
      const codOrderLimit = feeDoc?.codOrderLimit;
      
      // 0 or unset means no limit (0 used to refuse every cash order).
      if (Number(codOrderLimit) > 0 && normalizedPricing.total >= Number(codOrderLimit)) {
        throw new ValidationError(`Cash on Delivery is not allowed for orders of ₹${codOrderLimit} or more.`);
      }

      /*
       * No refusal here for who happens to be online. Cash on delivery used to be
       * refused whenever no Food rider was online at that second -- or when no
       * online rider had cash headroom, which a rider with no limit set read as
       * Rs 0 -- so customers could not order at all at quiet times. The order is
       * placed like any other: dispatch skips riders over their cash limit
       * (order-dispatch.service.js) and keeps offering it as riders come online.
       */
    }

    if (paymentMethod === "razorpay" && !isRazorpayConfigured()) {
      throw new ValidationError("Razorpay payment gateway is not configured");
    }

    const payment = {
      method: paymentMethod,
      status: isCash ? "cod_pending" : isWallet ? "paid" : "created",
      amountDue: normalizedPricing.total || 0,
      razorpay: {},
      qr: {},
    };

    const riderBasePay = Math.round((Number(normalizedPricing.deliveryFeeBreakdown?.basePayout || 0) * 100)) / 100;
    const riderDeliveryFeeShare = Math.round((Number(normalizedPricing.riderDeliveryEarningAfterAdminCommission || 0) * 100)) / 100;
    const riderSurgePay = Number(normalizedPricing.surgeAmount) || 0;
    const riderIncentivePay = Math.round((Number(normalizedPricing.deliveryPartnerIncentiveAmount || 0) * 100)) / 100;
    const riderTotalPayout = Math.round((riderBasePay + riderSurgePay + riderDeliveryFeeShare + riderIncentivePay) * 100) / 100;
    /*
     * The tip goes to the rider, in full.
     *
     * riderEarning is what the rider's balance is built from, both what they
     * earned and, on COD, what offsets the cash they collected. Without the tip
     * here a tipped order paid the rider nothing extra, and on cash they had to
     * deposit the customer's tip as though it were the platform's money.
     *
     * riderTotalPayout stays the pay BEFORE the tip. The ledger
     * (foodTransaction.service.js) adds the tip on top of it, so folding it in
     * here as well would count it twice.
     */
    const riderTipPay = Math.round((Number(normalizedPricing.tip) || 0) * 100) / 100;
    const riderEarning = Math.round((riderTotalPayout + riderTipPay) * 100) / 100;
    
    // Calculate restaurant commission from subtotal
    let restaurantCommission = 0;
    // Stamped alongside the amount so this order stays billed the way it was
    // taken, whatever the platform switches to afterwards. Left unset if the
    // lookup failed, so the payout path falls back to the live setting rather
    // than recording a mode that was never resolved.
    let monetizationMode = null;
    try {
      const snapshot = await foodTransactionService.getRestaurantCommissionSnapshot({
        pricing: normalizedPricing,
        restaurantId: restaurantId
      });
      restaurantCommission = Number(snapshot?.commissionAmount) || 0;
      monetizationMode = snapshot?.monetizationMode || null;
    } catch (err) {
      logger.error(`Commission calculation failed for order: ${err.message}`);
    }

    normalizedPricing.restaurantCommission = restaurantCommission;
    if (monetizationMode) normalizedPricing.monetizationMode = monetizationMode;

    // A first figure only: replaced below by the ledger's platformNetProfit,
    // which also counts packaging, coupons and the round-off, so the order and
    // its transaction can never report two different profits. Not floored at
    // zero -- an order on free delivery costs the platform the rider's pay, and
    // a floor only stopped that loss being recorded.
    const platformProfit = Math.round((
      (Number.isFinite(normalizedPricing.deliveryFee) ? normalizedPricing.deliveryFee : 0) +
      (Number.isFinite(normalizedPricing.platformFee) ? normalizedPricing.platformFee : 0) +
      (Number.isFinite(normalizedPricing.surgeAmount) ? normalizedPricing.surgeAmount : 0) +
      restaurantCommission -
      riderTotalPayout
    ) * 100) / 100;

    const initialStatus = (paymentMethod === "razorpay" || paymentMethod === "card") ? "pending_payment" : "created";

    const order = new FoodOrder({
      userId: toObjectId(userId, 'User ID'),
      restaurantId: restaurantId,
      zoneId: orderZoneId,
      items: (dto.items || []).map(item => ({
        ...item,
        itemId: toObjectId(item.itemId, 'Item ID')
      })),
      deliveryAddress,
      customerName: String(dto.customerName || deliveryAddress.fullName || ""),
      customerPhone: String(dto.customerPhone || deliveryAddress.phone || ""),
      pricing: normalizedPricing,
      payment,
      orderStatus: initialStatus,
      dispatch: { modeAtCreation: dispatchMode, status: "unassigned" },
      statusHistory: [
        {
          at: new Date(),
          byRole: "SYSTEM",
          from: "",
          to: initialStatus,
          note: initialStatus === "pending_payment" ? "Order created, awaiting payment" : "Order placed",
        },
      ],
      note: String(dto.note || ""),
      deliveryInstructions: Array.isArray(dto.deliveryInstructions)
        ? dto.deliveryInstructions.map(v => String(v || "").trim()).filter(Boolean)
        : [],
      sendCutlery: dto.sendCutlery !== false,
      deliveryFleet: String(dto.deliveryFleet || "standard"),
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      riderBasePay: Number(riderBasePay) || 0,
      riderSurgePay: Number(riderSurgePay) || 0,
      riderDeliveryFeeShare: Number(riderDeliveryFeeShare) || 0,
      riderIncentivePay: Number(riderIncentivePay) || 0,
      riderTotalPayout: Number(riderTotalPayout) || 0,
      riderEarning: Number(riderEarning) || 0,
      platformProfit: Number(platformProfit) || 0,
    });

    let razorpayPayload = null;

    if (paymentMethod === "razorpay") {
      const amountPaise = Math.round((normalizedPricing.total || 0) * 100);
      try {
        razorpayPayload = await createRazorpayCheckoutOrder(amountPaise, "INR", order._id.toString());
        payment.razorpay = { orderId: razorpayPayload.orderId, paymentId: "", signature: "" };
        payment.status = "created";
        // Update order payment state before saving
        order.payment = payment;
      } catch (err) {
        logger.error(`Razorpay order creation failed: ${err.message}`);
        throw new ValidationError(err?.message || "Payment gateway error");
      }
    }

    /*
     * The coupon's use, taken BEFORE the order is saved.
     *
     * The global cap is claimed with an atomic conditional increment. If another
     * order took the last slot after this one was priced, the order is refused
     * here, before any money moves. Previously the increment was attempted after
     * the save, a lost race only logged a warning, and the order kept a
     * discount the coupon no longer allowed.
     *
     * Online orders are not counted yet. They are counted when the payment is
     * verified (couponUsage.service.js), so a checkout abandoned at the payment
     * sheet no longer spends the coupon.
     */
    const appliedCouponCode = normalizedPricing.appliedCoupon?.code
      ? String(normalizedPricing.appliedCoupon.code).trim().toUpperCase()
      : "";
    let couponUseTaken = false;
    if (appliedCouponCode) {
      if (paymentMethod === "razorpay") {
        // Online orders count the coupon on payment, so two unpaid online orders
        // with the same coupon could both be paid and both keep the discount.
        // A new one supersedes the customer's earlier unpaid one (an abandoned
        // payment sheet, most often); if that one is paid late after all, the
        // webhook refunds it because it is cancelled.
        await FoodOrder.updateMany(
          {
            userId: new mongoose.Types.ObjectId(userId),
            orderStatus: "pending_payment",
            "payment.status": { $nin: ["paid", "refunded"] },
            "pricing.appliedCoupon.code": { $in: [appliedCouponCode, String(normalizedPricing.appliedCoupon.code)] },
          },
          {
            $set: { orderStatus: "cancelled_by_user", "payment.status": "failed" },
            $push: { statusHistory: { at: new Date(), byRole: "SYSTEM", from: "pending_payment", to: "cancelled_by_user", note: "Replaced by a newer order with the same coupon" } },
          },
        );
        order.couponUsage = COUPON_USAGE.PENDING;
      } else {
        const use = await takeCouponUse(appliedCouponCode, userId, { enforceLimit: true });
        if (use.exhausted) {
          throw new ValidationError(
            use.perUser
              ? `You have already used coupon ${appliedCouponCode} as many times as it allows.`
              : `Coupon ${appliedCouponCode} has just reached its usage limit. Please remove it and check your total before ordering again.`
          );
        }
        couponUseTaken = use.taken;
        if (use.taken) order.couponUsage = COUPON_USAGE.COUNTED;
      }
    }

    let walletDebited = false;
    try {
      if (isWallet) {
        // ponytail: debit the wallet BEFORE persisting the order. Saving a 'paid' wallet order and
        // deducting afterwards left a window where a crash produced a paid order with no debit.
        // order._id exists at instantiation, so the ledger reference is valid pre-save.
        await userWalletService.deductWalletBalance(userId, order.pricing.total, `Payment for order #${order.order_id || order._id}`, { orderId: order._id });
        walletDebited = true;
      }

      await order.save();
    } catch (err) {
      /*
       * The other half of debiting first: if the save fails, the debit is
       * credited straight back. Otherwise the customer is charged for an order
       * that does not exist, and nothing would ever refund it. A coupon use
       * taken above is given back for the same reason.
       */
      if (walletDebited) {
        try {
          await userWalletService.refundWalletBalance(
            userId,
            order.pricing.total,
            `Refund: order #${order.order_id || order._id} could not be placed`,
            { orderId: order._id },
          );
        } catch (refundErr) {
          logger.error(`[CRITICAL] Wallet debited for unsaved order ${order._id} and NOT refunded: ${refundErr.message}`);
        }
      }
      if (couponUseTaken) {
        try {
          await giveBackCouponUse(appliedCouponCode, userId);
        } catch (couponErr) {
          logger.error(`Coupon ${appliedCouponCode} use not given back for unsaved order ${order._id}: ${couponErr.message}`);
        }
      }
      throw err;
    }

    // Phase 2: Create initial transaction (Non-blocking but logged)
    try {
      const transaction = await foodTransactionService.createInitialTransaction(order);
      // The ledger's figure is the complete one (packaging, coupons, round-off).
      // The order carries the same number so a report reading either agrees.
      const ledgerProfit = Number(transaction?.amounts?.platformNetProfit);
      if (Number.isFinite(ledgerProfit) && ledgerProfit !== order.platformProfit) {
        order.platformProfit = ledgerProfit;
        await FoodOrder.updateOne({ _id: order._id }, { $set: { platformProfit: ledgerProfit } });
      }
    } catch (err) {
      logger.error(`[CRITICAL] Initial transaction failed for order ${order._id}: ${err.message}`);
      // We don't throw here to avoid failing the whole order if transaction logging fails
    }

    // Realtime + push notifications.
    try {
      const isAwaitingOnlinePayment =
        String(paymentMethod || "").toLowerCase() === "razorpay" &&
        String(payment?.status || "").toLowerCase() !== "paid";
        
      await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
        title: isAwaitingOnlinePayment
          ? "Complete Payment to Confirm Order"
          : "Order Confirmed! 🍔",
        body: isAwaitingOnlinePayment
          ? `Order #${order.order_id || order._id} is created. Please complete payment to send it to ${restaurant.restaurantName || "the restaurant"}.`
          : `Your order #${order.order_id || order._id} from ${restaurant.restaurantName || "the restaurant"} has been placed successfully.`,
        image: "https://i.ibb.co/5GzXz7r/Quick Drop-Brand-Image.png",
        data: {
          type: isAwaitingOnlinePayment ? "order_created_pending_payment" : "order_created",
          orderId: String(order._id),
          orderMongoId: order._id.toString(),
          link: `/food/user/orders/${order._id.toString()}`,
        },
      });

      // Restaurant gets new-order request only when payment flow is eligible.
      await notifyRestaurantNewOrder(order);
    } catch (err) {
      logger.warn(`Notifications failed for order ${order._id}: ${err.message}`);
    }

    // Coupon usage is taken before the save above (cash / wallet) or on payment
    // verification (online) -- see couponUsage.service.js.

    const saved = normalizeOrderForClient(order);
    return { order: saved, razorpay: razorpayPayload };
  } catch (err) {
    logger.error(`Order placement error: ${err.message}`, { stack: err.stack, userId, dto });
    if (err instanceof ValidationError || err instanceof ForbiddenError || err instanceof NotFoundError) {
      throw err;
    }
    // Transform system errors to Generic validation error with 500 logging
    throw new ValidationError(err.message || "Something went wrong while placing your order. Please try again.");
  }
}

// ----- Verify payment -----
export async function verifyPayment(userId, dto) {
  const identity = buildOrderIdentityFilter(dto.orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (order.payment.status === "paid")
    return { order: normalizeOrderForClient(order), payment: order.payment };

  // Bind the signature to THIS order's Razorpay order id. Without this, a valid
  // signature from any other (e.g. cheap) order could be replayed to mark this one paid.
  const expectedRzpOrderId = order.payment?.razorpay?.orderId;
  if (!expectedRzpOrderId || String(dto.razorpayOrderId) !== String(expectedRzpOrderId)) {
    throw new ValidationError("Payment verification failed: order mismatch");
  }

  const valid = verifyPaymentSignature(
    dto.razorpayOrderId,
    dto.razorpayPaymentId,
    dto.razorpaySignature,
  );
  if (!valid) throw new ValidationError("Payment verification failed");

  // Confirm the payment was actually captured for the amount we charged (skips mock payments in dev).
  if (!String(dto.razorpayPaymentId || "").startsWith("mock_")) {
    try {
      const rzpPayment = await fetchRazorpayPayment(dto.razorpayPaymentId);
      const capturedPaise = Number(rzpPayment?.amount || 0);
      const expectedPaise = Math.round(Number(order.payment.amountDue || 0) * 100);
      const capturedOk = ["captured", "authorized"].includes(String(rzpPayment?.status || ""));
      if (String(rzpPayment?.order_id || "") !== String(expectedRzpOrderId)) {
        throw new ValidationError("Payment verification failed: order mismatch");
      }
      if (!capturedOk || capturedPaise < expectedPaise) {
        throw new ValidationError("Payment verification failed: amount or status mismatch");
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError("Unable to verify payment with gateway. Please try again.");
    }
  }

  order.payment.status = "paid";
  order.payment.razorpay.paymentId = dto.razorpayPaymentId;
  order.payment.razorpay.signature = dto.razorpaySignature;
  
  const from = order.orderStatus;
  order.orderStatus = "created";

  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from: from,
    to: "created",
    note: "Payment verified, order confirmed",
  });
  await order.save();

  // Paid, so the coupon now counts as used. Idempotent against the webhook.
  await countCouponUseOnPayment(order);

  await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
    status: 'captured',
    razorpayPaymentId: dto.razorpayPaymentId,
    razorpaySignature: dto.razorpaySignature,
    recordedByRole: "USER",
    recordedById: new mongoose.Types.ObjectId(userId)
  });

  // After online payment is verified, now notify restaurant about the new order.
  await notifyRestaurantNewOrder(order);

  // Notify Customer about payment success
  await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
    title: "Payment Successful! ✅",
    body: `We have received your payment of ₹${order.payment.amountDue} for Order #${order._id.toString()}.`,
    image: "https://i.ibb.co/5GzXz7r/Quick Drop-Brand-Image.png",
    data: {
      type: "payment_success",
      orderId: String(order._id.toString()),
      orderMongoId: String(order._id),
    },
  });


  return { order: normalizeOrderForClient(order), payment: order.payment };
}

// ----- Auto-assign -----

/**
 * Start or continue a smart cascading dispatch.
 * @param {string} orderId - Mongo ID of the order.
 * @param {object} options - Options (retry count, etc)
 */
export async function tryAutoAssign(orderId, options = {}) {
    return dispatchService.tryAutoAssign(orderId, options);
}

/**
 * Triggered by worker after 60 seconds of zero response.
 */
export async function processDispatchTimeout(orderId, partnerId, options = {}) {
    return dispatchService.processDispatchTimeout(orderId, partnerId, options);
}

// ----- User: list, get, cancel -----
export async function listOrdersUser(userId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = { 
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: { $ne: 'pending_payment' }
  };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate(
        "restaurantId",
        "restaurantName profileImage coverImages slug area city location rating totalRatings",
      )
      .populate("dispatch.deliveryPartnerId", "name phone rating totalRatings")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  return buildPaginatedResult({
    docs: docs.map((doc) => normalizeOrderForClient(doc)),
    total,
    page,
    limit,
  });
}

export async function getOrderById(
  orderId,
  { userId, restaurantId, deliveryPartnerId, admin } = {},
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne(identity)
    .populate(
      "restaurantId",
      "restaurantName ownerPhone profileImage area city location rating totalRatings primaryContactNumber",
    )
    .populate("dispatch.deliveryPartnerId", "name fullName phone phoneNumber rating totalRatings profileImage avatar vehicleType vehicleName vehicleNumber")
    .populate("userId", "name fullName phone email")
    .select("+deliveryOtp")
    .lean();
  if (!order) throw new NotFoundError("Order not found");

  if (admin) return normalizeOrderForClient(order);

  const orderUserId = order.userId?._id?.toString() || order.userId?.toString();
  const orderRestaurantId = order.restaurantId?._id?.toString() || order.restaurantId?.toString();
  const orderPartnerId = order.dispatch?.deliveryPartnerId?._id?.toString() || order.dispatch?.deliveryPartnerId?.toString();

  if (userId && orderUserId !== userId.toString())
    throw new ForbiddenError("Not your order");
  if (restaurantId && orderRestaurantId !== restaurantId.toString())
    throw new ForbiddenError("Not your restaurant order");
  if (deliveryPartnerId && orderPartnerId !== deliveryPartnerId.toString())
    throw new ForbiddenError("Not assigned to you");

  if (deliveryPartnerId || restaurantId) {
    const external = sanitizeOrderForExternal(order);
    // The restaurant is shown what it earns on the order, not just what the
    // customer paid. The rider is not: none of it is the rider's money.
    if (restaurantId) await attachRestaurantPayout([external]);
    return external;
  }

  if (userId) {
    const drop = order.deliveryVerification?.dropOtp || {};
    const secret = String(order.deliveryOtp || "").trim();
    const out = normalizeOrderForClient(order);
    delete out.deliveryOtp;
    out.deliveryVerification = {
      ...(order.deliveryVerification || {}),
      dropOtp: {
        required: Boolean(drop.required),
        verified: Boolean(drop.verified),
      },
    };
    if (!drop.verified && secret) {
      out.handoverOtp = secret;
    }
    // Whether the app may offer Cancel, and until when (countdown).
    try {
      const { getCancelRules, cancellationForClient } = await import("./cancellationPolicy.js");
      out.cancellation = cancellationForClient(order, await getCancelRules('food', order.zoneId));
    } catch {
      /* the app falls back to its own status check */
    }
    return out;
  }

  return sanitizeOrderForExternal(order);
}

export async function getDropOtpUser(orderId, userId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  }).select("+deliveryOtp");
  if (!order) throw new NotFoundError("Order not found");

  const phase = order.deliveryState?.currentPhase;
  const status = order.orderStatus;
  const eligiblePhases = ["at_drop", "en_route_to_delivery"];
  const isEligible = eligiblePhases.includes(phase) || status === "picked_up";

  if (!isEligible) {
    throw new ValidationError(
      "Rider is still at the restaurant. Wait for them to pick up your order to see the OTP."
    );
  }

  return { otp: order.deliveryOtp };
}

/**
 * Watchdog: Recovers orders stuck in 'assigned' or 'preparing' status for too long.
 * Should be called on server startup.
 */
export async function recoverStuckOrders() {
  const now = new Date();
  const FIVE_MIN = 5 * 60 * 1000;
  const TWO_MIN = 2 * 60 * 1000;

  try {
    // 1. Stuck in 'assigned' (partner never accepted) for > 2m
    const stuckAssigned = await FoodOrder.find({
      'dispatch.status': 'assigned',
      'dispatch.acceptedAt': { $exists: false },
      'dispatch.assignedAt': { $lt: new Date(now - TWO_MIN) },
      orderStatus: { $nin: ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant'] }
    });

    if (stuckAssigned.length > 0) {
      logger.info(`Watchdog: Healing ${stuckAssigned.length} stuck assigned orders.`);
      for (const order of stuckAssigned) {
        // Reset status to unassigned and re-trigger auto-assign
        order.dispatch.status = 'unassigned';
        order.dispatch.deliveryPartnerId = null;
        await order.save();
        await tryAutoAssign(order._id);
      }
    }

    // 2. Clear old dispatching locks (cleanup in case of crash)
    await FoodOrder.updateMany(
      { 'dispatch.dispatchingAt': { $lt: new Date(now - FIVE_MIN) } },
      { $unset: { 'dispatch.dispatchingAt': '' } }
    );

  } catch (err) {
    logger.error(`Watchdog recovery error: ${err.message}`);
  }
}

export async function resyncState(userId, role) {
  if (role === "USER") {
    const order = await FoodOrder.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      orderStatus: {
        $nin: [
          "delivered",
          "cancelled_by_user",
          "cancelled_by_restaurant",
          "cancelled_by_admin",
        ],
      },
    })
      .select("+deliveryOtp")
      .sort({ createdAt: -1 })
      .lean();

    if (order) {
      const out = normalizeOrderForClient(order);
      // Re-add handover OTP if order is picked up
      if (
        (order.deliveryState?.currentPhase === "at_drop" || order.orderStatus === "picked_up") &&
        !order.deliveryVerification?.dropOtp?.verified &&
        order.deliveryOtp
      ) {
        out.handoverOtp = order.deliveryOtp;
      }
      return { activeOrder: out };
    }
    return { activeOrder: null };
  }

  if (role === "DELIVERY_PARTNER") {
    const order = await FoodOrder.findOne({
      "dispatch.deliveryPartnerId": new mongoose.Types.ObjectId(userId),
      "dispatch.status": { $in: ["assigned", "accepted"] },
      orderStatus: {
        $nin: ["delivered", "cancelled_by_user", "cancelled_by_restaurant"],
      },
    })
      .populate("restaurantId")
      .lean();
    return { activeOrder: order ? sanitizeOrderForExternal(order) : null };
  }

  return {};
}

/**
 * Idempotently refunds a paid order at most once. Atomically claims the refund
 * (none/failed -> pending) before calling the gateway, so a restaurant-cancel racing a
 * user-cancel/webhook can't both issue a refund. Mirrors the authoritative state back onto
 * the in-memory `order` so the caller's trailing save() doesn't clobber it.
 * @param {import('mongoose').Document} order
 * @param {string|import('mongoose').Types.ObjectId} refundUserId user to credit for wallet refunds
 */
async function processOrderRefundOnce(order, refundUserId) {
  if (String(order.payment?.status || "").toLowerCase() !== "paid") return;
  const method = String(order.payment?.method || "").toLowerCase();
  if (method !== "razorpay" && method !== "wallet") return;
  if (method === "razorpay" && !order.payment?.razorpay?.paymentId) return;

  // Atomic claim — only the first caller flips refund.status into 'pending'.
  const claimed = await FoodOrder.findOneAndUpdate(
    {
      _id: order._id,
      "payment.status": "paid",
      "payment.refund.status": { $nin: ["pending", "processed"] },
    },
    { $set: { "payment.refund.status": "pending", "payment.refund.amount": order.pricing.total } },
    { new: true },
  );
  if (!claimed) {
    // Another flow owns the refund; sync in-memory state from DB to avoid clobbering on save().
    const fresh = await FoodOrder.findById(order._id).select("payment").lean();
    if (fresh?.payment) {
      order.payment.status = fresh.payment.status;
      order.payment.refund = fresh.payment.refund;
    }
    return;
  }

  let refundPatch;
  try {
    if (method === "razorpay") {
      // Through the platform refund service: one Refund row per order (the
      // idempotency key), Razorpay's status tracked by the refund webhooks.
      const refundResult = await refundGatewayPayment({
        vertical: "food",
        gatewayPaymentId: order.payment.razorpay.paymentId,
        amount: order.pricing.total,
        idempotencyKey: `food:order_refund:${order._id}`,
        orderId: order._id,
        orderRef: order.orderId || order.order_id || "",
        userId: refundUserId || order.userId,
        reason: "Order cancelled",
        source: "order_cancelled",
      });
      refundPatch = refundResult.success
        ? { "payment.status": "refunded", "payment.refund": { status: "processed", amount: order.pricing.total, refundId: refundResult.refundId, processedAt: new Date() } }
        : { "payment.refund": { status: "failed", amount: order.pricing.total } };
    } else {
      await userWalletService.refundWalletBalance(refundUserId, order.pricing.total, `Refund for cancelled order #${order.order_id || order._id}`, { orderId: order._id });
      refundPatch = { "payment.status": "refunded", "payment.refund": { status: "processed", amount: order.pricing.total, processedAt: new Date() } };
    }
  } catch (err) {
    logger.error(`Refund processing error for Order ${order._id}: ${err.message}`);
    refundPatch = { "payment.refund": { status: "failed", amount: order.pricing.total } };
  }

  await FoodOrder.updateOne({ _id: order._id }, { $set: refundPatch });
  if (refundPatch["payment.status"]) order.payment.status = refundPatch["payment.status"];
  order.payment.refund = refundPatch["payment.refund"];
}

export async function cancelOrder(orderId, userId, reason) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");

  // Waiting for the restaurant: always. After it accepts: only inside the
  // window the admin set (Food -> Order cancellation), see cancellationPolicy.
  const { getCancelRules, judgeUserCancel } = await import("./cancellationPolicy.js");
  const verdict = judgeUserCancel(order, await getCancelRules('food', order.zoneId));
  if (!verdict.allowed) throw new ValidationError(verdict.reason || "Order cannot be cancelled");

  const from = order.orderStatus;
  const assignedRiderId = order.dispatch?.deliveryPartnerId ? String(order.dispatch.deliveryPartnerId) : null;
  order.orderStatus = "cancelled_by_user";
  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from,
    to: "cancelled_by_user",
    note: reason || "",
  });

  const paymentMethod = String(order.payment?.method || "cash").toLowerCase();
  const paymentStatus = String(order.payment?.status || "cod_pending").toLowerCase();

  // Automated refund on user cancel — idempotent + race-safe (see processOrderRefundOnce).
  await processOrderRefundOnce(order, userId);

  await order.save();

  // A cancelled order is not a use of its coupon.
  await releaseCouponUse(order);

  enqueueOrderEvent("order_cancelled_by_user", {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    userId,
    reason: reason || "",
  });

  // Sync transaction status
  try {
    const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
    const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
    const isOnlinePaid =
      finalPaymentMethod === "razorpay" &&
      (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
    await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_user', {
        status: isOnlinePaid ? 'refunded' : 'failed',
        note: `Order cancelled by user: ${reason || "No reason"}`,
        recordedByRole: 'USER',
        recordedById: userId
    });
  } catch (err) {
    logger.warn(`cancelOrder transaction sync failed: ${err?.message || err}`);
  }

  // Notify User and Restaurant about the cancellation
  const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
  const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
  const isOnlinePaid =
    finalPaymentMethod === "razorpay" &&
    (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
  const refundDetail = isOnlinePaid ? ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.` : "";
  
  await notifyOwnersSafely(
    [
      { ownerType: "USER", ownerId: userId },
      { ownerType: "RESTAURANT", ownerId: order.restaurantId },
    ],
    {
      title: "Order Cancelled ❌",
      body: `Order #${order.order_id || order._id} has been cancelled successfully.${refundDetail}`,
      image: "https://i.ibb.co/5GzXz7r/Quick Drop-Brand-Image.png",
      data: {
        type: "order_cancelled",
        orderId: String(order._id.toString()),
        orderMongoId: String(order._id),
      },
    },
  );

  // Real-time: status update via socket
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        message: `Order #${order.order_id || order._id} has been cancelled successfully.${refundDetail}`
      };
      io.to(rooms.user(userId)).emit("order_status_update", payload);
      io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", payload);
      // Cancelled after acceptance, a rider may already be on the way.
      if (assignedRiderId) io.to(rooms.delivery(assignedRiderId)).emit("order_status_update", payload);
    }
  } catch (err) {
    logger.warn(`cancelOrder socket emit failed: ${err?.message || err}`);
  }

  if (from !== "created") {
    // Accepted orders are already in the kitchen: say so loudly, and stop the rider.
    await notifyOwnersSafely(
      [{ ownerType: "RESTAURANT", ownerId: order.restaurantId }],
      {
        title: "Customer cancelled an accepted order",
        body: `Order #${order.order_id || order._id} was cancelled by the customer. Stop preparing it.`,
        data: { type: "order_cancelled_by_user", orderId: String(order._id), orderMongoId: String(order._id) },
      },
    );
    if (assignedRiderId) {
      await notifyOwnersSafely(
        [{ ownerType: "DELIVERY_PARTNER", ownerId: assignedRiderId }],
        {
          title: "Order cancelled",
          body: `Order #${order.order_id || order._id} was cancelled by the customer. You do not need to pick it up.`,
          data: { type: "order_cancelled", orderId: String(order._id), orderMongoId: String(order._id) },
        },
      );
    }
  }

  return normalizeOrderForClient(order);
}

export async function submitOrderRatings(orderId, userId, dto) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (String(order.orderStatus) !== "delivered") {
    throw new ValidationError("You can rate only delivered orders");
  }

  const hasDeliveryPartner = !!order.dispatch?.deliveryPartnerId;
  if (hasDeliveryPartner && !dto.deliveryPartnerRating) {
    throw new ValidationError("Delivery partner rating is required");
  }

  const restaurantAlreadyRated = Number.isFinite(
    Number(order?.ratings?.restaurant?.rating),
  );
  const deliveryAlreadyRated = Number.isFinite(
    Number(order?.ratings?.deliveryPartner?.rating),
  );
  if (restaurantAlreadyRated || (hasDeliveryPartner && deliveryAlreadyRated)) {
    throw new ValidationError("Ratings already submitted for this order");
  }

  const now = new Date();
  order.ratings = order.ratings || {};
  order.ratings.restaurant = {
    rating: dto.restaurantRating,
    comment: dto.restaurantComment || "",
    ratedAt: now,
  };

  if (hasDeliveryPartner) {
    order.ratings.deliveryPartner = {
      rating: dto.deliveryPartnerRating,
      comment: dto.deliveryPartnerComment || "",
      ratedAt: now,
    };
  }

  await Promise.all([
    applyAggregateRating(
      FoodRestaurant,
      order.restaurantId,
      dto.restaurantRating,
    ),
    hasDeliveryPartner
      ? applyAggregateRating(
          FoodDeliveryPartner,
          order.dispatch.deliveryPartnerId,
          dto.deliveryPartnerRating,
        )
      : Promise.resolve(),
  ]);

    await order.save();
    enqueueOrderEvent('order_ratings_submitted', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        userId,
        restaurantRating: dto.restaurantRating,
        deliveryPartnerRating: hasDeliveryPartner ? dto.deliveryPartnerRating : null
    });
}

/**
 * The delivery partner rating the customer, after handover.
 *
 * The mirror of submitOrderRatings above, and it feeds the same aggregate
 * machinery — a customer accumulates a rating on FoodUser exactly as a
 * restaurant does. Deliberately allowed only once per order and only after
 * delivery, so it cannot be used to pressure a customer mid-trip.
 */
export async function submitCustomerRating(orderId, deliveryPartnerId, dto) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError("Order not found");

  if (
    String(order.dispatch?.deliveryPartnerId || "") !== String(deliveryPartnerId)
  ) {
    throw new ForbiddenError("Not your order");
  }
  if (String(order.orderStatus) !== "delivered") {
    throw new ValidationError("You can rate only delivered orders");
  }
  if (Number.isFinite(Number(order?.ratings?.customer?.rating))) {
    throw new ValidationError("You have already rated this customer");
  }

  order.ratings = order.ratings || {};
  order.ratings.customer = {
    rating: dto.rating,
    comment: dto.comment || "",
    ratedAt: new Date(),
  };

  await applyAggregateRating(FoodUser, order.userId, dto.rating);
  await order.save();

  return {
    orderId: order.order_id || order._id.toString(),
    orderMongoId: order._id.toString(),
    customerRating: order.ratings.customer,
  };
}

export async function updateOrderInstructions(orderId, userId, instructions) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  
  const allowedStatuses = ['created', 'confirmed', 'preparing'];
  if (!allowedStatuses.includes(order.orderStatus)) {
    throw new ValidationError("Instructions can no longer be updated for this order");
  }

  order.note = String(instructions || "").trim();
  await order.save();
  return order;
}

// ----- Restaurant -----
export async function listOrdersRestaurant(restaurantId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    $or: [
      { "payment.method": { $in: ["cash", "wallet"] } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
    ],
    // Not while the order is in its cancellation hold (core/orders/orderHold.js).
    $and: [RELEASED_TO_RESTAURANT],
  };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate("userId", "name phone email profileImage")
      .populate("dispatch.deliveryPartnerId", "name fullName phone phoneNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const orders = await attachRestaurantPayout(docs.map((d) => normalizeOrderForClient(d)));
  return buildPaginatedResult({ docs: orders, total, page, limit });
}

export async function updateOrderStatusRestaurant(
  orderId,
  restaurantId,
  orderStatus,
  note = "",
  actor = { role: "RESTAURANT", id: null },
) {
  const isAdmin = String(actor?.role || "").toUpperCase() === "ADMIN";
  // Pickup and delivery are the rider's steps (handover code, cash, ledger).
  // (RESTAURANT_ALLOWED_STATUSES below enforces the same for admins too.)
  if (!isAdmin && ["picked_up", "reached_pickup", "reached_drop", "delivered"].includes(String(orderStatus))) {
    throw new ForbiddenError("Pickup and delivery are marked by the delivery partner");
  }
  const identity = buildOrderIdentityFilter(orderId);
  // An admin acts across restaurants, so the order is not scoped to one restaurantId.
  let order = await FoodOrder.findOne(
    isAdmin
      ? identity
      : { ...identity, restaurantId: new mongoose.Types.ObjectId(restaurantId) },
  );
  if (!order) throw new NotFoundError("Order not found");
  if (!isAdmin && isHeld(order)) throw new ValidationError("This order is still in its cancellation hold and reaches you in a few seconds.");

  // Admin calls arrive without a restaurantId; take it from the order so all downstream
  // socket rooms / notifications below keep working unchanged.
  if (isAdmin) restaurantId = order.restaurantId;

  // Only kitchen-side statuses are settable here — picked_up / delivered are owned by the
  // delivery flow (partner assignment + drop-OTP in completeDelivery), so neither a restaurant
  // nor an admin may mark an order delivered with no courier/OTP.
  const RESTAURANT_ALLOWED_STATUSES = new Set([
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "cancelled_by_restaurant",
  ]);
  if (!RESTAURANT_ALLOWED_STATUSES.has(orderStatus)) {
    throw new ValidationError(
      `${isAdmin ? "Admins" : "Restaurants"} cannot set order status to '${orderStatus}'.`,
    );
  }

  const from = order.orderStatus;

  // Not before the money: an online order still waiting for its payment could
  // be confirmed, which also started dispatch for an order nobody had paid.
  if (from === "pending_payment" && !String(orderStatus).startsWith("cancelled")) {
    throw new ValidationError("This order is still waiting for the customer's payment.");
  }

  /*
   * No cancelling once the rider has the food.
   *
   * isStatusAdvance treats a cancel as valid from anywhere short of delivered,
   * including picked_up and reached_drop. But a rider is only ever paid for a
   * DELIVERED order: every earnings total filters on it. An online customer is
   * refunded in full, delivery fee included, and there is no cancellation
   * charge. So a cancel at this stage leaves the rider unpaid for a trip
   * already made.
   *
   * Refused for the admin as well as the restaurant. The alternative, crediting
   * the rider's delivery share on an undelivered order, has no home today: rider
   * balances are built from delivered orders only (core/finance, owned
   * elsewhere). A credit written anywhere else would go unread, or be read twice
   * if that ever changes. A problem this late is handled by completing the
   * delivery, or by a refund and payout through support.
   */
  const riderHasTheFood =
    ((STATUS_PRIORITY[from] || 0) >= STATUS_PRIORITY.picked_up &&
      (STATUS_PRIORITY[from] || 0) < STATUS_PRIORITY.delivered) ||
    ["en_route_to_delivery", "at_drop"].includes(order.deliveryState?.currentPhase);
  if (String(orderStatus).startsWith("cancelled") && riderHasTheFood) {
    throw new ValidationError(
      isAdmin
        ? "This order has already been picked up by the delivery partner, so it can no longer be cancelled: the partner would go unpaid for the trip. Let the delivery complete, or resolve it through a refund."
        : "This order has already been picked up by the delivery partner and can no longer be cancelled."
    );
  }

  if (!isStatusAdvance(from, orderStatus)) {
    throw new ValidationError(
      `Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`
    );
  }

  order.orderStatus = orderStatus;
  if (note && String(note).trim()) {
    order.note = String(note).trim();
  }

  pushStatusHistory(order, {
    byRole: isAdmin ? "ADMIN" : "RESTAURANT",
    byId: isAdmin ? actor?.id || null : restaurantId,
    from,
    to: orderStatus,
    note: note || "",
  });
  await order.save();

  // Custom messages / titles for status updates
  let title = `Order ${order._id.toString()} updated`;
  let body = `Status changed to ${String(orderStatus).replace(/_/g, " ")}`;

  if (orderStatus === "confirmed") {
    title = "Order Accepted! 🧑‍🍳";
    body = "The restaurant has accepted your order and is starting to prepare it.";
  } else if (orderStatus === "preparing") {
    title = "Food is being prepared! 🍳";
    body = "Your food is currently being prepared by the restaurant.";
  } else if (orderStatus === "ready_for_pickup") {
    title = "Food is ready! 🛍️";
    body = "Your order is ready and waiting to be picked up.";
  } else if (String(orderStatus).includes("cancel")) {
    const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
    const refundDetail = isOnlinePaid ? ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.` : "";
    
    title = "Order Cancelled ❌";
    body = (note && String(note).trim()) ? note : `Unfortunately, your order has been cancelled by the restaurant.${refundDetail}`;
  }

  // Real-time: status update to restaurant room.
  try {
    const io = getIO();
    if (io) {
      console.log(
        `[DEBUG] Emitting status update to restaurant ${restaurantId} and user ${order.userId}: ${orderStatus}`,
      );
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        note: order.note || note || "",
        title,
        message: body,
      };
      
      const restRoom = rooms.restaurant(restaurantId);
      const userRoom = rooms.user(order.userId);
      
      console.log(`[DEBUG] Emitting order_status_update to rooms: ${restRoom}, ${userRoom}`);
      io.to(restRoom).emit("order_status_update", payload);
      io.to(userRoom).emit("order_status_update", payload);
      
      // Notify assigned rider via socket if they exist
      const assignedRiderId = order.dispatch?.deliveryPartnerId;
      if (assignedRiderId) {
          const riderRoom = rooms.delivery(assignedRiderId);
          console.log(`[DEBUG] Emitting order_status_update to rider room: ${riderRoom}`);
          io.to(riderRoom).emit("order_status_update", payload);
      }
    }

    const notifyList = [
      { ownerType: "USER", ownerId: order.userId },
      { ownerType: "RESTAURANT", ownerId: restaurantId },
    ];

    const assignedRiderId = order.dispatch?.deliveryPartnerId;
    if (assignedRiderId) {
      notifyList.push({ ownerType: "DELIVERY_PARTNER", ownerId: assignedRiderId });
    }

    let riderTitle = `Order #${order.order_id || order._id} updated`;
    let riderBody = `The order status is now ${String(orderStatus).replace(/_/g, " ")}.`;

    if (String(orderStatus).includes("cancel")) {
      riderTitle = "Order Cancelled ❌";
      riderBody = `Order #${order.order_id || order._id} has been cancelled. Please stop your current task.`;
      
      // Sync transaction status
      try {
        const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
        await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_restaurant', {
            status: isOnlinePaid ? 'refunded' : 'failed',
            note: `Order cancelled by restaurant/admin`,
            recordedByRole: 'RESTAURANT',
            recordedById: restaurantId
        });
      } catch (err) {
        logger.warn(`updateOrderStatusRestaurant transaction sync failed: ${err?.message || err}`);
      }
    }

    await notifyOwnersSafely(
      notifyList,
      {
        title: title,
        body: body,
        image: "https://i.ibb.co/5GzXz7r/Quick Drop-Brand-Image.png",
        data: {
          type: "order_status_update",
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.() || "",
          orderStatus: String(orderStatus || ""),
          link: `/food/user/orders/${order._id?.toString?.() || ""}`,
        },
      },
    );
  } catch (err) {
    console.error("[DEBUG] Error emitting status update to restaurant:", err);
  }

  // Real-time: delivery request / ready notifications.
  try {
    const io = getIO();
    if (io) {
      // On accept (confirmed or preparing) -> request delivery partners via central logic
      if (
        (String(orderStatus) === "preparing" || String(orderStatus) === "confirmed") && 
        (String(from) !== "preparing" && String(from) !== "confirmed")
      ) {
        console.log(
          `[DEBUG] Order ${order._id.toString()} status changed to '${orderStatus}'. Triggering central delivery dispatch.`,
        );
        
        try {
            await tryAutoAssign(order._id);
            // Refresh local order state after assignment search
            order = await FoodOrder.findById(order._id); 
        } catch (err) {
            console.error(`[DEBUG] Auto-assign in updateOrderStatusRestaurant failed:`, err);
        }
      }

            // When ready for pickup -> ping assigned delivery partner.
            if (String(orderStatus) === 'ready_for_pickup' && String(from) !== 'ready_for_pickup') {
                console.log(`[DEBUG] Order ${order._id.toString()} changed to 'ready_for_pickup'.`);
                const assignedId = order.dispatch?.deliveryPartnerId?.toString?.() || order.dispatch?.deliveryPartnerId;
                if (assignedId) {
                    console.log(`[DEBUG] Notifying assigned partner ${assignedId} that order is ready.`);
                    const restaurant = await FoodRestaurant.findById(order.restaurantId).select('restaurantName location addressLine1 area city state').lean();
                    const payload = buildDeliverySocketPayload(order, restaurant);
                    logger.info(
                      `[DeliveryDispatch] Emitting order_ready to ${rooms.delivery(assignedId)} for order ${order._id.toString()}`,
                    );
                    io.to(rooms.delivery(assignedId)).emit('order_ready', payload);
                } else {
                    console.log(`[DEBUG] Order ${order._id.toString()} is ready but no partner assigned.`);
                }
            }
        }
    } catch (err) {
        console.error('[DEBUG] Error in delivery notification logic:', err);
    }

    enqueueOrderEvent('restaurant_order_status_updated', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        restaurantId,
        from,
        to: orderStatus
    });

    // ✅ NEW: Automated Razorpay Refund on Restaurant Cancel
    // Triggers if the restaurant sets status to a cancelled state (e.g., cancelled_by_restaurant)
    // Automated refund on restaurant cancel — idempotent + race-safe (see processOrderRefundOnce).
    if (String(orderStatus).includes("cancel")) {
      await processOrderRefundOnce(order, order.userId);
      await order.save();
      // A cancelled order is not a use of its coupon.
      await releaseCouponUse(order);
    }

    return normalizeOrderForClient(order);
}

/**
 * Manually re-trigger delivery partner search for a restaurant order.
 * Only allowed if status is preparing/ready and no partner has accepted yet.
 */
export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
    return dispatchService.resendDeliveryNotificationRestaurant(orderId, restaurantId);
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  return deliveryService.getCurrentTripDelivery(deliveryPartnerId);
}

/** Every order on the rider's trip (batching). */
export async function getCurrentTripsDelivery(deliveryPartnerId) {
  return deliveryService.getCurrentTripsDelivery(deliveryPartnerId);
}

// ----- Delivery: available, accept, reject, status -----
export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  return deliveryService.listOrdersAvailableDelivery(deliveryPartnerId, query);
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.acceptOrderDelivery(orderId, deliveryPartnerId);
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId, options = {}) {
  return deliveryService.rejectOrderDelivery(orderId, deliveryPartnerId, options);
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedPickupDelivery(orderId, deliveryPartnerId);
}

/**
 * Slide to confirm pickup (Bill uploaded)
 */
export async function confirmPickupDelivery(
  orderId,
  deliveryPartnerId,
  billImageUrl,
) {
  return deliveryService.confirmPickupDelivery(
    orderId,
    deliveryPartnerId,
    billImageUrl,
  );
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedDropDelivery(orderId, deliveryPartnerId);
}

export { getOrderRoute } from './order-route.service.js';

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  return deliveryService.verifyDropOtpDelivery(orderId, deliveryPartnerId, otp);
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  return deliveryService.completeDelivery(orderId, deliveryPartnerId, body);
}



export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  return deliveryService.updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus);
}

// ----- COD QR collection -----
export async function createCollectQr(
  orderId,
  deliveryPartnerId,
  customerInfo = {},
) {
  return paymentService.createCollectQr(orderId, deliveryPartnerId, customerInfo);
}


export async function getPaymentStatus(orderId, deliveryPartnerId) {
  return paymentService.getPaymentStatus(orderId, deliveryPartnerId);
}

export async function switchToCash(orderId, deliveryPartnerId) {
  return paymentService.switchToCash(orderId, deliveryPartnerId);
}


// ----- Admin -----
export async function listOrdersAdmin(query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    $or: [
      { "payment.method": { $in: ["cash", "wallet"] } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
    ],
  };

  const rawStatus =
    typeof query.status === "string" ? query.status.trim().toLowerCase() : "";
  const cancelledBy =
    typeof query.cancelledBy === "string"
      ? query.cancelledBy.trim().toLowerCase()
      : "";
  const restaurantIdRaw =
    typeof query.restaurantId === "string" ? query.restaurantId.trim() : "";
  const startDateRaw =
    typeof query.startDate === "string" ? query.startDate.trim() : "";
  const endDateRaw =
    typeof query.endDate === "string" ? query.endDate.trim() : "";

  if (rawStatus && rawStatus !== "all") {
    switch (rawStatus) {
      case "pending":
        filter.orderStatus = { $in: ["created", "confirmed"] };
        break;
      case "accepted":
        filter.orderStatus = "confirmed";
        break;
      case "processing":
        filter.orderStatus = { $in: ["preparing", "ready_for_pickup"] };
        break;
      case "food-on-the-way":
        filter.orderStatus = "picked_up";
        break;
      case "delivered":
        filter.orderStatus = "delivered";
        break;
      case "canceled":
      case "cancelled":
        filter.orderStatus = {
          $in: [
            "cancelled_by_user",
            "cancelled_by_restaurant",
            "cancelled_by_admin",
          ],
        };
        break;
      case "restaurant-cancelled":
        filter.orderStatus = "cancelled_by_restaurant";
        break;
      case "payment-failed":
        filter["payment.status"] = "failed";
        break;
      case "refunded":
        filter["payment.status"] = "refunded";
        break;
      case "offline-payments":
        filter["payment.method"] = "cash";
        filter.orderStatus = { $in: ["created", "confirmed", "delivered"] };
        break;
      case "scheduled":
        filter.scheduledAt = { $ne: null };
        break;
      default:
        break;
    }
  }

  if (cancelledBy) {
    if (cancelledBy === "restaurant") {
      filter.orderStatus = "cancelled_by_restaurant";
    } else if (cancelledBy === "user" || cancelledBy === "customer") {
      filter.orderStatus = "cancelled_by_user";
    }
  }

  /*
   * Search, run on the server so it reaches every order rather than the page
   * currently on screen.
   *
   * The admin list used to fetch a thousand orders and filter them in the
   * browser, which worked only because the whole dataset arrived at once -- and
   * it did not: the endpoint caps a request at 100, silently, so search already
   * missed everything past the hundredth order. Paginating without moving this
   * would have made that worse rather than better.
   *
   * Order id and phone are matched as substrings, which is how someone reads a
   * number off a receipt or a caller's screen. The term is escaped: an admin
   * pasting an id containing a bracket should get no results, not a crash.
   */
  const searchRaw = typeof query.search === "string" ? query.search.trim().slice(0, 120) : "";
  if (searchRaw) {
    const escaped = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(escaped, "i");
    filter.$and = [
      ...(filter.$and || []),
      {
        /*
         * The fields an order actually carries. customerName and customerPhone
         * are denormalised onto the order at checkout, which is what makes this
         * a plain query rather than a join.
         *
         * Restaurant name is deliberately absent: the order stores only
         * restaurantId, so matching a name would need a lookup per query. The
         * filter panel already narrows by restaurant, and does it properly.
         */
        $or: [
          { order_id: rx },
          { customerName: rx },
          { customerPhone: rx },
        ],
      },
    ];
  }

  if (restaurantIdRaw && mongoose.Types.ObjectId.isValid(restaurantIdRaw)) {
    filter.restaurantId = new mongoose.Types.ObjectId(restaurantIdRaw);
  }

  // A zone asked for, or a zone-limited sub-admin's zones: orders of restaurants there.
  const zoneMatch = zoneMatchFrom(query);
  if (zoneMatch) {
    const inZone = await FoodRestaurant.find({ zoneId: zoneMatch }).distinct("_id");
    filter.restaurantId = filter.restaurantId
      ? { $in: inZone.filter((id) => String(id) === String(filter.restaurantId)) }
      : { $in: inZone };
  }

  if (startDateRaw || endDateRaw) {
    const createdAt = {};
    const start = startDateRaw ? new Date(startDateRaw) : null;
    const end = endDateRaw ? new Date(endDateRaw) : null;
    if (start && !Number.isNaN(start.getTime())) {
      createdAt.$gte = start;
    }
    if (end && !Number.isNaN(end.getTime())) {
      createdAt.$lte = end;
    }
    if (Object.keys(createdAt).length > 0) {
      filter.createdAt = createdAt;
    }
  }

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .select("+deliveryOtp")
      .populate("userId", "name phone email")
      .populate("restaurantId", "restaurantName area city ownerPhone primaryContactNumber")
      .populate("dispatch.deliveryPartnerId", "name phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const paginated = buildPaginatedResult({ docs: docs.map(d => normalizeOrderForClient(d)), total, page, limit });
  return { ...paginated, orders: paginated.data };
}

// An admin assigning a rider by hand: core/delivery/manualAssign.js (assignRider),
// mounted at PATCH /admin/orders/:orderId/assign-rider. The old unrouted
// assignDeliveryPartnerAdmin that lived here bypassed the accept window, the
// auto-dispatch hand-off and the rider alert, and was removed.

export async function deleteOrderAdmin(orderId, adminId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity).lean();
  if (!order) throw new NotFoundError("Order not found");

  /*
   * An order that money has moved on cannot be deleted.
   *
   * Deleting removes the order AND its ledger row. On a delivered COD order
   * that erased the rider's cash debt and earning and the restaurant's share,
   * because every balance is summed from these documents. The same goes for
   * one that was paid or refunded: the payment and the refund are real and have
   * to stay traceable. Such an order is cancelled (and refunded) instead. Only
   * orders nobody has paid for and that were never delivered can be removed.
   */
  const paymentStatus = String(order.payment?.status || "").toLowerCase();
  const refundStatus = String(order.payment?.refund?.status || "").toLowerCase();
  if (
    order.orderStatus === "delivered" ||
    ["paid", "authorized", "refunded"].includes(paymentStatus) ||
    ["pending", "processed"].includes(refundStatus)
  ) {
    throw new ValidationError(
      "This order has been delivered or paid, so it cannot be deleted: its payment and payouts must stay on record. Cancel it instead if it should not stand."
    );
  }

  // Keep support tickets but detach deleted order reference.
  await Promise.all([
    FoodSupportTicket.updateMany(
      { orderId: order._id },
      { $set: { orderId: null } },
    ),
    FoodTransaction.deleteOne({
      $or: [{ orderId: order._id }, { orderReadableId: String(order._id.toString()) }],
    }),
    FoodOrder.deleteOne({ _id: order._id }),
  ]);

  // Remove realtime tracking node if present.
  try {
    const db = getFirebaseDB();
    if (db && order?.orderId) {
      await db.ref(`active_orders/${order._id.toString()}`).remove();
    }
  } catch (err) {
    logger.warn(`Delete order firebase cleanup failed: ${err?.message || err}`);
  }

  // Notify connected apps so stale UI entries can disappear without refresh.
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: String(order._id),
        orderId: String(order._id.toString() || ""),
        deletedBy: "ADMIN",
        adminId: adminId ? String(adminId) : null,
      };

      if (order.userId) io.to(rooms.user(order.userId)).emit("order_deleted", payload);
      if (order.restaurantId) io.to(rooms.restaurant(order.restaurantId)).emit("order_deleted", payload);
      if (order.dispatch?.deliveryPartnerId) {
        io.to(rooms.delivery(order.dispatch.deliveryPartnerId)).emit("order_deleted", payload);
      }
    }
  } catch (err) {
    logger.warn(`Delete order socket emit failed: ${err?.message || err}`);
  }

  enqueueOrderEvent("order_deleted_by_admin", {
    orderMongoId: String(order._id),
    orderId: String(order._id.toString() || ""),
    adminId: adminId ? String(adminId) : null,
  });

  return {
    deleted: true,
    orderId: String(order._id.toString() || ""),
    orderMongoId: String(order._id),
  };
}

