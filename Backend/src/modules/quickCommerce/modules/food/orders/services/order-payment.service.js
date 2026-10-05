import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import {
  createPaymentLink,
  fetchRazorpayPaymentLink,
  isRazorpayConfigured,
} from '../helpers/razorpay.helper.js';
import * as foodTransactionService from './foodTransaction.service.js';
import {
  buildOrderIdentityFilter,
  enqueueOrderEvent,
} from './order.helpers.js';

export async function syncRazorpayQrPayment(orderDoc) {
  const orderId = orderDoc?._id;
  // FoodTransaction is source of truth; FoodOrder.payment is fallback
  const tx = await FoodTransaction.findOne({ orderId }).lean();
  const payment = tx?.payment || orderDoc?.payment || null;
  if (!payment) {
    logger.warn(`[QrSync] No payment found for order ${orderId}`);
    return null;
  }

  // Allow sync if either tx OR FoodOrder has razorpay_qr method
  const isQrMethod = payment.method === 'razorpay_qr';
  if (!isQrMethod) return payment;
  if (payment.status === 'paid') return payment;

  const paymentLinkId = payment?.qr?.paymentLinkId;
  if (!paymentLinkId) {
    logger.warn(`[QrSync] No paymentLinkId for order ${orderId}`);
    return payment;
  }
  if (!isRazorpayConfigured()) {
    logger.warn(`[QrSync] Razorpay not configured – cannot sync order ${orderId}`);
    return payment;
  }

  let link;
  try {
    link = await fetchRazorpayPaymentLink(paymentLinkId);
    logger.info(`[QrSync] Razorpay link status for ${paymentLinkId}: ${link?.status}`);
  } catch (error) {
    logger.error(
      `[QrSync] Razorpay payment-link fetch FAILED for ${paymentLinkId}: ${
        error?.message || error
      }`,
    );
    return payment;
  }

  const linkStatus = String(link?.status || '').toLowerCase();
  if (!linkStatus) {
    logger.warn(`[QrSync] Empty linkStatus for ${paymentLinkId}`);
    return payment;
  }

  // Razorpay Payment Link statuses: created, partially_paid, paid, expired, cancelled.
  // ONLY a fully-paid link counts. 'partially_paid' means some of the amount arrived, and
  // 'authorized' means funds are merely held, not captured — treating either as paid let a
  // rider hand over food for an order that was underpaid or never actually charged.
  const isPaid = ['paid', 'captured'].includes(linkStatus);
  const isFailed = ['expired', 'cancelled', 'canceled', 'failed'].includes(linkStatus);
  const newPaymentStatus = isPaid ? 'paid' : isFailed ? 'failed' : (payment.status || 'pending_qr');

  if (['partially_paid', 'authorized'].includes(linkStatus)) {
    logger.warn(
      `[QrSync] Order ${orderId} link is '${linkStatus}' — NOT settling as paid. The rider must not hand over the order until it is fully captured.`
    );
  }

  logger.info(`[QrSync] Updating order ${orderId} payment.status from '${payment.status}' to '${newPaymentStatus}'`);

  // Update FoodTransaction (upsert in case it didn't exist)
  await FoodTransaction.updateOne(
    { orderId },
    {
      $set: {
        'payment.qr.status': linkStatus,
        'payment.status': newPaymentStatus,
      },
    },
  );

  // Keep FoodOrder in sync too
  if (isPaid) {
    await FoodOrder.updateOne(
      { _id: orderId },
      { $set: { 'payment.status': 'paid', 'payment.qr.status': 'paid' } }
    );
  }

  const updatedTx = await FoodTransaction.findOne({ orderId }).lean();
  return updatedTx?.payment || payment;
}



export async function createCollectQr(
  orderId,
  deliveryPartnerId,
  customerInfo = {},
) {
  const query = mongoose.Types.ObjectId.isValid(orderId)
    ? { _id: orderId }
    : { orderId };

  const order = await FoodOrder.findOne(query)
    .populate('userId', 'name email phone')
    .lean();

  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const payment = tx?.payment || order.payment || {};
  if (payment.method !== 'cash' && payment.status === 'paid') {
    throw new ValidationError('Order already paid');
  }

  const amountDue = payment.amountDue ?? tx?.pricing?.total ?? order.pricing?.total ?? 0;
  if (amountDue < 1) throw new ValidationError('No amount due');
  if (!isRazorpayConfigured()) {
    throw new ValidationError('QR payment not configured');
  }

  const user = order.userId || {};
  const link = await createPaymentLink({
    amountPaise: Math.round(amountDue * 100),
    currency: 'INR',
    description: `Order ${order._id.toString()} - COD collect`,
    orderId: order._id.toString(),
    customerName: customerInfo.name || user.name || 'Customer',
    customerEmail: customerInfo.email || user.email || 'customer@example.com',
    customerPhone: customerInfo.phone || user.phone,
  });


  // CRITICAL: use upsert so this works even if FoodTransaction was never created at order placement
  const upsertData = {
    $set: {
      paymentMethod: 'razorpay_qr',
      'payment.method': 'razorpay_qr',
      'payment.status': 'pending_qr',
      'payment.amountDue': amountDue,
      'payment.qr': {
        paymentLinkId: link.id,
        shortUrl: link.short_url,
        imageUrl: link.short_url,
        status: link.status || 'created',
        expiresAt: link.expire_by ? new Date(link.expire_by * 1000) : null,
      },
    },
    $setOnInsert: {
      orderId: order._id,
      userId: order.userId?._id || order.userId,
      restaurantId: order.restaurantId,
      deliveryPartnerId: order.dispatch?.deliveryPartnerId,
      currency: 'INR',
      status: 'pending',
      pricing: {
        subtotal: order.pricing?.subtotal || 0,
        tax: order.pricing?.tax || 0,
        packagingFee: order.pricing?.packagingFee || 0,
        deliveryFee: order.pricing?.deliveryFee || 0,
        deliveryFeeGst: order.pricing?.deliveryFeeGst || 0,
        platformFee: order.pricing?.platformFee || 0,
        restaurantCommission: order.pricing?.restaurantCommission || 0,
        discount: order.pricing?.discount || 0,
        couponCode: order.pricing?.couponCode ? String(order.pricing.couponCode).trim().toUpperCase() : null,
        total: order.pricing?.total || 0,
        currency: 'INR',
      },
      amounts: {
        totalCustomerPaid: order.pricing?.total || 0,
        restaurantShare: 0, riderShare: 0, restaurantCommission: 0, platformNetProfit: 0,
      },
      history: [{ kind: 'created', amount: amountDue, note: 'Transaction auto-created at QR generation' }],
    },
  };

  await FoodTransaction.updateOne(
    { orderId: order._id },
    upsertData,
    { upsert: true }
  );

  // Also write to FoodOrder so sync can find paymentLinkId even without a TX doc
  await FoodOrder.updateOne(
    { _id: order._id },
    {
      $set: {
        'payment.method': 'razorpay_qr',
        'payment.status': 'pending_qr',
        'payment.qr.paymentLinkId': link.id,
        'payment.qr.shortUrl': link.short_url,
        'payment.qr.status': link.status || 'created',
      }
    }
  );

  const updatedTx = await FoodTransaction.findOne({ orderId: order._id }).lean();


  if (updatedTx) {
    await foodTransactionService.updateTransactionStatus(
      order._id,
      'cod_collect_qr_created',
      {
        recordedByRole: 'DELIVERY_PARTNER',
        recordedById: deliveryPartnerId,
        note: 'COD collection QR created',
      },
    );
  }

  enqueueOrderEvent('collect_qr_created', {
    orderMongoId: String(orderId),
    orderId: order?.orderId || null,
    deliveryPartnerId,
    paymentLinkId: link.id,
    shortUrl: link.short_url,
    amountDue,
  });

  return {
    shortUrl:
      link?.short_url ?? link?.shortUrl ?? link?.short_url_path ?? null,
    imageUrl:
      link?.short_url ??
      link?.image_url ??
      link?.imageUrl ??
      link?.image ??
      null,
    amount: amountDue,
    expiresAt: link?.expire_by
      ? new Date(link.expire_by * 1000)
      : link?.expiresAt
        ? new Date(link.expiresAt)
        : null,
  };
}

export async function getPaymentStatus(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  // Include payment field so syncRazorpayQrPayment can use it as fallback
  const order = await FoodOrder.findOne(identity).select(
    'dispatch riderEarning platformProfit payment',
  );
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  let transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const effectiveMethod = transaction?.payment?.method || order.payment?.method;
  const hasPaymentLink = transaction?.payment?.qr?.paymentLinkId || order.payment?.qr?.paymentLinkId;
  
  logger.info(`[getPaymentStatus] order=${order._id} method=${effectiveMethod} txStatus=${transaction?.payment?.status} hasLink=${!!hasPaymentLink}`);

  // Sync if this is a QR payment (check both tx and order) and not already paid
  if (effectiveMethod === 'razorpay_qr' && transaction?.payment?.status !== 'paid' && hasPaymentLink) {
    await syncRazorpayQrPayment(order);
    // Re-fetch to get the latest status after sync
    transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
    logger.info(`[getPaymentStatus] After sync: tx.payment.status=${transaction?.payment?.status}`);
  }

  // If no transaction, fall back to FoodOrder.payment
  const paymentData = transaction?.payment || order.payment?.toObject?.() || {};

  const latestHistory =
    (transaction?.history || []).sort((a, b) => (b.at || 0) - (a.at || 0))[0] ||
    null;

  return {
    payment: paymentData,
    latestPaymentSnapshot: latestHistory,
    riderEarning: order.riderEarning ?? 0,
    platformProfit: order.platformProfit ?? 0,
    pricingTotal: transaction?.pricing?.total ?? 0,
    transactionStatus: transaction?.status ?? null,
  };
}



export async function switchToCash(orderId, deliveryPartnerId) {
  const query = mongoose.Types.ObjectId.isValid(orderId)
    ? { _id: orderId }
    : { orderId };

  let order = await FoodOrder.findOne(query).lean();
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  // The local payment status is only refreshed by syncRazorpayQrPayment. Without syncing
  // first, a customer who has already scanned and paid the QR still looks unpaid here, so
  // the rider collects cash as well — the customer pays twice and the QR payment is left
  // unattributed. Pull the real state from Razorpay before deciding.
  if (order.payment?.qr?.paymentLinkId) {
    try {
      await syncRazorpayQrPayment(await FoodOrder.findOne(query));
      order = await FoodOrder.findOne(query).lean();
    } catch (err) {
      logger.warn(`switchToCash QR sync failed for ${order._id}: ${err?.message || err}`);
    }
  }

  // Only pay-at-delivery orders (legacy COD or QR-collect) may switch to cash.
  const orderPayMethod = String(order.payment?.method || '').toLowerCase();
  if (!['cash', 'razorpay_qr'].includes(orderPayMethod)) {
    throw new ValidationError('Online-paid orders cannot be switched to cash collection');
  }
  if (String(order.payment?.status || '').toLowerCase() === 'paid') {
    throw new ValidationError('Order is already paid');
  }

  // Reset payment method to cash on BOTH records. Updating only the transaction left
  // FoodOrder.payment as razorpay_qr/pending_qr, so completeDelivery never flipped it to
  // paid and the cash-in-hand aggregations (which filter on FoodOrder.payment.method
  // 'cash' + status 'paid') never saw the money the rider actually collected.
  await Promise.all([
    FoodTransaction.updateOne(
      { orderId: order._id },
      {
        $set: {
          paymentMethod: 'cash',
          'payment.method': 'cash',
          'payment.status': 'cod_pending',
          'payment.qr': {} // Clear QR info
        }
      }
    ),
    FoodOrder.updateOne(
      { _id: order._id },
      {
        $set: {
          'payment.method': 'cash',
          'payment.status': 'cod_pending',
          'payment.qr': {}
        }
      }
    )
  ]);

  await foodTransactionService.updateTransactionStatus(
    order._id,
    'cod_switched_to_cash',
    {
      recordedByRole: 'DELIVERY_PARTNER',
      recordedById: deliveryPartnerId,
      note: 'Rider switched from QR to Cash collection',
    }
  );

  return { success: true };
}
