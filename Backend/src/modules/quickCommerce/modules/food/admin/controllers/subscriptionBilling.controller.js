import { sendResponse } from '../../../../utils/response.js';
import * as billingService from '../services/adminSubscriptionBilling.service.js';

const adminIdentity = (req) => ({
    id: req.user?.userId || null,
    name: req.user?.name || req.user?.email || '',
});

export const listSubscriptionInvoices = async (req, res, next) => {
    try {
        const data = await billingService.listSubscriptionInvoicesAdmin(req.query || {});
        return sendResponse(res, 200, 'Subscription invoices fetched', data);
    } catch (error) {
        next(error);
    }
};

export const getSubscriptionInvoice = async (req, res, next) => {
    try {
        const data = await billingService.getSubscriptionInvoiceAdmin(req.params.invoiceId);
        return sendResponse(res, 200, 'Subscription invoice fetched', data);
    } catch (error) {
        next(error);
    }
};

export const getSubscriptionBillingSummary = async (req, res, next) => {
    try {
        const data = await billingService.getSubscriptionBillingSummaryAdmin(req.query || {});
        return sendResponse(res, 200, 'Subscription billing summary fetched', data);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantSubscriptionOverview = async (req, res, next) => {
    try {
        const data = await billingService.getRestaurantSubscriptionOverviewAdmin(req.params.restaurantId);
        return sendResponse(res, 200, 'Restaurant subscription overview fetched', data);
    } catch (error) {
        next(error);
    }
};

export const deductInvoiceFromWallet = async (req, res, next) => {
    try {
        const { amount, remarks } = req.body || {};
        const data = await billingService.deductInvoiceFromWalletAdmin(
            req.params.invoiceId,
            amount,
            adminIdentity(req),
            remarks,
        );
        return sendResponse(res, 200, 'Subscription due deducted from wallet', data);
    } catch (error) {
        next(error);
    }
};

export const markInvoicePaid = async (req, res, next) => {
    try {
        const { amount, remarks } = req.body || {};
        const data = await billingService.markInvoicePaidAdmin(
            req.params.invoiceId,
            amount,
            adminIdentity(req),
            remarks,
        );
        return sendResponse(res, 200, 'Subscription due marked as paid', data);
    } catch (error) {
        next(error);
    }
};

export const waiveInvoice = async (req, res, next) => {
    try {
        const { remarks } = req.body || {};
        const data = await billingService.waiveInvoiceAdmin(req.params.invoiceId, adminIdentity(req), remarks);
        return sendResponse(res, 200, 'Subscription due waived', data);
    } catch (error) {
        next(error);
    }
};

export const adjustInvoice = async (req, res, next) => {
    try {
        const { amount, remarks } = req.body || {};
        const data = await billingService.adjustInvoiceAdmin(
            req.params.invoiceId,
            amount,
            adminIdentity(req),
            remarks,
        );
        return sendResponse(res, 200, 'Subscription due adjusted', data);
    } catch (error) {
        next(error);
    }
};

export const runSubscriptionBilling = async (req, res, next) => {
    try {
        const data = await billingService.runSubscriptionBillingAdmin(req.body?.billingMonth);
        return sendResponse(res, 200, 'Subscription billing executed', data);
    } catch (error) {
        next(error);
    }
};

export const exportSubscriptionInvoices = async (req, res, next) => {
    try {
        const csv = await billingService.exportSubscriptionInvoicesAdmin(req.query || {});
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="subscription-invoices.csv"');
        return res.status(200).send(csv);
    } catch (error) {
        next(error);
    }
};
