// Service-Provider module router.
//
// This is a straight transcription of the app.use() block that used to live in
// service-provider/Backend/server.js, minus the leading '/api'. Mount ORDER IS
// LOAD-BEARING -- express matches in registration order and several of these share
// the same prefix (five different files all mount on '/vendors'). Do not sort.
//
// CommonJS on purpose: see ../package.json.

const express = require('express');

// Register all SP schemas up front so populate() never hits MissingSchemaError
// because of require order. See ../models/index.js.
require('../models');

const router = express.Router();

// ─── Public ────────────────────────────────────────────────────────────────
router.use('/public/cities', require('./public-routes/city.routes.js'));

// ─── User ──────────────────────────────────────────────────────────────────
router.use('/users/auth', require('./user-routes/auth.routes'));
router.use('/users', require('./user-routes/profile.routes'));
router.use('/user/wallet', require('./user-routes/userWallet.routes'));
router.use('/users/bookings', require('./user-routes/booking.routes'));
router.use('/users', require('./user-routes/cart.routes'));
router.use('/users/fcm-tokens', require('./user-routes/fcmToken.routes'));

// ─── Scrap ─────────────────────────────────────────────────────────────────
router.use('/scrap', require('./scrap.routes'));

// ─── Vendor ────────────────────────────────────────────────────────────────
router.use('/vendors/auth', require('./vendor-routes/auth.routes'));
router.use('/vendors', require('./vendor-routes/profile.routes'));
router.use('/vendors', require('./vendor-routes/settings.routes'));
router.use('/vendors', require('./vendor-routes/wallet.routes'));
router.use('/vendors', require('./vendor-routes/dashboard.routes'));
router.use('/vendors', require('./vendor-routes/service.routes'));
router.use('/vendors/bookings', require('./vendor-routes/booking.routes'));
router.use('/vendors/workers', require('./vendor-routes/worker.routes'));
router.use('/vendors/fcm-tokens', require('./vendor-routes/fcmToken.routes'));
router.use('/vendors', require('./vendor-routes/vendorBill.routes'));
router.use('/vendors/catalog', require('./vendor-routes/catalog.routes'));

// ─── Worker ────────────────────────────────────────────────────────────────
router.use('/workers/auth', require('./worker-routes/auth.routes'));
router.use('/workers', require('./worker-routes/profile.routes'));
router.use('/workers', require('./worker-routes/job.routes'));
router.use('/workers', require('./worker-routes/dashboard.routes'));
router.use('/workers/wallet', require('./worker-routes/wallet.routes'));
router.use('/workers/subscription', require('./worker-routes/subscription.routes'));
router.use('/workers/fcm-tokens', require('./worker-routes/fcmToken.routes'));

// ─── Admin ─────────────────────────────────────────────────────────────────
router.use('/admin/auth', require('./admin-routes/adminAuth.routes'));
router.use('/admin', require('./admin-routes/cityManagement.routes.js'));
router.use('/admin', require('./admin-routes/dashboard.routes'));
router.use('/admin', require('./admin-routes/userManagement.routes'));
router.use('/admin', require('./admin-routes/vendorManagement.routes'));
router.use('/admin', require('./admin-routes/workerManagement.routes'));
router.use('/admin', require('./admin-routes/categoryManagement.routes'));
router.use('/admin', require('./admin-routes/brandManagement.routes'));
router.use('/admin', require('./admin-routes/serviceManagement.routes'));
router.use('/admin', require('./admin-routes/vendorCatalogManagement.routes'));
router.use('/admin', require('./admin-routes/homePageManagement.routes'));
router.use('/admin', require('./admin-routes/bookingManagement.routes'));
router.use('/admin', require('./admin-routes/paymentManagement.routes'));
router.use('/admin', require('./admin-routes/transactionManagement.routes'));
router.use('/admin', require('./admin-routes/upload.routes'));
router.use('/admin', require('./admin-routes/planManagement.routes'));
router.use('/admin/worker-plans', require('./admin-routes/workerPlanManagement.routes'));
router.use('/admin', require('./admin-routes/settings.routes'));
router.use('/admin', require('./admin-routes/reviewManagement.routes'));
router.use('/admin', require('./admin-routes/reportManagement.routes'));
router.use('/admin/settlements', require('./admin-routes/settlementManagement.routes'));
router.use('/admin/admins', require('./admin-routes/adminManagement.routes'));
router.use('/image', require('./admin-routes/image.routes'));
router.use('/', require('./admin-routes/upload.routes')); // generic upload access

// ─── Vendor wallet / ledger ────────────────────────────────────────────────
// NOTE: mounted at '/vendors', so router.post('/withdrawal') inside becomes
// /vendors/withdrawal. Kept where server.js had it (after the admin block).
router.use('/vendors', require('./vendor-routes/vendorWallet.routes'));

// ─── Bookings ──────────────────────────────────────────────────────────────
router.use('/bookings', require('./booking-routes/userBooking.routes'));
router.use('/bookings/cash', require('./booking-routes/cashCollection.routes'));

// ─── Payments ──────────────────────────────────────────────────────────────
router.use('/payments', require('./payment-routes/payment.routes'));

// ─── Notifications ─────────────────────────────────────────────────────────
router.use('/notifications', require('./notification.routes'));

// ─── Public (catalog / plans / config) ─────────────────────────────────────
router.use('/public', require('./public-routes/catalog.routes'));
router.use('/public', require('./public-routes/plan.routes'));
router.use('/public', require('./public-routes/config.routes'));

module.exports = router;

// Intentionally NOT mounted, matching the old server.js exactly:
//   ./booking-routes/vendorBooking.routes.js  (vendor-routes/booking.routes serves this)
//   ./cityRoutes.js                           (public-routes/city.routes.js serves this)
// Leaving them dead rather than newly exposing untested endpoints.
