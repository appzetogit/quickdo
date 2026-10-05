import mongoose from "mongoose";
import { FoodRestaurant } from "../models/restaurant.model.js";
import { FoodOrder } from "../../orders/models/order.model.js";
import { FoodTransaction } from "../../orders/models/foodTransaction.model.js";
import { FoodOffer } from "../../admin/models/offer.model.js";
import {
  isRestaurantEarnedOrder,
  computeRestaurantOrderShare,
} from "../../shared/restaurantPayout.util.js";
import { FoodSubscriptionInvoice } from "../models/subscriptionInvoice.model.js";
import { FoodSubscriptionTransaction } from "../models/subscriptionTransaction.model.js";
import { FoodSubscriptionBillingRun } from "../models/subscriptionBillingRun.model.js";
import { FoodNotification } from "../../../../core/notifications/models/notification.model.js";
import { notifyOwnerSafely } from "../../../../core/notifications/firebase.service.js";
import { getRestaurantSubscriptionSettings } from "../../admin/services/admin.service.js";
import { FEATURE_KEYS, isFeatureEnabled } from "../../admin/services/featureSettings.service.js";
import { buildPlanCatalog, resolveEligiblePlanByGmv, GST_RATE } from "./subscriptionPlan.service.js";
import { ValidationError, NotFoundError } from "../../../../core/auth/errors.js";
import { logger } from "../../../../utils/logger.js";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ---------- Billing month helpers ----------

export function formatBillingMonth(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function parseBillingMonth(billingMonth) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(billingMonth || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function billingMonthLabel(billingMonth) {
  if (billingMonth === "legacy") return "Pre-migration balance";
  const parsed = parseBillingMonth(billingMonth);
  if (!parsed) return String(billingMonth || "");
  return `${MONTH_LABELS[parsed.month - 1]} ${parsed.year}`;
}

/** Calendar-month window: 1st 00:00:00.000 → last day 23:59:59.999, server-local time. */
export function getMonthWindow(billingMonth) {
  const parsed = parseBillingMonth(billingMonth);
  if (!parsed) throw new ValidationError(`Invalid billing month: ${billingMonth}`);
  const start = new Date(parsed.year, parsed.month - 1, 1, 0, 0, 0, 0);
  const end = new Date(parsed.year, parsed.month, 0, 23, 59, 59, 999);
  return { start, end };
}

export function previousBillingMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return formatBillingMonth(d);
}

function nextBillingMonth(billingMonth) {
  const parsed = parseBillingMonth(billingMonth);
  const d = new Date(parsed.year, parsed.month, 1); // month is 1-based, so this is +1 month
  return formatBillingMonth(d);
}

/** billingMonth string comparison works lexicographically for 'YYYY-MM'. */
function isMonthBeforeOrEqual(a, b) {
  return String(a) <= String(b);
}

// ---------- GMV ----------

/**
 * Monthly GMV = sum of restaurant net share (payout) for earned orders in the window.
 * Uses the same per-order formula as Hub Finance / wallet balance.
 */
export async function computeMonthlyGmv(restaurantId, start, end) {
  const rid = new mongoose.Types.ObjectId(String(restaurantId));

  const orders = await FoodOrder.find({
    restaurantId: rid,
    createdAt: { $gte: start, $lte: end },
    orderStatus: { $nin: ["pending_payment"] },
  })
    .select("orderStatus status deliveryState pricing")
    .lean();

  const earnedOrders = orders.filter(isRestaurantEarnedOrder);
  if (!earnedOrders.length) {
    return { gmv: 0, orderCount: 0 };
  }

  const orderIds = earnedOrders.map((order) => order._id);
  const [transactions, offers] = await Promise.all([
    FoodTransaction.find({ orderId: { $in: orderIds } })
      .select("orderId pricing amounts")
      .lean(),
    FoodOffer.find({
      $or: [
        { restaurantScope: { $ne: "selected" } },
        { restaurantId: rid },
        { restaurantIds: rid },
      ],
    }).lean(),
  ]);

  const txByOrderId = new Map(transactions.map((tx) => [String(tx.orderId), tx]));
  let gmv = 0;
  for (const order of earnedOrders) {
    const tx = txByOrderId.get(String(order._id));
    gmv += computeRestaurantOrderShare(order, tx, offers, rid);
  }

  return {
    gmv: round2(Math.max(0, gmv)),
    orderCount: earnedOrders.length,
  };
}

// ---------- Notifications ----------

async function notifyRestaurantBilling(restaurantId, restaurantName, title, message, data = {}) {
  try {
    await FoodNotification.create({
      ownerType: "RESTAURANT",
      ownerId: restaurantId,
      title,
      message,
      category: "billing",
      source: "SUBSCRIPTION_BILLING",
    });
    await notifyOwnerSafely(
      { ownerType: "RESTAURANT", ownerId: restaurantId },
      {
        title,
        body: message,
        data: { type: "subscription_billing", restaurantId: String(restaurantId), ...data },
      },
    );
  } catch (err) {
    logger.warn(`Subscription billing notification failed for ${restaurantId}: ${err?.message || err}`);
  }
}

// ---------- Invoice generation ----------

/**
 * Generates the postpaid invoice for one restaurant for a closed billing month.
 * Skips zero-GMV months and months already invoiced (unique index is the backstop).
 */
export async function generateInvoiceForRestaurant(restaurant, billingMonth, settings, generatedBy = "system") {
  const restaurantId = restaurant?._id;
  if (!restaurantId) return { status: "skipped", reason: "missing_restaurant" };

  const existing = await FoodSubscriptionInvoice.findOne({ restaurantId, billingMonth })
    .select("_id")
    .lean();
  if (existing) return { status: "skipped", reason: "already_invoiced" };

  const { start, end } = getMonthWindow(billingMonth);
  const { gmv, orderCount } = await computeMonthlyGmv(restaurantId, start, end);
  if (gmv <= 0) return { status: "skipped", reason: "zero_gmv" };

  const catalog = buildPlanCatalog(settings);
  const planName = resolveEligiblePlanByGmv(gmv, catalog);
  const planEntry = catalog.plans.find((plan) => plan.id === planName) || catalog.plans[0];
  const planAmount = Math.max(0, Number(planEntry?.basePrice) || 0);
  const gstAmount = Math.round(planAmount * GST_RATE);
  const totalAmount = planAmount + gstAmount;

  let invoice;
  try {
    invoice = await FoodSubscriptionInvoice.create({
      restaurantId,
      billingMonth,
      periodStart: start,
      periodEnd: end,
      gmv,
      orderCount,
      planName,
      planAmount,
      gstAmount,
      totalAmount,
      outstandingAmount: totalAmount,
      status: "pending",
      settingsSnapshot: {
        starterMinGmv: catalog.starterMinGmv,
        starterMaxGmv: catalog.starterMaxGmv,
        growthMinGmv: catalog.growthMinGmv,
        growthMaxGmv: catalog.growthMaxGmv,
        premiumMinGmv: catalog.premiumMinGmv,
        plans: catalog.plans,
        gstRate: GST_RATE,
      },
      generatedBy,
    });
  } catch (err) {
    if (err?.code === 11000) return { status: "skipped", reason: "already_invoiced" };
    throw err;
  }

  await FoodSubscriptionTransaction.create({
    restaurantId,
    invoiceId: invoice._id,
    billingMonth,
    type: "invoice_generated",
    amount: totalAmount,
    outstandingAfter: totalAmount,
    invoiceStatusAfter: "pending",
    processedBy: { role: "SYSTEM" },
    remarks: `Monthly invoice for ${billingMonthLabel(billingMonth)} — GMV ₹${gmv}, ${planEntry?.label || planName} plan`,
    metadata: { gmv, orderCount, planAmount, gstAmount },
  });

  await notifyRestaurantBilling(
    restaurantId,
    restaurant.restaurantName,
    "Subscription Invoice Generated 💳",
    `Your ${billingMonthLabel(billingMonth)} subscription invoice is ready: ${planEntry?.label || planName} plan ₹${totalAmount} (incl. GST) based on monthly GMV of ₹${gmv}. The amount is due and locked against your wallet balance.`,
    { billingMonth, invoiceId: String(invoice._id), amount: String(totalAmount) },
  );

  return { status: "invoiced", invoice };
}

/**
 * Runs (or re-runs) billing for one closed calendar month across all approved restaurants.
 * Idempotent: already-invoiced restaurants are skipped.
 */
export async function runMonthlyBilling(billingMonth, { generatedBy = "system" } = {}) {
  const parsed = parseBillingMonth(billingMonth);
  if (!parsed) throw new ValidationError(`Invalid billing month: ${billingMonth}`);
  if (!isMonthBeforeOrEqual(billingMonth, previousBillingMonth())) {
    throw new ValidationError("Cannot bill the current or a future month — the month must be closed first");
  }

  const run = await FoodSubscriptionBillingRun.findOneAndUpdate(
    { billingMonth },
    { $setOnInsert: { billingMonth }, $set: { status: "pending", startedAt: new Date() } },
    { upsert: true, new: true },
  );

  const settings = (await getRestaurantSubscriptionSettings()) || {};
  const restaurants = await FoodRestaurant.find({ status: "approved" })
    .select("_id restaurantName")
    .lean();

  let invoicedCount = 0;
  let skippedZeroGmvCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const restaurant of restaurants) {
    try {
      const result = await generateInvoiceForRestaurant(restaurant, billingMonth, settings, generatedBy);
      if (result.status === "invoiced") invoicedCount += 1;
      else if (result.reason === "zero_gmv") skippedZeroGmvCount += 1;
    } catch (err) {
      errorCount += 1;
      errors.push(`${restaurant._id}: ${err?.message || err}`);
      logger.error(`Monthly billing failed for restaurant ${restaurant._id} (${billingMonth}): ${err?.message || err}`);
    }
  }

  run.status = errorCount > 0 ? "failed" : "completed";
  run.invoicedCount = invoicedCount;
  run.skippedZeroGmvCount = skippedZeroGmvCount;
  run.errorCount = errorCount;
  run.errors = errors.slice(0, 50);
  run.finishedAt = new Date();
  await run.save();

  logger.info(
    `[SUBSCRIPTION BILLING] ${billingMonth}: invoiced=${invoicedCount}, zeroGmvSkipped=${skippedZeroGmvCount}, errors=${errorCount}`,
  );
  return { billingMonth, invoicedCount, skippedZeroGmvCount, errorCount };
}

/**
 * Job entry point. Bills every unbilled month up to and including the previous
 * calendar month — BullMQ repeatable jobs do not backfill runs missed while
 * the worker was down, so this catches up on restart.
 */
export async function runBillingCatchUp() {
  const enabled = await isFeatureEnabled(FEATURE_KEYS.RESTAURANT_SUBSCRIPTION, true);
  if (!enabled) {
    logger.info("[SUBSCRIPTION BILLING] Feature disabled — skipping billing run");
    return { skipped: true, reason: "feature_disabled" };
  }

  const targetMonth = previousBillingMonth();
  const lastCompleted = await FoodSubscriptionBillingRun.findOne({ status: "completed" })
    .sort({ billingMonth: -1 })
    .lean();

  // Start from the month after the last completed run; first-ever run bills only the previous month.
  let month = lastCompleted ? nextBillingMonth(lastCompleted.billingMonth) : targetMonth;
  if (!isMonthBeforeOrEqual(month, targetMonth)) month = targetMonth;

  const results = [];
  while (isMonthBeforeOrEqual(month, targetMonth)) {
    results.push(await runMonthlyBilling(month));
    month = nextBillingMonth(month);
  }
  return { skipped: false, results };
}

// ---------- Outstanding / locking ----------

const OPEN_INVOICE_STATUSES = ["pending", "partially_settled"];

/**
 * Total outstanding subscription due = wallet locked amount, plus per-invoice breakdown.
 */
export async function getOutstandingSummary(restaurantId) {
  if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
    return { lockedAmount: 0, openInvoices: [], monthsLabel: "" };
  }
  const openInvoices = await FoodSubscriptionInvoice.find({
    restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
    status: { $in: OPEN_INVOICE_STATUSES },
    outstandingAmount: { $gt: 0 },
  })
    .sort({ billingMonth: 1 })
    .select("billingMonth planName totalAmount outstandingAmount status isLegacyCarryForward")
    .lean();

  const lockedAmount = round2(
    openInvoices.reduce((sum, inv) => sum + (Number(inv.outstandingAmount) || 0), 0),
  );
  const monthsLabel = openInvoices.map((inv) => billingMonthLabel(inv.billingMonth)).join(", ");
  return { lockedAmount, openInvoices, monthsLabel };
}

// ---------- Settlement primitives ----------

function resolveInvoiceStatus(invoice) {
  if (invoice.outstandingAmount <= 0) {
    return invoice.waivedAmount > 0 && invoice.paidAmount <= 0 ? "waived" : "settled";
  }
  return invoice.paidAmount > 0 || invoice.waivedAmount > 0 ? "partially_settled" : "pending";
}

/**
 * [actor] names a non-admin author -- today, the seller paying their own
 * due. Omitted by every existing caller, which keeps its ADMIN/SYSTEM
 * behaviour exactly as it was.
 */
async function appendTransaction(invoice, type, amount, admin, remarks, metadata = {}, actor = null) {
  return FoodSubscriptionTransaction.create({
    restaurantId: invoice.restaurantId,
    invoiceId: invoice._id,
    billingMonth: invoice.billingMonth,
    type,
    amount,
    outstandingAfter: invoice.outstandingAmount,
    invoiceStatusAfter: invoice.status,
    processedBy: actor
      ? { role: actor.role, id: actor.id || null, name: actor.name || "" }
      : admin
        ? { role: "ADMIN", id: admin.id || admin._id || null, name: admin.name || "" }
        : { role: "SYSTEM" },
    remarks: remarks || "",
    metadata,
  });
}

async function loadInvoiceForSettlement(invoiceId) {
  const invoice = await FoodSubscriptionInvoice.findById(invoiceId);
  if (!invoice) throw new NotFoundError("Subscription invoice not found");
  return invoice;
}

/**
 * Admin deducts (part of) the due directly from the restaurant wallet.
 * `maxDeductible` — the restaurant's current available wallet balance, computed
 * by the caller from the finance service so the number matches what the
 * restaurant sees. The deduction itself is recorded as a wallet_deduction
 * transaction, which the finance service subtracts from the balance.
 */
export async function applyWalletDeduction(invoiceId, amount, admin, remarks, { maxDeductible = null } = {}) {
  const invoice = await loadInvoiceForSettlement(invoiceId);
  const deductAmount = round2(Number(amount));
  if (!Number.isFinite(deductAmount) || deductAmount <= 0) {
    throw new ValidationError("Deduction amount must be greater than zero");
  }
  if (deductAmount > invoice.outstandingAmount) {
    throw new ValidationError(
      `Deduction ₹${deductAmount} exceeds outstanding due of ₹${invoice.outstandingAmount}`,
    );
  }
  if (maxDeductible != null && deductAmount > round2(maxDeductible)) {
    throw new ValidationError(
      `Deduction ₹${deductAmount} exceeds the restaurant's wallet balance of ₹${round2(maxDeductible)}`,
    );
  }

  // Atomic guard against concurrent settlements on the same invoice.
  const updated = await FoodSubscriptionInvoice.findOneAndUpdate(
    { _id: invoice._id, outstandingAmount: { $gte: deductAmount } },
    { $inc: { paidAmount: deductAmount, outstandingAmount: -deductAmount } },
    { new: true },
  );
  if (!updated) throw new ValidationError("Invoice was settled concurrently — refresh and retry");

  updated.status = resolveInvoiceStatus(updated);
  await updated.save();

  const tx = await appendTransaction(updated, "wallet_deduction", deductAmount, admin, remarks, {
    method: "wallet",
  });

  await notifyRestaurantBilling(
    updated.restaurantId,
    "",
    "Subscription Due Deducted",
    `₹${deductAmount} was deducted from your wallet towards the ${billingMonthLabel(updated.billingMonth)} subscription due. Remaining due: ₹${updated.outstandingAmount}.${remarks ? ` Note: ${remarks}` : ""}`,
    { billingMonth: updated.billingMonth, amount: String(deductAmount) },
  );

  return { invoice: updated, transaction: tx };
}

/**
 * Admin marks (part of) the due as paid outside the platform (cash/bank transfer).
 */
export async function applyManualPayment(invoiceId, amount, admin, remarks) {
  const invoice = await loadInvoiceForSettlement(invoiceId);
  const payAmount = round2(amount != null ? Number(amount) : invoice.outstandingAmount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    throw new ValidationError("Payment amount must be greater than zero");
  }
  if (payAmount > invoice.outstandingAmount) {
    throw new ValidationError(`Payment ₹${payAmount} exceeds outstanding due of ₹${invoice.outstandingAmount}`);
  }
  if (!String(remarks || "").trim()) {
    throw new ValidationError("Remarks are required when marking a due as paid manually");
  }

  const updated = await FoodSubscriptionInvoice.findOneAndUpdate(
    { _id: invoice._id, outstandingAmount: { $gte: payAmount } },
    { $inc: { paidAmount: payAmount, outstandingAmount: -payAmount } },
    { new: true },
  );
  if (!updated) throw new ValidationError("Invoice was settled concurrently — refresh and retry");

  updated.status = resolveInvoiceStatus(updated);
  await updated.save();

  const tx = await appendTransaction(updated, "manual_payment", payAmount, admin, remarks, {
    method: "manual",
  });

  await notifyRestaurantBilling(
    updated.restaurantId,
    "",
    "Subscription Payment Recorded",
    `₹${payAmount} was recorded against your ${billingMonthLabel(updated.billingMonth)} subscription due. Remaining due: ₹${updated.outstandingAmount}.`,
    { billingMonth: updated.billingMonth, amount: String(payAmount) },
  );

  return { invoice: updated, transaction: tx };
}

/**
 * The seller pays their own due through the payment gateway.
 *
 * [amount] is what the GATEWAY says was captured, never what the client
 * asked for -- the caller reads it back from Razorpay. It is clamped to
 * the outstanding figure rather than refused, because a seller who pays
 * the full due while a wallet deduction lands in the same minute has done
 * nothing wrong and should not have their payment rejected.
 *
 * The invoice must belong to [restaurantId]: an invoice id is guessable
 * and settling somebody else's due would release their locked payout.
 */
export async function applyOnlinePayment({ invoiceId, restaurantId, amount, metadata = {} }) {
  const invoice = await loadInvoiceForSettlement(invoiceId);

  if (String(invoice.restaurantId) !== String(restaurantId)) {
    throw new NotFoundError("Subscription invoice not found");
  }

  const paid = round2(Number(amount));
  if (!Number.isFinite(paid) || paid <= 0) {
    throw new ValidationError("Payment amount must be greater than zero");
  }
  if (invoice.outstandingAmount <= 0) {
    return { invoice, transaction: null, settledAmount: 0 };
  }

  const payAmount = Math.min(paid, invoice.outstandingAmount);

  // The write is the claim: whoever loses a race against a concurrent
  // settlement finds the guard unmet rather than overdrawing the invoice.
  const updated = await FoodSubscriptionInvoice.findOneAndUpdate(
    { _id: invoice._id, outstandingAmount: { $gte: payAmount } },
    { $inc: { paidAmount: payAmount, outstandingAmount: -payAmount } },
    { new: true },
  );
  if (!updated) {
    throw new ValidationError("Invoice was settled concurrently — refresh and retry");
  }

  updated.status = resolveInvoiceStatus(updated);
  await updated.save();

  const tx = await appendTransaction(
    updated,
    "online_payment",
    payAmount,
    null,
    "Paid by the seller from the app",
    { method: "razorpay", ...metadata },
    { role: "RESTAURANT", id: invoice.restaurantId, name: "" },
  );

  await notifyRestaurantBilling(
    updated.restaurantId,
    "",
    "Subscription Payment Received",
    `₹${payAmount} was received towards your ${billingMonthLabel(updated.billingMonth)} subscription due. Remaining due: ₹${updated.outstandingAmount}.`,
    { billingMonth: updated.billingMonth, amount: String(payAmount) },
  );

  return { invoice: updated, transaction: tx, settledAmount: payAmount };
}

/**
 * Admin waives the full remaining due. Wallet lock releases immediately
 * (locking is computed from outstanding amounts).
 */
export async function applyWaiver(invoiceId, admin, remarks) {
  const invoice = await loadInvoiceForSettlement(invoiceId);
  if (!String(remarks || "").trim()) {
    throw new ValidationError("Remarks are required when waiving a subscription due");
  }
  const waiveAmount = round2(invoice.outstandingAmount);
  if (waiveAmount <= 0) throw new ValidationError("Invoice has no outstanding amount to waive");

  const updated = await FoodSubscriptionInvoice.findOneAndUpdate(
    { _id: invoice._id, outstandingAmount: { $gte: waiveAmount } },
    { $inc: { waivedAmount: waiveAmount, outstandingAmount: -waiveAmount } },
    { new: true },
  );
  if (!updated) throw new ValidationError("Invoice was settled concurrently — refresh and retry");

  updated.status = resolveInvoiceStatus(updated);
  await updated.save();

  const tx = await appendTransaction(updated, "waiver", waiveAmount, admin, remarks);

  await notifyRestaurantBilling(
    updated.restaurantId,
    "",
    "Subscription Due Waived 🎉",
    `Your ${billingMonthLabel(updated.billingMonth)} subscription due of ₹${waiveAmount} has been waived. The locked wallet amount has been released.${remarks ? ` Note: ${remarks}` : ""}`,
    { billingMonth: updated.billingMonth, amount: String(waiveAmount) },
  );

  return { invoice: updated, transaction: tx };
}

/**
 * Admin manual adjustment: positive increases the outstanding due,
 * negative reduces it (floored at zero).
 */
export async function applyAdjustment(invoiceId, signedAmount, admin, remarks) {
  const invoice = await loadInvoiceForSettlement(invoiceId);
  const adjustment = round2(Number(signedAmount));
  if (!Number.isFinite(adjustment) || adjustment === 0) {
    throw new ValidationError("Adjustment amount must be a non-zero number");
  }
  if (!String(remarks || "").trim()) {
    throw new ValidationError("Remarks are required for manual adjustments");
  }

  const effective = adjustment < 0 ? Math.max(adjustment, -invoice.outstandingAmount) : adjustment;

  const updated = await FoodSubscriptionInvoice.findOneAndUpdate(
    { _id: invoice._id, outstandingAmount: { $gte: effective < 0 ? -effective : 0 } },
    { $inc: { adjustmentAmount: effective, outstandingAmount: effective } },
    { new: true },
  );
  if (!updated) throw new ValidationError("Invoice was settled concurrently — refresh and retry");

  updated.status = resolveInvoiceStatus(updated);
  await updated.save();

  const tx = await appendTransaction(updated, "adjustment", effective, admin, remarks, {
    requestedAmount: adjustment,
  });

  await notifyRestaurantBilling(
    updated.restaurantId,
    "",
    "Subscription Due Adjusted",
    `Your ${billingMonthLabel(updated.billingMonth)} subscription due was adjusted by ₹${effective}. Remaining due: ₹${updated.outstandingAmount}.${remarks ? ` Note: ${remarks}` : ""}`,
    { billingMonth: updated.billingMonth, amount: String(effective) },
  );

  return { invoice: updated, transaction: tx };
}
