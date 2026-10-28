import mongoose from 'mongoose';
import { registerDeliveryPartner, updateDeliveryPartnerProfile, updateDeliveryPartnerBankDetails, listSupportTicketsByPartner, createSupportTicket, getSupportTicketByIdAndPartner, updateDeliveryPartnerDetails, updateDeliveryPartnerProfilePhotoBase64, updateDeliveryAvailability, getDeliveryPartnerWallet, getDeliveryPartnerEarnings, getDeliveryPartnerTripHistory, getDeliveryPocketDetails, getActiveEarningAddonsForPartner, deleteDeliveryPartnerAccount } from '../services/delivery.service.js';
import { createDeliveryCashDepositOrder, getDeliveryPartnerWalletEnhanced, requestDeliveryWithdrawal, verifyDeliveryCashDepositPayment } from '../services/deliveryFinance.service.js';
import { getDeliveryCashLimitSettings, getDeliveryEmergencyHelp } from '../../admin/services/admin.service.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { validateDeliveryRegisterDto, validateDeliveryProfileUpdateDto, validateDeliveryBankDetailsDto } from '../validators/delivery.validator.js';
import { sendResponse } from '../../../../utils/response.js';
import { getDeliveryReferralStats } from '../services/deliveryReferral.service.js';
import {
    createOrderEmergencyRequest,
    getOrderEmergencyRequestByPartner,
    listOrderEmergencyRequestsByPartner
} from '../services/orderEmergencyRequest.service.js';

export const registerDeliveryPartnerController = async (req, res, next) => {
    try {
        const validated = validateDeliveryRegisterDto(req.body);
        // upload.any() gives req.files as an array — reshape to { fieldname: [file] }
        // so the existing named lookups (files.profilePhoto[0]) keep working, and
        // admin-defined document fields are picked up by their own key.
        const filesByField = {};
        for (const f of Array.isArray(req.files) ? req.files : []) {
            (filesByField[f.fieldname] ||= []).push(f);
        }
        const partner = await registerDeliveryPartner(validated, filesByField, req.body);
        return sendResponse(res, 201, 'Delivery partner registered successfully', partner);
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerProfileController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const validated = validateDeliveryProfileUpdateDto(req.body);
        const result = await updateDeliveryPartnerProfile(userId, validated, req.files);
        return sendResponse(res, 200, 'Profile updated successfully', result);
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerDetailsController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const partner = await updateDeliveryPartnerDetails(userId, req.body || {});
        return sendResponse(res, 200, 'Profile updated successfully', { partner });
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerProfilePhotoBase64Controller = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const partner = await updateDeliveryPartnerProfilePhotoBase64(userId, req.body || {});
        return sendResponse(res, 200, 'Profile photo updated successfully', { partner });
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerBankDetailsController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const validated = validateDeliveryBankDetailsDto(req.body);
        const partner = await updateDeliveryPartnerBankDetails(userId, validated, req.files);
        const data = {
            bankDetails: {
                accountHolderName: partner.bankAccountHolderName,
                accountNumber: partner.bankAccountNumber,
                ifscCode: partner.bankIfscCode,
                bankName: partner.bankName,
                upiId: partner.upiId,
                upiQrCode: partner.upiQrCode
            },
            panNumber: partner.panNumber
        };
        return sendResponse(res, 200, 'Bank details updated successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listSupportTicketsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const tickets = await listSupportTicketsByPartner(deliveryPartnerId);
        return sendResponse(res, 200, 'Tickets fetched successfully', { tickets });
    } catch (error) {
        next(error);
    }
};

export const createSupportTicketController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const ticket = await createSupportTicket(deliveryPartnerId, req.body);
        return sendResponse(res, 201, 'Ticket created successfully', ticket);
    } catch (error) {
        next(error);
    }
};

export const getSupportTicketByIdController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const ticket = await getSupportTicketByIdAndPartner(req.params.id, deliveryPartnerId);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }
        return sendResponse(res, 200, 'Ticket fetched successfully', ticket);
    } catch (error) {
        next(error);
    }
};

export const listOrderEmergencyRequestsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const requests = await listOrderEmergencyRequestsByPartner(deliveryPartnerId);
        return sendResponse(res, 200, 'Order reassignment requests fetched', { requests });
    } catch (error) {
        next(error);
    }
};

export const createOrderEmergencyRequestController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const request = await createOrderEmergencyRequest(deliveryPartnerId, req.body || {});
        return sendResponse(res, 201, 'Emergency reassignment request created', { request });
    } catch (error) {
        next(error);
    }
};

export const getOrderEmergencyRequestController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const request = await getOrderEmergencyRequestByPartner(
            req.params.id,
            deliveryPartnerId
        );
        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Emergency reassignment request not found'
            });
        }
        return sendResponse(res, 200, 'Emergency reassignment request fetched', {
            request
        });
    } catch (error) {
        next(error);
    }
};

export const updateAvailabilityController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const data = await updateDeliveryAvailability(userId, req.body || {});
        return sendResponse(res, 200, 'Availability updated successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getWalletController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const requestedTypeRaw = String(req.query?.type || '').trim().toLowerCase();
        const rawLimit = Number.parseInt(String(req.query?.limit || ''), 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

        const normalizeWalletTransaction = (tx) => ({
            ...tx,
            id: tx?.id || tx?._id,
            _id: tx?._id || tx?.id,
            amount: Number(tx?.amount) || 0,
            date: tx?.date || tx?.createdAt,
            createdAt: tx?.createdAt || tx?.date
        });

        if (requestedTypeRaw === 'bonus' || requestedTypeRaw === 'deposit' || requestedTypeRaw === 'deduction') {
            if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
                return sendResponse(res, 200, 'Wallet fetched successfully', { wallet: { transactions: [] } });
            }

            const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
            if (requestedTypeRaw === 'bonus') {
                const bonusList = await DeliveryBonusTransaction.find({ deliveryPartnerId })
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .lean();

                wallet.transactions = (bonusList || []).map((b) => ({
                    id: b._id,
                    _id: b._id,
                    type: 'bonus',
                    amount: b.amount || 0,
                    status: 'Completed',
                    date: b.createdAt,
                    createdAt: b.createdAt,
                    description: b.reference || 'Bonus',
                    transactionId: b.transactionId
                }));
            } else {
                const allowedTypes = requestedTypeRaw === 'deposit'
                    ? new Set(['deposit'])
                    : new Set(['withdrawal', 'deposit']);

                wallet.transactions = (wallet.transactions || [])
                    .filter((tx) => allowedTypes.has(String(tx?.type || '').trim().toLowerCase()))
                    .map(normalizeWalletTransaction)
                    .slice(0, limit);
            }

            return sendResponse(res, 200, 'Wallet fetched successfully', { wallet });
        }

        const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
        return sendResponse(res, 200, 'Wallet fetched successfully', { wallet });
    } catch (error) {
        next(error);
    }
};

export const createWithdrawalRequestController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const result = await requestDeliveryWithdrawal(deliveryPartnerId, req.body || {});
        return sendResponse(res, 201, 'Withdrawal request submitted successfully', { withdrawal: result });
    } catch (error) {
        next(error);
    }
};

export const getEarningsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPartnerEarnings(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Earnings fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getActiveEarningAddonsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getActiveEarningAddonsForPartner(deliveryPartnerId);
        return sendResponse(res, 200, 'Active earning addons fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const createCashDepositOrderController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const amount = req.body?.amount;
        const data = await createDeliveryCashDepositOrder(deliveryPartnerId, amount);
        return sendResponse(res, 201, 'Cash deposit order created successfully', data);
    } catch (error) {
        next(error);
    }
};

export const verifyCashDepositPaymentController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await verifyDeliveryCashDepositPayment(deliveryPartnerId, {
            razorpayOrderId: req.body?.razorpay_order_id,
            razorpayPaymentId: req.body?.razorpay_payment_id,
            razorpaySignature: req.body?.razorpay_signature,
            amount: req.body?.amount
        });
        return sendResponse(res, 200, 'Cash deposit verified successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getTripHistoryController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPartnerTripHistory(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Trip history fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getPocketDetailsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPocketDetails(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Pocket details fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getEmergencyHelpController = async (req, res, next) => {
    try {
        const data = await getDeliveryEmergencyHelp();
        return sendResponse(res, 200, 'Emergency help fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getCashLimitController = async (req, res, next) => {
    try {
        const data = await getDeliveryCashLimitSettings();
        return sendResponse(res, 200, 'Cash limit fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getDeliveryReferralStatsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const stats = await getDeliveryReferralStats(deliveryPartnerId);
        return sendResponse(res, 200, 'Referral stats fetched successfully', { stats });
    } catch (error) {
        next(error);
    }
};


export const deleteDeliveryPartnerAccountController = async (req, res, next) => {
    try {
        const partnerId = req.user?.userId;
        const result = await deleteDeliveryPartnerAccount(partnerId);
        return sendResponse(res, 200, 'Account deleted successfully', result);
    } catch (error) {
        next(error);
    }
};
