import mongoose from 'mongoose';
import { ParentOrder } from '../../../../../../core/orders/parentOrder.model.js';
import { splitProRata, splitProRataInt } from '../../../../../../core/orders/proRata.js';
import { quoteRedemption, burnPoints, reverseBurn, loyaltySettings } from '../../../../../../core/loyalty/loyalty.service.js';
import { refundGatewayPayment } from '../../../../../../core/payments/refund.service.js';
import { FoodOrder } from '../models/order.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import {
  calculateOrderPricing,
  evaluateCoupon,
  loadRestaurantForOrdering,
} from './order-pricing.service.js';
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  getRazorpayKeyId,
  isRazorpayConfigured,
  fetchRazorpayPayment,
} from '../helpers/razorpay.helper.js';
import * as userWalletService from '../../user/services/userWallet.service.js';
import * as foodTransactionService from './foodTransaction.service.js';
import { restoreOrderStock } from './inventory.service.js';
import { releaseSlot } from '../../../../../../core/deliverySlots/deliverySlot.service.js';
import { normalizeOrderForClient, notifyOwnersSafely, pushStatusHistory } from './order.helpers.js';

/**
 * Multi-seller checkout for quick commerce (plan §5.1).
 *
 * One basket, items from several stores. The customer pays once and uses one
 * coupon; each store gets its own child order -- its own acceptance, rider,
 * tracking, cancellation and refund -- through the ordinary createOrder path.
 * The parent (core/orders/parentOrder.model.js) holds the payment and the
 * coupon and records the split.
 *
 * The shared charges are split between the stores by item value, to the paisa
 * (core/orders/proRata.js), and each child is priced with its share, so its
 * total, its GST and its refund are its own:
 *
 *   delivery fee   ONE fee for the basket: the highest any single store would
 *                  charge (0 for pickup), shared out by item value
 *   platform fee   charged once, shared the same way
 *   coupon         tested once against the whole basket; a store-scoped coupon
 *                  is shared only between the stores it covers
 *   points         redeemed once (core/loyalty), shared by value after coupon
 *
 * Each child stores its shares in `parentSplit`; the parent stores them all in
 * `split`. A refund of one child (cancel, seller reject, timeout) returns that
 * child's total through the shared, idempotent refundGatewayPayment keyed on
 * the child -- the existing per-order refund path, unchanged.
 */

const VERTICAL = 'quickCommerce';
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

/** Lines grouped by store, in the order the stores first appear. */
export function groupItemsByStore(dto = {}) {
  const groups = new Map();
  for (const item of Array.isArray(dto.items) ? dto.items : []) {
    const sid = String(item?.storeId || item?.restaurantId || dto.restaurantId || '');
    if (!isId(sid)) throw new ValidationError('Every item needs the storeId it is sold by');
    if (!groups.has(sid)) groups.set(sid, []);
    const { storeId, ...line } = item;
    groups.get(sid).push(line);
  }
  if (groups.size === 0) throw new ValidationError('Your cart is empty');
  if (groups.size > 5) throw new ValidationError('A checkout can include at most 5 stores');
  return [...groups.entries()].map(([storeId, items]) => ({ storeId, items }));
}

const childDtoFor = (dto, group) => {
  const { items, pricing, couponCode, loyaltyPoints, ...rest } = dto;
  return { ...rest, restaurantId: group.storeId, items: group.items };
};

/**
 * Price the basket: each store alone, then the shared charges split between
 * them. Returns the per-store overrides createOrder prices each child with.
 */
export async function planMultiStore(userId, dto) {
  const groups = groupItemsByStore(dto);
  const fulfilmentType = String(dto.fulfilmentType || 'delivery').toLowerCase() === 'pickup' ? 'pickup' : 'delivery';
  const at = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();
  const address = dto.address || dto.deliveryAddress;

  const alone = [];
  for (const g of groups) {
    const restaurant = await loadRestaurantForOrdering(g.storeId);
    const priced = await calculateOrderPricing(
      userId,
      { restaurantId: g.storeId, items: g.items, deliveryAddress: address, deliveryAddressId: dto.deliveryAddressId, fulfilmentType },
      { at: Number.isNaN(at.getTime()) ? new Date() : at, restaurant, skipAvailabilityCheck: true, fulfilmentType },
    );
    alone.push({ ...g, restaurant, subtotal: Number(priced.pricing.subtotal) || 0, pricing: priced.pricing });
  }

  const subtotals = alone.map((a) => a.subtotal);
  const subtotal = round2(subtotals.reduce((x, y) => x + y, 0));
  const deliveryFee = fulfilmentType === 'pickup' ? 0 : round2(Math.max(0, ...alone.map((a) => Number(a.pricing.naturalDeliveryFee) || 0)));
  const platformFee = round2(Math.max(0, ...alone.map((a) => Number(a.pricing.naturalPlatformFee) || 0)));

  // One coupon, tested against the whole basket.
  const code = String(dto.pricing?.couponCode || dto.couponCode || '').trim().toUpperCase();
  let coupon = { discount: 0, discountFundedByPlatform: false, appliedCoupon: null, codeRaw: code, offerScope: null };
  let couponWeights = subtotals;
  if (code) {
    const storeIds = alone.map((a) => a.storeId);
    coupon = await evaluateCoupon(userId, code, { subtotal, restaurantIds: storeIds });
    if (coupon.offerScope) {
      couponWeights = alone.map((a) => (coupon.offerScope.includes(String(a.storeId)) ? a.subtotal : 0));
      const eligibleSubtotal = round2(couponWeights.reduce((x, y) => x + y, 0));
      coupon = await evaluateCoupon(userId, code, { subtotal, restaurantIds: storeIds, eligibleSubtotal });
      coupon.offerScope = coupon.offerScope || [];
    }
  }
  const discount = round2(coupon.discount || 0);

  const deliveryShares = splitProRata(deliveryFee, subtotals);
  const platformShares = splitProRata(platformFee, subtotals);
  const discountShares = splitProRata(discount, couponWeights);

  // Points, redeemed once against the value left after the coupon.
  let loyalty = { points: 0, discount: 0 };
  let pointShares = alone.map(() => 0);
  let loyaltyShares = alone.map(() => 0);
  if (Number(dto.loyaltyPoints) > 0) {
    loyalty = await quoteRedemption({ customerId: userId, vertical: VERTICAL, points: dto.loyaltyPoints, orderValue: Math.max(0, subtotal - discount) });
    if (loyalty.points > 0) {
      const { rupeesPerPoint } = await loyaltySettings(VERTICAL);
      const afterCoupon = alone.map((a, i) => Math.max(0, a.subtotal - discountShares[i]));
      pointShares = splitProRataInt(loyalty.points, afterCoupon);
      loyaltyShares = pointShares.map((p) => round2(p * rupeesPerPoint));
    }
  }

  const children = alone.map((a, i) => ({
    storeId: a.storeId,
    storeName: a.restaurant?.restaurantName || '',
    items: a.items,
    subtotal: a.subtotal,
    overrides: {
      deliveryFee: deliveryShares[i],
      platformFee: platformShares[i],
      discount: discountShares[i],
      discountFundedByPlatform: coupon.discountFundedByPlatform === true,
      couponCode: discountShares[i] > 0 ? code : null,
      loyaltyDiscount: loyaltyShares[i],
      loyaltyPoints: pointShares[i],
    },
  }));

  return {
    fulfilmentType,
    subtotal,
    deliveryFee,
    platformFee,
    discount,
    couponCode: discount > 0 ? code : null,
    appliedCoupon: coupon.appliedCoupon,
    discountFundedByPlatform: coupon.discountFundedByPlatform === true,
    loyaltyPoints: pointShares.reduce((x, y) => x + y, 0),
    loyaltyDiscount: round2(loyaltyShares.reduce((x, y) => x + y, 0)),
    loyaltyQuote: loyalty,
    children,
  };
}

/** The /calculate answer for a multi-store basket: each child priced with its share. */
export async function quoteMultiStore(userId, dto) {
  const plan = await planMultiStore(userId, dto);
  const at = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();
  const stores = [];
  for (const c of plan.children) {
    const priced = await calculateOrderPricing(
      userId,
      { restaurantId: c.storeId, items: c.items, deliveryAddress: dto.address || dto.deliveryAddress, deliveryAddressId: dto.deliveryAddressId, fulfilmentType: plan.fulfilmentType },
      { at: Number.isNaN(at.getTime()) ? new Date() : at, skipAvailabilityCheck: true, fulfilmentType: plan.fulfilmentType, overrides: c.overrides },
    );
    stores.push({ storeId: c.storeId, storeName: c.storeName, items: priced.items, pricing: priced.pricing, priceChanges: priced.priceChanges });
  }
  const sum = (k) => round2(stores.reduce((x, s) => x + (Number(s.pricing[k]) || 0), 0));
  return {
    isMultiStore: true,
    fulfilmentType: plan.fulfilmentType,
    stores,
    items: stores.flatMap((s) => s.items.map((it) => ({ ...it, storeId: s.storeId }))),
    priceChanges: stores.flatMap((s) => s.priceChanges || []),
    pricing: {
      subtotal: sum('subtotal'),
      tax: sum('tax'),
      deliveryFee: sum('deliveryFee'),
      deliveryFeeGst: sum('deliveryFeeGst'),
      platformFee: sum('platformFee'),
      platformFeeGst: sum('platformFeeGst'),
      discount: sum('discount'),
      loyaltyDiscount: sum('loyaltyDiscount'),
      loyaltyPoints: stores.reduce((x, s) => x + (Number(s.pricing.loyaltyPoints) || 0), 0),
      roundOff: sum('roundOff'),
      total: sum('total'),
      couponCode: plan.couponCode,
      appliedCoupon: plan.appliedCoupon,
      currency: 'INR',
      fulfilmentType: plan.fulfilmentType,
      splitBasis: 'subtotal',
    },
  };
}

/** The parent as the app sees it, with its children. */
export async function parentView(parentLike, { userId, children } = {}) {
  const parent = parentLike?.toObject ? parentLike.toObject() : parentLike;
  const kids = children || (await FoodOrder.find({ parentOrderId: parent._id }).select('+pickupOtp')
    .populate('restaurantId', 'restaurantName profileImage area city location primaryContactNumber ownerPhone')
    .sort({ createdAt: 1 })
    .lean());
  return {
    isMultiStore: true,
    parentOrderId: String(parent._id),
    orderId: parent.orderNumber,
    orderNumber: parent.orderNumber,
    status: parent.status,
    fulfilmentType: parent.fulfilmentType,
    scheduledAt: parent.scheduledAt,
    pricing: parent.pricing,
    payment: { method: parent.payment?.method, status: parent.payment?.status, amountDue: parent.payment?.amountDue },
    split: parent.split,
    createdAt: parent.createdAt,
    children: kids.map((k) => {
      const out = normalizeOrderForClient(k);
      const isOwner = !userId || String(k.userId?._id || k.userId) === String(userId);
      if (k.fulfilmentType === 'pickup' && isOwner && !k.pickupVerification?.verified) out.pickupOtp = k.pickupOtp || '';
      else delete out.pickupOtp;
      delete out.deliveryOtp;
      return out;
    }),
  };
}

async function failChildren(children, reason) {
  for (const child of children) {
    try {
      const doc = await FoodOrder.findById(child._id);
      if (!doc || String(doc.orderStatus).startsWith('cancelled')) continue;
      const from = doc.orderStatus;
      doc.orderStatus = 'cancelled_by_user';
      doc.cancellationReason = reason;
      if (doc.payment && doc.payment.status !== 'refunded') doc.payment.status = 'failed';
      pushStatusHistory(doc, { byRole: 'SYSTEM', from, to: 'cancelled_by_user', note: reason });
      await doc.save();
      await restoreOrderStock(doc);
      if (doc.deliverySlot?.slotId) await releaseSlot({ slotId: doc.deliverySlot.slotId, date: doc.deliverySlot.date, orderId: doc._id });
      await foodTransactionService.updateTransactionStatus(doc._id, 'cancelled_by_user', { status: 'failed', note: reason, recordedByRole: 'SYSTEM' }).catch(() => {});
    } catch (err) {
      logger.error(`Multi-store rollback of child ${child?._id} failed: ${err?.message || err}`);
    }
  }
}

async function giveBackParentCoupon(parent, userId) {
  if (!parent.couponUserClaimed || !parent.pricing?.couponCode) return;
  try {
    const offer = await FoodOffer.findOne({ couponCode: parent.pricing.couponCode }).select('_id').lean();
    if (offer) await FoodOfferUsage.updateOne({ offerId: offer._id, userId: new mongoose.Types.ObjectId(String(userId)), count: { $gt: 0 } }, { $inc: { count: -1 } });
  } catch { /* best effort */ }
}

/** Count the parent's one coupon, once (the claim on couponCountedAt makes it idempotent). */
async function countParentCoupon(parent, userId) {
  if (!parent.pricing?.couponCode || !(Number(parent.pricing.discount) > 0)) return;
  const claimed = await ParentOrder.findOneAndUpdate(
    { _id: parent._id, couponCountedAt: null },
    { $set: { couponCountedAt: new Date() } },
  );
  if (!claimed) return;
  const { incrementCouponUsageForOrder } = await import('./order.service.js');
  const pseudo = { _id: parent._id, pricing: { couponCode: parent.pricing.couponCode, discount: parent.pricing.discount }, $locals: { couponUserClaimed: parent.couponUserClaimed } };
  await incrementCouponUsageForOrder(pseudo, userId);
}

export async function createMultiStoreOrder(userId, dto) {
  const { createOrder, claimCouponForCustomer } = await import('./order.service.js');
  const plan = await planMultiStore(userId, dto);
  const rawMethod = dto.paymentMethod === 'card' ? 'razorpay' : String(dto.paymentMethod || 'cash');
  const method = rawMethod;
  if (!['cash', 'wallet', 'razorpay'].includes(method)) throw new ValidationError('Unsupported payment method for a multi-store order');
  if (method === 'cash' && String(process.env.COD_ENABLED || 'true') !== 'true') {
    throw new ValidationError('Cash on Delivery is no longer available. Please pay online.');
  }
  const awaitingOnline = method === 'razorpay';

  const parent = new ParentOrder({
    vertical: VERTICAL,
    userId: new mongoose.Types.ObjectId(String(userId)),
    storeIds: plan.children.map((c) => new mongoose.Types.ObjectId(c.storeId)),
    fulfilmentType: plan.fulfilmentType,
    scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
    status: 'placing',
    pricing: {
      subtotal: plan.subtotal,
      deliveryFee: plan.deliveryFee,
      platformFee: plan.platformFee,
      discount: plan.discount,
      couponCode: plan.couponCode,
      loyaltyPoints: plan.loyaltyPoints,
      loyaltyDiscount: plan.loyaltyDiscount,
      splitBasis: 'subtotal',
    },
    payment: { method, status: 'created' },
  });
  await parent.save();

  // The one coupon: claimed for the customer once, on the parent.
  try {
    parent.couponUserClaimed = await claimCouponForCustomer(
      { _id: parent._id, pricing: { couponCode: plan.couponCode, discount: plan.discount } },
      userId,
      awaitingOnline,
    );
  } catch (err) {
    await ParentOrder.updateOne({ _id: parent._id }, { $set: { status: 'failed', failureReason: err.message } });
    throw err;
  }

  // The points: spent once, on the parent; each child records its share.
  if (plan.loyaltyPoints > 0) {
    try {
      await burnPoints({ customerId: userId, vertical: VERTICAL, points: plan.loyaltyPoints, key: `qc:parent:${parent._id}`, orderRef: parent.orderNumber, amount: plan.loyaltyDiscount });
    } catch (err) {
      await giveBackParentCoupon(parent, userId);
      await ParentOrder.updateOne({ _id: parent._id }, { $set: { status: 'failed', failureReason: err.message } });
      throw err;
    }
  }

  const undoParent = async (reason, created) => {
    await failChildren(created, reason);
    if (plan.loyaltyPoints > 0) {
      await reverseBurn({ customerId: userId, vertical: VERTICAL, points: plan.loyaltyPoints, key: `qc:parent:${parent._id}`, orderRef: parent.orderNumber }).catch(() => {});
    }
    await giveBackParentCoupon(parent, userId);
    await ParentOrder.updateOne({ _id: parent._id }, { $set: { status: 'failed', failureReason: reason, childOrderIds: created.map((c) => c._id) } });
  };

  const created = [];
  for (const child of plan.children) {
    try {
      const result = await createOrder(
        userId,
        { ...childDtoFor(dto, child), paymentMethod: method },
        {
          parentOrderId: parent._id,
          overrides: child.overrides,
          parentSplit: {
            deliveryFee: child.overrides.deliveryFee,
            platformFee: child.overrides.platformFee,
            discount: child.overrides.discount,
            loyaltyDiscount: child.overrides.loyaltyDiscount,
            loyaltyPoints: child.overrides.loyaltyPoints,
            basis: 'subtotal',
          },
        },
      );
      created.push({ _id: new mongoose.Types.ObjectId(String(result.order.orderMongoId || result.order._id)), storeId: child.storeId, order: result.order });
    } catch (err) {
      await undoParent(`Could not place the order with ${child.storeName || 'a store'}: ${err.message}`, created);
      throw new ValidationError(`${child.storeName || 'One of the stores'}: ${err.message}`);
    }
  }

  const docs = await FoodOrder.find({ _id: { $in: created.map((c) => c._id) } }).lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const split = created.map((c) => {
    const d = byId.get(String(c._id)) || {};
    const p = d.pricing || {};
    return {
      orderId: c._id,
      storeId: new mongoose.Types.ObjectId(c.storeId),
      orderNumber: d.order_id || '',
      subtotal: Number(p.subtotal) || 0,
      deliveryFee: Number(p.deliveryFee) || 0,
      platformFee: Number(p.platformFee) || 0,
      discount: Number(p.discount) || 0,
      loyaltyDiscount: Number(p.loyaltyDiscount) || 0,
      loyaltyPoints: Number(p.loyaltyPoints) || 0,
      total: Number(p.total) || 0,
    };
  });
  const total = round2(split.reduce((x, r) => x + r.total, 0));
  parent.childOrderIds = created.map((c) => c._id);
  parent.split = split;
  parent.pricing.total = total;
  parent.payment.amountDue = total;

  let razorpay = null;
  if (method === 'wallet') {
    try {
      await userWalletService.deductWalletBalance(userId, total, `Payment for order #${parent.orderNumber}`, { orderId: parent._id, parentOrderId: parent._id });
    } catch (err) {
      await undoParent(err.message || 'Wallet payment failed', created);
      throw err;
    }
    parent.payment.status = 'paid';
    parent.payment.paidAt = new Date();
    parent.status = 'placed';
  } else if (method === 'cash') {
    parent.payment.status = 'cod_pending';
    parent.status = 'placed';
  } else {
    parent.status = 'pending_payment';
    if (isRazorpayConfigured()) {
      const amountPaise = Math.round(total * 100);
      if (amountPaise < 100) {
        await undoParent('Amount too low for online payment', created);
        throw new ValidationError('Amount too low for online payment');
      }
      try {
        const rz = await createRazorpayOrder(amountPaise, 'INR', String(parent._id));
        parent.payment.razorpay = { orderId: rz.id, paymentId: '', signature: '' };
        razorpay = { key: getRazorpayKeyId(), orderId: rz.id, amount: rz.amount, currency: rz.currency || 'INR', parentOrderId: String(parent._id) };
      } catch (err) {
        await undoParent(err?.message || 'Payment gateway error', created);
        throw new ValidationError(err?.message || 'Payment gateway error');
      }
    }
  }
  await parent.save();

  if (!awaitingOnline) {
    await countParentCoupon(parent, userId);
    void notifyOwnersSafely([{ ownerType: 'USER', ownerId: userId }], {
      title: 'Order Confirmed!',
      body: `Your order #${parent.orderNumber} from ${created.length} stores has been placed.`,
      data: { type: 'order_created', orderId: String(parent._id), parentOrderId: String(parent._id) },
    });
  }

  const view = await parentView(parent, { userId });
  return { order: view, parentOrder: view, orders: view.children, razorpay };
}

/** Find a customer's parent by id or number. */
export async function findParentForUser(userId, parentRef) {
  const ref = String(parentRef || '').trim();
  if (!ref) return null;
  const q = isId(ref) ? { _id: new mongoose.Types.ObjectId(ref) } : { orderNumber: ref };
  const parent = await ParentOrder.findOne({ ...q, vertical: VERTICAL });
  if (!parent) return null;
  if (userId && String(parent.userId) !== String(userId)) throw new ForbiddenError('Not your order');
  return parent;
}

export async function getParentOrderForUser(userId, parentRef) {
  const parent = await findParentForUser(userId, parentRef);
  if (!parent) throw new NotFoundError('Order not found');
  return parentView(parent, { userId });
}

/**
 * The parent's one payment arrived: every child still waiting is marked paid
 * (its own acceptance window, ledger row and store push), and a child that was
 * cancelled meanwhile (its payment window ran out) has its share refunded.
 * Idempotent: a child already paid is left alone.
 */
export async function settleParentPayment(parent, { razorpayPaymentId, razorpaySignature = '', userId, byRole = 'USER' }) {
  const { markOnlineOrderPaid } = await import('./order.service.js');
  const rzOrderId = parent.payment?.razorpay?.orderId || '';
  const children = await FoodOrder.find({ parentOrderId: parent._id });
  for (const child of children) {
    const pay = String(child.payment?.status || '').toLowerCase();
    if (pay === 'paid' || pay === 'refunded') continue;
    if (child.orderStatus === 'pending_payment') {
      await markOnlineOrderPaid(child, { userId: String(parent.userId), razorpayPaymentId, razorpaySignature, razorpayOrderId: rzOrderId, skipCoupon: true, byRole });
      continue;
    }
    if (String(child.orderStatus).startsWith('cancelled')) {
      const amount = Number(child.pricing?.total) || 0;
      if (amount > 0) {
        const r = await refundGatewayPayment({
          vertical: VERTICAL,
          gatewayPaymentId: razorpayPaymentId,
          amount,
          idempotencyKey: `qc:order_refund:${child._id}`,
          orderId: child._id,
          orderRef: child.order_id || '',
          userId: child.userId,
          reason: 'Paid after this store order was cancelled',
          source: 'late_capture',
        });
        child.payment.razorpay = { ...(child.payment.razorpay?.toObject?.() || child.payment.razorpay || {}), orderId: rzOrderId, paymentId: razorpayPaymentId };
        child.payment.status = r.success ? 'refunded' : 'paid';
        child.payment.refund = { status: r.success ? 'processed' : 'failed', amount, refundId: r.refundId || '', processedAt: new Date() };
        await child.save();
      }
    }
  }
  await ParentOrder.updateOne(
    { _id: parent._id },
    { $set: { 'payment.status': 'paid', 'payment.paidAt': new Date(), 'payment.razorpay.paymentId': razorpayPaymentId, 'payment.razorpay.signature': razorpaySignature, status: 'placed' } },
  );
  const fresh = await ParentOrder.findById(parent._id);
  await countParentCoupon(fresh, userId || String(parent.userId));
  return fresh;
}

/** The app's /verify-payment for a parent (orderId = parent id or number). */
export async function verifyMultiStorePayment(userId, dto) {
  const parent = await findParentForUser(userId, dto.orderId);
  if (!parent) return null;
  if (parent.payment?.status === 'paid') return { order: await parentView(parent, { userId }), payment: parent.payment };
  if (String(dto.razorpayOrderId) !== String(parent.payment?.razorpay?.orderId || '')) {
    throw new ValidationError('Payment verification failed');
  }
  if (!verifyPaymentSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature)) {
    throw new ValidationError('Payment verification failed');
  }
  let rz;
  try {
    rz = await fetchRazorpayPayment(dto.razorpayPaymentId);
  } catch (err) {
    logger.error(`Razorpay payment fetch failed for parent ${parent._id}: ${err?.message || err}`);
    throw new ValidationError('Payment verification failed. Please retry in a moment.');
  }
  const expectedPaise = Math.round((Number(parent.pricing?.total) || 0) * 100);
  const status = String(rz?.status || '').toLowerCase();
  if (String(rz?.order_id || '') !== String(parent.payment.razorpay.orderId) || !['captured', 'authorized'].includes(status) || Number(rz?.amount) !== expectedPaise) {
    await ParentOrder.updateOne({ _id: parent._id, 'payment.status': { $ne: 'paid' } }, { $set: { 'payment.status': 'failed' } });
    throw new ValidationError('Payment verification failed');
  }
  const fresh = await settleParentPayment(parent, { razorpayPaymentId: dto.razorpayPaymentId, razorpaySignature: dto.razorpaySignature, userId });
  return { order: await parentView(fresh, { userId }), payment: fresh.payment };
}

/**
 * The webhook's half (core/payments/controllers/razorpayWebhook.controller.js):
 * a captured payment for a parent's gateway order. Returns false when the
 * gateway order is not a parent's, so the caller carries on as before.
 */
export async function handleParentCapture({ rzOrderId, rzPaymentId, amountPaise }) {
  const parent = await ParentOrder.findOne({ vertical: VERTICAL, 'payment.razorpay.orderId': rzOrderId });
  if (!parent) return false;
  if (parent.payment?.status === 'paid' && parent.payment?.razorpay?.paymentId === rzPaymentId) return true;
  const expected = Math.round((Number(parent.pricing?.total) || 0) * 100);
  if (Number(amountPaise) !== expected) {
    logger.error(`Webhook: AMOUNT MISMATCH for parent ${parent._id}: paid ${amountPaise}, expected ${expected}. Not marked paid.`);
    return true;
  }
  await settleParentPayment(parent, { razorpayPaymentId: rzPaymentId, userId: String(parent.userId), byRole: 'SYSTEM' });
  return true;
}

/** Parents for a page of child orders, for the grouped order list. */
export async function groupOrdersByParent(docs = []) {
  const ids = [...new Set(docs.map((d) => d.parentOrderId).filter(Boolean).map(String))];
  if (!ids.length) return docs;
  const parents = await ParentOrder.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }).lean();
  const byId = new Map(parents.map((p) => [String(p._id), p]));
  const out = [];
  const seen = new Map();
  for (const d of docs) {
    const pid = d.parentOrderId ? String(d.parentOrderId) : '';
    const parent = pid && byId.get(pid);
    if (!parent) {
      out.push(d);
      continue;
    }
    if (!seen.has(pid)) {
      const entry = {
        isMultiStore: true,
        parentOrderId: pid,
        orderId: parent.orderNumber,
        orderNumber: parent.orderNumber,
        status: parent.status,
        fulfilmentType: parent.fulfilmentType,
        pricing: parent.pricing,
        payment: { method: parent.payment?.method, status: parent.payment?.status },
        createdAt: parent.createdAt,
        children: [],
      };
      seen.set(pid, entry);
      out.push(entry);
    }
    seen.get(pid).children.push(d);
  }
  return out;
}

/**
 * The customer closed the payment sheet: every child still waiting for the one
 * payment is cancelled (stock, slot back), the points and the coupon claim are
 * returned, and the parent is marked cancelled. Returns null when the id is not
 * a parent's.
 */
export async function abandonParentPayment(userId, parentRef) {
  const parent = await findParentForUser(userId, parentRef);
  if (!parent) return null;
  if (parent.payment?.status === 'paid') throw new ValidationError('This order is already paid');
  const { expirePendingPaymentOrder } = await import('./order.service.js');
  const children = await FoodOrder.find({ parentOrderId: parent._id, orderStatus: 'pending_payment' })
    .select('_id orderStatus payment stockReservedAt stockRestoredAt')
    .lean();
  for (const child of children) await expirePendingPaymentOrder(child);
  if (Number(parent.pricing?.loyaltyPoints) > 0) {
    await reverseBurn({ customerId: userId, vertical: VERTICAL, points: parent.pricing.loyaltyPoints, key: `qc:parent:${parent._id}`, orderRef: parent.orderNumber }).catch(() => {});
  }
  await ParentOrder.updateOne({ _id: parent._id }, { $set: { status: 'cancelled', 'payment.status': 'failed' } });
  return { deleted: true, orderId: String(parent._id), parentOrderId: String(parent._id) };
}
