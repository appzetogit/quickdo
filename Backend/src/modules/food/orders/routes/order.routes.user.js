import express from 'express';
import {
    calculateOrderController,
    createOrderController,
    verifyPaymentController,
    listOrdersUserController,
    getOrderPaymentsUserController,
    getOrderByIdUserController,
    cancelOrderController,
    submitOrderRatingsController,
    getOrderDropOtpUserController,
    getOrderRouteUserController,
    updateOrderInstructionsController
} from '../controllers/order.controller.js';
import { idempotency } from '../../../../middleware/idempotency.js';
import { sensitiveActionRateLimiter } from '../../../../middleware/rateLimit.js';

const router = express.Router();

// /calculate is a read, but it prices an arbitrary coupon code, which makes it a
// coupon-code oracle worth brute-forcing. Rate limited, not made idempotent.
router.post('/calculate', sensitiveActionRateLimiter, calculateOrderController);

// The two money paths. `idempotency()` is a no-op for any client that does not send
// an Idempotency-Key header, so every shipped Flutter and APK build keeps working
// unchanged and gains double-submit protection only once it starts sending one.
router.post('/', sensitiveActionRateLimiter, idempotency({ implicitWindowMs: 10_000 }), createOrderController);
router.post('/verify-payment', sensitiveActionRateLimiter, idempotency(), verifyPaymentController);
router.get('/', listOrdersUserController);
router.get('/:orderId/payments', getOrderPaymentsUserController);
router.get('/:orderId/drop-otp', getOrderDropOtpUserController);
router.get('/:orderId/route', getOrderRouteUserController);
router.get('/:orderId', getOrderByIdUserController);
router.patch('/:orderId/cancel', cancelOrderController);
router.patch('/:orderId/ratings', submitOrderRatingsController);
router.patch('/:orderId/instructions', updateOrderInstructionsController);

export default router;
