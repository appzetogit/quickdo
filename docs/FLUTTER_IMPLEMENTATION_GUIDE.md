# QuickDoo: Flutter implementation guide

The starting point for the Flutter team building the client SOW apps. It covers the platform rules (hosts, prefixes, tokens, errors, uploads, sockets, push, payments). It then maps each app's screens to endpoints in the order you will build them, lists every feature and endpoint that has been removed, and gives the rollout checklist.

The detailed request and response examples live in the module documents. This guide links to them rather than repeating them:

| Document | Covers |
|---|---|
| [flutter-auth-payments-api.md](./flutter-auth-payments-api.md) | Customer email/password, Google and Apple sign-in, adding a phone, refund status |
| [flutter-taxi-api.md](./flutter-taxi-api.md) | Stops, round trip, tolls, night and extra-km charges, live ETA, SOS, trip sharing, driver approval, delivery-partner RC |
| [flutter-sp-api.md](./flutter-sp-api.md) | Service provider onboarding, availability, provider choice, add-ons, quotes, work photos, invoices, worker earnings |
| [flutter-integration.md](./flutter-integration.md) | Food menu and checkout: per-size limits, combos, free delivery, the ₹99 store cap, the itemised bill |
| [flutter-stock-and-cancel-guide.md](./flutter-stock-and-cancel-guide.md) | Store stock screen, low-stock pushes, the food order-cancel window |
| [flutter-qc-api.md](./flutter-qc-api.md) | Quick commerce (SOW §5): multi-store cart, pickup, delivery slots, proof of delivery, search suggestions, barcode, loyalty, FAQs, store customer analytics |
| [flutter-food-api.md](./flutter-food-api.md) | Food (SOW §6): restaurant analytics, reports, settlements, GSTIN check, email sign-in, onboarding menu step, invoice PDF |
| [flutter-platform-api.md](./flutter-platform-api.md) | Platform (SOW §7): recommendations, demand, global settings, admin broadcasts |
| [../SOW_IMPLEMENTATION_PLAN.md](../SOW_IMPLEMENTATION_PLAN.md) | The backend plan and decisions D1 to D8 |

Every route prefix in this guide was checked against `Backend/src/routes/index.js` and each module's route index at the time of writing (branch `sow/phase-0-1`, last checked at commit `6b31463`, which includes SOW §5–§7). If an endpoint here and the code disagree, the code wins. Please tell the backend team.

---

## Contents

1. [Overview](#1-overview)
   - [Apps](#11-apps)
   - [Hosts and base URLs](#12-hosts-and-base-urls)
   - [Route prefixes](#13-route-prefixes)
   - [Sign-in and tokens](#14-sign-in-and-tokens)
   - [Responses and errors](#15-responses-and-errors)
   - [Pagination](#16-pagination)
   - [Uploads](#17-uploads)
   - [Sockets](#18-sockets)
   - [Push notifications (FCM)](#19-push-notifications-fcm)
   - [Razorpay](#110-razorpay)
2. [Customer app](#2-customer-app)
3. [Driver app (taxi drivers and delivery partners)](#3-driver-app-taxi-drivers-and-delivery-partners)
4. [Service Provider app (vendors and workers)](#4-service-provider-app-vendors-and-workers)
5. [Restaurant and store partner app](#5-restaurant-and-store-partner-app)
6. [Quick commerce](#6-quick-commerce)
   - [Platform endpoints](#68-platform-endpoints-recommendations-and-global-settings)
7. [Food ordering updates](#7-food-ordering-updates)
8. [What changed or was removed](#8-what-changed-or-was-removed)
9. [Configuration the client must supply](#9-configuration-the-client-must-supply)
10. [Rollout notes and checklist](#10-rollout-notes-and-checklist)
11. [Known gaps and doc/code mismatches](#11-known-gaps-and-doccode-mismatches)

---

## 1. Overview

### 1.1 Apps

| App | Users | Verticals |
|---|---|---|
| **Customer** | Customers (`USER`) | Food, quick commerce (QC), taxi and home services (SP) in one app, with one sign-in |
| **Driver** | Taxi drivers and food/QC delivery partners | Taxi rides; food and QC deliveries. One person can hold both identities (see [3.1](#31-two-identities-one-person)). |
| **Service Provider** | SP vendors (businesses) and SP workers (individuals) | Home services |
| **Restaurant / store partner** | Restaurant owners (food) and store sellers (QC) | A React web panel exists. A partner Flutter app exists (`Rish1811/quickdrop_restaurant`, see the stock guide). [Section 5](#5-restaurant-and-store-partner-app) lists what a new app needs. |

Decision D1: the backend team owns the API and the admin panel, and the Flutter team owns the apps.

### 1.2 Hosts and base URLs

| Environment | Web | API base (REST) | Socket.IO origin |
|---|---|---|---|
| Now (IP, plain HTTP) | `http://187.126.119.13` | `http://187.126.119.13/api` | `http://187.126.119.13` |
| Once DNS and HTTPS are live | `https://quickdoo.in` | `https://api.quickdoo.in/api` | `https://api.quickdoo.in` |
| Local backend | `http://localhost:5007` (the Node port behind nginx) | `http://localhost:5007/api` | `http://localhost:5007` |

- Every route below begins with `/api`, so a full URL is `<API base>/v1/...`. For example, today the phone OTP request is `http://187.126.119.13/api/v1/auth/user/request-otp`.
- **Make the host a build flavour or remote config value. Do not hard-code it.** The IP address goes away when DNS moves. When HTTPS arrives, Android needs no cleartext exception. Until then, a release build that talks to the IP needs `android:usesCleartextTraffic` (or a network security config) for that host only. Do not ship that to the stores.
- The live preview is `http://187.126.119.13`, where the web app calls the API same-origin on `/api`. Production moves to `https://quickdoo.in` (web) and `https://api.quickdoo.in` (API) once the domain hold is lifted. `api.quickdoo.in` proxies the whole path to the backend, so **the `/api` prefix stays** (`https://api.quickdoo.in/api/v1/...`).
- Health check: `GET /api/v1/health` returns `{ "status": "UP" }`.
- Customer-facing web links the API returns, such as the trip-share `url` (`https://<web>/track-trip/:token`), point at the web host, not the API host.

### 1.3 Route prefixes

These come from `Backend/src/routes/index.js` (all under `/api`).

| Prefix | What | Who |
|---|---|---|
| `/v1/auth` (same routes under `/v1/food/auth`) | Core sign-in: customer phone OTP, email/password, Google/Apple; restaurant and delivery-partner OTP; refresh; logout; `/me` | Customer, restaurant, delivery partner |
| `/v1/food/...` | Food: `/food/restaurant`, `/food/orders`, `/food/user`, `/food/delivery`, `/food/search`, `/food/notifications`, `/food/chat`, `/food/payments`, and landing/banners at `/food/...` | Customer, restaurant, delivery partner |
| `/v1/qc/...` | Quick commerce. It is a fork of the food module and has the same sub-paths under `/qc`: `/qc/auth`, `/qc/restaurant`, `/qc/partner`, `/qc/orders`, `/qc/user`, `/qc/delivery`, `/qc/returns`, `/qc/payments`, `/qc/search`, `/qc/uploads`, `/qc/fcm-tokens` | Customer, store seller, delivery partner |
| `/v1/taxi/...` | Taxi: `/taxi/users`, `/taxi/rides`, `/taxi/safety`, `/taxi/promos`, `/taxi/drivers`, `/taxi/common`, `/taxi/public/trip/:token` | Customer, driver |
| `/v1/sp/...` | Service provider: `/sp/users`, `/sp/vendors`, `/sp/workers`, `/sp/bookings`, `/sp/payments`, `/sp/public`, `/sp/notifications`, `/sp/image` | Customer, vendor, worker |
| `/v1/platform/...` | Cross-vertical: `/platform/app-services` (which service tiles to show, public), `/platform/me/orders` (My Orders across every service), `/platform/legal/:app/:kind` (terms and privacy, public), `/platform/global-settings` (public), `/platform/recommendations/...`, `/platform/faqs` (public), `/platform/loyalty` (food customers), `/platform/delivery-slots/available` (public). See [6.8](#68-platform-endpoints-recommendations-and-global-settings). | Customer, everyone |
| `/v1/me/activity`, `/v1/me/spend` | The customer's history and spend across verticals | Customer |
| `/v1/uploads` | Core image and document upload | Any signed-in core role |
| `/v1/fcm-tokens` | Core push-token registration | Customer, restaurant, delivery partner, taxi driver |
| `/v1/payments/webhook/razorpay` | Razorpay webhook | **Server only. Never call it from the app.** |
| `/v1/env/public` | Public client config (Maps key, Firebase web config) | Public |

Notes:

- **Legacy SP prefixes.** The SP module also answers on old top-level paths (`/api/users/...`, `/api/vendors/...`, `/api/workers/...` and others) for shipped builds. **New code must use `/api/v1/sp/...`.**
- **Module kill switch.** An admin can take a vertical out of service. Write requests (POST/PUT/PATCH/DELETE) to `/v1/food/orders`, `/v1/taxi`, `/v1/qc` or `/v1/sp` then return **503** with a `Retry-After: 300` header and a message to show. Reads still work. Show the message and keep existing orders visible.

### 1.4 Sign-in and tokens

There are three token families. All are JWTs sent as `Authorization: Bearer <token>`.

| Family | Issued by | Shape | Refresh |
|---|---|---|---|
| **Core** (customer, restaurant, delivery partner) | `/v1/auth/...` (and `/v1/qc/auth/...` for QC sellers and riders) | `{ accessToken, refreshToken }`. The access token lives 15 minutes by default (`JWT_ACCESS_EXPIRES`) and the refresh token 7 days (`JWT_REFRESH_EXPIRES`). | `POST /api/v1/auth/refresh-token` with `{ "refreshToken": "..." }` returns `{ accessToken, refreshToken }`. The refresh token is not rotated, so keep the one you have. QC sellers and riders use `POST /api/v1/qc/auth/refresh-token`. |
| **Taxi** (driver; also customer if you use the taxi OTP endpoints) | `/v1/taxi/drivers/auth/verify-otp`, `/v1/taxi/users/auth/verify-otp` | `token` (kept for old builds) and the same value as `accessToken` (role `driver` or `user`, `sub` = id, core access secret and lifetime), plus `refreshToken` and `expiresIn` (seconds). | `POST /api/v1/taxi/drivers/auth/refresh-token` or `/v1/taxi/users/auth/refresh-token` with `{ "refreshToken": "..." }` returns a new `{ token, accessToken, refreshToken, expiresIn }`. **The refresh token rotates**: save the new one; replaying a used one signs the session out everywhere. Logout: `POST .../auth/logout { refreshToken }`. See `flutter-taxi-api.md` section 0. |
| **SP** (vendor, worker; also SP-native customers) | `/v1/sp/{users,vendors,workers}/auth/...` | `{ accessToken, refreshToken }` | `POST /api/v1/sp/<role>/auth/refresh-token` (`<role>` = `users`, `vendors` or `workers`) with `{ "refreshToken": "..." }`. A new login on another device rotates the session, so the old refresh fails with 401 "Session expired". |

**The customer app needs only the core login.** A core `USER` access token is accepted by:

- food (`/v1/food/...`);
- QC (`/v1/qc/...`), which links a QC profile on first use;
- taxi (`/v1/taxi/...`), because both read the same `users` collection;
- SP (`/v1/sp/users/...`), which provisions an SP customer on first use;
- all four socket namespaces.

Do not sign the customer in four times.

Implement one Dio interceptor per token family:

1. On 401, call the family's refresh endpoint once, retry the request, then sign out if the refresh also fails.
2. Serialise refreshes, so ten parallel 401s produce one refresh call.
3. A 403 is not a refresh case. It means blocked, deactivated or pending approval. Show the message.
4. `POST /api/v1/auth/logout` takes `{ refreshToken, fcmToken?, platform? }`. Send the FCM token so the server stops pushing to this device.

Customer sign-in methods (all under `/api/v1/auth`). Every one returns the same session; details are in [flutter-auth-payments-api.md](./flutter-auth-payments-api.md).

| Method | Endpoints |
|---|---|
| Phone OTP (unchanged) | `POST /user/request-otp { phone }`, then `POST /user/verify-otp { phone, otp (4 digits), fcmToken?, platform: "mobile", name?, ref? }` |
| Email and password | `/user/email/register`, `/user/email/verify`, `/user/email/resend-otp`, `/user/email/login`, `/user/password/forgot`, `/user/password/reset` |
| Google / Apple | `POST /user/social/google { idToken }`, `POST /user/social/apple { idToken, nonce, name? }` |
| Signed-in account | `GET /user/account`, `/user/email/add`, `/user/password/change`, `/user/phone/request-otp`, `/user/phone/verify`, link and unlink of Google/Apple |

`user.needsPhone: true` (after email or social sign-up) means you must collect a phone number before the first order.

### 1.5 Responses and errors

Success envelope (food, QC, core, taxi, SP):

```json
{ "success": true, "message": "…", "data": { … } }
```

Error envelope:

```json
{ "success": false, "message": "Text you can show the user", "error": "same text", "requestId": "…", "code": "OPTIONAL_MACHINE_CODE" }
```

- **Show `message` as-is on any 4xx.** The server writes these messages for the end user, for example *You can order at most 3 of "Pasta (Full Plate)"*.
- A 5xx says `Internal server error`. Show a generic retry message and log the `requestId`. Support can look it up.
- Some SP and taxi endpoints return the body without `data` (for example SP `verify-login` puts `accessToken` at the top level, and SP image upload returns `imageUrl`). Parse defensively, per endpoint.
- Validation errors from Mongoose come back as 400 `Some details are missing or invalid: <fields>`.
- Uploads that are too large return 413 with a message. The multer limit is 5 MB per SP file.

Machine-readable `code` values to handle:

| `code` / case | Status | Where | What the app does |
|---|---|---|---|
| `EMAIL_NOT_VERIFIED` | 403 | `/auth/user/email/login` | Go to the code screen and offer "Resend code" |
| `ACCOUNT_LOCKED` | 423 | `/auth/user/email/login` | Body has `retryAfterSeconds`, and there is a `Retry-After` header. Offer "Reset password". |
| `TOO_MANY_REQUESTS` | 429 | Customer email/password endpoints | Too many codes requested. Wait. |
| (no code) 429 | 429 | Any `/api` route (global and auth rate limiters) | `message` is "Too many requests…" or "Too many authentication attempts…". Back off. Do not retry in a loop. |
| `BEFORE_PHOTOS_REQUIRED` | 400 | SP `.../visit/verify` | Open the camera, upload, call `/photos` with `phase: "before"`, then retry. The OTP was **not** consumed. |
| `AFTER_PHOTOS_REQUIRED` | 400 | SP `.../complete` | Same, with `phase: "after"` |
| `VERIFICATION_INCOMPLETE` | 400 | SP **admin** approve endpoint | Admin-only. Apps never receive it. The provider app shows the same information as `verification.missing` from `GET /onboarding`. |
| Parcel refused | 400 | `POST /taxi/rides/quote`, `POST /taxi/rides` | `"Parcel delivery is not available."` when `serviceType: "parcel"` or `transport_type: "delivery"` is sent. Remove all parcel UI. |
| Module disabled | 503 | Any write to a disabled vertical | Show `message`. The response has `Retry-After: 300`. |
| Driver pending | 403 | Taxi driver routes | `"Driver account is pending approval"`. Show the pending screen (`GET /taxi/drivers/approval-status`). |
| Vendor pending | 403 | SP vendor routes | `"Your vendor account is pending approval or has been rejected."` |
| Cancel window closed | 400 | `PATCH /food/orders/:id/cancel` | Show `message`. See the stock and cancel guide. |
| Order quantity | 400 | `POST /food/orders/calculate` | Show `message`. It names the size. |

### 1.6 Pagination

There is no single convention yet. Parse per module:

| Module | Query | Response |
|---|---|---|
| Food and QC lists (orders and others) | `page` (default 1), `limit` (default 20, max 100) | `data: { data: [...], meta: { total, page, limit, totalPages } }` |
| Taxi (ride history, admin lists) | `page`, `limit` | `data: { results: [...], paginator: { ... } }` |
| SP (bookings and others) | `page` (default 1), `limit` (default 10) | `data` plus `pagination: { page, limit, total, pages }` |

Write a small `Page<T>` adapter for each of the three shapes.

### 1.7 Uploads

Upload the file first, then send the returned URL in the JSON of the real request. Each family has its own upload endpoint, and **every one now needs a signed-in token** (commit `3972719` closed the last two open ones).

| Endpoint | Auth | Multipart field | Extra fields | Response URL at |
|---|---|---|---|---|
| `POST /api/v1/uploads/image` | Core token | `file` | `folder` (optional) | `data.url` |
| `POST /api/v1/uploads/document` | Core token | `file` | `folder` | `data.url` |
| `POST /api/v1/taxi/common/upload/image` | Taxi token. **Now required.** Drivers still under review are allowed. | `image` | `folder` (for example `toll-receipts`) | `data.url` |
| `POST /api/v1/sp/image/upload` | SP token. **Now required.** | `file` (image, 5 MB max) | — | `imageUrl` (top level, not under `data`) |
| `POST /api/v1/sp/upload` | SP token | `file` | — | `imageUrl` |
| `POST /api/v1/qc/uploads/...` | QC token (QC partner onboarding checks its own onboarding token) | `file` | — | `data.url` |

Uploads before an account exists:

- **Delivery partner signup**: `POST /api/v1/food/delivery/register` is multipart and takes the files directly: `profilePhoto`, `aadharPhoto`, `panPhoto`, `drivingLicensePhoto`, `upiQrCode`, **`vehicleRcPhoto`** (new) and any admin-defined `doc_<key>_front` / `doc_<key>_back`.
- **Taxi driver onboarding** (`/taxi/drivers/onboarding/*`) takes documents as base64 data URLs in the JSON body. It needs no upload token.
- **SP vendor and worker registration** (`/sp/{vendors|workers}/auth/register`) take documents (`aadharDocument`, `aadharBackDocument`, `panDocument`, `otherDocuments[]`) as base64 `data:` URLs or as already-hosted URLs. Use data URLs, because `/sp/image/upload` now needs a token the provider does not have yet.

### 1.8 Sockets

There is one Socket.IO server (socket.io v4 protocol; use `socket_io_client` 2.x or later) on the API origin, at the default path `/socket.io`. There are three namespaces:

| Namespace | Connect to | Who | Auth |
|---|---|---|---|
| `/` (root) | `io(<origin>, { auth: { token } })` | Food customers, restaurants, delivery partners, admins, **and taxi users and drivers** (taxi runs on the root namespace) | `auth.token` (required for taxi; food also accepts `Authorization: Bearer` or `?token=`). **Always use `auth.token`.** |
| `/qc` | `io(<origin> + '/qc', { auth: { token } })` | QC customers, stores, riders | `auth.token` |
| `/sp` | `io(<origin> + '/sp', { auth: { token } })` | SP customers, vendors, workers | `auth.token` or `Authorization` header |

Use transports `['websocket']` and reconnect with backoff. **When the access token is refreshed, reconnect the socket with the new token.** The handshake checks the token only once, so an expired token surfaces as a failed reconnect (`AUTH_INVALID`).

#### Food rooms and events (root namespace)

Rooms are joined automatically from the token: `user:<id>`, `restaurant:<id>`, `delivery:<id>`.

| Direction | Event | Notes |
|---|---|---|
| client → server | `join-tracking` (orderId), `leave-tracking` | Customer, restaurant or assigned rider of that order only. Reply: `tracking-room-joined`. |
| client → server | `update-location` `{ orderId, lat, lng, heading, … }` | Delivery partner, assigned orders only |
| client → server | `resync` | Delivery partner after reconnect. The server re-sends the active order and `delivery_drop_otp`, then `resync_complete`. |
| server → client | `order_status_update`, `location-update`, `order_deleted` | Customer and restaurant |
| server → client | `new_order`, `order_ready`, `manual_assignment_update` | Restaurant |
| server → client | `new_order_available`, `order_assigned`, `order_claimed`, `order_deassigned`, `delivery_drop_otp` | Delivery partner |
| both | `chat:message`, `chat:conversation_update` | Order chat (REST at `/food/chat`) |

QC on `/qc` uses the same events and rooms.

#### Taxi events (root namespace)

Rooms: `driver:<id>`, the user room, and a per-ride room joined with `ride:join`.

| Direction | Event | Payload / notes |
|---|---|---|
| client → server | `ride:join` | `{ rideId }`. Only the ride's rider or driver. Reply: `ride:joined`, then `ride:state`. |
| client → server | `ride:rejoin-current` | After reconnect. Returns `ride:state` (or `null` when there is no active ride). |
| driver → server | `acceptRide` `{ rideId }`, `rejectRide` `{ rideId }`, `submitRideBid` | Response to a `rideRequest` |
| driver → server | `ride:status:update` | `{ rideId, status, otp?, … }`, where `status` is one of `accepted`, `arriving`, `started`, `arrived`, `completed` |
| driver → server | `ride:driver-location:update` | `{ rideId, coordinates: [lng, lat], heading, speed }`. **Send it continuously during the trip.** The extra-km charge and live ETA are worked out from it. |
| driver → server | `locationUpdate` | `{ coordinates }` while online and idle (dispatch position) |
| driver → server | `ride:stop:reached` | `{ rideId, order }` |
| either → server | `ride:message:send` | Ride chat |
| server → driver | `rideRequest` (offer, with `stops`, `tripType`, `returnAt`), `rideRequestClosed`, `driver:wallet:updated` | |
| server → rider | `rideCreated`, `rideAccepted`, `rideCancelled`, `driverRejectedRide` | |
| server → ride room | `ride:state`, `ride:status:updated`, `ride:driver-location:updated`, `ride:driver-route:updated`, `ride:eta:updated`, `ride:stop:updated`, `ride:tolls:updated`, `ride:message:new` | Payloads are in [flutter-taxi-api.md §11](./flutter-taxi-api.md#11-socket-events-summary) |
| server → client | `errorMessage` | `{ message }` when a socket action fails. Show it. |

#### SP events (`/sp`)

Rooms are joined from the token: `user_<id>`, `vendor_<id>`, `worker_<id>`. There are also explicit joins: `join_user_room`, `join_vendor_room`, `join_worker_room` (own id only).

| Direction | Event | Notes |
|---|---|---|
| client → server | `join_tracking` (bookingId) | Booking parties only. The cached `live_location_update` is sent at once. |
| provider → server | `update_location` `{ lat, lng, heading, bookingId }` | Provider on the way |
| provider → server | `set_availability` `{ status }`, `booking_alert_received` `{ bookingId }` | |
| server → provider | `new_booking_request`, `new_job_assigned`, `booking_taken`, `removeVendorBooking`, `removeWorkerBooking`, `removePartnerBooking` | |
| server → customer | `booking_accepted`, `booking_updated`, `booking_search_failed`, `payment_success`, `live_location_update`, `notification` | |

### 1.9 Push notifications (FCM)

Register the device token **after every sign-in and on every `onTokenRefresh`**. Remove it on sign-out.

| Role | Register | Body | Remove |
|---|---|---|---|
| Customer (core), restaurant, delivery partner, taxi driver, taxi-token customer | `POST /api/v1/fcm-tokens/mobile/save` | `{ "token": "<fcm token>" }`. **Do not send `platform`**: this endpoint answers 400 if it is present. | `DELETE /api/v1/fcm-tokens/remove` `{ token, platform: "mobile" }` |
| QC store seller or rider (QC token) | `POST /api/v1/qc/fcm-tokens/mobile/save` | same | `DELETE /api/v1/qc/fcm-tokens/remove` |
| SP customer | `POST /api/v1/sp/users/fcm-tokens/save` | `{ "fcmToken": "...", "platform": "android" \| "ios" }` | (sent with logout) |
| SP vendor | `POST /api/v1/sp/vendors/fcm-tokens/save` | same | |
| SP worker | `POST /api/v1/sp/workers/fcm-tokens/save` | same | |

- The core login endpoints (`/auth/user/verify-otp`, `/auth/user/email/login`, social sign-in) also accept `fcmToken` and `platform: "mobile"`, and register the token for you. SP login and verify-login accept `fcmToken`/`platform` too.
- One customer in the super app has a core identity and, after first SP use, an SP identity. **Register the token with both** `/v1/fcm-tokens/mobile/save` and `/v1/sp/users/fcm-tokens/save`, or SP booking pushes will not arrive.
- `POST /api/v1/fcm-tokens/test` sends a test push to the caller. Use it on the settings screen in debug builds.
- Payloads carry a `data.type` (for example `new_order`, `order_cancelled`, `stock_low`, `stock_out`) and often `data.link`. Route taps on `type`. See the stock guide for the store alerts.
- SOS alerts and admin broadcasts also arrive by FCM.

### 1.10 Razorpay

The flow is the same in every vertical:

1. **Create.** The app asks the backend to create an order. The backend creates the Razorpay order and returns the order id, the amount in paise, and the **key id**. Never embed the key secret in the app.
2. **Checkout.** Open `razorpay_flutter` with `key`, `order_id`, `amount` and the prefill.
3. **Verify.** Send the three values from the success callback to the vertical's verify endpoint. **The order is only paid after verify returns success.** Never mark it paid from the client callback alone.
4. **Webhooks** (`payment.captured`, `refund.processed`, `refund.failed`) go to `POST /api/v1/payments/webhook/razorpay` and are handled on the server. They are a backstop for apps killed mid-payment. The app does nothing with them, but should re-fetch the order when it returns to the foreground.

| Vertical | Create | Key field in response | Verify | Verify body |
|---|---|---|---|---|
| Food | `POST /food/orders` with `paymentMethod: "razorpay"` | `data.razorpay.key`, `data.razorpay.orderId`, `data.razorpay.amount` | `POST /food/orders/verify-payment` | `{ orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }` (camelCase) |
| QC | `POST /qc/orders` (same shape as food) | same | `POST /qc/orders/verify-payment` | same. `DELETE /qc/orders/:orderId/pending-payment` abandons an unpaid online order. |
| Taxi ride (paid after the ride) | `POST /taxi/rides/:rideId/complete-payment/razorpay/order` `{ tipAmount?, rating? }` | `data.keyId`, `data.orderId`, `data.amount` | `POST /taxi/rides/:rideId/complete-payment/razorpay/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature, rating?, comment?, tipAmount? }` (snake_case) |
| SP booking | `POST /sp/payments/create-order` `{ bookingId }` | `data.key`, `data.orderId`, `data.amount` (rupees) | `POST /sp/payments/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` (snake_case; the booking is found from the order) |
| SP provider subscription | `POST /sp/vendors/subscription/create-order` or `POST /sp/workers/subscription/create-order` | see the response | `POST /sp/vendors/subscription/verify-payment` or `POST /sp/workers/subscription/verify-payment` | Razorpay fields |
| Wallets and plans | food `POST /food/user/wallet/topup/order` and `/verify`; taxi `/taxi/users/wallet/razorpay/order` and `/verify`; driver `/taxi/drivers/wallet/top-up/razorpay/order` and `/verify`; delivery partner `/food/delivery/wallet/deposit/order` and `/verify`; SP **customer** plans `/sp/payments/plan/create-order` and `/plan/verify` | | | |

The key field name and the verify body casing differ between verticals (`key`, `keyId`, `razorpay.key`; camelCase or snake_case). Wrap each in its own repository method.

Refunds are started by the server (cancel, return, admin). Food and QC orders expose `payment.refund.status` (`pending`, `processed` or `failed`) and `payment.refund.refundId` (`rfnd_…`). See [flutter-auth-payments-api.md §4](./flutter-auth-payments-api.md#4-refunds-what-the-apps-see). Taxi refunds go to the wallet only.

Supported `paymentMethod` values for a food or QC order: `cash`, `razorpay`, `razorpay_qr` (pay the rider by QR on delivery) and `wallet`.

---

## 2. Customer app

Build in this order. Every path is under `/api`.

### 2.1 Start-up and sign-in

1. `GET /v1/env/public`: Google Maps key and Firebase web config. Mobile normally uses `google-services.json`; use this only if you load the Maps key at runtime.
   Also call `GET /v1/platform/global-settings` (public) and take the currency symbol, phone code, country and time zone from it instead of hard-coding `₹`, `+91` or IST. See [6.8](#68-platform-endpoints-recommendations-and-global-settings).
2. `GET /v1/platform/app-services?lat=&lng=`: which of Food, QC, Taxi and Services to show here. It is public and cached for 30 seconds. **Drive the home tiles from it.** Removed services never appear.
3. `GET /v1/platform/legal/:app/:kind` for the consent screen. `:kind` is `terms` or `privacy`. `:app` is one of `food_user`, `food_restaurant`, `food_delivery`, `qc_user`, `qc_seller`, `qc_rider`, `taxi_user`, `taxi_driver`, `services_user`, `services_provider`. The admin writes the pages per app. The super-app customer app should read `food_user` until a combined customer page exists (ask the backend team).
4. Sign in with phone OTP, email/password, Google or Apple. See [1.4](#14-sign-in-and-tokens). Store both tokens in secure storage.
5. If `needsPhone` is true, call `/v1/auth/user/phone/request-otp` and then `/verify` before the first order.
6. Register FCM ([1.9](#19-push-notifications-fcm)), then connect the root socket.

```http
POST /api/v1/auth/user/verify-otp
{ "phone": "9876543210", "otp": "1234", "fcmToken": "<fcm>", "platform": "mobile" }

200 { "success": true, "message": "Login successful",
      "data": { "accessToken": "…", "refreshToken": "…", "isNewUser": false,
                "user": { "_id": "…", "name": "…", "phone": "9876543210", "needsPhone": false, "role": "USER" } } }
```

### 2.2 Home and profile (shared)

| Screen | Endpoints |
|---|---|
| Profile | `GET/PATCH /v1/food/user/profile`, `POST /v1/food/user/profile/profile-image` (multipart `file`), `GET /v1/auth/user/account` (sign-in methods) |
| Addresses | `GET/POST /v1/food/user/addresses`, `PATCH /v1/food/user/addresses/:id`, `PATCH /v1/food/user/addresses/:id/default` |
| Wallet (food/QC) | `GET /v1/food/user/wallet`, top-up `POST /v1/food/user/wallet/topup/order` and `/verify` |
| My Orders (every service) | `GET /v1/platform/me/orders` |
| Activity / spend | `GET /v1/me/activity`, `GET /v1/me/spend` |
| Notifications inbox | `GET /v1/food/notifications/inbox` |
| Support | `POST /v1/food/user/support/ticket`, `GET /v1/food/user/support/my-tickets` |
| Referrals | `GET /v1/food/user/referrals/stats`, `GET /v1/food/user/referrals/details` |

### 2.3 Food

See [section 7](#7-food-ordering-updates) for the full list. In brief: browse with `/v1/food/restaurant/...`, price with `POST /v1/food/orders/calculate`, place with `POST /v1/food/orders`, verify payment, track over the socket, then rate.

### 2.4 Quick commerce

See [section 6](#6-quick-commerce). Home sections "Popular near you" and "Goes well with" come from the recommendation endpoints in [6.8](#68-platform-endpoints-recommendations-and-global-settings) (food and QC).

### 2.5 Taxi

Details: [flutter-taxi-api.md](./flutter-taxi-api.md).

| Step | Endpoint |
|---|---|
| Vehicle catalogue and tariffs | `GET /v1/taxi/users/vehicle-types`, `GET /v1/taxi/users/set-prices`, `GET /v1/taxi/users/service-locations`, `GET /v1/taxi/users/popular-places` |
| Check pickup is served | `POST /v1/taxi/rides/validate-location` |
| Quote | `POST /v1/taxi/rides/quote` with `pickup`/`drop` as `[lng, lat]`, `stops[]` (up to 5, `{ lat, lng, address }`), `tripType: "one_way" \| "round_trip"`, `returnAt`, `scheduledAt`, `vehicleTypeIds[]` |
| Book | `POST /v1/taxi/rides`: the **same** stops, `tripType` and `returnAt` as the quote, plus `paymentMethod` |
| Track | Socket `ride:join`, then `ride:state`, `ride:status:updated`, `ride:driver-location:updated`, `ride:eta:updated`, `ride:stop:updated`, `ride:tolls:updated`. REST fallback: `GET /v1/taxi/rides/active/me`, `GET /v1/taxi/rides/:rideId`. |
| Bids (bid mode) | `GET /v1/taxi/rides/:rideId/bids`, `POST /v1/taxi/rides/:rideId/bids/:bidId/accept`, `PATCH /v1/taxi/rides/:rideId/bids/ceiling` |
| Cancel | `PATCH /v1/taxi/rides/:rideId/cancel` |
| Safety | `POST /v1/taxi/users/sos`; `POST /v1/taxi/users/sos/:alertId/location` every 10 seconds while the alert is active; `POST /v1/taxi/safety/trip/share { trip_id }` then share `data.url`; trusted contacts at `/v1/taxi/safety/trusted-contacts` |
| Pay | Online: `complete-payment/razorpay/order` and `/verify`. Wallet: `POST /v1/taxi/rides/:rideId/complete-payment/wallet`. Tip: `POST /v1/taxi/rides/:rideId/tip/razorpay/order` and `/verify`. |
| Rate | `PATCH /v1/taxi/rides/:rideId/feedback` |
| History | `GET /v1/taxi/rides?page=&limit=` |
| Taxi wallet | `GET /v1/taxi/users/wallet`, `POST /v1/taxi/users/wallet/razorpay/order` and `/verify` |

Fare display rules:

- Show `fare.total` from the quote. **Never compute a round-trip fare in the app.** The old web `baseFare*1.8` is gone.
- Show these lines when they are non-zero: `returnTripFare`, `roundTripWaitingCharge`, `nightCharge` ("Night charge, included"), `tollChargeAmount` and `distanceChargeAmount` (extra km).

```http
POST /api/v1/taxi/rides/quote
{ "pickup": [75.8843, 22.7282], "drop": [75.8968, 22.7552],
  "stops": [{ "lat": 22.741, "lng": 75.8851, "address": "Palasia" }],
  "tripType": "one_way", "vehicleTypeIds": ["66f…"] }

200 { "success": true, "data": [ { "vehicleTypeId": "66f…", "available": true,
      "fare": { "baseFare": 70, "distanceFare": 236.3, "nightCharge": 0, "total": 388, "tripType": "one_way" },
      "measuredDistanceMeters": 23100, "stopCount": 1, "tripType": "one_way" } ] }
```

### 2.6 Home services (SP)

Details: [flutter-sp-api.md §2–§4](./flutter-sp-api.md#2-booking-customer-app). Use the core customer token on every `/v1/sp/users/...` route.

| Step | Endpoint |
|---|---|
| Catalogue | `GET /v1/sp/public/categories`, `GET /v1/sp/public/services`, `GET /v1/sp/public/home-data`, `GET /v1/sp/public/config` |
| Cart (optional) | `/v1/sp/users/...` cart routes |
| Choose a provider (optional) | `GET /v1/sp/users/providers?categoryId=&lat=&lng=&date=&time=` |
| Book | `POST /v1/sp/users/bookings` with optional `addOns[]` and `preferredProviderId` |
| Quote categories (`isConsultancy: true`) | `POST /v1/sp/users/quotes/requests`, then `GET /v1/sp/users/quotes/requests/:bookingId`, then `POST /v1/sp/users/quotes/:quoteId/accept` |
| Track | Socket `/sp`, `join_tracking`, `booking_updated`, `live_location_update` |
| Details | `GET /v1/sp/users/bookings/:id`, including `workPhotos.before[]` / `after[]`, `addOns`, `preferredOffer` and `invoiceNumber` |
| Pay | `POST /v1/sp/payments/create-order { bookingId }`, then `POST /v1/sp/payments/verify`; or `POST /v1/sp/payments/wallet`, or `/pay-at-home` |
| Invoice | `GET /v1/sp/users/bookings/:id/invoice` returns a PDF (`application/pdf`). It answers 400 until the work is done. |
| Cancel, reschedule, review | `POST /v1/sp/users/bookings/:id/cancel`, `PUT /:id/reschedule`, `POST /:id/review` |

---

## 3. Driver app (taxi drivers and delivery partners)

### 3.1 Two identities, one person

- A **taxi driver** is a `Driver` (taxi token, role `driver`).
- A **food/QC delivery partner** is a `FoodDeliveryPartner` (core token, role `DELIVERY_PARTNER`).
- When the unification backfill has linked the two (`partner.driverId`) and the partner is approved, the server accepts the **delivery-partner token on `/v1/taxi/*` and on the taxi socket**, and treats it as the linked driver. A partner token for an unlinked partner is refused by taxi as before.
- **One driver, one job feed (SOW plan §8) is built, behind the `UNIFIED_DISPATCH_ENABLED` flag (off by default).** The full contract is in [flutter-taxi-api.md, "Unified jobs"](./flutter-taxi-api.md#13-unified-jobs-one-driver-for-rides-and-deliveries-sow-plan-8). In short:
  - Sign the driver in once with the **taxi** login. Listen on the taxi socket (root namespace, room `driver:<id>`) for `job:offer` and `job:cancelled`. Each carries `jobType`: `taxi`, `food` or `quick_commerce`, and one normalised shape (pickup, drop, earning, cash to collect, distance, expiry, and how to accept).
  - Rides are accepted as today (socket `acceptRide`). For a food or grocery job, call `POST /api/v1/taxi/drivers/jobs/delivery-session` once to get a delivery-partner token for the driver's own linked delivery record, then run the job with the delivery endpoints in [3.3](#33-delivery-partner-flow-food-qc-mirrors-it-under-v1qcdelivery) (`PATCH /v1/food/delivery/orders/:id/accept`, and so on; QC orders use the same paths).
  - `GET /api/v1/taxi/drivers/jobs/active` lists every job the driver holds (rides and deliveries). Call it on start-up and after a reconnect to restore the screen.
  - A driver holds **one job at a time** across all three. `PATCH /work-mode` (`all`, `taxi`, `delivery`) decides which streams they are offered.
  - Keep handling the old per-vertical events (`rideRequest`, and `new_order` on the delivery socket) while the flag is off, and for delivery-only partners, who keep using the delivery app flow in 3.3 unchanged.
- Until the flag is on for the driver's zone, `job:offer` never arrives. Build the app so it works both ways: the unified card when `job:offer` arrives, the two existing modes otherwise.

### 3.2 Taxi driver flow

All under `/api/v1/taxi/drivers` unless stated.

| Step | Endpoint |
|---|---|
| Sign in | `POST /auth/send-otp { phone }`, then `POST /auth/verify-otp`, which returns `data.token` and `data.driver` |
| Sign up (onboarding) | `POST /onboarding/send-otp`, `/onboarding/verify-otp`, `PATCH /onboarding/personal`, `/onboarding/referral`, `/onboarding/vehicle`, `/onboarding/documents` (base64 data URLs), then `POST /onboarding/complete`. Resume with `GET /onboarding/session/:registrationId`. Templates: `GET /document-templates`, `GET /vehicle-field-templates`, `GET /service-locations`. |
| Pending review | New drivers are now always `approve: false, status: "pending"`. Poll `GET /approval-status`. `GET /me` works while pending. Other routes return 403 until approved. |
| Documents | `PATCH /documents/:documentKey` (allowed while pending) |
| Go online or offline | `PATCH /online`, `PATCH /offline`, `PATCH /work-mode` |
| Offers | Socket `rideRequest` (shows `stops`, `tripType`, `returnAt`). Reply with `acceptRide` or `rejectRide`, or REST `POST /rides/:rideId/decline`. |
| Trip | Socket `ride:status:update` (`arriving`, then `arrived` at pickup, then `started` with `otp`, then `completed`). Send `ride:driver-location:update` continuously. |
| Stops | `POST /rides/:rideId/stops/:order/reached` or socket `ride:stop:reached` |
| Tolls | Upload the receipt (`POST /v1/taxi/common/upload/image`, field `image`, `folder=toll-receipts`), then `POST /rides/:rideId/tolls { amount, receiptPhotoUrl }` |
| Navigation | A Google Maps `dir/?api=1&destination=<lat>,<lng>&waypoints=…&travelmode=driving` link. `waypoints` lists only the stops not yet reached, as `lat,lng` pairs separated by `%7C` (a URL-encoded pipe). See [taxi doc §1](./flutter-taxi-api.md#1-multiple-stops-41). |
| Collect payment | `POST /payments/qr`, `GET /payments/qr/status` |
| Cancel | `POST /rides/:rideId/cancel`; scheduled rides `GET /scheduled-rides`, `POST /scheduled-rides/:rideId/cancel` |
| SOS | `POST /sos`, then `POST /sos/:alertId/location` every 10 seconds. Contacts: `GET/POST/DELETE /emergency-contacts`. |
| Wallet and earnings | `GET /wallet`, `POST /wallet/top-up/razorpay/order` and `/verify`, `POST /wallet/withdrawals`, `GET /incentives`, `GET /incentives/ladder/current`, `POST /incentives/claim` |
| Profile | `GET/PATCH /me`, `PATCH /vehicle`, `POST /me/delete-request` |

Round trip: the driver taps **Arrived** at the destination, waits, drives back, then completes. The whole trip is traced.

### 3.3 Delivery partner flow (food; QC mirrors it under `/v1/qc/delivery`)

All under `/api/v1/food/delivery` unless stated.

| Step | Endpoint |
|---|---|
| Sign in | `POST /v1/auth/delivery/request-otp`, then `POST /v1/auth/delivery/verify-otp`. Returns core tokens. |
| Sign up | `GET /onboarding/options`, `GET /onboarding/requirements`, `GET /check-vehicle/:number`, then `POST /register` (multipart). **New: `vehicleRcPhoto` (file or URL) and `vehicleRcNumber` are required for every motorised `vehicleType` (anything except bicycle/cycle).** Without them the server returns 400. |
| Availability | `PATCH /availability` |
| Orders | `GET /orders/available`, `GET /orders/current`, `PATCH /orders/:id/accept`, `PATCH /orders/:id/reject`, `PATCH /orders/:id/reached-pickup`, `PATCH /orders/:id/confirm-pickup`, `POST /orders/:id/bill-photo`, `PATCH /orders/:id/reached-drop`, `POST /orders/:id/verify-drop-otp`, `PATCH /orders/:id/complete` |
| Route | `GET /orders/:id/route`. Navigate with a Google Maps `dir/?api=1&destination=…` link, not a search query (SOW 4.10). |
| Collect | `POST /orders/:id/collect/qr`, `GET /orders/:id/payment-status`, `POST /orders/:id/collect/cash` |
| Live location | Socket `update-location`; `resync` after reconnect |
| Wallet and earnings | `GET /wallet`, `POST /wallet/withdraw`, `POST /wallet/deposit/order` and `/verify`, `GET /earnings`, `GET /trip-history`, `GET /pocket-details`, `GET /cash-limit`, `GET /incentives/current`, `GET /earning-addons/active` |
| Profile | `PATCH /profile` (`vehicleRcPhoto` can be updated here too), `PATCH /profile/bank-details`, `DELETE /profile/account` |
| Help | `GET/POST /support-tickets`, `GET/POST /order-emergency-requests`, `GET /emergency-help` |

**Proof-of-delivery photo** (QC 5.4, `dropProof { photoUrl, lat, lng, at }` at completion, required when there is no OTP) applies to quick-commerce orders only. See [6.5](#65-proof-of-delivery-delivery-app).

---

## 4. Service Provider app (vendors and workers)

Details: [flutter-sp-api.md](./flutter-sp-api.md). Prefix: `/api/v1/sp`. Use `/vendors/...` or `/workers/...` for the signed-in role. The admin setting `bookingModel` decides whether jobs go to vendors or to workers.

| Step | Vendor | Worker |
|---|---|---|
| Sign in | `POST /vendors/auth/send-otp { phone }`, then `POST /vendors/auth/verify-login { phone, otp }`. Existing account: `accessToken` and `refreshToken` at the top level. New account: `isNewUser: true` and a `verificationToken`. | same under `/workers/auth` |
| Register | `POST /vendors/auth/register { name, phone, email, aadhar (12), pan (10), verificationToken, aadharDocument, aadharBackDocument, panDocument, otherDocuments[] }`, with documents as data URLs | `POST /workers/auth/register` |
| Pending | A pending (or rejected) vendor gets a limited **onboarding token**: verify-login answers 200 with `vendor.adminApproval`, `tokenScope: "onboarding"`, `onboardingToken` and `onboardingRefreshToken` (no `accessToken`). It works only on onboarding, bank details, email OTP, availability, `POST /upload`, profile read and logout; other vendor routes return 403 `ONBOARDING_ONLY`. Show "Under review" with the checklist. After approval, `POST /vendors/auth/refresh-token` with the onboarding refresh token returns a full token (`tokenScope: "full"`). See `flutter-sp-api.md` section 1. | Pending workers do get a token and can complete onboarding. |
| Onboarding | `GET/PUT /vendors/onboarding` (GST, certifications, categories), `PUT /bank-details`, `POST /email/send-otp`, `POST /email/verify` | same, plus worker `pan` and `serviceRadiusKm` |
| Availability | `GET/PUT /availability`, `POST /availability/overrides`, `DELETE /availability/overrides/:date` | same |
| Subscription | `GET /vendors/subscription/plans`, `GET /vendors/subscription/status`, `POST /vendors/subscription/create-order`, then Razorpay, then `POST /vendors/subscription/verify-payment` | same under `/workers/subscription`, plus `POST /workers/subscription/activate` |
| Incoming jobs | Socket `/sp`: `new_booking_request`. REST: `GET /vendors/bookings/pending`. Accept with `POST /vendors/bookings/:id/accept`, reject with `/reject`. | `GET /workers/jobs/pending-requests`, `PUT /workers/jobs/:id/respond` |
| Assign to a worker | `POST /vendors/bookings/:id/assign-worker` | — |
| Do the job | `POST /vendors/bookings/:id/self/start`, then `/self/reached`, then `/self/visit/verify { otp, location, beforePhotos? }`, then `/self/photos`, then `/self/complete { afterPhotos? }`, then `/self/payment/collect` | `POST /workers/jobs/:id/start`, then `/reached`, `/visit/verify`, `/photos`, `/complete`, `/payment/collect`; bill `POST/GET /workers/jobs/:id/bill` |
| Quotes | `GET /vendors/quotes/requests`, `POST /vendors/quotes/requests/:bookingId`, `POST /vendors/quotes/:quoteId/withdraw` | same under `/workers/quotes` |
| Earnings and wallet | Vendor dashboard routes, `POST /vendors/withdraw` (bank details optional; the saved ones are used) | `GET /workers/dashboard/earnings?period=daily\|weekly\|monthly`, `GET /workers/stats`, `POST /workers/wallet/withdraw` |
| Upload | `POST /image/upload` (multipart `file`, **signed in**), which returns `imageUrl` | same |

Work-photo example:

```http
POST /api/v1/sp/workers/jobs/66b…/photos
{ "phase": "before", "photos": ["https://…/b1.jpg"], "lat": 18.52, "lng": 73.85 }

200 { "success": true, "message": "1 before photo(s) saved", "data": { "workPhotos": { "before": [ { "url": "…", "lat": 18.52, "lng": 73.85, "uploadedAt": "…" } ], "after": [] } } }
```

---

## 5. Restaurant and store partner app

The React web panel covers restaurants and stores today. The existing Flutter partner app (`quickdrop_restaurant`) switches between food and QC paths with `SellerVertical.resolvePath` (`/food/...` to `/qc/...`). A new or updated app needs the following.

| Area | Food (`/api/v1/food/restaurant`) | QC store (`/api/v1/qc/restaurant`) |
|---|---|---|
| Sign in | `POST /v1/auth/restaurant/request-otp`, then `/verify-otp` (core tokens). Email OTP sign-in for existing outlets: `/v1/auth/restaurant/email/request-otp` and `/verify-otp` (SOW 6.5, see [7.2](#72-restaurant-partner-app)). | `POST /v1/qc/auth/restaurant/request-otp`, then `/verify-otp`. Seller sign-up and onboarding at `/v1/qc/partner/...`. |
| Register | `POST /register`, `POST /upload-attachment`, GST check `POST /gst/verify` (public, SOW 6.4); optional `firstItems` / `menuSheet` menu step (SOW 6.6) | QC partner flow |
| Profile and hours | `GET /current`, `PATCH /profile`, `PATCH /availability`, `GET/PUT /outlet-timings`, `GET/PUT /service-radius`, `GET/PUT /tax-settings`, media `/media/...` | same paths |
| Menu | `GET/PATCH /menu`, categories `/categories`, items `POST /foods` and `PATCH /foods/:id`, add-ons `/item-extras` (alias of `/addons`), combos `/combos`, bulk `/bulk-upload` (template `/bulk-upload/template`) | same, plus **stock**: `GET/PATCH /stock`, `POST /stock/bulk`, `GET /stock/history` ([stock guide](./flutter-stock-and-cancel-guide.md)) |
| Orders | `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/resend-notification`. Socket `new_order`, `order_status_update`. | same on `/qc`, plus `GET /orders?fulfilmentType=pickup` and pickup hand-over `POST /orders/:orderId/pickup/verify { otp }` ([6.3](#63-self-pickup)) |
| Offers | `/my-offers` (alias `/my-deals`), `/freebie-offer`, `/bogo-offer` | |
| Money | `GET /finance`, `POST /withdraw`, `GET /withdrawals`, `GET /commission`, settlements `GET /settlements`, `/settlements/:cycleId`, `/settlements/:cycleId/download` (SOW 6.3) | subscription `GET /subscription/overview`, `/subscription/invoices`, `/subscription-history` |
| Reports | `GET /analytics/sales?from&to&groupBy` (alias `/insights/sales`), `GET /reports?type&format&from&to` (CSV/PDF file) (SOW 6.1–6.2) | `GET /analytics` (now with new/returning/repeat and top customers, SOW 5.9). No `/reports`, `/analytics/sales` or `/settlements` yet: they return 404 on `/qc`. |
| Support | `GET /complaints`, `POST/GET /support/tickets` | |
| Push | `POST /v1/fcm-tokens/mobile/save` (QC: `/v1/qc/fcm-tokens/mobile/save`). Handle `new_order`, `order_cancelled`, `stock_low` and `stock_out` taps. | |

Dining and table reservations are removed. Drop any dining tab or settings screen.

---

## 6. Quick commerce

Full payloads and error messages: [flutter-qc-api.md](./flutter-qc-api.md). Everything in SOW §5 is committed (commit `6b31463`) and backward compatible: old request bodies still work and new response fields are only added.

### 6.1 Basics and build order

**Prefix and identity.**

- Everything is under `/api/v1/qc`. It is a fork of the food module, so the sub-paths mirror food: `/qc/restaurant` (stores), `/qc/orders`, `/qc/user`, `/qc/delivery`, `/qc/search`, `/qc/uploads`, `/qc/payments`, `/qc/notifications`, `/qc/chat`. QC-only paths are `/qc/partner` (seller onboarding), `/qc/returns` (customer returns), `/qc/loyalty` and `/qc/products/by-barcode/:code`.
- Public settings: `/qc/admin/business-settings/public`, `/power-scanning/public`, `/feature-settings/public`, `/fee-settings/public`, `/cashback-settings/public`, `/restaurant-subscription-settings/public`.
- The customer uses the **core** token. QC links its own profile on first use. Sockets are on the `/qc` namespace, with the same event names as food.
- Shared features live under `/api/v1/platform`: FAQs, delivery slots, loyalty for food customers, recommendations and global settings.

**Ordering contract (unchanged from food).** `POST /qc/orders/calculate`, then `POST /qc/orders` (10-second idempotency window), then `POST /qc/orders/verify-payment`. Call `DELETE /qc/orders/:orderId/pending-payment` when the Razorpay sheet is dismissed. Also `GET /qc/orders`, `GET /qc/orders/:orderId`, `/drop-otp`, `/route`, `/payments`, `PATCH /:orderId/cancel`, `/ratings`, `/instructions`. Returns are at `/qc/returns` and are refunded through the gateway (`payment.refund.status`). Pricing is shared with food: render `pricing.bill`, never sum it.

**Stock (stores).** Live. `stockQty: null` means not counted, `0` means sold out and hides the product. Pushes `stock_low` and `stock_out`. See [flutter-stock-and-cancel-guide.md](./flutter-stock-and-cancel-guide.md).

**Removed: medical/pharmacy (D2).** Prescription orders, uploads, requests and broadcasts; drug-licence and pharmacy verification; the medical tile and medical partner sign-up. Pharmacy stores are hidden and refuse orders. No order is numbered `MED-` again.

**Customer app screens, in build order** (paths under `/api/v1/qc` unless they start with `/v1/platform`):

| # | Screen | Endpoints |
|---|---|---|
| 1 | Home | `GET /v1/platform/recommendations/popular?vertical=quickCommerce&lat=&lng=` ([6.8](#68-platform-endpoints-recommendations-and-global-settings)) |
| 2 | Search box | `GET /search/suggest?q=`, `GET/POST/DELETE /search/recent`, then `GET /search/products?q=` ([6.6](#66-search-suggestions-recent-searches-and-barcode)) |
| 3 | Barcode scan | Scan on the device, then `GET /products/by-barcode/:code?zoneId=` |
| 4 | Product sheet and cart | `GET /v1/platform/recommendations/together?vertical=quickCommerce&itemId=` ("Goes well with"); cart lines carry `storeId` ([6.2](#62-multi-store-cart-and-parent-orders-mso-)) |
| 5 | Checkout: delivery or pickup | `fulfilmentType: "delivery" \| "pickup"` ([6.3](#63-self-pickup)) |
| 6 | Checkout: slot picker | `GET /v1/platform/delivery-slots/available?vertical=quickCommerce&zoneId=&days=3`, then `scheduledAt` + `slotId` ([6.4](#64-delivery-slots-and-scheduledat)) |
| 7 | Checkout: points | `GET /loyalty/me`, `GET /loyalty/quote?points=&orderValue=`, then `loyaltyPoints` on calculate and place ([6.7](#67-loyalty-points-and-faqs)) |
| 8 | Pay and place | `POST /orders/calculate`, `POST /orders`, `POST /orders/verify-payment` (parent id for multi-store) |
| 9 | Orders list and detail | `GET /orders?groupByParent=true`, `GET /orders/parent/:parentId`, `GET /orders/:orderId` (shows `pickupOtp`, `deliverySlot`, `dropProof`) |
| 10 | Help | `GET /v1/platform/faqs?vertical=quickCommerce` |

### 6.2 Multi-store cart and parent orders (`MSO-`)

- A basket may hold items from **up to 5 stores**. Put `storeId` on every line. A single-store basket is placed exactly as before (one order, no parent; `restaurantId` still works).
- Two or more stores create one **parent order** (`MSO-…`) that holds the single payment and the single coupon, plus one **child order** (`FOD-…`) per store. Each child has its own store acceptance, rider, tracking, OTP, cancellation and refund. Track, cancel and rate children with the normal `/orders/:orderId/...` routes.
- **Delivery fee:** the customer pays **one** fee, the highest fee any single store would charge (0 for pickup), split between the stores by item value. The platform fee is charged once and split the same way. The coupon is checked once against the whole basket. Loyalty points are redeemed once and split after the coupon.
- **Express is not offered on multi-store baskets.** Every child is priced as `basic`; hide the `quick` option when the cart has more than one store.
- Quote: `POST /orders/calculate` returns `isMultiStore: true`, `stores[]` (each with its own `pricing`) and a combined `pricing`.
- Place: `POST /orders` returns `order` (the parent view, with `children[]` and each child's `parentSplit`), `orders` (the children) and one `razorpay` object. Cash: each rider collects that child's total. Wallet: debited once for the parent total.
- Verify with the **parent** id (Mongo id or `MSO-` number): `POST /orders/verify-payment`. Abandon with `DELETE /orders/<parentId or MSO->/pending-payment`.
- If one store cannot take its part, the whole checkout is refused with that store's message and nothing is charged.
- Lists: `GET /orders?groupByParent=true` returns one entry per checkout; `GET /orders/parent/:parentId` returns the parent with all children; a child's `GET /orders/:orderId` adds `parentOrder { …, siblings[] }`.
- Cancel per child with `PATCH /orders/:childId/cancel`. The refund is that child's total only.

```http
POST /api/v1/qc/orders/calculate
{ "items": [ { "itemId": "66f…a1", "name": "Rice 5kg", "price": 300, "quantity": 1, "storeId": "66e…01" },
             { "itemId": "66f…b2", "name": "Milk 1L",  "price": 100, "quantity": 1, "storeId": "66e…02" } ],
  "deliveryAddress": { "location": { "coordinates": [75.88, 22.73] } },
  "couponCode": "SAVE40", "fulfilmentType": "delivery" }

200 { "success": true, "data": { "isMultiStore": true, "stores": [ { "storeId": "66e…01", "pricing": { "deliveryFee": 22.5, "…": "…" } }, { "…": "…" } ],
      "pricing": { "subtotal": 400, "deliveryFee": 30, "discount": 40, "total": 401, "splitBasis": "subtotal" } } }
```

### 6.3 Self-pickup

- Send `"fulfilmentType": "pickup"` to `/orders/calculate` and `/orders`. No delivery fee and no rider; `address` is optional.
- The place-order response and the customer's `GET /orders/:orderId` carry a 4-digit `pickupOtp` until the order is collected. Show it on the order screen. It is never sent to the store or riders.
- **Store app:** list with `GET /qc/restaurant/orders?fulfilmentType=pickup`. After accepting and packing, the store enters the customer's code with `POST /qc/restaurant/orders/:orderId/pickup/verify { "otp": "4821" }`, and the order becomes `delivered` (cash is marked paid at the counter). Five wrong codes lock it; support can still close the order.

### 6.4 Delivery slots and `scheduledAt`

- Admins configure slots per zone with a daily capacity. `GET /api/v1/platform/delivery-slots/available?vertical=quickCommerce&zoneId=<zone>&days=3` (public) returns `slotsEnabled` and `days[].slots[]` with `slotId`, `label`, `startTime`, `endTime`, `scheduledAt`, `capacity`, `remaining`, `available`.
- `slotsEnabled: false` means the zone has no slots: let the customer pick any time, as before. Otherwise only offer slots with `available: true`.
- Place with `"scheduledAt": "<slot.scheduledAt>"` and, optionally, `"slotId"`. A full or closed slot returns 400 with a message to show. The order carries `scheduledAt` and `deliverySlot { slotId, date, startTime, endTime, label }`; a cancel frees the place.
- Rider search starts `orders.scheduledDispatchLeadMinutes` (default 30) before the slot.

### 6.5 Proof of delivery (delivery app)

The delivery app keeps using the **food** rider endpoints (`/api/v1/food/delivery/...`); QC orders appear in the same lists with `vertical: "quickCommerce"`, `storeName`, `pickList[]`, `scheduledAt`, `deliverySlot`, `contactlessDelivery` and `parentOrderId`. Show "Store" instead of "Restaurant" and the pick list at pickup. Pickup orders are never offered to riders, and scheduled orders only from the rider-search time.

The drop photo is **required** when the handover code is not used: the admin turned `delivery.dropOtpRequired` off, or the customer chose `contactlessDelivery: true` at checkout. Otherwise it is optional.

1. Upload: `POST /api/v1/uploads/image` (multipart `file`, optional `folder=delivery/drop-proof`, rider token). Returns `data.url`.
2. Complete: `PATCH /api/v1/food/delivery/orders/:orderId/complete`.

```http
PATCH /api/v1/food/delivery/orders/FOD-…/complete
{ "dropProof": { "photoUrl": "https://…/drop-proof/abc.webp", "lat": 22.7201, "lng": 75.8801 }, "otp": "1234" }

400 { "success": false, "message": "Take a photo of the delivery to complete it (no handover code on this order)." }
```

The order then carries `dropProof { photoUrl, lat, lng, at }`, which the customer sees in `GET /qc/orders/:orderId`.

### 6.6 Search suggestions, recent searches and barcode

| Purpose | Endpoint | Token |
|---|---|---|
| Type-ahead | `GET /qc/search/suggest?q=mil&limit=10&zoneId=` returns `suggestions[]` (`type`: `product`, `category` or `brand`) and, when signed in, `recent[]` | optional |
| Full search | `GET /qc/search/products?q=` | none |
| Recent searches | `GET /qc/search/recent`; `POST /qc/search/recent { "q": "atta" }` when the customer submits; `DELETE /qc/search/recent?term=atta` (no `term` clears all) | customer |
| Barcode | `GET /qc/products/by-barcode/:code?zoneId=` returns `products[]`, one per store, in stock first. `404` when nothing matches. | none |

Voice search and the camera scan run on the device. Store apps can send `barcode` (or `ean`) on product create and update; a wrong check digit returns 400.

### 6.7 Loyalty points and FAQs

**Loyalty** is **off by default** (Master setting `loyalty.enabled`). When on, customers earn points on delivered orders and redeem them at checkout. Points belong to the one platform account, so points earned on QC can be spent on food and the other way round.

| | QC customer | Food customer |
|---|---|---|
| Balance, rules, history | `GET /api/v1/qc/loyalty/me` | `GET /api/v1/platform/loyalty/me` |
| What a basket may redeem | `GET /api/v1/qc/loyalty/quote?points=200&orderValue=450` | `GET /api/v1/platform/loyalty/quote?…` |
| Redeem | `"loyaltyPoints": <n>` on `/qc/orders/calculate` and `/qc/orders`. The server caps it at the balance and `maxRedeemPercent`; read the applied `pricing.loyaltyPoints` and `pricing.loyaltyDiscount`. | **Not yet**: food checkout ignores `loyaltyPoints` ([section 11](#11-known-gaps-and-doccode-mismatches)). Show the balance only. |

When `enabled` is false in `/loyalty/me`, hide the points row at checkout. Cancelling an order that used points returns them.

**FAQs.** `GET /api/v1/platform/faqs?vertical=quickCommerce&category=&includeGeneral=true` (public). `vertical` is `quickCommerce` (or `quick`), `food`, `taxi`, `serviceProvider`, `delivery`, `store` or `general`. The response has a flat `faqs[]` and grouped `categories[]`. Every app's Help screen can use it with its own `vertical`.

### 6.8 Platform endpoints: recommendations and global settings

Full payloads: [flutter-platform-api.md](./flutter-platform-api.md). All under `/api/v1/platform`.

| Endpoint | Token | Where the apps use it |
|---|---|---|
| `GET /recommendations/popular?vertical=food\|quickCommerce&lat=&lng=&limit=10` | public | Customer app home: a "Popular near you" row for food and QC. `scope: "all"` means no local data, so the list is service-wide. |
| `GET /recommendations/together?vertical=food\|quickCommerce&itemId=&limit=10` | public | Customer app item sheet and cart: "Goes well with". `itemId` is the order line's `itemId`. |
| `GET /recommendations/demand?vertical=food\|quickCommerce\|taxi&zoneId=&hours=12` | any signed-in role | Driver app: suggest where to wait (busiest zone first). |
| `GET /global-settings` | public | Every app at start-up, before sign-in: `currencySymbol`, `currencyCode`, `phoneCode`, `countryCode`, `timezone`. `null` delivery and schedule values mean "use the service default". |

The recommendation data is computed nightly (after 02:00 IST). Until the first run the lists are empty: **hide the row, do not show an error.** Admin broadcasts now also reach taxi drivers and SP vendors and workers (push `data.type = "admin_broadcast"` and an inbox row with `source: ADMIN_BROADCAST`).

---

## 7. Food ordering updates

Full payloads: [flutter-food-api.md](./flutter-food-api.md) (SOW §6) and [flutter-integration.md](./flutter-integration.md) (menu and checkout). Everything below is committed.

### 7.1 Customer app

All under `/api/v1/food`, customer token unless marked public. Build in this order:

| Purpose | Endpoint |
|---|---|
| Landing settings (includes `ninetyNineStoreMaxPrice`, never null) | `GET /landing/settings/public` |
| Banners | `GET /hero-banners/public`, `/hero-banners/under-250/public`, `/hero-banners/home-promotion/public`, `/hero-banners/gourmet/public`, `/explore-icons/public` |
| Zone detection | `GET /zones/detect` |
| Home recommendations | `GET /api/v1/platform/recommendations/popular?vertical=food&lat=&lng=` ([6.8](#68-platform-endpoints-recommendations-and-global-settings)) |
| Restaurant list and detail | `GET /restaurant/restaurants`, `GET /restaurant/restaurants/:id` (both carry `freeDeliveryRule`, `freeDeliverySource`, `freeDeliveryOffer`) |
| Menu | `GET /restaurant/restaurants/:id/menu`, `/restaurants/:id/addons`, `/restaurants/:id/reviews`, `/restaurants/:id/outlet-timings` |
| Cross-restaurant dish feed | `GET /restaurant/public/foods` (`promo=switch99` for the ₹99 shelf, which the server filters) |
| Offers and categories | `GET /restaurant/offers`, `GET /restaurant/categories/public` |
| Search | `GET /search/unified?q=` |
| Fees | `GET /admin/fee-settings/public`, `/admin/business-settings/public`, `/admin/cashback-settings/public` |
| "Goes well with" | `GET /api/v1/platform/recommendations/together?vertical=food&itemId=` |
| Price the cart | `POST /orders/calculate` returns `pricing` with `bill`, `deliveryFeeBreakdown` and `adjustments[]` |
| Place | `POST /orders` (`paymentMethod`, `tip`, `couponCode`, `zoneId`, …). A 10-second idempotency window covers double taps. |
| Verify payment | `POST /orders/verify-payment` |
| List and detail | `GET /orders`, `GET /orders/:orderId` (includes `cancellation { allowed, until, secondsLeft, reason }`) |
| Track | Socket `join-tracking`, `order_status_update`, `location-update`; `GET /orders/:orderId/route`; `GET /orders/:orderId/drop-otp` |
| Cancel | `PATCH /orders/:orderId/cancel`, subject to the admin cancel window; show the 400 message as-is |
| Rate and instructions | `PATCH /orders/:orderId/ratings`, `PATCH /orders/:orderId/instructions` |
| **Invoice PDF** (SOW 6.7) | `GET /orders/:orderId/invoice` (`FOD-…` or Mongo id) returns `application/pdf`, filename `invoice-<orderId>.pdf`. Only once delivered: before that it returns **409** "The invoice is available once the order has been delivered". Show the button only on delivered orders. |
| Loyalty balance | `GET /api/v1/platform/loyalty/me` (redeem at food checkout is not wired yet) |
| Help | `GET /api/v1/platform/faqs?vertical=food` |
| Favourites | `GET /user/favorites`, `POST /user/favorites/restaurants/:id`, `POST /user/favorites/foods/:id` |
| Refund history | `GET /user/refunds` |

Already required by [flutter-integration.md](./flutter-integration.md): per-size `minOrderQuantity` / `maxOrderQuantity` (each inherits on its own; `0` max means no cap), combos (`isCombo`, `comboComponents[]`), free delivery by distance (`deliveryFeeBreakdown.freeDeliveryReason`, `waivedDeliveryFee`), the live `ninetyNineStoreMaxPrice` (never hard-code 99), and the itemised `pricing.bill` with platform-fee GST, `tip` and `roundOff` (show `grandTotal` as given). That document's examples use the old host `https://quickdropsindia.com/api/v1`; use the hosts in [1.2](#12-hosts-and-base-urls).

**Removed:** dining and table reservations (module, banners, public routes and screens).

### 7.2 Restaurant partner app

All under `/api/v1/food`. These exist **only for food**: on `/qc/restaurant` the reports, sales analytics and settlement routes return 404, so show "not available" for stores.

| Feature | Endpoint | Notes |
|---|---|---|
| Email sign-in (SOW 6.5) | `POST /auth/restaurant/email/request-otp { email }`, then `POST /auth/restaurant/email/verify-otp { email, otp, fcmToken?, platform? }` (also on `/api/v1/auth/...`) | Existing outlets only; new outlets register by phone. Same response as phone verify-otp (tokens, or `pendingApproval`). `409 EMAIL_MULTIPLE_OUTLETS`: ask for the phone number. The request answer is the same whether or not the email exists. |
| GSTIN check (SOW 6.4) | `POST /restaurant/gst/verify { gstin, legalName?, panNumber?, state? }` (public, rate limited) | Call when the GSTIN reaches 15 characters. `status`: `verified`, `offline_valid`, `invalid` (registration refuses it), `not_found`, `inactive`, `error` (does not block). Fill blank legal name and address from the result; never overwrite typed values. |
| Menu step at onboarding (SOW 6.6) | `GET /restaurant/bulk-upload/template/blank` (public `.xlsx`); `POST /restaurant/register` with optional `firstItems` (JSON, up to 25) and `menuSheet` (.xlsx) | A bad sheet never fails registration; read `data.menuImport`. |
| Sales analytics (SOW 6.2) | `GET /restaurant/analytics/sales?from&to&groupBy=day\|week\|month` | `series[]` has every bucket, zeros included. `empty: true`: show an empty state, never sample data. |
| Reports (SOW 6.1) | `GET /restaurant/reports?type=orders\|sales\|commission\|gst\|payouts&format=csv\|pdf&from&to` | Returns the file, not JSON. Up to 366 days. |
| Settlements (SOW 6.3) | `GET /restaurant/settlements?limit=6`, `GET /restaurant/settlements/:cycleId`, `GET /restaurant/settlements/:cycleId/download?format=pdf\|csv` | Cycles run from the 15th to the 14th (IST), named by start month (`2026-09`). |

File endpoints set `Content-Type` and `Content-Disposition`; download the bytes, then save or share. On an error they return the usual JSON envelope.

```http
POST /api/v1/food/auth/restaurant/email/request-otp
{ "email": "owner@restaurant.com" }

200 { "success": true, "data": { "message": "If a restaurant uses this email, a sign-in code is on its way.", "codeLength": 6 } }
```

---

## 8. What changed or was removed

### 8.1 Removed features: delete the screens and the calls

| Feature | Decision / commit | Endpoints and fields that are gone | App action |
|---|---|---|---|
| **Bus booking** | §1, `13c692d` | All bus booking, seat-hold, bus-driver and owner-bus routes and the bus-driver role | Remove the bus tile and screens. Remove the bus-driver mode from the driver app. |
| **Seat pooling / shared rides** | §1, `13c692d` | Pooling routes, instant pool groups, shared-ride price fields, "Shared Taxi" and "Cab Sharing" | Remove them. The stops timeline UI is kept and now renders the normal `stops[]`. |
| **Bike / vehicle rental** | §1, `13c692d` | Rental quotes and tracking, the service-centre portal | Remove the rental tile and screens. (`RentalPackageType` remains server-side only for intercity package pricing.) |
| **Ride insurance** | §1, `13c692d` | Insurance plans, the quote insurance options, the completion insurance fee | Remove the insurance toggle and line from quote and checkout |
| **Parcel delivery** | §1, `5a01b47` | `serviceType: "parcel"` and `transport_type: "delivery"` on `/taxi/rides/quote` and `/taxi/rides` now return **400 "Parcel delivery is not available."** Goods types, weight slots, the `Delivery` model, parcel photos, parcel incentive ladders, the `PARCEL` capability and `parcel_vehicle` driver class, and the porter home section and parcel tiles are gone. | Remove every parcel and porter screen and tile. Old parcel rides still appear in ride history as rides. |
| **Fleet owners** | D4, `5a01b47` | The owner role and login, fleet driver and vehicle management, owner wallet, owner reports | Remove owner login and fleet screens. `Driver.owner_id` is unused. |
| **Dining / table booking** | §1, `e2d86db` | Food and QC dining modules, dining banners, `/food/restaurant` dining-settings, the public dining routes | Remove dining tabs (customer and restaurant) |
| **Medical / pharmacy** | D2, `17bb3f4` | Prescription orders and requests, pharmacy verification, the medical zone map, the `medical` app service, medical partner sign-up | Remove the medical tile, prescription upload and pharmacy seller sign-up |
| **Intercity screens** | D3, `02aede7` | The separate intercity booking flow (web screens removed) | Fold into the normal ride flow as **one way / round trip** (`tripType`, `returnAt`). Outstation rates still apply when `transport_type: "intercity"` is sent. `GET /taxi/users/intercity-packages` still exists for package pricing. |

Old enum values (`pooling`, `bus`, parcel fields) are still accepted when old documents are saved, so history screens keep working. **Never send them on new requests.**

### 8.2 Changed behaviour and payloads

| Area | Change | Source |
|---|---|---|
| Uploads | `POST /taxi/common/upload/image` and `POST /sp/image/upload` now **require a token**. Anonymous calls return 401. | `3972719` |
| Taxi rides | New request fields `stops[]` (up to 5, with coordinates), `tripType`, `returnAt` (and `scheduledAt` on the quote). New fare fields `returnTripFare`, `roundTripWaitingCharge`, `nightCharge`, `nightChargeWindow`. New ride fields `stops`, `tripType`, `returnAt`, `tolls`, `tollChargeAmount`, `nightChargeAmount`, `distanceChargeAmount`, `extraDistance`. Anything sent as `additionalCharge` is ignored. | `02aede7`, [taxi doc](./flutter-taxi-api.md) |
| Taxi SOS | One service. `POST /taxi/users/sos` and `POST /taxi/drivers/sos` take `{ rideId, location: { lat, lng } }`. A new location endpoint must be called every 10 seconds. The old `POST /taxi/safety/sos` still works. | `02aede7` |
| Trip share | `POST /taxi/safety/trip/share` now returns `url`. The public `GET /taxi/public/trip/:token` returns 410 when expired. | `02aede7` |
| Driver approval | New drivers default to **pending**, including admin-created ones | `02aede7` |
| Delivery partner signup | **`vehicleRcPhoto` is required** for motorised vehicles. `vehicleRcNumber` is new. | `02aede7` |
| SP work photos | `workPhotos` is now `{ before: [], after: [] }` of `{ url, uploadedAt, uploadedBy, lat, lng }`. **Before photos are required at visit verify and after photos at complete**, per category. | `667a5ed` |
| SP bookings | Optional `addOns[]` and `preferredProviderId`. The response adds `addOns`, `addOnsTotal`, `preferredOffer`, `acceptedQuoteId`, `invoiceNumber`. | `667a5ed` |
| SP withdrawals | `bankDetails` is optional; the saved profile details are used | `667a5ed` |
| SP approval | Admin approval is blocked until the required checklist items are verified | `667a5ed` |
| SP vendor jobs | Vendors need an active subscription to receive jobs, **only when the admin switch is on** (see [10.1](#101-behaviours-behind-admin-switches)) | `016c144`, `667a5ed` |
| SP commission | Bookings of ₹1,000 or less with an active subscription pay 0 commission. Above that, the most specific rule applies to the whole booking (D8). The app only displays it. | `016c144` |
| Customer sign-in | Email/password and Google/Apple added. Phone OTP unchanged. | `521d28d` |
| Refunds | Gateway refunds are tracked: `payment.refund.status` and `payment.refund.refundId` | `521d28d` |
| Food cancel | Admin-set cancel window. `GET /food/orders/:id` carries `cancellation`. | stock and cancel guide |
| Food bill | `pricing.bill` with platform-fee GST, tip and round-off. Tax has decimals. | flutter-integration.md |
| FCM (core) | The unauthenticated `/fcm-tokens/test-set-token` and `/test-get-token` routes are gone. Use `/mobile/save` signed in. | `fcm.routes.js` |
| QC multi-store | Cart lines carry `storeId`. Baskets from 2–5 stores create a parent `MSO-…` order with one payment and one child `FOD-…` order per store. Delivery fee = the **highest single-store fee**, split by item value. No `quick` (express) mode on multi-store. Verify payment with the parent id. | `7d89993`, [6.2](#62-multi-store-cart-and-parent-orders-mso-) |
| QC orders | New optional request fields `fulfilmentType`, `slotId`, `loyaltyPoints`, `contactlessDelivery`, top-level `couponCode`. New response fields `pickupOtp`, `deliverySlot`, `dropProof`, `parentOrderId`, `parentOrder`, `fulfilmentType`. `address` is optional for pickup. | `7d89993` |
| QC scheduled orders | Where a zone has slots, `scheduledAt` must match an open slot with room, or the order is refused (400) | `7d89993`, [6.4](#64-delivery-slots-and-scheduledat) |
| Rider completion | `PATCH /food/delivery/orders/:orderId/complete` takes `dropProof` for QC orders. It is **required** when the handover code is not used (`dropOtpRequired` off, or contactless). QC orders reach riders through the food rider endpoints with `vertical`, `pickList` and `storeName`. | `7d89993`, [6.5](#65-proof-of-delivery-delivery-app) |
| QC products | `barcode` / `ean` accepted on create and update, check digit validated | `7d89993` |
| QC store analytics | `GET /qc/restaurant/analytics` adds new, returning and repeat customers and `topCustomers` (phones masked) | `7d89993` |
| Food restaurant registration | Runs the GSTIN check and refuses an `invalid` GSTIN with 400. Optional `firstItems` / `menuSheet`. | `e106ce3`, [7.2](#72-restaurant-partner-app) |
| Food invoice | `GET /food/orders/:orderId/invoice` (PDF, 409 until delivered) | `e106ce3` |
| Restaurant sign-in | Email OTP for existing outlets | `e106ce3` |
| Admin broadcasts | Now also reach taxi drivers and SP vendors and workers (push `admin_broadcast`, inbox `source: ADMIN_BROADCAST`) | `76d434b` |

### 8.3 New required fields (summary)

| Request | Field | Required when |
|---|---|---|
| `POST /food/delivery/register` | `vehicleRcPhoto` | `vehicleType` is not bicycle or cycle |
| SP `.../visit/verify` | a before photo (in `beforePhotos` or uploaded first via `/photos`) | the category's `requireWorkPhotos` is on (the default) |
| SP `.../complete` | an after photo (`afterPhotos`, legacy `workPhotos`, or `/photos`) | same |
| `POST /taxi/drivers/rides/:id/tolls` | `receiptPhotoUrl`, `amount` (0 < amount ≤ 5,000) | always |
| `POST /taxi/rides` (multi-stop) | each stop needs `lat`/`lng`. Address-only stops are dropped. | when sending stops |
| `POST /taxi/rides` (round trip) | `tripType: "round_trip"`. `returnAt` is optional but must be after arrival and within 7 days. | round trip |
| SP quote accept | `paymentMethod` | always |
| SP `PUT /bank-details` | account + IFSC + holder name, or `upiId` | always |
| `PATCH /food/delivery/orders/:orderId/complete` | `dropProof { photoUrl, lat, lng }` | a QC order where the handover code is not used (`delivery.dropOtpRequired` off, or the customer chose contactless) |
| `POST /qc/orders` (multi-store) | `storeId` on every item | the basket has items from more than one store |
| `POST /qc/orders` (slots) | `scheduledAt` equal to an available slot's `scheduledAt` | scheduling in a zone that has slots |
| `POST /qc/restaurant/orders/:orderId/pickup/verify` | `otp` (the customer's 4-digit code) | always |

---

## 9. Configuration the client must supply

| Item | Who supplies it | Where it goes in the apps | Must match on the backend |
|---|---|---|---|
| **Firebase project** (FCM) | Client (owner of the Firebase project) | `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) for **each** app id. Upload the APNs key to Firebase for iOS push. | `FIREBASE_SERVICE_ACCOUNT` (or `FIREBASE_SERVICE_ACCOUNT_PATH`) and `FIREBASE_PROJECT_ID` on the server, or the Firebase settings in the admin panel, **from the same project**. Otherwise pushes fail silently. |
| **Google Maps key(s)** | Client (Google Cloud billing account) | Android and iOS SDK keys, restricted by package name and SHA-1, or bundle id. Enable Maps SDK, Places, Directions and Distance Matrix. | The server key (admin Map settings, or `GOOGLE_MAPS_API_KEY`) drives quotes, live ETA and routes. Without it, ETA falls back to a straight-line estimate. `GET /api/v1/env/public` exposes the web key. |
| **Razorpay** | Client (Razorpay account, live KYC) | Nothing to embed. The key id comes from each create-order response. | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (or the payment settings in the admin panel). Webhook URL `https://api.quickdoo.in/api/v1/payments/webhook/razorpay` with events `payment.captured`, `refund.processed`, `refund.failed`. Use test keys on staging. |
| **Google Sign-In** | Client (OAuth clients in the same Google Cloud project) | `google_sign_in` with `serverClientId` = the **web** client id. Android client per package name and SHA-1 (debug, release and Play signing). iOS client and reversed client id URL scheme. | Every client id (web, Android, iOS) in **Master settings → Payments & Messages → Google and Apple sign-in**, or `GOOGLE_CLIENT_IDS`. A missing id gives 401 "could not be verified". An empty list gives 503: hide the button. |
| **Apple Sign-In** | Client (Apple Developer account) | Enable "Sign in with Apple" on the bundle id. Use `sign_in_with_apple` with a SHA-256 nonce. | The bundle id (and the web Services ID) in Master settings, or `APPLE_CLIENT_IDS`. Apple requires it on iOS whenever Google sign-in is offered. |
| **App ids and package names** | Flutter team and client | One per app. Decide them before creating the Firebase and OAuth clients. | Listed in Firebase, the OAuth clients and Maps key restrictions |
| **Deep links / web host** | Client (DNS) | `https://quickdoo.in/track-trip/:token` for trip share. Add App Links and Universal Links if the app should open them. | The web host the server uses when building `url` |
| **SMS / OTP** | Client (SMS provider and DLT templates in India) | — | The server SMS provider. Phone OTP, SOS texts and trusted-contact links depend on it. |
| **Email** | Client (SMTP or provider) | — | Email OTP (including restaurant email sign-in), password reset, invoices. Sent through the email queue. |
| **GST verification provider** (optional) | Client (a GSTIN lookup API account) | — | `GST_VERIFY_PROVIDER` (`http`), `GST_VERIFY_URL` (`{gstin}` is replaced), `GST_VERIFY_API_KEY`, optional `GST_VERIFY_AUTH_HEADER`, `GST_VERIFY_TIMEOUT_MS` (default 8000). Without a provider, `POST /food/restaurant/gst/verify` only checks the format and check character and returns `offline_valid`. |
| **Hosts** | Client (DNS, domain hold) | Build flavour or remote config | Live preview `http://187.126.119.13` (API same-origin at `/api`). Production `https://quickdoo.in` and `https://api.quickdoo.in` once the domain hold is lifted; `api.quickdoo.in` proxies the whole path, so the API base is `https://api.quickdoo.in/api`. |
| **Country, currency, time zone** | Admin (Master settings → Global platform) | Read at start-up from `GET /v1/platform/global-settings` | Nothing to embed in the app |

---

## 10. Rollout notes and checklist

### 10.1 Behaviours behind admin switches

Each switch defaults to today's behaviour. The app must handle both states.

| Switch | Where | Default | Effect in the app |
|---|---|---|---|
| `requireWorkPhotos` per SP category | Admin → SP categories | **On** | Before and after photos are required at visit verify and complete (`BEFORE_PHOTOS_REQUIRED` / `AFTER_PHOTOS_REQUIRED`). The photo step should always exist, and be skippable only when the server does not refuse. |
| `isConsultancy` per SP category | Admin → SP categories | Off | The category books through quotes instead of an instant booking |
| `requireVendorSubscription` and `vendorSubscriptionGraceUntil` | SP settings | **Off** | When on, vendors without an active subscription stop receiving jobs (after the grace date). The vendor app must show the subscription state and a "Subscribe" call to action. |
| `bookingModel` | SP settings | — | Jobs go to vendors or to workers. `GET /users/providers` returns `providerType`. |
| `preferredProviderTimeoutSec` | SP settings | 120 | How long a chosen provider has to accept before the normal waves start |
| Required verification items | SP settings | Vendor: aadhaar, pan, address. Worker: aadhaar, address. | What `verification.missing` lists |
| `FINANCE_PERMISSIONS_ENFORCED` | Server env | Off (log only) | Admin-only. The apps are not affected. |
| `UNIFIED_DISPATCH_ENABLED` | Server env | Off | When on, one driver is offered rides, food and grocery jobs on one `job:offer` feed and holds one job at a time (section 3.1) |
| `dispatch.unifiedZones` | Master settings | `[]` (every zone, once the flag is on) | Zone ids where unified dispatch is piloted. Outside them the driver gets the old per-vertical offers only. |
| Taxi toll auto-approve limit | Taxi admin (`toll_auto_approve_limit`) | 0 (review every toll) | A toll shows `pending` until reviewed |
| Night charge and extra-km charge | Taxi set prices | Off | The fare lines appear only when on |
| Round-trip factors | Taxi set prices | factor 1, 60 minutes free wait, ₹0/hour | Fare only |
| Food cancel window | Food panel → Order Cancellation | Off | `cancellation.allowed` / `until` |
| Free delivery by distance | Platform or per restaurant | Off | `deliveryFeeBreakdown` |
| SOS enabled | Taxi admin | On | 403 when off. Hide the SOS button on 403. |
| App services | Master → App services (per zone) | — | `GET /v1/platform/app-services` decides which tiles show |
| Module kill switch | Master → Platform modules | Enabled | 503 on writes |
| `loyalty.enabled` (and `pointsPerRupee` 0.1, `rupeesPerPoint` 0.25, `maxRedeemPercent` 20, `expiryDays` 365) | Master settings → Loyalty (global or per service) | **Off** | Nothing is earned or redeemed. `GET …/loyalty/me` returns `enabled: false`: hide the points row and wallet card. |
| Delivery slots | Admin → Delivery slots (`/v1/platform/delivery-slots/admin`, per zone) | None configured | `slotsEnabled: false`: any `scheduledAt` works as before. Once slots exist, only open slots with room are accepted. |
| `orders.scheduledDispatchLeadMinutes` | Master settings | 30 | How long before a slot rider search starts. Riders get `400 This is a scheduled order…` if they accept earlier. |
| `delivery.dropOtpRequired` | Master settings (per service, can be set per zone) | **On** | When off (or when the customer chose contactless), riders complete without the handover code and **must** send a `dropProof` photo. The rider app should always offer the photo step and treat the 400 as "photo required". |
| `GST_VERIFY_PROVIDER` | Server env | Unset (offline checks only) | `gst/verify` returns `offline_valid` instead of `verified`; treat both as acceptable in onboarding |

### 10.2 Checklist for the Flutter team

**Platform**

- [ ] Hosts are a flavour or remote config value (IP now; `api.quickdoo.in` later). No hard-coded `quickdropsindia.com`.
- [ ] One Dio client per token family (core, taxi, SP), each with its refresh interceptor and serialised refresh.
- [ ] Every 4xx shows the server `message`. 5xx shows a generic message and logs `requestId`.
- [ ] 503 module-disabled is handled (show the message, keep reads working).
- [ ] 429 backs off and never retries in a tight loop.
- [ ] Sockets connect with `auth: { token }`, reconnect after a token refresh, and rejoin rooms (`ride:rejoin-current`, `resync`, `join_tracking`).
- [ ] FCM token is registered after sign-in and on refresh, in both the core and SP registries for customers, and removed on logout.
- [ ] Razorpay: create, then checkout, then **server verify**. Re-fetch the order on resume. No key secret in the app.
- [ ] Uploads always send a token. Pre-account documents use the multipart or data-URL register paths.

**Customer app**

- [ ] One core sign-in used across food, QC, taxi and SP. Phone, email and Google/Apple. `needsPhone` is handled.
- [ ] `EMAIL_NOT_VERIFIED` and `ACCOUNT_LOCKED` flows work.
- [ ] Home tiles come from `/v1/platform/app-services`. No bus, pooling, rental, parcel, dining, medical or insurance anywhere.
- [ ] Taxi: one way or round trip on the vehicle screen; up to 5 stops with coordinates; the same payload sent to quote and book; `fare.total` shown, never computed.
- [ ] Taxi: night, toll and extra-km lines; live ETA; stop timeline; SOS with 10-second location pings; trip share.
- [ ] SP: provider choice, add-ons, quotes, before and after photos in booking detail, invoice PDF download.
- [ ] Food: everything in the [flutter-integration.md checklist](./flutter-integration.md#before-you-ship) and the cancel countdown.
- [ ] Refund status shown from `payment.refund.status`.
- [ ] Currency symbol, phone code and time zone come from `GET /v1/platform/global-settings`, not hard-coded.
- [ ] Home "Popular near you" and cart "Goes well with" rows from `/v1/platform/recommendations/...`; the rows hide when the lists are empty.
- [ ] QC: multi-store cart with `storeId` per line (up to 5 stores); one delivery fee (the highest single-store fee); express hidden on multi-store; verify with the parent id; `groupByParent=true` order list with per-child tracking and cancel.
- [ ] QC: delivery or pickup toggle; pickup code shown on the order; slot picker that falls back to free time when `slotsEnabled` is false; contactless option.
- [ ] QC: search suggestions and recent searches; barcode scan; FAQs screen.
- [ ] Loyalty: balance and redeem row on QC checkout, hidden when `enabled` is false (the default). Food shows the balance only until food checkout accepts points.
- [ ] Food: invoice PDF download on delivered orders (handle 409 before delivery).

**Driver app**

- [ ] Taxi: pending-approval screen; stops and waypoint navigation; tolls with a receipt upload; continuous `ride:driver-location:update` during trips; SOS.
- [ ] The driver taps Arrived at the destination on a round trip, then completes on return.
- [ ] Delivery partner: `vehicleRcPhoto` and `vehicleRcNumber` at signup for motorised vehicles; directions-style Maps links.
- [ ] People who are both taxi drivers and delivery partners: one card for `job:offer` (rides, food and grocery), the delivery session for food/QC accepts, `GET /taxi/drivers/jobs/active` on start-up; the two existing modes still work while `job:offer` does not arrive.
- [ ] The taxi refresh token rotates: save the new `refreshToken` after every refresh, and never run two refreshes with the same token.
- [ ] Delivery partner: QC orders in the same lists ("Store" label, pick list at pickup); proof-of-delivery photo step (upload to `/v1/uploads/image`, then `dropProof` on complete), required when there is no handover code.
- [ ] Optional: "where to wait" hints from `GET /v1/platform/recommendations/demand`.

**Service Provider app**

- [ ] OTP, then verify-login, then register with a `verificationToken`. Documents are sent as data URLs.
- [ ] A pending vendor sees "Under review" and can finish the checklist with the onboarding token, then refreshes into a full token after approval. A pending worker can finish onboarding.
- [ ] Onboarding: GST, PAN (worker), bank details, email OTP, certifications, categories, availability calendar.
- [ ] Before and after photos with GPS. `BEFORE_PHOTOS_REQUIRED` and `AFTER_PHOTOS_REQUIRED` are handled without losing the OTP.
- [ ] Quotes inbox and submit. Worker earnings by day, week and month.
- [ ] Subscription screen (needed once `requireVendorSubscription` is turned on).

**Partner app (restaurant and store)**

- [ ] Stock screen and low-stock push taps (stores only).
- [ ] No dining screens. No pharmacy sign-up.
- [ ] Stores: pickup-orders filter and the pickup-code hand-over screen; `barcode` field on products; customer analytics on the analytics screen.
- [ ] Restaurants: email OTP sign-in (handle `409 EMAIL_MULTIPLE_OUTLETS`); GSTIN check at 15 characters during onboarding; optional menu step; sales analytics chart, report downloads (CSV/PDF) and settlement statements. Show "not available" for reports and settlements on store accounts.

**Release**

- [ ] Test against staging with Razorpay test keys and a separate Firebase app.
- [ ] Bump the version for every app. Use Shorebird patches only for Dart-only changes on Shorebird-built releases.
- [ ] Before building the partner and customer repos, check that the git history has none of the injected files (`.vscode/tasks.json`, `public/fonts/fa-solid-500.woff2`). See the stock guide.

---

## 11. Known gaps and doc/code mismatches

These were found while writing this guide. Raise them with the backend team before relying on the behaviour.

1. **Fixed: taxi tokens can now be refreshed.** Driver and rider sign-in (`/taxi/drivers/auth/verify-otp`, `/taxi/users/auth/verify-otp`, and the password, signup and onboarding-complete routes) still return `token`, and now also `accessToken` (the same value), `refreshToken` and `expiresIn`. `POST /taxi/drivers/auth/refresh-token` and `POST /taxi/users/auth/refresh-token` rotate the refresh token. Reusing an old one revokes the whole session. `POST /taxi/{drivers|users}/auth/logout { refreshToken }` revokes it. Blocked, rejected, inactive or deleted accounts cannot refresh. A pending driver can, but stays limited to the pending routes. Details in `flutter-taxi-api.md` section 0. The React taxi app does not use the refresh token yet.
2. **Fixed: pending SP vendors get an onboarding token.** Pending and rejected vendors now receive an OTP, and `verify-login` (and `register`) return `tokenScope: "onboarding"`, `onboardingToken` and `onboardingRefreshToken`. The token works only on `GET/PUT /vendors/onboarding`, `PUT /vendors/bank-details`, the email OTP routes, the availability routes, `POST /upload`, `GET /vendors/profile` and `POST /vendors/auth/logout`. Every other vendor route still returns 403 until approval, and the `/sp` socket refuses it. After approval, `POST /vendors/auth/refresh-token` with the onboarding refresh token returns a full token. Suspended or deactivated vendors still get nothing. Workers are unchanged. Details in `flutter-sp-api.md` section 1.
3. **Razorpay contracts differ by vertical.** Food and QC return `razorpay.key` and verify with camelCase `razorpayOrderId…`. Taxi returns `keyId` and verifies with snake_case `razorpay_order_id…`. SP returns `key` and verifies with snake_case. This is documented here, but it is not uniform.
4. **Upload responses differ.** Core, taxi and QC return `data.url`. SP returns top-level `imageUrl`. The multipart field is `file` everywhere except taxi, which uses `image`.
5. **Pagination differs by module** (section 1.6).
6. **FCM registration differs.** Core `/fcm-tokens/mobile/save` takes `{ token }` and **refuses** a `platform` field. SP `/fcm-tokens/save` takes `fcmToken` (plus several aliases) and `platform`. The core FCM role map does not include SP `VENDOR` or `WORKER`; they must use the SP routes.
7. **Old host in `flutter-integration.md`.** It uses `https://quickdropsindia.com/api/v1`. Use the hosts in 1.2.
8. **The nginx config in the repo names the old host.** `deploy/nginx/superapp.appzeto.com.conf` is the only server block. The `quickdoo.in` and `api.quickdoo.in` blocks are not in the repo yet. Decided: `api.quickdoo.in` proxies the whole path to the backend, so the `/api` prefix stays. The domains go live once the domain hold is lifted; until then use `http://187.126.119.13`.
9. **`flutter-taxi-api.md` toll step 1** says to use "the existing upload endpoint" without saying it now needs the driver's token (commit `3972719`). It does, and pending drivers are allowed.
10. **Intercity leftovers.** The intercity screens were removed (D3), but `GET /taxi/users/intercity-packages` and the `transport_type: "intercity"` / `rideType: "outstation"` pricing still exist. Treat "outstation" as a pricing flag on a normal one-way or round-trip ride, not as a separate flow.
11. **The SP doc says "the legacy `/api/...` prefixes still work".** That is true (`SP_LEGACY_PREFIXES` in `routes/index.js`), but they exist only for shipped builds. New apps should not use them.
12. **Committed: SOW §5–§7.** Restaurant email sign-in, the food invoice PDF, `/v1/platform/faqs`, `/v1/platform/loyalty`, `/v1/platform/delivery-slots`, restaurant reports, settlements and GST verification, QC parent orders, pickup, slots and drop proof, recommendations and global settings are all committed (up to `6b31463`). Their module documents ([flutter-qc-api.md](./flutter-qc-api.md), [flutter-food-api.md](./flutter-food-api.md), [flutter-platform-api.md](./flutter-platform-api.md)) are authoritative.
13. **Loyalty cannot be redeemed at food checkout yet.** Food customers can read `GET /v1/platform/loyalty/me` and `/quote`, and food deliveries earn points, but `POST /food/orders/calculate` and `POST /food/orders` ignore `loyaltyPoints`. Only QC checkout redeems. Loyalty is also off by default (`loyalty.enabled`).
14. **QC stores have no reports or settlements yet.** `/restaurant/reports`, `/restaurant/analytics/sales` and `/restaurant/settlements…` exist only under `/food`; on `/qc/restaurant` they return 404. Stores get only the extended `GET /qc/restaurant/analytics` (customer analytics).
15. **Multi-store limits.** At most 5 stores per basket; the `quick` (express) mode is not offered (every child is `basic`); the customer pays the highest single-store delivery fee, split by item value. If one store cannot accept, the whole checkout is refused.
16. **Pickup, slots and drop proof are QC only.** Food orders do not take `fulfilmentType: "pickup"` or slot validation, and food completion ignores `dropProof` (the photo is stored and enforced only for QC orders, even though both go through the same rider completion route).
17. **GST lookup needs a provider.** With `GST_VERIFY_PROVIDER` unset the check is offline only (`offline_valid`); `verified`, `not_found` and `inactive` appear only once a provider is configured.
18. **Recommendations start empty.** The nightly job fills them after 02:00 IST; until the first run every list is empty.
