import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { authMiddleware, requireFoodDeliveryPartner } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../core/roles/role.middleware.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import {
    listOrderEmergencyRequestsController,
    createOrderEmergencyRequestController,
    getOrderEmergencyRequestController
} from '../controllers/orderEmergencyRequest.controller.js';
import { getCurrentIncentiveController } from '../../../../core/incentives/controllers/incentiveController.js';
import { onboardingOptionsController,
    onboardingRequirementsController,
    registerDeliveryPartnerController, updateDeliveryPartnerProfileController, updateDeliveryPartnerBankDetailsController, listSupportTicketsController, createSupportTicketController, getSupportTicketByIdController, updateDeliveryPartnerDetailsController, updateDeliveryPartnerProfilePhotoBase64Controller, updateAvailabilityController, getWalletController, createWithdrawalRequestController, createCashDepositOrderController, verifyCashDepositPaymentController, getEarningsController, getTripHistoryController, getPocketDetailsController, getEmergencyHelpController, getCashLimitController, getDeliveryReferralStatsController, getActiveEarningAddonsController, deleteDeliveryPartnerAccountController } from '../controllers/delivery.controller.js';

const router = express.Router();

const uploadFields = upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'aadharPhoto', maxCount: 1 },
    { name: 'panPhoto', maxCount: 1 },
    { name: 'drivingLicensePhoto', maxCount: 1 },
    { name: 'upiQrCode', maxCount: 1 }
]);

// Read before the form is filled in, by someone who has no account yet —
// the same reason /register itself is open.
router.get('/onboarding/options', onboardingOptionsController);
router.get('/onboarding/requirements', onboardingRequirementsController);
/**
 * Regroups an `any()` upload back into the shape `fields()` produces.
 *
 * Registration has to accept file fields nobody can name in advance --
 * the admin invents them when they add a document -- and multer refuses
 * an unnamed field. `any()` takes everything but hands back an ARRAY,
 * which every existing reader of `files.profilePhoto[0]` would break on.
 * This puts it back.
 */
const groupUploadedFiles = (req, _res, next) => {
    if (Array.isArray(req.files)) {
        const grouped = {};
        for (const file of req.files) {
            if (!grouped[file.fieldname]) grouped[file.fieldname] = [];
            grouped[file.fieldname].push(file);
        }
        req.files = grouped;
    }
    next();
};

router.post('/register', upload.any(), groupUploadedFiles, registerDeliveryPartnerController);

/**
 * Public: is this vehicle number free to register?
 *
 * Called from the registration form before submit, so it cannot require a token.
 * Answers only yes/no -- it never reveals who holds the number. A 'rejected'
 * application does not hold its vehicle number, so that rider can re-apply.
 */
router.get('/check-vehicle/:number', async (req, res) => {
    try {
        const { FoodDeliveryPartner } = await import('../models/deliveryPartner.model.js');
        const vNum = String(req.params.number || '').trim().toUpperCase();
        if (!vNum) {
            return res.status(400).json({ success: false, message: 'Vehicle number is required' });
        }
        const existing = await FoodDeliveryPartner.findOne({
            vehicleNumber: vNum,
            status: { $ne: 'rejected' }
        });
        return res.json({
            success: true,
            isAvailable: !existing,
            message: existing ? 'Vehicle number already registered' : 'Available'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.patch('/profile', authMiddleware, requireFoodDeliveryPartner, uploadFields, updateDeliveryPartnerProfileController);

// JSON-only profile updates (no files) – safe for web updates like vehicle number.
router.patch('/profile/details', authMiddleware, requireFoodDeliveryPartner, updateDeliveryPartnerDetailsController);

// Base64 profile photo update – designed for Flutter in-app WebView camera handler.
router.post('/profile/photo-base64', authMiddleware, requireFoodDeliveryPartner, updateDeliveryPartnerProfilePhotoBase64Controller);

router.patch('/profile/bank-details', authMiddleware, requireFoodDeliveryPartner, uploadFields, updateDeliveryPartnerBankDetailsController);
router.delete('/profile/account', authMiddleware, requireFoodDeliveryPartner, deleteDeliveryPartnerAccountController);

router.patch('/availability', authMiddleware, requireFoodDeliveryPartner, updateAvailabilityController);

router.get('/support-tickets', authMiddleware, requireFoodDeliveryPartner, listSupportTicketsController);
router.post('/support-tickets', authMiddleware, requireFoodDeliveryPartner, createSupportTicketController);
router.get('/support-tickets/:id', authMiddleware, requireFoodDeliveryPartner, getSupportTicketByIdController);

// ----- Emergency reassignment -----
// A rider who cannot finish an accepted job asks for it to be handed to someone
// else. A rider only ever sees their own requests; acting on one is an admin job.
router.get('/order-emergency-requests', authMiddleware, requireFoodDeliveryPartner, listOrderEmergencyRequestsController);
router.post('/order-emergency-requests', authMiddleware, requireFoodDeliveryPartner, createOrderEmergencyRequestController);
router.get('/order-emergency-requests/:id', authMiddleware, requireFoodDeliveryPartner, getOrderEmergencyRequestController);

// ----- Orders -----
router.get('/orders/current', authMiddleware, requireFoodDeliveryPartner, orderController.getCurrentTripDeliveryController);
router.get('/orders/available', authMiddleware, requireFoodDeliveryPartner, orderController.listOrdersAvailableDeliveryController);
router.get('/orders/:orderId', authMiddleware, requireFoodDeliveryPartner, orderController.getOrderByIdDeliveryController);
router.patch('/orders/:orderId/accept', authMiddleware, requireFoodDeliveryPartner, orderController.acceptOrderDeliveryController);
router.patch('/orders/:orderId/reject', authMiddleware, requireFoodDeliveryPartner, orderController.rejectOrderDeliveryController);
router.patch('/orders/:orderId/reached-pickup', authMiddleware, requireFoodDeliveryPartner, orderController.confirmReachedPickupDeliveryController);
router.patch('/orders/:orderId/confirm-pickup', authMiddleware, requireFoodDeliveryPartner, orderController.confirmPickupDeliveryController);
// The bill photo taken at pickup; returns { url } for confirm-pickup's billImageUrl.
router.post('/orders/:orderId/bill-photo', authMiddleware, requireFoodDeliveryPartner, orderController.uploadPickupBillPhotoController);
router.patch('/orders/:orderId/reached-drop', authMiddleware, requireFoodDeliveryPartner, orderController.confirmReachedDropDeliveryController);
router.get('/orders/:orderId/route', authMiddleware, requireFoodDeliveryPartner, orderController.getOrderRouteDeliveryController);
router.post('/orders/:orderId/verify-drop-otp', authMiddleware, requireFoodDeliveryPartner, orderController.verifyDropOtpDeliveryController);
router.patch('/orders/:orderId/complete', authMiddleware, requireFoodDeliveryPartner, orderController.completeDeliveryController);
// The mirror of the customer's own rating: once per order, delivered orders only.
router.patch('/orders/:orderId/rate-customer', authMiddleware, requireFoodDeliveryPartner, orderController.rateCustomerDeliveryController);
router.patch('/orders/:orderId/status', authMiddleware, requireFoodDeliveryPartner, orderController.updateOrderStatusDeliveryController);
router.post('/orders/:orderId/collect/qr', authMiddleware, requireFoodDeliveryPartner, orderController.createCollectQrController);

router.get('/orders/:orderId/payment-status', authMiddleware, requireFoodDeliveryPartner, orderController.getPaymentStatusController);
router.post('/orders/:orderId/collect/cash', authMiddleware, requireFoodDeliveryPartner, orderController.switchToCashController);


// ----- Earnings / Settings -----
router.get('/earning-addons/active', authMiddleware, requireFoodDeliveryPartner, getActiveEarningAddonsController);
router.post('/reverify', authMiddleware, requireFoodDeliveryPartner, (req, res) => res.json({ success: true, message: 'Submitted' })); // Stub

// Pocket / requests page – wallet, earnings, and admin-set delivery settings
router.get('/wallet', authMiddleware, requireFoodDeliveryPartner, getWalletController);
router.post('/wallet/withdraw', authMiddleware, requireFoodDeliveryPartner, createWithdrawalRequestController);
router.post('/wallet/deposit/order', authMiddleware, requireFoodDeliveryPartner, createCashDepositOrderController);
router.post('/wallet/deposit/verify', authMiddleware, requireFoodDeliveryPartner, verifyCashDepositPaymentController);
router.get('/earnings', authMiddleware, requireFoodDeliveryPartner, getEarningsController);
router.get('/trip-history', authMiddleware, requireFoodDeliveryPartner, getTripHistoryController);
router.get('/pocket-details', authMiddleware, requireFoodDeliveryPartner, getPocketDetailsController);
router.get('/emergency-help', authMiddleware, requireFoodDeliveryPartner, getEmergencyHelpController);
router.get('/cash-limit', authMiddleware, requireFoodDeliveryPartner, getCashLimitController);
router.get('/referrals/stats', authMiddleware, requireFoodDeliveryPartner, getDeliveryReferralStatsController);
router.get('/incentives/current', authMiddleware, requireFoodDeliveryPartner, getCurrentIncentiveController);

export default router;

