# Service-Provider (Homster) → Master Super-App Integration Plan

**Source:** `D:\projects\service-provider` (Backend 186 files / ~28.7k LOC, Admin FE 82 files / ~19.5k LOC)
**Target:** `D:\projects\master` (Backend ESM, Frontend Vite/React)
**Scope:** Backend = 100% (user + vendor + worker + admin + sockets + jobs). Frontend = **admin panel only**.

---

## 0. What already exists (the precedent to copy)

Master has already absorbed one whole app — Taxi. The pattern it used is the pattern we reuse:

| Concern | How Taxi did it | We do the same |
|---|---|---|
| Code location | `Backend/src/modules/taxi/**` (self-contained: models, routes, services, sockets, middleware) | `Backend/src/modules/serviceProvider/**` |
| Route mount | one line in `src/routes/index.js` → `router.use('/v1/taxi', taxiRouter)` | `router.use('/v1/sp', spRouter)` + legacy aliases |
| Models | own mongoose model names, prefixed `Taxi*` | prefixed `SP*` |
| Shared identity | `TaxiUser` + `FoodUser` both bind `collection: 'users'` | `SPUser` binds `sp_users` now, `users` after migration (§4.2) |
| Shared admin | `TaxiAdmin` + `FoodAdmin` both bind `collection: 'admins'` | `SPAdmin` binds `collection: 'admins'` **from day 1** |
| Sockets | `configureTaxiSocketServer(getIO())` on master's single io | `configureSPSocketServer(getIO())` on namespace `/sp` |
| Admin UI | `/taxi/admin/*` inside `TaxiApp.jsx`, reachable from `/admin/taxi` | `/sp/admin/*`, reachable from `/admin/sp` |

Nothing here is new territory. It's Taxi again, with two extra wrinkles below.

---

## 1. The two real blockers (and the cheap answers)

### 1.1 CommonJS vs ESM

`master/Backend/package.json` has `"type": "module"`. Every SP file uses `require`/`module.exports`. Converting 186 files is a 28k-line diff and a week of regressions.

**Answer: don't convert.** Node scopes module type by *nearest* `package.json`. Drop one file:

```json
// Backend/src/modules/serviceProvider/package.json
{ "name": "sp-module", "type": "commonjs" }
```

Every `.js` under that folder stays CommonJS, all internal `require('../models/User')` paths resolve unchanged. ESM can import CJS: `import spRouter from './modules/serviceProvider/index.js'` gives you `module.exports` as the default. `mongoose` is a CJS package — `require('mongoose')` inside SP and `import mongoose` in master resolve to the **same singleton**, so one connection, one model registry. Verified: this is the only thing that makes the "zero rewrite" viable.

> Cost: SP code can't `import` master's ESM utils synchronously. It doesn't need to — the only crossings are the shared services in §5, which we expose through a small CJS shim (`sp/bridge.cjs`) using `await import()` inside async functions.

### 1.2 Collection collisions

SP models declare **no** `collection:` option, so mongoose pluralizes. That silently lands SP data on top of master's live collections:

| SP model | Auto collection | Master already owns it | Verdict |
|---|---|---|---|
| `User` | `users` | `FoodUser` + `TaxiUser` | **Merge, but phased** (§4.2) |
| `Admin` | `admins` | `FoodAdmin` + `TaxiAdmin` | **Merge now** (§4.1) |
| `Transaction` | `transactions` | `core/payments` `Transaction` | **Hard rename** → `sp_transactions` |
| `Settlement` | `settlements` | `core/payments` `Settlement` | **Hard rename** → `sp_settlements` |
| `Notification` | `notifications` | free (master uses `food_notifications`) | rename for hygiene |
| all others | `bookings`, `vendors`, `workers`, `categories`, … | free | rename for hygiene |

`Transaction` and `Settlement` also collide at the **mongoose model-name** level → `OverwriteModelError` on boot. Those two are non-negotiable.

---

## 2. Naming contract (apply mechanically, no exceptions)

| Thing | Rule | Example |
|---|---|---|
| Module folder | `src/modules/serviceProvider/` | — |
| Model name | `SP` prefix | `User` → `SPUser`, `Booking` → `SPBooking` |
| Collection | `sp_` prefix, snake_case, explicit | `sp_bookings`, `sp_vendor_bills` |
| Shared collections | **no** prefix — that's the point | `admins`, later `users` |
| API prefix (new) | `/api/v1/sp/...` | `/api/v1/sp/admin/dashboard` |
| API prefix (legacy) | keep `/api/users`, `/api/vendors`, `/api/workers`, `/api/admin`, `/api/bookings`, `/api/payments`, `/api/notifications`, `/api/public`, `/api/scrap`, `/api/image` as **aliases** | existing Flutter/APK builds keep working |
| Socket namespace | `/sp` | `io.of('/sp')` |
| Admin FE route | `/admin/sp/*` | — |

Legacy alias check: master mounts everything under `/api/v1/*` plus `/api/fcm-tokens`. **Zero overlap** with SP's legacy paths — the aliases are free and safe. Do not skip them or you break shipped mobile apps.

---

## 3. Model scan — the full inventory

29 SP models. Sorted by what happens to each.

### 3.1 MERGE — one record, many services

| SP model | Merges into | Notes |
|---|---|---|
| `Admin` | `admins` collection (alongside `FoodAdmin`, `TaxiAdmin`) | Day 1. Extra fields `cityId`/`cityName` live only on `SPAdmin`; harmless to the other two models. |
| `User` | `users` collection | **Phase 2**, behind a migration. See §4.2 — this one has a schema-shape trap. |

### 3.2 HARD RENAME — collides today, will crash on boot

| SP model | New model name | New collection |
|---|---|---|
| `Transaction` | `SPTransaction` | `sp_transactions` |
| `Settlement` | `SPSettlement` | `sp_settlements` |

### 3.3 RENAME FOR HYGIENE — no equivalent in master, keep the logic

`Booking`, `BookingRequest`, `Brand`, `Cart`, `Category`, `City`, `HomeContent`, `Notification`, `NotificationLog`, `Plan`, `PlatformEarning`, `Review`, `Scrap`, `Service`, `Settings`, `Token`, `UserService`, `Vendor`, `VendorBill`, `VendorPartsCatalog`, `VendorService`, `VendorServiceCatalog`, `Withdrawal`, `Worker`, `WorkerSubscriptionPlan`
→ `SPBooking`, `SPBookingRequest`, … each with an explicit `sp_*` collection.

**Do not** try to fold `SPVendor`/`SPWorker` into taxi's `Driver`/`Owner` or food's `DeliveryPartner`. Different lifecycle (approval → catalog → subscription plans → bill), different auth flow. Merging them is the classic super-app mistake that costs a month and buys nothing.

**Do not** fold `SPCategory`/`SPService` into `FoodCategory`. Home-services taxonomy ≠ food menu taxonomy.

### 3.4 Ref rewrite (mechanical, 77 sites)

Renaming models breaks every `ref:` string. Counted across `models/`, `controllers/`, `services/`:

```
15× ref:'Category'  14× ref:'Vendor'   10× ref:'Worker'   7× ref:'Service'
 6× ref:'User'       6× ref:'Admin'     5× ref:'UserService'  4× ref:'City'
 4× ref:'Booking'    2× ref:'Brand'     1× each: WorkerSubscriptionPlan,
                                          VendorServiceCatalog, VendorPartsCatalog, VendorBill
```

One sed pass per name + a boot-time assertion that every registered `SP*` model's refs resolve. `ref:'Admin'` → `ref:'SPAdmin'`; `ref:'User'` → `ref:'SPUser'`.

---

## 4. The two identity merges

### 4.1 Admin — merge on day 1 (this is what unlocks the single panel)

Master's `admins` collection already carries the multi-service machinery. Three small edits:

1. **`src/core/admin/admin.model.js`** — extend the enum:
   ```js
   servicesAccess: { type: [String], enum: ['food','quickCommerce','taxi','serviceProvider'], default: ['food'] }
   ```
2. **`src/core/admin/adminHierarchy.constants.js`** — add `SP_SUPERADMIN: 'sp_superadmin'` to `ADMIN_LEVELS` and `SERVICE_PROVIDER: 'serviceProvider'` to `ADMIN_MODULES`.
3. **`src/core/admin/adminHierarchy.service.js`** — `resolveAdminModule` / `isModuleSuperAdmin` / `getCreatableAdminLevels` currently hardcode food-vs-taxi pairs. Add the third arm. (~15 lines, all in one file.)

Then `SPAdmin` = SP's `models/Admin.js` with `{ collection: 'admins' }` and model name `SPAdmin`. Same shape as `TaxiAdmin` does it.

**Token unification.** SP signs with `process.env.JWT_SECRET`; master's `config.jwtAccessSecret = JWT_ACCESS_SECRET || JWT_SECRET`. If both env vars are set they diverge and cross-module tokens fail. Fix in `serviceProvider/utils/tokenService.js`:
```js
const SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
```
Payload shapes already line up — master's `authMiddleware` reads `decoded.userId || decoded.sub`, SP's reads `decoded.userId`, and SP's role switch already accepts `'ADMIN' | 'admin' | 'super_admin'`. Normalize the claim SP issues to `role: 'ADMIN'` and one login serves all three modules.

**Result:** an admin logs in once at `POST /api/v1/auth/admin/login` and their `servicesAccess` decides whether the Food, Taxi, and/or Service-Provider sections appear in the panel.

### 4.2 User — merge in Phase 2, not Phase 1

Tempting to point `SPUser` at `collection:'users'` immediately. Two traps:

- `name: { required: true }` in SP vs optional in Food/Taxi → any SP write to a food-created user throws a validation error.
- **`addresses[]` has a different sub-schema.** Food/Taxi: `{street, city, state, zipCode, location:{Point}}`. SP: `{addressLine1, addressLine2, pincode, landmark}`. Same array, same collection, two incompatible shapes = silent data corruption.

**Phase 1:** `SPUser` → `collection: 'sp_users'`. Everything works, zero risk, ships this week.

**Phase 2 (separate PR):** split identity from profile, the way master already splits `FoodDeliveryPartner` from `food_delivery_profiles`:
- `SPUser` → `collection: 'users'`, holding only shared identity: `phone` (unique key), `name` (relaxed to optional), `email`, `isActive`, `fcmTokens`, `fcmTokenMobile`.
- New `SPUserProfile` → `sp_user_profiles`, keyed by `userId`, holding SP-only state: `addresses`, `wallet`, `plans`, `totalBookings`, `completedBookings`, `cancelledBookings`, `settings`, `loginSessionId`, `isPhoneVerified`, `profilePhoto`.
- Migration script matches on normalized `phone`, links existing `users` docs, creates the rest.

Then one phone number = one account across food, taxi and services. Do it deliberately, not as a side effect of the port.

---

## 5. Shared services — delete the duplicates

SP ships its own copy of infrastructure master already runs. Every duplicate here is a second set of credentials, a second failure mode, and a second thing to rotate. Route SP through master's via a thin CJS bridge:

| SP file | Replace with | Why |
|---|---|---|
| `config/db.js` | master `src/config/db.js` | **Must go.** Two `mongoose.connect()` calls on one process. Delete SP's; master's `connectDB()` already ran by the time SP routes are hit. |
| `services/redisService.js` | master `src/config/redis.js` | one pool. Keep SP's *helpers* (`setLiveLocation`, `setVendorLocation`, geo keys) — rewrite them on master's client. |
| `services/firebaseAdmin.js` | master `src/config/firebase.js` + `core/notifications/firebase.service.js` | one Firebase app init. Two `initializeApp()` on the same creds throws. |
| `services/cloudinaryService.js`, `config/cloudinary.js`, `utils/cloudinaryUpload.js` | master `src/services/cloudinary.service.js` | same account, same folder conventions |
| `services/razorpayService.js`, `utils/confirmGatewayPayment.js` | master `src/core/payments/payment.service.js` + `routes/webhook.routes.js` | **Important:** master's `app.js` only captures `rawBody` for `/webhook/razorpay` — SP webhooks must land on that path or signature verification silently fails |
| `services/smsService.js` | master `src/modules/taxi/services/smsService.js` (SMS India Hub) | one DLT template set |
| `services/emailService.js` | master `src/services/email.service.js` | one SMTP |
| `services/otpService.js`, `utils/redisOtp.util.js`, `utils/generateOTP.js` | master `src/core/otp/otp.service.js` | one OTP TTL/rate-limit policy — currently SP and master can disagree on how many attempts you get |
| `middleware/rateLimiter.js` | master `src/middleware/rateLimit.js` | master already applies `apiRateLimiter` on all `/api` — SP's would double-count |
| `middleware/uploadMiddleware.js` | master `src/middleware/upload.js` | — |
| `sockets/index.js` | attach to master's io as namespace `/sp` | see §6.4 |
| **KEEP** `services/bookingScheduler.js` | — | wave-based vendor alerting, SP-specific, no master equivalent |
| **KEEP** `services/earningTrackerService.js`, `locationService.js`, `fileStorageService.js` | — | SP domain logic |

`utils/withTransaction.js` and `utils/commission.js` stay — SP-specific, and `withTransaction` is genuinely good.

---

## 6. Backend implementation — phase by phase

### Phase 0 — prep (½ day)
- `git subtree add` or plain copy `service-provider/Backend/{config,controllers,middleware,models,routes,services,sockets,utils}` → `master/Backend/src/modules/serviceProvider/`.
- **Exclude:** `node_modules`, `scratch/`, `api/index.js` (Vercel shim), the 20 one-off `inspect_*.js` / `debug_*.js` / `test-*.js` scripts at repo root, `server.js`.
- **Port:** `scripts/` → `master/Backend/scripts/sp-*.js` (seeders are worth keeping; rename so they don't collide).
- Add `src/modules/serviceProvider/package.json` → `{"type":"commonjs"}`.
- Merge deps into master `Backend/package.json`: `cookie-parser`, `express-validator`, `multer-storage-cloudinary`, `pdfkit`, `streamifier`, `form-data`. (`axios`, `bcryptjs`, `helmet`, `morgan`, `multer`, `qrcode`, `razorpay`, `socket.io`, `ioredis`, `mongoose`, `jsonwebtoken`, `nodemailer` already present — **check `bcryptjs`: master is v2, SP is v3.** v3 dropped the callback API. Pin v2 and grep SP for callback-style `bcrypt.hash(x, y, cb)`.)

### Phase 1 — make it boot (1–2 days)
1. Delete `config/db.js`; strip `dotenv.config()` calls (master loads env first).
2. Rename all 29 models + add explicit `sp_*` collections + rewrite the 77 `ref:` strings.
3. `SPAdmin` → `collection: 'admins'`; `SPUser` → `collection: 'sp_users'` (Phase 1 only).
4. Point `utils/tokenService.js` at `JWT_ACCESS_SECRET || JWT_SECRET`.
5. Create `src/modules/serviceProvider/routes/index.js` — one CJS router that mounts all 60 route files exactly as `server.js` did, minus the `/api` prefix.
6. In `src/routes/index.js` (master, ESM):
   ```js
   import spRouter from '../modules/serviceProvider/routes/index.js';
   router.use('/v1/sp', spRouter);
   // legacy aliases for shipped mobile builds — do not remove
   router.use('/users', spRouter);      // etc. per §2
   ```
7. Boot. Fix `OverwriteModelError` / missing-ref crashes until `/health` is green.

**Exit criterion:** server starts, food + taxi routes still return their old responses, `GET /api/v1/sp/public/cities` returns data.

### Phase 2 — de-duplicate infra (2–3 days)
Work through §5 top to bottom. One service per commit so a regression is bisectable. Highest-risk first: Firebase (double-init crash), then Razorpay (rawBody path), then Redis, then the rest.

### Phase 3 — unify admin auth (1 day)
- The three edits in §4.1.
- `serviceProvider/middleware/authMiddleware.js`: keep the role switch, but for `ADMIN` look up `SPAdmin` (same `admins` collection) and additionally honour `servicesAccess.includes('serviceProvider')` — an admin without it gets 403 on SP routes.
- Keep `/api/admin/auth/login` alive as an alias of master's `adminLoginController` so the ported panel needs no change on day 1.

### Phase 4 — sockets (1 day)
Master owns the single `io`. Convert `sockets/index.js`:
```js
// was: initializeSocket(server) → new Server(server)
const configureSPSocketServer = (io) => {
  const ns = io.of('/sp');
  ns.use(/* existing SP token auth, unchanged */);
  ns.on('connection', /* existing handlers, unchanged */);
};
```
Wire it in `master/Backend/server.js` next to `configureTaxiSocketServer(getIO())`. Rooms (`user_`, `vendor_`, `worker_`, `booking_`) are namespace-scoped, so no collision with food's `user:`/`tracking:` rooms.
Frontend client connects to `io(BASE + '/sp', { auth: { token } })`.

### Phase 5 — background jobs (½ day)
`services/bookingScheduler.js` currently starts from SP's `server.js`. Move the `initializeScheduler(io)` call into master's `startServer()` alongside `expireOffersInterval` / `fssaiExpiryInterval`, gated on `mongoose.connection.readyState === 1` like the others.

### Phase 6 — env merge (½ day)
Merge SP's `.env` keys into master's `.env` / `.env.example` and `src/config/validateEnv.js`.
Collisions to resolve by hand — same key, different value between the two projects: `JWT_SECRET`, `JWT_EXPIRE`, `FRONTEND_URL`, `MONGO_URI`, `RAZORPAY_*`, `CLOUDINARY_*`, `FIREBASE_*`, `REDIS_URL`, `PORT`.
Add SP's allowed origins (`homster.in`, `truliq.com`) to `isOriginAllowed()` in `src/config/env.js` — SP's CORS list is currently hardcoded in its `server.js` and dies with that file.

---

## 7. Frontend — admin panel only

**Where it goes:** master's `/admin/*` shell (`Frontend/src/modules/Food/components/admin/AdminRouter.jsx`) already has the slot — line 306 does exactly this for taxi:
```jsx
<Route path="taxi/*" element={<Navigate to="/taxi/admin/dashboard" replace />} />
```

Steps:
1. Copy `service-provider/Frontend/src/modules/admin/**` → `master/Frontend/src/modules/ServiceProvider/admin/**` (82 files).
2. Copy the shared pieces those pages import — **this is the part that gets forgotten:**
   - `services/api.js` + the 8 `admin*Service.js` files (`adminBookingService`, `adminDashboardService`, `adminReportService`, `adminSettlementService`, `adminTransactionService`, `adminUserService`, `adminVendorService`, `adminWorkerService`) + `cityService`, `planService`, `reviewService`, `settingsService`, `vendorService`, `workerService`
   - `components/auth/ProtectedRoute.jsx`, `PublicRoute.jsx`
   - `components/common/` (`LogoLoader`, `ConfirmDialog`, `Logo`, `SkeletonLoaders`, `LazyImage`, `OptimizedImage`, `CashCollectionModal`, `AnimatedRiderMarker`, `index.jsx`)
   - `context/SocketContext.jsx`, `context/CityContext.jsx`
   - `hooks/useAppNotifications.jsx`, `hooks/useAdminHeaderHeight.js`
   - `utils/` (`apiCache`, `csvExport`, `cloudinaryOptimize`, `cloudinaryUpload`, `imageCompression`, `toast`, `notificationSound`)
   - `theme/`, `firebase.js`
3. Vite alias in `master/Frontend/vite.config.js`:
   ```js
   '@sp': path.resolve(__dirname, './src/modules/ServiceProvider'),
   ```
4. Mount in `AdminRouter.jsx`, replacing the taxi-style redirect with a real nested router:
   ```jsx
   const SPAdminRoutes = lazy(() => import('@sp/admin/routes'));
   <Route path="sp/*" element={<SPAdminRoutes />} />
   ```
   Strip SP's own `<Route path="/login">` — master's `/admin/login` is now the single door. Delete `pages/login.jsx` and swap SP's `ProtectedRoute` for master's `admin/ProtectedRoute.jsx` so both panels share one session.
5. **Token keys.** SP's `api.js` picks its key by `window.location.pathname.startsWith('/admin')` → `adminAccessToken`. Master's admin session uses its own key. Reconcile in `getTokenKeys()` — read master's key first, keep `adminAccessToken` as fallback. Also flip the base URL: `VITE_API_BASE_URL` → `/api/v1/sp`.
6. **Sidebar.** Add a Service-Provider section to `AdminSidebar.jsx`, gated on `servicesAccess.includes('serviceProvider')` — same gate food/taxi already use. SP's own `config/adminMenu.json` is the source of the item list.
7. **Missing deps** to add to master `Frontend/package.json`: `react-dropzone`, `react-switch`, `date-fns`. (`recharts`, `react-icons`, `framer-motion`, `socket.io-client`, `leaflet`, `react-leaflet`, `@react-google-maps/api`, `gsap`, `firebase` already there — note firebase is v11 in master vs v12 in SP; pin v11 and smoke-test FCM.)
8. **Do not port** `modules/user`, `modules/vendor`, `modules/worker`, `modules/landing` from SP's frontend. Those apps keep pointing at the same backend via the legacy `/api/*` aliases and are unaffected.

---

## 8. Data migration scripts (write these, they're the "nothing left behind" part)

| Script | Does |
|---|---|
| `scripts/sp-rename-collections.js` | `db.transactions.renameCollection('sp_transactions')` etc. for all 29. **Run against a restored dump first.** |
| `scripts/sp-merge-admins.js` | copy SP `admins` docs into master's `admins` with `servicesAccess:['serviceProvider']`, `adminLevel:'sp_superadmin'`; de-dupe by email; report collisions instead of overwriting |
| `scripts/sp-link-users.js` | **Phase 2 only.** Normalize phone (`+91` handling — SP has no `countryCode` field, master does), match against `users`, write `sp_user_profiles`, report unmatched |
| `scripts/sp-verify-refs.js` | walk every `SP*` model's paths, assert each `ref` resolves to a registered model. Cheap insurance against a missed rename. |

If SP currently runs on its **own MongoDB**, add a dump/restore step into master's DB before the rename script. Check `MONGO_URI` in both `.env` files before assuming.

---

## 9. Verification checklist

Backend:
- [ ] `/health` and `/ready` green; startup log shows no `OverwriteModelError`
- [ ] Existing food order flow end-to-end (create → dispatch → deliver)
- [ ] Existing taxi ride flow end-to-end
- [ ] SP booking flow: user creates → wave alert reaches vendor → vendor accepts → worker assigned → live tracking on `/sp` namespace → cash/online payment → settlement
- [ ] SP vendor + worker login/registration/approval
- [ ] Razorpay webhook signature verifies for **both** food and SP payments (rawBody path)
- [ ] FCM push arrives for food, taxi **and** SP (single Firebase app)
- [ ] Legacy `/api/users/...`, `/api/vendors/...`, `/api/workers/...` still answer — test with the actual Flutter build
- [ ] `master/Backend` existing smoke tests (`npm test`) still pass

Frontend:
- [ ] one admin login at `/admin/login` reaches Food, Taxi **and** SP sections
- [ ] an admin with `servicesAccess:['food']` sees **no** SP nav and gets 403 on SP endpoints
- [ ] all 22 SP admin page groups render with live data (Dashboard, Users, Vendors, Workers, Bookings+Tracking+Notifications, UserCategories×6, Payments×6, Reports×5, Plans×2, Settlements, Reviews, Scrap, Cities, Notifications, LegalSettings, Settings)
- [ ] CSV export, Cloudinary upload, and the socket-driven booking notification window all work inside master's shell
- [ ] `vite build` succeeds and bundle size hasn't blown up (SP admin is lazy-loaded)

---

## 10. Deliberately deferred — say no now, revisit later

- **Merging `SPVendor`/`SPWorker` into taxi's driver pool.** Different lifecycles. Revisit only if you actually want a driver to take service jobs.
- **Merging `SPCategory`/`SPService` into `FoodCategory`.** Different taxonomies.
- **Converting SP to ESM.** The `package.json` type-scope makes it unnecessary. Do it only if you later need SP to import master's ESM utils synchronously.
- **Porting SP's user/vendor/worker frontends.** Out of scope by your call; they keep working off the legacy aliases.
- **Unified `SPUserProfile` split.** Phase 2, its own PR, its own migration window.
- **A shared notification model across all three services.** Master already has three (`food_notifications`, `TaxiNotification`, SP's). Consolidating is a nice-to-have, not a blocker.

---

## 11. Effort

| Phase | Days |
|---|---|
| 0 prep | 0.5 |
| 1 boot | 2 |
| 2 de-dupe infra | 3 |
| 3 admin auth unify | 1 |
| 4 sockets | 1 |
| 5 jobs | 0.5 |
| 6 env | 0.5 |
| 7 admin frontend | 3 |
| 8 migration scripts + dry run | 2 |
| 9 verification | 2 |
| **Total** | **~15.5 dev-days** |

Phase 2 (user identity merge) is a separate ~3 days after this lands.
