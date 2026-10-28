import express from 'express';
import {
    cancelPrescriptionRequestController,
    createPrescriptionRequestController,
    listMyPrescriptionRequestsController,
    listNearbyPharmaciesController,
} from '../controllers/prescriptionRequest.controller.js';
import { sensitiveActionRateLimiter } from '../../../../../../middleware/rateLimit.js';

/**
 * The customer's medical section: find a pharmacy, or ask them all.
 *
 * Mounted apart from /orders because none of this is an order. A broadcast
 * request becomes an order only when a pharmacy accepts it, and until then
 * there is nothing for the order routes to show, cancel or charge for.
 *
 * Choosing a pharmacy and sending it a prescription stays where it was, at
 * POST /orders/prescription: that path does create an order immediately, and
 * it reaches that one pharmacy only.
 */
const router = express.Router();

// Everything the Medical screen needs to open: who is near, how far the
// platform lets a prescription travel, and whether broadcasting is available.
router.get('/pharmacies', listNearbyPharmaciesController);

router.get('/requests', listMyPrescriptionRequestsController);
// Rate limited with the money-ish routes: each one of these puts a health
// record in front of every pharmacy in range, so a loop here is not a nuisance
// but a disclosure.
router.post('/requests', sensitiveActionRateLimiter, createPrescriptionRequestController);
router.post('/requests/:requestId/cancel', cancelPrescriptionRequestController);

export default router;
