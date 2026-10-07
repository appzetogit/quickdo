# SOW Implementation Plan

This plan covers how to get from the code in this repo (`fae26da`) to the
*Complete Master App (Android/iOS) Development Quotation* SOW.

It is based on a gap audit of every SOW bullet against the code. The work is
done inside the existing project: same Node/Express/MongoDB backend, same
React/Vite frontend, same module layout. Nothing is rewritten that already
works.

**Estimates.** Effort is in developer-days (d) for one experienced developer
on this codebase. Treat the figures as rough sizing, not quotes.

---

## 0. Decisions (settled 2026-10-07)

| # | Question | Decision |
|---|---|---|
| D1 | Flutter apps | Built by a separate Flutter team. This repo covers the backend and the admin panel; the apps consume the APIs documented in `docs/flutter-*.md`. |
| D2 | Medical / pharmacy | **Remove.** |
| D3 | Intercity / outstation | **Fold into normal rides** as one-way / round trip (§4), then remove the separate intercity screens. |
| D4 | Fleet owners | **Remove.** |
| D5 | Petpooja POS integration | Keep, off by default. |
| D6 | Referrals, cashback, driver incentives | Keep. Loyalty points (§5) build on them. |
| D7 | ₹1,000 subscription / ₹100 fee | Admin settings, seeded with ₹1,000 and ₹100. |
| D8 | Commission on bookings over ₹1,000 | Charged on the **whole booking**. |

---

## 1. Remove what the SOW does not ask for

### 1.1 What goes

| Feature | Where it lives | Notes |
|---|---|---|
| **Bus booking** | Backend: `modules/taxi/admin/models/BusService.js`, `taxi/driver/models/BusDriver.js`, `taxi/user/models/BusBooking.js`, `BusSeatHold.js`, `scripts/seed-bus-driver.js`. Frontend: `Taxi/modules/user/pages/bus/*`, `admin/pages/bus-service/*`, `driver/pages/BusDriverHome.jsx`, `OwnerBus*Page.jsx`, `BusBooking*.jsx`, `bus*Service.js` | Self-contained. Lowest risk. |
| **Seat pooling / shared rides** | `taxi/admin/models/Pooling*.js`, `InstantPoolGroup.js`, `taxi/services/instantPoolingService.js`, `routeOptimizer.js` (pooling use only), both `poolingController.js`, `scripts/*pooling*`. Frontend `pages/pooling/*` (admin and user) | `RideTracking.jsx` shows a stops timeline and per-stop ETA only for pooled rides. Keep the timeline component and reuse it for the new multi-stop feature (§4) before deleting the pooling code. |
| **Bike / vehicle rental** | `taxi/admin/models/Rental*.js`, `taxi/services/rentalTrackingService.js`. Frontend `user/pages/rental/*`, `RentalLocationTracker.jsx`, `admin/pages/price-management/Rental*.jsx` | Self-contained. |
| **Parcel delivery** | Frontend `Taxi/modules/user/pages/parcel/*`. Backend: parcel branches inside `core/incentives/*`, `core/orders/masterOrders.service.js`, `core/orders/myOrders.*`, `core/identity/driverCapabilities.service.js`, `food/delivery/*` (partner model, earnings, onboarding requirements), `taxi/admin/controllers/adminController.js`, `core/cms/homeContent.service.js` | **Most tangled in.** Remove the parcel branches one file at a time, not with a mass delete. Delete or update tests `bike-parcel-with-delivery`, `parcel-offer-push` and `rider-earnings-include-parcels`. |
| **Ride insurance** | `taxi/admin/models/RideInsurancePlan.js`, `taxi/common/rideInsurance.js` (plus its check), `admin/pages/price-management/RideInsurance.jsx`, `docs/ride-insurance-flutter.md` | Remove the insurance line from the fare quote in `rideService.js`. |
| **Dining / table booking** | `food/dining/*` and its quick-commerce copy, `food/landing/*diningBanner*`, `routes/index.js:151`. Frontend: `Food/pages/user/Dining*.jsx`, `pages/user/dining/*`, `restaurant/DiningReservations.jsx`, `admin/system/Dining*.jsx`, `hooks/user/useDining*.js`, `UserRouter.jsx:100-109`, `AdminRouter.jsx:385-386`, `theme_update_dining.cjs` | Self-contained. |
| **Medical / pharmacy** (D2) | QC `admin/*medical*`, `orders/routes/medical.routes.user.js`, `shared/medicalRequest.js`, `quickCommerce/routes/index.js:22,97-101`, `scripts/*medical*`, the `medical` entry in `core/appServices/appServices.rules.js`. Frontend `Food/pages/admin/medical/*`. Tests `medical-*`, `qc-*medical*`, `quick-shop-excludes-pharmacy` | Also remove the `medical` zone collection, the `prescription` fields on the QC order, and the "Medical" admin menu. |
| **Fleet owners** (D4) | `taxi/admin/models/Owner*.js`, `FleetVehicle.js`. Frontend `admin/pages/owners/*`, `driver/pages/OwnerDashboard.jsx`, `settings/*Fleet.jsx`, `reports/OwnerReport.jsx`, `FleetFinanceReport.jsx` | Check first that no live driver has an `ownerId` (see below). |
| **Intercity screens** (D3) | `Taxi/modules/user/pages/intercity/*`, `TaxiApp.jsx:744-745` | Only after round trip works inside the normal ride flow (§4). |
| **Stray root scripts** | `Frontend/theme_update*.cjs` | One-off theme scripts. Not product code. |

### 1.2 How to remove safely

1. **Count the live data first.** Write and run a read-only script
   (`Backend/scripts/audit-out-of-scope-data.mjs`). For each feature, it
   counts documents in its collections and the users, drivers and orders that
   point at them. A feature with live rows needs a sign-off before deletion.
2. **Hide it, then delete it.** First release: hide the routes and menu
   entries behind a flag and turn off the customer tiles. Run it for a week.
   Second release: delete the code. This gives a cheap rollback if something
   still depends on a removed route.
3. **One PR per feature.** In each PR:
   - remove the routes, models, screens and seeds;
   - update `TaxiApp.jsx`, `AdminRouter.jsx` and the admin sidebars;
   - delete or update the feature's tests and remove them from `npm test`;
   - run the whole test suite.
4. **Keep the data.** Leave the collections in MongoDB. Take a `mongodump`
   archive of them (§2.1) before deleting the code. Dropping collections is a
   separate step, months later.

**Effort:** about 8–10d. Parcel takes about 3d of that, because it is spread
across core, food delivery, incentives and the order lists.

---

## 2. Platform foundations (needed by every vertical)

| # | Work | Where | Effort |
|---|---|---|---|
| 2.1 | **Data backup.** Nightly `mongodump`, compressed and uploaded to object storage (S3 or compatible), kept 14 days daily and 8 weeks weekly. Add a restore script and run a test restore on staging. | `deploy/backup.sh`, cron/pm2 entry in `deploy/ecosystem.config.cjs`, `deploy/restore.sh` | 2d |
| 2.2 | **SSL in the repo.** Put the final 443 server block and HTTP→HTTPS redirect in `deploy/nginx/*.conf`, so a fresh server does not depend on Certbot editing the file. | `deploy/nginx/` | 0.5d |
| 2.3 | **Customer email login and password recovery.** Login and registration with email + password (bcrypt), email OTP verification, forgot/reset password. Reuse the admin reset-OTP pattern in `core/admin/adminResetOtp.model.js`. | `core/auth/*`, `core/users/user.model.js`, `core/otp/*` | 3d |
| 2.4 | **Google and Apple sign-in.** Backend checks the ID token from the client (Google via `google-auth-library`, Apple via JWKS), then finds or creates the user, linking by verified email or phone through `core/identity`. Replace the stub `AuthCallback.jsx`. | `core/auth/socialAuth.*` (new), `Food/pages/user/auth/*` | 3d |
| 2.5 | **Gateway refunds.** Call `processGatewayRefund` (`core/payments/refund.service.js`) wherever an online payment is refunded (food, QC, taxi, SP). Use idempotency keys and handle the `refund.processed` webhook. | `core/payments/*`, SP `services/razorpayService.js` | 3d |
| 2.6 | **Email queue and templates.** Fill in the empty `queues/email.queue.js`. Send every email through it: invoices, booking confirmations, onboarding status, password reset. | `queues/email.queue.js`, `services/email.service.js` | 2d |
| 2.7 | **Admin activity log.** Extend `core/admin/models/adminAudit.model.js` from finance-only to every admin write (approvals, settings, refunds, user blocks). Add it as middleware next to `enforceAdminAccess`, and add an admin page to view it. | `core/admin/*`, master admin page | 2d |
| 2.8 | **Close the remaining P0 finance issues** listed in `MASTER_PRODUCT_AUDIT.md`: webhook idempotency, swallowed `recordTransaction` errors, and the rest of the wallet-adjust RBAC (P0-4/5/7). | `core/payments`, `core/wallet`, `core/finance` | 3d |

**Effort:** about 18d.

---

## 3. Service Provider: biggest gap against the SOW

The SP backend and admin panel are in this repo. The customer, vendor and
worker screens are not (they are Flutter, D1).

### 3.1 Finish the integration first

- Run `Backend/scripts/sp-migrate-data.js` on staging, then on production.
  Then do the Phase 9 end-to-end checks from
  `SP_INTEGRATION_CHANGE_MANIFEST.md`.
- Mount the routes that are not mounted yet:
  `routes/booking-routes/vendorBooking.routes.js` and `routes/cityRoutes.js`.
- **Fix two schema bugs.** Add `skills` and `bankDetails` to
  `models/Worker.js`. Today `workerProfileController` drops skills silently,
  and the bank-details fallback in `workerWalletController` always comes back
  empty.

**Effort:** 2d plus the migration window.

### 3.2 Subscription and commission engine (SOW §8)

**New settings, with admin UI:**

- `subscriptionPrice` (default 1000)
- `subscriptionPlatformFee` (default 100)
- `subscriptionRemainderRule` (where the other ₹900 goes, per D7)
- `commissionThreshold` (default 1000)

**New model, `CommissionRule`:**

- `scope`: `global | category | provider`
- `refId`: categoryId, or vendorId/workerId
- `type`: `fixed | percentage`
- `value`, `active`, and a validity window

**How commission is worked out.** Add `resolveCommission(booking)` in
`utils/commission.js`:

1. If the booking total is ₹1,000 or less and the provider's subscription is
   active, the commission is **0**. The subscription covers it.
2. If the total is above `commissionThreshold`, the most specific rule wins:
   provider rule, then category rule, then global rule. Each rule is fixed or
   percentage.
3. Save the result on the booking (`commissionSnapshot`): rule id, type, value
   and amount, so later changes to rules never rewrite past bookings.

`getCommissionRates` today returns a single global `servicePayoutPercentage`.
Replace every place that reads it (settlement, wallet credit, reports) with
the booking's snapshot.

**Subscriptions:**

- Extend them to **vendors** as well as workers. Today the `locationService`
  check only covers workers.
- Record the ₹100 platform fee and the remainder as separate ledger lines.
  `adminDashboardController` (around line 263) currently books 100% of the
  subscription as platform revenue.
- Collect renewals as recurring payments through Razorpay Subscriptions, not
  one-off orders. Send expiry reminders through the notification queue. When
  a subscription lapses, the provider stops getting jobs (existing behaviour).

**Admin:**

- A Commission Rules page: global, category and provider tabs.
- A Subscriptions page: active, expiring and lapsed providers, and the fee
  split.
- Add the per-rule split to the commission report.

**Tests:** `tests/sp-commission-engine.smoke.mjs` covers:

- a booking under the threshold with an active subscription;
- a booking over the threshold under each scope;
- fixed versus percentage rules;
- a snapshot staying unchanged after a rule is edited.

**Effort:** 8d.

### 3.3 Onboarding and profile (SOW §8 and §9)

| Item | Change |
|---|---|
| GST upload | `gst.{number, document, verified}` on Vendor and Worker |
| PAN for workers | `pan.{number, document}` on Worker |
| Bank details | `bankDetails` on Vendor and Worker, plus an `/bank-details` endpoint; withdrawals read from the profile |
| Experience, certifications | `experienceYears`, `certifications[] {name, issuer, document, expiresAt}` |
| Category selection | Store `Category` ObjectIds instead of free-text strings; migrate the existing values |
| Email verification | Email OTP for vendors and workers, using `isEmailVerified` (the field exists but nothing sets it) |
| Verification checklist | `verification.{aadhaar, pan, gst, address, background}`, each with `status / verifiedBy / verifiedAt / note`. Admin ticks each one off, and approval is blocked until the required items are ticked. Space is left for a KYC API (DigiLocker or similar) later. |
| Working radius and calendar | `serviceRadiusKm` on workers too. New `Availability` model: weekly hours plus date overrides (leave or blocked days). Assignment in `locationService` skips providers who are unavailable at the booked slot. |
| Pricing | Use `VendorService.customPrice` in booking pricing when the customer picks that provider (§3.4) |

Admin: the vendor and worker detail pages show the new documents and the checklist.

**Effort:** 6d.

### 3.4 Booking features (SOW §7)

| Item | Change |
|---|---|
| Quote request | New `Quote` model: booking, provider, line items, amount, validity, status. Flow: customer sends a request → nearby providers send quotes → customer accepts one → it becomes a normal booking at that price. Add an `isConsultancy` toggle to the admin category page. |
| Provider selection | `GET /user/providers?category&lat&lng&slot` returns providers ranked by rating and distance. `createBooking` takes an optional `preferredProviderId`: offer to that provider first, then fall back to the automatic waves if they don't accept in time. |
| Service packages | A `ServicePackage` model (several services at one price) that customers can book as one item |
| Add-ons at booking | `addOns[]` on a Service, and customers can choose them in `createBooking` (kept separate from extras the provider adds at billing) |
| Invoice download | Server-side PDF (`pdfkit`) at `GET /user/bookings/:id/invoice`, using the existing invoice prefix, SAC and GSTIN settings. Email the invoice for every completed booking, not only vendor ones. |
| Category seed | Seed every SOW category: Doctor Consultation, Pandit, Packers & Movers, Pest Control, Gardening, Laundry, and the rest. |

**Effort:** 8d.

### 3.5 Work-verification photos (SOW §8)

- Replace the single `workPhotos[]` with
  `workPhotos.{before[], after[]}`, each photo carrying
  `{url, uploadedAt, uploadedBy, lat, lng}`. Migrate the existing photos into
  `after`.
- `before` photos are required at `startJob`, and `after` photos at
  `completeJob`. Each category can turn the requirement off.
- Customers get the photos in their booking details.
- Admin: add a photo gallery to the booking detail page and the dispute view.

**Effort:** 2d.

### 3.6 Earnings (SOW §8)

Give the worker dashboard daily, weekly and monthly earnings, as the vendor
dashboard already has.

**Effort:** 1d.

**SP total:** about 29d.

---

## 4. Taxi and driver

| # | Item | Change | Effort |
|---|---|---|---|
| 4.1 | **Multiple stops** | Add `stops[] {address, lat, lng, order, reachedAt}` to the `Ride` model and save it in `createRide`. Show the stops to the driver. The Google Maps handoff in `ActiveTrip.jsx` uses waypoints. Add an "arrived at stop" event over the socket. Move the stops timeline out of the pooling code before pooling is deleted. | 3d |
| 4.2 | **Round trip** | Price round trips in the backend: outbound leg + return leg + a waiting allowance, with admin-set factors on `SetPrice`. Save `tripType: one_way \| round_trip` and `returnAt` on the ride. Make it available in the normal ride flow, not only intercity. Remove the frontend `baseFare*1.8`. | 3d |
| 4.3 | **Toll charges** | Driver adds tolls with a receipt photo during the trip. Admin can set auto-approval limits. Tolls go into the final fare as a separate line. Optional later: estimate tolls with the Google Routes API `tollInfo`. Replace the code that ignores `additionalCharge` at completion with a toll line that has been approved. | 3d |
| 4.4 | **Night charges** | Add `night_charge {enabled, start, end, type, value}` to `SetPrice`, separate from surge slots. Include it in the quote and the final fare, and show it as a line on the fare breakdown. | 1.5d |
| 4.5 | **Extra kilometres** | At completion, compare the distance actually driven (GPS trace) with the quoted distance. If it is over by more than an admin-set tolerance, charge the extra km at the per-km rate (`rideService.js` around line 2490). | 2d |
| 4.6 | **Live ETA** | Send driver-to-pickup and driver-to-drop ETAs over the socket on each location update, from the Directions duration, rate-limited. Show them in `RideTracking.jsx`. | 2d |
| 4.7 | **SOS** | Merge the two SOS paths into one service. On trigger: save an alert, push it to admins over the socket and FCM, SMS every trusted contact with a live-tracking link, and record location updates every 10 s until the alert is resolved. Same flow for drivers. | 3d |
| 4.8 | **Live trip sharing** | Public endpoint `GET /public/trip/:token` that checks the token and expiry and returns live ride status and location, plus a public page at `/track-trip/:token`. Read-only, with no personal data beyond first names and vehicle number. | 2d |
| 4.9 | **Driver approval** | Change the `Driver` model default to `approve:false, status:'pending'` so admin-created drivers also go through review. | 0.5d |
| 4.10 | **Food rider navigation** | Use Google Maps directions links (`dir/?api=1&destination=…&waypoints=…`) instead of a search query in DeliveryV2. | 0.5d |
| 4.11 | **Vehicle RC for delivery partners** | Add RC to the DeliveryV2 signup documents, needed for motorised vehicles. | 1d |
| 4.12 | **Ride types** | Seed Mini, Sedan, SUV and Premium vehicle types with default prices. | 0.5d |
| 4.13 | **Scheduled-ride dispatch** | Move the scheduled-dispatch timers from memory to a BullMQ delayed job, so a restart or a second server cannot miss or double-fire one. | 1.5d |

**Taxi total:** about 23d.

---

## 5. Quick commerce

**Step zero: reduce the fork.** QC is a copy of the food module of about 370
files (`FORK_COLLAPSE.md`). Every feature below would otherwise be built
twice or drift. Do not attempt the whole collapse here. Do this instead:

- build new QC features as shared services in `core/` (or `modules/food/shared`);
- have the QC copy call those shared services;
- port the bug fixes that went into food after the fork (diff the two trees).

| # | Item | Change | Effort |
|---|---|---|---|
| 5.1 | **Multi-seller cart** | Cart holds `items[]` that each carry `storeId`. Checkout creates one **parent order** (single payment, single coupon) with **one child order per store**. Each child has its own store acceptance, rider and tracking. Split delivery fees and coupon discounts between the children by value, and keep the split on each child. Refunds and cancellations work per child. | 10d |
| 5.2 | **Self-pickup** | `fulfilmentType: delivery \| pickup` on the order. Pickup orders skip dispatch and the delivery fee, and show a pickup OTP that the store checks. | 2d |
| 5.3 | **Scheduled delivery** | Store `scheduledAt` against admin-defined slots with capacity limits. A delayed BullMQ job starts dispatch N minutes before the slot. | 3d |
| 5.4 | **Proof-of-delivery photo** | `dropProof {photoUrl, lat, lng, at}` at completion, required when there is no OTP. Shown to the customer and to admin. | 1d |
| 5.5 | **Search suggestions** | `GET /search/suggest?q=` with a prefix match on product, category and brand names, ranked by popularity (order counts). Keep a recent-searches list per user. | 2d |
| 5.6 | **Voice search and QR scan** | Done in the app (device speech-to-text, camera barcode scan). Backend adds `barcode`/`ean` on products and `GET /products/by-barcode/:code`. | 1d |
| 5.7 | **Loyalty points** | `LoyaltyLedger` (earn and burn, with expiry). Admin sets the earn rule (points per ₹) and redeem rule (₹ per point, maximum % of an order). Points are earned when an order is delivered and redeemed at checkout. Lives in `core/` so food can use it too. | 4d |
| 5.8 | **FAQs** | `Faq` model (per vertical and category, ordered) with admin CRUD and a public `GET /faqs?vertical=`. Shared by all verticals. | 1.5d |
| 5.9 | **Customer analytics for vendors** | Add new versus repeat customers and top customers to `restaurantAnalytics.service.js`. | 1d |
| 5.10 | **QC in the delivery-partner app** | DeliveryV2 picks up QC orders as well as food. Mostly API routing plus store/product display. Overlaps with the unified driver work (§8). | 3d |

**QC total:** about 29d.

---

## 6. Food delivery and restaurant panel

| # | Item | Change | Effort |
|---|---|---|---|
| 6.1 | Replace the mock pages | `DownloadReport.jsx` and `FinanceDetailsPage.jsx` call real endpoints. Server-side report generation (CSV/PDF) for a date range. | 2d |
| 6.2 | Analytics on the server | `GET /restaurant/analytics/sales?from&to&groupBy` does the aggregation in MongoDB. Remove `generateMockOrders` and the demo mode from `Analytics.jsx`. | 2d |
| 6.3 | Settlement statements for vendors | A statement per settlement cycle: orders, commission, GST, deductions, payout. Viewable and downloadable. | 2d |
| 6.4 | GST verification | Check the GSTIN with a provider's API at onboarding and in admin review (fill in legal name and address, flag mismatches). Keep the regex check as a fallback. | 2d |
| 6.5 | Restaurant email signup | Fix `SignupEmail.jsx`, which sends an email to a phone-only DTO. Either support email OTP (§2.3) or remove the option. | 0.5d |
| 6.6 | Menu setup during onboarding | Optional "add your first items / upload menu sheet" step using the existing `/bulk-upload`. | 1.5d |
| 6.7 | Server-side invoice PDF | Share the PDF service from §3.4, so Flutter apps can download invoices too. | 1d |

**Food total:** about 11d.

---

## 7. Admin panel: unify it

| # | Item | Change | Effort |
|---|---|---|---|
| 7.1 | **Unified dashboard** | New `/admin` home (replacing the redirect to `/admin/food`). Shows KPI cards and charts across all four verticals: users, restaurants, stores, SPs, drivers, orders/bookings today and over a period, revenue, commission, subscriptions. Backend `core/admin/dashboard.service.js` adds up existing per-vertical queries, with caching. | 4d |
| 7.2 | **SP bookings in Master Orders** | Add SP bookings to `core/orders/masterOrders.service.js`, so one list shows food, QC, taxi and service bookings. | 2d |
| 7.3 | **Master subscriptions view** | One page over the SP, QC-seller and taxi-driver plans, with subscription income included in `platformPnl`. | 2d |
| 7.4 | **Cross-vertical reports** | Sales, revenue, customer, vendor, driver and provider reports, each filterable by vertical and zone, with CSV/XLSX export (reuse `reportsExportUtils.js`). Add the missing customer report: new versus returning customers, lifetime value, retention by month. | 5d |
| 7.5 | **Tax reports for every vertical** | Record taxi GST per ride. One GST report across food, QC, taxi and SP (SP already has GSTR and TDS). | 3d |
| 7.6 | **Broadcasts to every role** | Add taxi drivers and SP workers and vendors as targets in `notificationBroadcast.model.js`. Add SMS and email channels with simple segments (zone, vertical, active within N days). | 3d |
| 7.7 | **AI insights** | Start with useful analytics, not a black box. **Forecast:** daily orders and revenue per vertical and zone, using seasonal moving averages over past data, on a nightly job. **Recommendations:** "often bought together" and "popular near you" from order co-occurrence. **Demand prediction:** expected orders per zone per hour, used for rider positioning. Show all three in a new Insights page. An LLM summary can be added later. Replace the dummy `AISetup.jsx`. | 8d |
| 7.8 | **Global settings** | Collect country, currency, phone code, timezone and the delivery and schedule defaults into Master Global Settings (Phase 6 of `MASTER_PRODUCT_PLAN.md`), all read through `core/config/resolver.service.js`. | 3d |
| 7.9 | **Clean up the admin menus** | Remove the bus, pooling, rental, parcel, dining, medical, owner and insurance menus (with §1). Put taxi and SP admin under the same shell as food and QC. | 2d |

**Admin total:** about 32d.

---

## 8. One driver for taxi and food delivery

The SOW says "Drivers will manage taxi rides and food deliveries". The code
for this exists but is switched off (`UNIFIED_DISPATCH_ENABLED=false`).

1. Run `scripts/migrate-unify-drivers.js` on staging and check it, then turn
   the flag on for staging.
2. Food and QC dispatch take candidates from `Driver` (through
   `findEligibleUnifiedDrivers`, currently never called), honouring
   `workMode` and the busy-lock.
3. Wallet and cash-limit checks use `getRiderFinance` in all verticals, and
   SP is added to it (from `MASTER_PRODUCT_AUDIT.md` §1.1).
4. One driver app shows both ride requests and delivery orders. The Flutter
   team needs a merged incoming-job feed: one socket channel with a `jobType`
   field.
5. Release: staging, then one pilot zone, then everywhere.

**Effort:** about 8d of backend work, plus Flutter work.

---

## 9. Apps and web portals

- **Flutter apps (D1).** For every API added in §2–8, update
  `docs/flutter-integration.md` with request and response examples. Better
  still, publish an OpenAPI spec generated from the validators. Fix the
  contract before building each screen, so the mobile team can work in
  parallel.
- **React customer web.** The SOW lists an *optional* customer web portal for
  quick commerce. Build the QC storefront by reusing the food customer
  screens, which already point at `/qc` through the axios rewrite: home,
  category, product, multi-seller cart, checkout, tracking, support and
  FAQs. **About 10d.**
- **SP vendor and worker web screens.** Not needed if they are Flutter-only.
  The admin side is covered in §3.

---

## 10. Order of work

| Phase | Contents | Can run in parallel with |
|---|---|---|
| **P0** (week 1) | Decisions D1–D8, backups (2.1), out-of-scope data audit, run the SP migration on staging | none |
| **P1** (weeks 2–3) | Remove out-of-scope features (§1), close finance P0s (2.8), SSL, email queue, audit log | Taxi 4.9–4.13 |
| **P2** (weeks 3–6) | SP engine and onboarding (§3), auth (2.3–2.4), refunds (2.5) | Taxi §4 |
| **P3** (weeks 6–9) | QC (§5), food fixes (§6) | Admin 7.1–7.3 |
| **P4** (weeks 9–12) | Admin unification (§7), unified driver (§8), QC web storefront | Flutter integration |
| **P5** (weeks 12–14) | Full regression, load test on dispatch and sockets, security review, staged go-live with the manual deploy workflow | none |

**Total backend and web effort:** about 170 developer-days (§1 to §8 plus the
QC storefront). With two backend developers and one frontend developer
working in parallel, that is roughly 12–14 weeks. Flutter app work is
separate.

---

## 11. Rules for every change

- **Tests.** Every feature gets a smoke or check test under `Backend/tests/`,
  added to `npm test`. The manual deploy workflow already runs them.
- **Money.** Every money path uses idempotency keys and ledger entries. Save
  pricing and commission inputs on the order, never recompute them later.
- **New settings.** Each one has a default that keeps today's behaviour until
  an admin changes it.
- **Data migrations.** Each migration is a script in `Backend/scripts/` with
  a `--dry-run` mode. Run it on staging before production.
- **Quick commerce.** No new code is copied into the QC fork. Put shared
  logic in `core/` and have both verticals call it.
