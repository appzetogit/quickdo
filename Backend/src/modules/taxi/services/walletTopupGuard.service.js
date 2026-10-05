import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';

/**
 * Guards for taxi wallet top-ups (rider wallet and driver wallet).
 *
 * The verify handlers used to credit ANY genuine payment on the merchant
 * account, any number of times, to whoever called them: the signature proves a
 * payment is real, not that it is this caller's top-up, and the duplicate check
 * only looked at the caller's own last 50 wallet rows. Pay once, then replay
 * the ids from a second account (or replay a ride payment) and the wallet was
 * credited again -- and driver wallet money is withdrawable.
 *
 * Two rules close that:
 *   1. Binding. A payment is only credited when it belongs to a top-up order
 *      created for THIS caller: Razorpay order notes carry
 *      { type: 'taxi_wallet_topup', ownerType, ownerId } (set server-side at
 *      order creation, read back from the gateway at verify); a PhonePe
 *      merchantTransactionId must have been recorded here, with its owner, when
 *      the top-up was started. The amount credited is the gateway's figure for
 *      the payment, never the client's.
 *   2. Global idempotency. Every credited gateway payment is recorded in
 *      TaxiWalletTopupReceipt, unique on { provider, paymentId }, BEFORE the
 *      wallet moves. A second verify of the same payment -- from anyone -- hits
 *      the unique index and credits nothing.
 *
 * Top-ups started before this shipped carry neither the typed notes nor an
 * intent row. They are still honoured for LEGACY_TOPUP_WINDOW_MS after they were
 * created, and only when what the old create endpoints wrote server-side names
 * this caller (see isLegacyRazorpayTopupFor / isLegacyPhonePeTopupFor). The
 * window makes that fallback expire by itself two days after deploy.
 */

export const TOPUP_NOTE_TYPE = 'taxi_wallet_topup';
export const LEGACY_TOPUP_WINDOW_MS = 48 * 60 * 60 * 1000;

const OWNER_TYPES = ['user', 'driver'];

// What the pre-guard create endpoints wrote, per owner type.
const LEGACY_RAZORPAY = {
  user: { receiptPrefix: 'uwal_', noteKey: 'userId' },
  driver: { receiptPrefix: 'dwal_', noteKey: 'driverId' },
};
const LEGACY_PHONEPE_PREFIX = { user: 'UWAL', driver: 'DWAL' };

const receiptSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    paymentId: { type: String, required: true },
    orderId: { type: String, default: '' },
    ownerType: { type: String, enum: OWNER_TYPES, required: true },
    ownerId: { type: String, required: true },
    amount: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'taxi_wallet_topup_receipts' },
);
receiptSchema.index({ provider: 1, paymentId: 1 }, { unique: true });

export const TaxiWalletTopupReceipt =
  mongoose.models.TaxiWalletTopupReceipt || mongoose.model('TaxiWalletTopupReceipt', receiptSchema);

const intentSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    merchantTransactionId: { type: String, required: true },
    ownerType: { type: String, enum: OWNER_TYPES, required: true },
    ownerId: { type: String, required: true },
    amountPaise: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'taxi_wallet_topup_intents' },
);
intentSchema.index({ provider: 1, merchantTransactionId: 1 }, { unique: true });

export const TaxiWalletTopupIntent =
  mongoose.models.TaxiWalletTopupIntent || mongoose.model('TaxiWalletTopupIntent', intentSchema);

const compactOwnerId = (ownerId, fallback) =>
  String(ownerId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || fallback;

const notBelonging = () => new ApiError(403, 'This payment does not belong to your wallet');
const notATopup = () => new ApiError(400, 'This payment is not a wallet top-up');

/** The notes to put on a Razorpay top-up order. */
export const buildTopupOrderNotes = ({ ownerType, ownerId }) => ({
  type: TOPUP_NOTE_TYPE,
  ownerType,
  ownerId: String(ownerId || ''),
});

const isLegacyRazorpayTopupFor = (order, { ownerType, ownerId, now }) => {
  const legacy = LEGACY_RAZORPAY[ownerType];
  const notes = order?.notes && typeof order.notes === 'object' ? order.notes : {};
  const createdAtMs = Number(order?.created_at) * 1000;
  return Boolean(
    legacy
      && String(order?.receipt || '').startsWith(legacy.receiptPrefix)
      && String(notes[legacy.noteKey] || '') === String(ownerId)
      && Number.isFinite(createdAtMs)
      && now - createdAtMs <= LEGACY_TOPUP_WINDOW_MS,
  );
};

/**
 * Refuse unless the Razorpay order (fetched from the gateway, not the client)
 * is a wallet top-up created for this owner.
 */
export const assertRazorpayTopupOrderOwner = (order, { ownerType, ownerId, now = Date.now() }) => {
  if (!ownerId) throw notBelonging();
  const notes = order?.notes && typeof order.notes === 'object' ? order.notes : {};

  if (!notes.type) {
    if (isLegacyRazorpayTopupFor(order, { ownerType, ownerId, now })) return;
    // A pre-guard top-up of someone else, or anything that is not a top-up.
    if (LEGACY_RAZORPAY[ownerType] && String(order?.receipt || '').startsWith(LEGACY_RAZORPAY[ownerType].receiptPrefix)
      && String(notes[LEGACY_RAZORPAY[ownerType].noteKey] || '') !== String(ownerId)) {
      throw notBelonging();
    }
    throw notATopup();
  }

  if (String(notes.type) !== TOPUP_NOTE_TYPE) throw notATopup();
  if (String(notes.ownerType || '') !== ownerType || String(notes.ownerId || '') !== String(ownerId)) {
    throw notBelonging();
  }
};

/**
 * Fetch the order and the payment from Razorpay and return the paise to credit.
 * `fetchRazorpay(path)` is the caller's authenticated GET (so each controller
 * keeps its own keys and error handling). Throws unless the order is this
 * owner's top-up and the payment is a captured/authorized payment OF that order.
 */
export const resolveRazorpayTopup = async ({ orderId, paymentId, ownerType, ownerId, fetchRazorpay, now = Date.now() }) => {
  const order = await fetchRazorpay(`/orders/${encodeURIComponent(orderId)}`);
  assertRazorpayTopupOrderOwner(order, { ownerType, ownerId, now });

  const payment = await fetchRazorpay(`/payments/${encodeURIComponent(paymentId)}`);
  if (String(payment?.order_id || '') !== String(orderId)) {
    throw new ApiError(400, 'Payment verification failed: order mismatch');
  }
  // Same rule as the food/delivery verifiers.
  if (!['captured', 'authorized'].includes(String(payment?.status || ''))) {
    throw new ApiError(400, 'Payment verification failed: payment not captured');
  }
  const amountPaise = Math.round(Number(payment?.amount));
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new ApiError(400, 'Invalid payment amount');
  }
  return { amountPaise, order, payment };
};

/** Record a PhonePe top-up at creation, so verify can tell whose it is. */
export const recordPhonePeTopupIntent = async ({ merchantTransactionId, ownerType, ownerId, amountPaise }) => {
  await TaxiWalletTopupIntent.create({
    provider: 'phonepe',
    merchantTransactionId,
    ownerType,
    ownerId: String(ownerId || ''),
    amountPaise,
  });
};

// Pre-guard ids were `${prefix}${Date.now()}${last 8 of ownerId}`, built server-side.
const isLegacyPhonePeTopupFor = (merchantTransactionId, { ownerType, ownerId, now }) => {
  const prefix = LEGACY_PHONEPE_PREFIX[ownerType];
  if (!prefix) return false;
  const match = new RegExp(`^${prefix}(\\d{13})([a-zA-Z0-9]+)$`).exec(String(merchantTransactionId || ''));
  if (!match) return false;
  const createdAtMs = Number(match[1]);
  const fallback = ownerType === 'driver' ? 'drv' : 'usr';
  return match[2] === compactOwnerId(ownerId, fallback)
    && createdAtMs <= now
    && now - createdAtMs <= LEGACY_TOPUP_WINDOW_MS;
};

/** Refuse unless this merchantTransactionId was started here by this owner. */
export const assertPhonePeTopupOwner = async ({ merchantTransactionId, ownerType, ownerId, now = Date.now() }) => {
  if (!ownerId) throw notBelonging();
  const intent = await TaxiWalletTopupIntent.findOne({ provider: 'phonepe', merchantTransactionId }).lean();
  if (intent) {
    if (intent.ownerType !== ownerType || String(intent.ownerId) !== String(ownerId)) throw notBelonging();
    return intent;
  }
  if (isLegacyPhonePeTopupFor(merchantTransactionId, { ownerType, ownerId, now })) return null;
  throw notATopup();
};

/**
 * Credit a gateway payment at most once, globally.
 *
 * Inserts the receipt first; `credit` runs only for the insert that won. On a
 * duplicate the payment was already credited: same owner -> { credited: false }
 * (the caller answers as it always did for a repeat verify), anyone else -> 409.
 * If `credit` throws, the receipt is removed so the top-up can be retried.
 */
export const creditTopupOnce = async ({ provider, paymentId, orderId = '', ownerType, ownerId, amount, credit }) => {
  if (!paymentId) {
    throw new ApiError(400, 'Payment id is required');
  }

  let receipt;
  try {
    receipt = await TaxiWalletTopupReceipt.create({
      provider,
      paymentId: String(paymentId),
      orderId: String(orderId || ''),
      ownerType,
      ownerId: String(ownerId || ''),
      amount,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await TaxiWalletTopupReceipt.findOne({ provider, paymentId: String(paymentId) }).lean();
    if (existing && existing.ownerType === ownerType && String(existing.ownerId) === String(ownerId)) {
      return { credited: false, result: null };
    }
    throw new ApiError(409, 'This payment has already been credited');
  }

  try {
    const result = await credit();
    return { credited: true, result };
  } catch (error) {
    await TaxiWalletTopupReceipt.deleteOne({ _id: receipt._id }).catch(() => {});
    throw error;
  }
};
