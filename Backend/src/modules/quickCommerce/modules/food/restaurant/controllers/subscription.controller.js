import mongoose from 'mongoose';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { FoodSubscriptionInvoice } from '../models/subscriptionInvoice.model.js';
import { FoodSubscriptionTransaction } from '../models/subscriptionTransaction.model.js';
import {
    computeMonthlyGmv,
    getMonthWindow,
    formatBillingMonth,
    billingMonthLabel,
    getOutstandingSummary,
} from '../services/subscriptionBilling.service.js';
import { getRestaurantFinance } from '../services/restaurantFinance.service.js';
import { applyOnlinePayment } from '../services/subscriptionBilling.service.js';
import {
    createPaymentLink,
    fetchRazorpayPaymentLink,
    isRazorpayConfigured,
} from '../../orders/helpers/razorpay.helper.js';
import { getRestaurantSubscriptionSettings } from '../../admin/services/admin.service.js';
import { FEATURE_KEYS, isFeatureEnabled } from '../../admin/services/featureSettings.service.js';
import { buildPlanCatalog, resolveEligiblePlanByGmv, GST_RATE } from '../services/subscriptionPlan.service.js';

/**
 * GET /subscription/overview — current-month live GMV, estimated plan/fee,
 * outstanding dues, locked amount, wallet balance and withdrawable amount.
 */
export const getSubscriptionOverviewController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        const featureEnabled = await isFeatureEnabled(FEATURE_KEYS.RESTAURANT_SUBSCRIPTION, true);

        const currentMonth = formatBillingMonth(new Date());
        const { start, end } = getMonthWindow(currentMonth);
        const [gmvResult, settings, outstanding, finance] = await Promise.all([
            computeMonthlyGmv(restaurantId, start, new Date()),
            getRestaurantSubscriptionSettings(),
            getOutstandingSummary(restaurantId),
            getRestaurantFinance(restaurantId),
        ]);

        const catalog = buildPlanCatalog(settings || {});
        const estimatedPlan = resolveEligiblePlanByGmv(gmvResult.gmv, catalog);
        const planEntry = catalog.plans.find((plan) => plan.id === estimatedPlan) || catalog.plans[0];
        const estimatedPlanAmount = gmvResult.gmv > 0 ? Math.max(0, Number(planEntry?.basePrice) || 0) : 0;
        const estimatedGst = Math.round(estimatedPlanAmount * GST_RATE);

        return sendResponse(res, 200, 'Subscription overview fetched', {
            featureEnabled,
            currentMonth: {
                billingMonth: currentMonth,
                label: billingMonthLabel(currentMonth),
                periodStart: start,
                periodEnd: end,
                gmv: gmvResult.gmv,
                orderCount: gmvResult.orderCount,
                estimatedPlan: gmvResult.gmv > 0 ? estimatedPlan : null,
                estimatedPlanLabel: gmvResult.gmv > 0 ? planEntry?.label || estimatedPlan : null,
                estimatedPlanAmount,
                estimatedGst,
                estimatedTotal: estimatedPlanAmount + estimatedGst,
                planCatalog: catalog.plans,
            },
            outstanding: {
                totalDue: outstanding.lockedAmount,
                lockedAmount: featureEnabled ? outstanding.lockedAmount : 0,
                lockedMonths: outstanding.monthsLabel,
                openInvoices: outstanding.openInvoices,
            },
            wallet: {
                totalBalance: Number(finance?.wallet?.withdrawableBalance ?? finance?.currentCycle?.withdrawableBalance ?? 0),
                netAvailable: Number(finance?.wallet?.netAvailable ?? finance?.currentCycle?.netAvailable ?? 0),
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /subscription/invoices — the restaurant's monthly invoice history.
 */
export const listSubscriptionInvoicesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

        const filter = { restaurantId: new mongoose.Types.ObjectId(String(restaurantId)) };
        if (req.query.status) filter.status = String(req.query.status);

        const [invoices, total] = await Promise.all([
            FoodSubscriptionInvoice.find(filter)
                .sort({ billingMonth: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            FoodSubscriptionInvoice.countDocuments(filter),
        ]);

        return sendResponse(res, 200, 'Subscription invoices fetched', {
            invoices: invoices.map((inv) => ({ ...inv, billingMonthLabel: billingMonthLabel(inv.billingMonth) })),
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /subscription/invoices/:invoiceId — one invoice + its transaction timeline.
 */
export const getSubscriptionInvoiceController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');
        const { invoiceId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(String(invoiceId))) {
            return sendError(res, 400, 'Invalid invoice id');
        }

        const invoice = await FoodSubscriptionInvoice.findOne({
            _id: invoiceId,
            restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        }).lean();
        if (!invoice) return sendError(res, 404, 'Invoice not found');

        const transactions = await FoodSubscriptionTransaction.find({ invoiceId: invoice._id })
            .sort({ createdAt: 1 })
            .lean();

        return sendResponse(res, 200, 'Subscription invoice fetched', {
            invoice: { ...invoice, billingMonthLabel: billingMonthLabel(invoice.billingMonth) },
            transactions,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /subscription/transactions — complete billing timeline for the restaurant.
 */
export const listSubscriptionTransactionsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

        const filter = { restaurantId: new mongoose.Types.ObjectId(String(restaurantId)) };
        if (req.query.billingMonth) filter.billingMonth = String(req.query.billingMonth);

        const [transactions, total] = await Promise.all([
            FoodSubscriptionTransaction.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            FoodSubscriptionTransaction.countDocuments(filter),
        ]);

        return sendResponse(res, 200, 'Subscription transactions fetched', {
            transactions: transactions.map((tx) => ({
                ...tx,
                billingMonthLabel: billingMonthLabel(tx.billingMonth),
            })),
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /subscription/invoices/:invoiceId/pay/link
 *
 * A Razorpay payment link for whatever is still outstanding on the invoice.
 * The amount comes from the invoice, not the request: the seller is settling
 * a specific due, not choosing a figure.
 */
export const createSubscriptionPaymentLinkController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        if (!isRazorpayConfigured()) {
            return sendError(res, 503, 'Online payment is not configured yet');
        }

        const invoice = await FoodSubscriptionInvoice.findOne({
            _id: req.params.invoiceId,
            restaurantId,
        }).lean();
        if (!invoice) return sendError(res, 404, 'Subscription invoice not found');

        const outstanding = Math.max(0, Number(invoice.outstandingAmount) || 0);
        if (outstanding <= 0) {
            return sendError(res, 400, 'This invoice is already settled');
        }

        const restaurant = await mongoose
            .model('QCRestaurant')
            .findById(restaurantId)
            .select('restaurantName ownerName ownerPhone ownerEmail email phone')
            .lean();

        const link = await createPaymentLink({
            amountPaise: Math.round(outstanding * 100),
            description: `Subscription due — ${billingMonthLabel(invoice.billingMonth)}`,
            orderId: String(invoice._id),
            customerName: restaurant?.ownerName || restaurant?.restaurantName || 'Seller',
            customerEmail: restaurant?.ownerEmail || restaurant?.email || undefined,
            customerPhone: restaurant?.ownerPhone || restaurant?.phone || undefined,
        });

        return sendResponse(res, 201, 'Payment link created', {
            paymentLinkId: link.id,
            shortUrl: link.short_url,
            amount: outstanding,
            invoiceId: String(invoice._id),
            billingMonth: invoice.billingMonth,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /subscription/invoices/:invoiceId/pay/link/:linkId
 *
 * Asks Razorpay whether that link was paid and, if so, settles the invoice
 * by the amount Razorpay says it collected.
 *
 * Safe to poll: the link id is the idempotency key, so a second call finds
 * the recorded transaction and reports the invoice rather than settling it
 * again.
 */
export const getSubscriptionPaymentLinkStatusController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        const invoice = await FoodSubscriptionInvoice.findOne({
            _id: req.params.invoiceId,
            restaurantId,
        }).lean();
        if (!invoice) return sendError(res, 404, 'Subscription invoice not found');

        const linkId = String(req.params.linkId || "").trim();

        const already = await FoodSubscriptionTransaction.findOne({
            restaurantId,
            type: 'online_payment',
            'metadata.paymentLinkId': linkId,
        }).lean();
        if (already) {
            return sendResponse(res, 200, 'Payment already recorded', {
                status: 'paid',
                settledAmount: 0,
                outstandingAmount: invoice.outstandingAmount,
            });
        }

        const link = await fetchRazorpayPaymentLink(linkId);
        const status = String(link?.status || '').toLowerCase();

        if (status !== 'paid') {
            return sendResponse(res, 200, 'Payment not completed yet', {
                status: status || 'created',
                settledAmount: 0,
                outstandingAmount: invoice.outstandingAmount,
            });
        }

        const paidPaise = Number(link?.amount_paid || 0);
        if (!Number.isFinite(paidPaise) || paidPaise <= 0) {
            return sendError(res, 400, 'Payment verification failed: amount missing');
        }

        const result = await applyOnlinePayment({
            invoiceId: String(invoice._id),
            restaurantId,
            amount: Math.round(paidPaise) / 100,
            metadata: {
                paymentLinkId: linkId,
                razorpayPaymentId: link?.payments?.[0]?.payment_id || null,
            },
        });

        return sendResponse(res, 200, 'Subscription payment recorded', {
            status: 'paid',
            settledAmount: result.settledAmount,
            outstandingAmount: result.invoice.outstandingAmount,
        });
    } catch (error) {
        next(error);
    }
};
