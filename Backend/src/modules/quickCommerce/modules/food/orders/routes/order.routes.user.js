import express from 'express';
import {
    approvePrescriptionBillController,
    createPrescriptionOrderController,
    declinePrescriptionBillController,
} from '../controllers/prescriptionOrder.controller.js';
import {
    calculateOrderController,
    createOrderController,
    verifyPaymentController,
    abandonOnlinePaymentController,
    listOrdersUserController,
    getOrderPaymentsUserController,
    getOrderByIdUserController,
    cancelOrderController,
    submitOrderRatingsController,
    getOrderDropOtpUserController,
    updateOrderInstructionsController,
    getOrderRouteUserController
} from '../controllers/order.controller.js';
// Both from master's middleware rather than this fork's copies. The idempotency
// ledger is one collection shared by every vertical, so a key is unique
// platform-wide; and this fork's own rateLimit.js has no sensitive-action limiter,
// so importing master's avoids adding a third implementation of the same idea.
import { idempotency } from '../../../../../../middleware/idempotency.js';
import { sensitiveActionRateLimiter } from '../../../../../../middleware/rateLimit.js';

const router = express.Router();

// Same treatment as the food module's order routes: /calculate prices an arbitrary
// coupon code so it is a brute-forceable oracle and gets rate limited, and the two
// money paths get the ledger. idempotency() is a no-op without an Idempotency-Key
// header, so existing clients are unaffected.
// Placing an order from a photographed prescription. Deliberately not POST '/'
// with an empty item list: that route prices and charges before it writes, and
// neither is possible here. See shared/prescriptionOrder.js.
router.post('/prescription', createPrescriptionOrderController);
// Answering the pharmacy's bill. Approving it returns the Razorpay order to pay
// with; declining cancels, since nothing has been paid and nothing has left the
// pharmacy. Rate-limited with the other money-moving routes below.
router.post('/:orderId/prescription-bill/approve', sensitiveActionRateLimiter, idempotency(), approvePrescriptionBillController);
router.post('/:orderId/prescription-bill/decline', sensitiveActionRateLimiter, declinePrescriptionBillController);

router.post('/calculate', sensitiveActionRateLimiter, calculateOrderController);
router.post('/', sensitiveActionRateLimiter, idempotency({ implicitWindowMs: 10_000 }), createOrderController);
router.post('/verify-payment', sensitiveActionRateLimiter, idempotency(), verifyPaymentController);
router.delete('/:orderId/pending-payment', abandonOnlinePaymentController);
router.get('/', listOrdersUserController);
router.get('/:orderId/payments', getOrderPaymentsUserController);
router.get('/:orderId/drop-otp', getOrderDropOtpUserController);
// Live route from the rider's current position to their next stop, for the tracking map.
router.get('/:orderId/route', getOrderRouteUserController);
router.get('/:orderId', getOrderByIdUserController);
router.patch('/:orderId/cancel', cancelOrderController);
router.patch('/:orderId/ratings', submitOrderRatingsController);
router.patch('/:orderId/instructions', updateOrderInstructionsController);

export default router;
