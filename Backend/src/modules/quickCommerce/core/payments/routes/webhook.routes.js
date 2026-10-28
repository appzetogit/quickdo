import express from 'express';
/*
 * Master's handler, not this fork's copy.
 *
 * There is one Razorpay account and one webhook secret, but the platform kept two
 * handlers -- and Razorpay accepts one URL per event. So whichever of the two was
 * not configured in the dashboard simply never ran, and that vertical's orders
 * reconciled only if the customer's app happened to call /verify. Close the app
 * after paying and the money was stranded.
 *
 * The single handler now resolves which vertical's collection holds the order, so
 * BOTH mounts behave identically and it no longer matters which URL is configured.
 * This mount is kept rather than redirected for exactly that reason: an already
 * configured dashboard URL keeps working untouched.
 */
import { handleRazorpayWebhook } from '../../../../../core/payments/controllers/razorpayWebhook.controller.js';

/** ✅ NEW: Webhook Routes Module */
const router = express.Router();

/**
 * Endpoint for Razorpay payment/refund events (Public)
 * Path: /api/v1/payments/webhook/razorpay
 */
router.post('/razorpay', handleRazorpayWebhook);

export default router;
