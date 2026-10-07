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
| [../SOW_IMPLEMENTATION_PLAN.md](../SOW_IMPLEMENTATION_PLAN.md) | The backend plan and decisions D1 to D8 |

Every route prefix in this guide was checked against `Backend/src/routes/index.js` and each module's route index at the time of writing (branch `sow/phase-0-1`, after commit `e002fb3`). If an endpoint here and the code disagree, the code wins. Please tell the backend team.

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
6. [Quick commerce (to be completed)](#quick-commerce-to-be-completed)
7. [Food ordering updates (to be completed)](#food-ordering-updates-to-be-completed)
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
- Assumption to confirm with the backend team: `api.quickdoo.in` keeps the `/api` path prefix (the nginx config proxies `/api/` and `/socket.io/` to the same Node process). The nginx file in the repo is still named for the old host. See [section 11](#11-known-gaps-and-doccode-mismatches).
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
| `/v1/platform/...` | Cross-vertical: `/platform/app-services` (which service tiles to show, public), `/platform/me/orders` (My Orders across every service), `/platform/legal/:app/:kind` (terms and privacy, public) | Customer, everyone |
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

See [Food ordering updates (to be completed)](#food-ordering-updates-to-be-completed) for the full list. In brief: browse with `/v1/food/restaurant/...`, price with `POST /v1/food/orders/calculate`, place with `POST /v1/food/orders`, verify payment, track over the socket, then rate.

### 2.4 Quick commerce

See [Quick commerce (to be completed)](#quick-commerce-to-be-completed).

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
- The unified dispatch flag (`UNIFIED_DISPATCH_ENABLED`) is still **off**. A merged job feed with a `jobType` field is planned (SOW plan §8) but not built. Until then, build the app with two modes ("Rides" and "Deliveries") and keep both sockets live when the person has both roles.

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

**Proof-of-delivery photo** (QC 5.4, `dropProof { photoUrl, lat, lng, at }` at completion, required when there is no OTP) is being built now. See the QC placeholder.

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
| Sign in | `POST /v1/auth/restaurant/request-otp`, then `/verify-otp` (core tokens). Email OTP sign-in for existing outlets (`/v1/auth/restaurant/email/request-otp` and `/verify-otp`) is **in progress** (SOW 6.5). | `POST /v1/qc/auth/restaurant/request-otp`, then `/verify-otp`. Seller sign-up and onboarding at `/v1/qc/partner/...`. |
| Register | `POST /register`, `POST /upload-attachment`, GST check `POST /gst/verify` (in progress, SOW 6.4) | QC partner flow |
| Profile and hours | `GET /current`, `PATCH /profile`, `PATCH /availability`, `GET/PUT /outlet-timings`, `GET/PUT /service-radius`, `GET/PUT /tax-settings`, media `/media/...` | same paths |
| Menu | `GET/PATCH /menu`, categories `/categories`, items `POST /foods` and `PATCH /foods/:id`, add-ons `/item-extras` (alias of `/addons`), combos `/combos`, bulk `/bulk-upload` (template `/bulk-upload/template`) | same, plus **stock**: `GET/PATCH /stock`, `POST /stock/bulk`, `GET /stock/history` ([stock guide](./flutter-stock-and-cancel-guide.md)) |
| Orders | `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/resend-notification`. Socket `new_order`, `order_status_update`. | same on `/qc` |
| Offers | `/my-offers` (alias `/my-deals`), `/freebie-offer`, `/bogo-offer` | |
| Money | `GET /finance`, `POST /withdraw`, `GET /withdrawals`, `GET /commission`, settlements `GET /settlements`, `/settlements/:cycleId`, `/settlements/:cycleId/download` (SOW 6.3) | subscription `GET /subscription/overview`, `/subscription/invoices`, `/subscription-history` |
| Reports | `GET /analytics/sales?from&to&groupBy` (alias `/insights/sales`), `GET /reports` (SOW 6.1–6.2, in progress) | |
| Support | `GET /complaints`, `POST/GET /support/tickets` | |
| Push | `POST /v1/fcm-tokens/mobile/save` (QC: `/v1/qc/fcm-tokens/mobile/save`). Handle `new_order`, `order_cancelled`, `stock_low` and `stock_out` taps. | |

Dining and table reservations are removed. Drop any dining tab or settings screen.

---

## Quick commerce (to be completed)

> **Placeholder.** Another agent is writing the full QC document for SOW §5 now. Do not build the new QC features (multi-seller cart, pickup, slots, loyalty and the rest) until that document lands. What is known today follows.

**Prefix and identity.**

- Everything is under `/api/v1/qc`. It is a fork of the food module, so the sub-paths mirror food: `/qc/restaurant` (stores), `/qc/orders`, `/qc/user`, `/qc/delivery`, `/qc/search`, `/qc/uploads`, `/qc/payments`, `/qc/notifications`, `/qc/chat`.
- QC-only paths are `/qc/partner` (seller onboarding) and `/qc/returns` (customer returns).
- Public settings: `/qc/admin/business-settings/public`, `/power-scanning/public`, `/feature-settings/public`, `/fee-settings/public`, `/cashback-settings/public`, `/restaurant-subscription-settings/public`.
- The customer uses the **core** token. QC links its own profile on first use.
- Sockets are on the `/qc` namespace, with the same event names as food.

**Ordering today (the same contract as food).**

- `POST /qc/orders/calculate`, then `POST /qc/orders` (with an idempotency window), then `POST /qc/orders/verify-payment`.
- `DELETE /qc/orders/:orderId/pending-payment` abandons an online payment the customer did not finish. Call it when the Razorpay sheet is dismissed.
- `GET /qc/orders`, `GET /qc/orders/:id`, `GET /qc/orders/:id/drop-otp`, `GET /qc/orders/:id/route`, `PATCH /qc/orders/:id/cancel`, `/ratings`, `/instructions`.
- Returns: `/qc/returns`. Approved returns are refunded through the gateway refund service (`payment.refund.status`).
- The per-size quantity limits, itemised `pricing.bill` and free-delivery breakdown described for food in [flutter-integration.md](./flutter-integration.md) come from shared pricing logic. Treat QC pricing responses the same way. Render `bill`. Never sum it.

**Stock (stores).** This is live. See [flutter-stock-and-cancel-guide.md](./flutter-stock-and-cancel-guide.md).

- `stockQty: null` means not counted.
- `0` means sold out and hides the product.
- Low-stock pushes are `stock_low` and `stock_out`.

**Removed.** Medical/pharmacy is gone (D2):

- prescription orders and uploads, prescription requests and broadcasts;
- drug-licence and pharmacy verification;
- the medical app service tile and medical partner sign-up.

Existing pharmacy stores are hidden from customers and refuse new orders. No order is ever numbered `MED-` again. Remove every medical or prescription screen.

**In progress on the backend (SOW §5). Shapes are not final:**

| SOW | Feature | Known so far |
|---|---|---|
| 5.1 | Multi-seller cart | Cart `items[]` each carry `storeId`. Checkout creates one **parent order** (one payment, one coupon) and one child order per store, each with its own acceptance, rider and tracking. Fees and discounts are split pro rata. Refunds and cancels are per child. |
| 5.2 | Self-pickup | `fulfilmentType: "delivery" \| "pickup"`. Pickup skips dispatch and the delivery fee, and shows a pickup OTP the store checks. |
| 5.3 | Scheduled delivery | `scheduledAt` against admin-defined slots with capacity. Shared slot routes are being added at `/api/v1/platform/delivery-slots`. |
| 5.4 | Proof-of-delivery photo | `dropProof { photoUrl, lat, lng, at }` at rider completion. Required when there is no OTP. |
| 5.5 | Search suggestions | `GET /search/suggest?q=` and recent searches |
| 5.6 | Voice search and barcode scan | Done on the device. Backend adds `barcode`/`ean` and `GET /products/by-barcode/:code`. |
| 5.7 | Loyalty points | Earn on delivery, redeem at checkout. Shared routes at `/api/v1/platform/loyalty`. |
| 5.8 | FAQs | `GET /api/v1/platform/faqs?vertical=` |
| 5.10 | QC orders in the delivery-partner app | Riders pick up QC orders as well as food |

---

## Food ordering updates (to be completed)

> **Placeholder.** Another agent is writing the food updates document for SOW §6 now. What is known today follows.

**Endpoints** (all under `/api/v1/food`, customer token):

| Purpose | Endpoint |
|---|---|
| Landing settings (includes `ninetyNineStoreMaxPrice`, never null) | `GET /landing/settings/public` |
| Banners | `GET /hero-banners/public`, `/hero-banners/under-250/public`, `/hero-banners/home-promotion/public`, `/hero-banners/gourmet/public`, `/explore-icons/public` |
| Zone detection | `GET /zones/detect` |
| Restaurant list and detail | `GET /restaurant/restaurants`, `GET /restaurant/restaurants/:id` (both carry `freeDeliveryRule`, `freeDeliverySource`, `freeDeliveryOffer`) |
| Menu | `GET /restaurant/restaurants/:id/menu`, `/restaurants/:id/addons`, `/restaurants/:id/reviews`, `/restaurants/:id/outlet-timings` |
| Cross-restaurant dish feed | `GET /restaurant/public/foods` (`promo=switch99` for the ₹99 shelf, which the server filters) |
| Offers and categories | `GET /restaurant/offers`, `GET /restaurant/categories/public` |
| Search | `GET /search/unified?q=` |
| Fees | `GET /admin/fee-settings/public`, `/admin/business-settings/public`, `/admin/cashback-settings/public` |
| Price the cart | `POST /orders/calculate` returns `pricing` with `bill`, `deliveryFeeBreakdown` and `adjustments[]` |
| Place | `POST /orders` (`paymentMethod`, `tip`, `couponCode`, `zoneId`, …). An implicit 10-second idempotency window covers double taps. |
| Verify payment | `POST /orders/verify-payment` |
| List and detail | `GET /orders`, `GET /orders/:id` (includes `cancellation { allowed, until, secondsLeft, reason }`) |
| Track | Socket `join-tracking`, `order_status_update`, `location-update`; `GET /orders/:id/route`; `GET /orders/:id/drop-otp` |
| Cancel | `PATCH /orders/:id/cancel`. This is subject to the admin cancel window; show the 400 message as-is. |
| Rate and instructions | `PATCH /orders/:id/ratings`, `PATCH /orders/:id/instructions` |
| Invoice PDF | `GET /orders/:id/invoice` (SOW 6.7). **In progress**: the route is in the working tree, not yet released. |
| Favourites | `GET /user/favorites`, `POST /user/favorites/restaurants/:id`, `POST /user/favorites/foods/:id` |
| Refund history | `GET /user/refunds` |

**Already required by [flutter-integration.md](./flutter-integration.md)** (the customer app must ship these):

- Per-size `minOrderQuantity` and `maxOrderQuantity`. Each bound inherits on its own, and `0` on max means "no cap".
- Combos (`isCombo`, `comboComponents[]`).
- Free delivery by distance (`deliveryFeeBreakdown.freeDeliveryReason`, `waivedDeliveryFee`).
- The live `ninetyNineStoreMaxPrice`. Never hard-code 99.
- The itemised `pricing.bill`, including platform-fee GST, `tip` and `roundOff`. Tax now has decimals. Show `grandTotal` exactly as given.

That document's examples use the old host (`https://quickdropsindia.com/api/v1`). Replace it with the hosts in [1.2](#12-hosts-and-base-urls).

**Removed:** dining and table reservations. The dining module, dining banners, the public dining routes and every dining screen are gone.

**Backend work in progress (SOW §6):**

- vendor reports and analytics on the server;
- settlement statements;
- GST verification at onboarding;
- restaurant email sign-in;
- a menu step during onboarding (`onboardingMenu`);
- the server-side invoice PDF.

These mostly affect the restaurant panel and app ([section 5](#5-restaurant-and-store-partner-app)).

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
| **Email** | Client (SMTP or provider) | — | Email OTP, password reset, invoices. Sent through the email queue. |

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
| `UNIFIED_DISPATCH_ENABLED` | Server env | Off | When on, food and QC deliveries are dispatched to unified drivers (section 3.1) |
| Taxi toll auto-approve limit | Taxi admin (`toll_auto_approve_limit`) | 0 (review every toll) | A toll shows `pending` until reviewed |
| Night charge and extra-km charge | Taxi set prices | Off | The fare lines appear only when on |
| Round-trip factors | Taxi set prices | factor 1, 60 minutes free wait, ₹0/hour | Fare only |
| Food cancel window | Food panel → Order Cancellation | Off | `cancellation.allowed` / `until` |
| Free delivery by distance | Platform or per restaurant | Off | `deliveryFeeBreakdown` |
| SOS enabled | Taxi admin | On | 403 when off. Hide the SOS button on 403. |
| App services | Master → App services (per zone) | — | `GET /v1/platform/app-services` decides which tiles show |
| Module kill switch | Master → Platform modules | Enabled | 503 on writes |

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

**Driver app**

- [ ] Taxi: pending-approval screen; stops and waypoint navigation; tolls with a receipt upload; continuous `ride:driver-location:update` during trips; SOS.
- [ ] The driver taps Arrived at the destination on a round trip, then completes on return.
- [ ] Delivery partner: `vehicleRcPhoto` and `vehicleRcNumber` at signup for motorised vehicles; directions-style Maps links.
- [ ] People who are both taxi drivers and delivery partners: two modes, until unified dispatch ships.
- [ ] The taxi refresh token rotates: save the new `refreshToken` after every refresh, and never run two refreshes with the same token.

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
8. **The nginx config in the repo names the old host.** `deploy/nginx/superapp.appzeto.com.conf` is the only server block. The `quickdoo.in` and `api.quickdoo.in` blocks (and whether `api.` keeps the `/api` prefix) are not in the repo yet.
9. **`flutter-taxi-api.md` toll step 1** says to use "the existing upload endpoint" without saying it now needs the driver's token (commit `3972719`). It does, and pending drivers are allowed.
10. **Intercity leftovers.** The intercity screens were removed (D3), but `GET /taxi/users/intercity-packages` and the `transport_type: "intercity"` / `rideType: "outstation"` pricing still exist. Treat "outstation" as a pricing flag on a normal one-way or round-trip ride, not as a separate flow.
11. **The SP doc says "the legacy `/api/...` prefixes still work".** That is true (`SP_LEGACY_PREFIXES` in `routes/index.js`), but they exist only for shipped builds. New apps should not use them.
12. **Work in progress in the working tree** (not yet committed when this was written):
    - restaurant email OTP sign-in;
    - the food invoice PDF route;
    - `/v1/platform/faqs`, `/v1/platform/loyalty` and `/v1/platform/delivery-slots`;
    - restaurant reports, settlements and GST verification;
    - QC parent orders and drop proof.

    Treat their shapes as provisional until the module documents land.
