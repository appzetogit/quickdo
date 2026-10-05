# Service-Provider integration — change manifest (Phases 0 & 1)

Recorded by hand because `D:\projects\master\.git` was deleted (it is still in the
Windows Recycle Bin, deleted 12/08/2026 3:19 pm) and the work was authorised to
proceed without version control. This file is the substitute for `git diff`.

Backups of every pre-existing file that was modified:
`C:\Users\ompar\AppData\Local\Temp\claude\D--projects-master\47e67644-0bda-451c-adf8-10154fb741ca\scratchpad\backup-before-sp-integration\`
(`Backend-package.json`, `Backend-src-routes-index.js`, `Backend-server.js` — server.js was
backed up but ultimately **not** modified in these phases.)

---

## Pre-existing master files MODIFIED (2)

### `Backend/package.json`
- dependencies added: `express-validator@^7.3.1`, `multer-storage-cloudinary@^4.0.0`, `streamifier@^0.1.1`
  (the only three externals the SP module requires that master lacked; `bcryptjs` stayed at v2 —
  SP uses no callback-style bcrypt calls, so v3 was not needed)
- scripts added: `test:sp`, `test:sp-unit`
- script changed: `test` now also runs `test:sp` and `test:sp-unit`

### `Backend/src/routes/index.js`
- added `import spRouter from '../modules/serviceProvider/routes/index.js'`
- added `router.use('/v1/sp', spRouter)`
- added a delegating middleware for the legacy prefixes (`/users /user /vendors /workers
  /admin /bookings /payments /notifications /public /scrap /image`) so shipped Flutter and
  seller-APK builds keep working. Registered **last**, so every master route wins on overlap.
  Delegation rather than `router.use('/users', spRouter)` because a prefixed mount strips the
  prefix that spRouter's own table expects.

**Nothing else under `Backend/src/` outside the new module was touched.** Food and taxi code
is byte-identical.

---

## New files created

| Path | What |
|---|---|
| `Backend/src/modules/serviceProvider/**` | the ported module — 199 files, ~34.7k LOC |
| `Backend/tests/sp.smoke.mjs` | 21-check integration smoke test (in-memory Mongo) |
| `SERVICE_PROVIDER_INTEGRATION_PLAN.md` | the full plan |
| `SP_INTEGRATION_CHANGE_MANIFEST.md` | this file |

Module breakdown: config 2, controllers 49, middleware 4, models 30, routes 60,
scripts 29, services 11, sockets 1, tests 3, utils 9.

---

## Changes made INSIDE the ported module (beyond a straight copy)

| File(s) | Change | Why |
|---|---|---|
| `package.json` (new) | `{"type":"commonjs"}` | Node scopes module type by nearest package.json. This one file lets 28k lines of `require()` run unchanged inside an ESM backend. **Deleting it breaks everything.** |
| all 29 `models/*.js` | model renamed to `SP*`, explicit `sp_*` collection pinned, wrapped in `mongoose.models.X \|\| ...` | `Transaction`/`Settlement` collided with `core/payments` at both model-name and collection level (boot crash); the rest would have silently pluralised onto master's live collections |
| 22 files across `models/ controllers/ services/` | 77 `ref:`/`model:` strings rewritten to the `SP*` names | consequence of the renames |
| `models/index.js` (new) | eagerly requires all 29 models | otherwise a model registers only when some controller happens to require it first, and any `populate()` on an unloaded model throws `MissingSchemaError` at request time |
| `routes/index.js` (new) | verbatim transcription of the old `server.js` mount block, minus `/api` | **mount order is load-bearing** — five files share the `/vendors` prefix, and `cityManagement.routes.js` does a path-less `router.use(isSuperAdmin)` on `/admin` |
| `config/db.js` | early-return when `mongoose.connection.readyState !== 0`; reads `MONGO_URI \|\| MONGODB_URI` | 17 standalone scripts still need it, but inside the server process master has already connected — a second `connect()` would open a second pool |
| `utils/tokenService.js` | secret resolves as `JWT_ACCESS_SECRET \|\| JWT_SECRET` | master resolves it that way; with both env vars set the two halves would sign with different keys and cross-module tokens would fail |
| `models/Admin.js` | `SPAdmin` pinned to the **shared** `admins` collection; `servicesAccess` field declared | the deliberate day-1 merge. The field must be declared or mongoose strict mode drops it on non-lean reads and the access gate below sees `undefined` |
| `utils/serviceAccess.js` (new) | `hasServiceProviderAccess()` | **security.** Pointing SPAdmin at the shared collection means a food/taxi admin's email+bcrypt passes SP's login, and their token (same secret) verifies in SP's middleware. Gate: non-empty `servicesAccess` must include `serviceProvider`; absent/empty allows (SP-native admins created before the merge migration) |
| `controllers/adminControllers/adminAuthController.js` | gate applied at login | closes the login path |
| `middleware/authMiddleware.js` | gate applied in the `ADMIN` branch | closes the token path, incl. master-issued tokens |
| `scripts/cleanupPlans.js`, `scripts/fixVendorAadharBack.js` | raw `db.collection('plans'\|'vendors')` → `sp_plans` / `sp_vendors` | they bypass mongoose, so the renames didn't reach them |

### Deleted during the copy
- `controllers/deleteScrap.tmp.js`, `controllers/notificationControllers/deleteAllNotifications.tmp.js` — dead one-off scratch files, referenced by nothing.

### Not copied (deliberate)
`node_modules/`, `scratch/`, `api/index.js` (Vercel shim), `server.js`, and ~20 root-level
`inspect_*.js` / `debug_*.js` / `test-*.js` one-offs.

### Not mounted (matches the old `server.js` exactly)
`routes/booking-routes/vendorBooking.routes.js` and `routes/cityRoutes.js` — dead in the source
project too. Left dead rather than newly exposing untested endpoints.

---

## Verification actually run

- `npm test` (master's pre-existing suites): **46/46 pass** — flow 11, unify 5, assignment 12, workmode 8, api 10. No regressions.
- `npm run test:sp`: **21/21 pass** — model registry, collection isolation, master routes unaffected, SP canonical prefix, legacy prefixes, no shadowing of master, and the shared-`admins` access gate (a `servicesAccess:['food']` admin is rejected with 403; a legacy SP-native admin and a `serviceProvider`-scoped admin both get in).
- `npm run test:sp-unit`: **26/26 pass** — SP's own three ported suites (security 8, transaction 9, payment-verification 9).

---

## Known issues carried forward (not regressions)

1. **Firebase credential file missing.** `services/firebaseAdmin.js` logs
   `Failed to load Firebase credentials: Cannot find module ...truliq-firebase-adminsdk-*.json`.
   That file never existed in the source project either — this is pre-existing and degrades
   gracefully (`if (!admin.apps.length && serviceAccount)`). Phase 2 replaces this file with
   master's Firebase entirely. In the merged process master initialises the default app first,
   so SP's `admin.messaging()` calls already fall through to master's app.
2. **Every SP admin endpoint requires `role: 'super_admin'`**, because
   `cityManagement.routes.js:20` has a path-less `router.use(isSuperAdmin)` and is mounted on
   `/admin` ahead of the rest. Faithful to the old `server.js`. Pinned by a test so a later
   refactor of the mount order can't silently widen access.
3. **SP still runs its own infra** — Redis, Cloudinary, Razorpay, SMS, email, OTP, rate limiter,
   and its own socket server is not yet attached. That is Phase 2 / Phase 4; nothing in these
   phases wired `sockets/index.js` or `bookingScheduler` into master's `server.js`, so SP
   sockets and the wave-based booking scheduler are **not running yet**.
4. **`SPUser` is on `sp_users`, not `users`.** Deliberate — see plan §4.2. Phase 2 splits
   identity from profile and migrates.

---
---

# Phases 2 (partial), 3, 4, 5, 6, 7

## Additional pre-existing master files MODIFIED (6)

| File | Change |
|---|---|
| `Backend/server.js` | attach SP sockets to namespace `/sp` (step 3c) + `app.set('io', spNamespace)`; start the SP booking scheduler in `startIntervals()`; `spScheduler.stop()` in graceful shutdown |
| `Backend/src/config/env.js` | `isOriginAllowed()` now allows `homster.in` / `truliq.com` (+ subdomains). Without this every shipped SP web client is CORS-blocked. |
| `Backend/src/core/admin/admin.model.js` | `servicesAccess` enum gains `'serviceProvider'` |
| `Backend/src/core/admin/adminHierarchy.constants.js` | `SERVICE_PROVIDER_SUPERADMIN` level, `SERVICE_PROVIDER` module, new `MODULE_SUPERADMIN_LEVELS` table |
| `Backend/src/core/admin/adminHierarchy.service.js` | 5 functions made table-driven off `MODULE_SUPERADMIN_LEVELS` instead of hardcoded food/taxi pairs |
| `Backend/src/core/auth/auth.service.js` | auto-provisioned default admin now gets `serviceProvider` in `servicesAccess` |
| `Frontend/vite.config.js` | `@sp` alias |
| `Frontend/package.json` | `react-dropzone`, `react-switch`, `date-fns`; `build` script pinned to `--max-old-space-size=8192` (the existing build OOMs at the default heap) |
| `Frontend/src/modules/Food/components/admin/AdminRouter.jsx` | `sp/*` route, mounted OUTSIDE master's AdminLayout (see below) |
| `Frontend/src/modules/Food/components/admin/AdminSidebar.jsx` | third "Services" module tab; all three tabs now gated by `useServiceAccess()` |

**Backward-compat note on the hierarchy change:** a taxi-only superadmin still resolves to
`PLATFORM_SUPERADMIN`, exactly as before. Generalising that would have silently demoted live
accounts. It does not leak into SP, which gates on the `servicesAccess` array directly. Pinned
by a regression test.

## New files

`Frontend/src/modules/ServiceProvider/**` (107 files), `Backend/tests/sp.runtime.smoke.mjs`,
`Backend/tests/sp.endpoints.smoke.mjs`, `Backend/scripts/dev-inmemory-server.mjs`,
`.claude/launch.json`.

## Frontend structure decision

SP's pages ship their own `AdminLayout` (sidebar + a `position: fixed` header). Nesting them
inside master's `AdminLayout` produced **two sidebars and two overlapping headers**. So `sp/*`
is mounted as a sibling of master's layout block, wrapped in `ProtectedRoute` only — the same
shape taxi already uses (it owns its chrome inside `TaxiApp`). Auth is still fully shared:
one `/admin/login`, one token, one `admins` collection. A module switcher was added to SP's
own sidebar so there is a way back to Food/Taxi.

The 82 admin files' outward imports were rewritten to the `@sp` alias (65 rewrites across 47
files); a checker confirms **zero** relative imports now escape the module.

## Bugs found and fixed (all pre-existing in the source project, not regressions)

1. **`adminDashboardController.js` — `ReferenceError: Transaction is not defined`.**
   `Transaction` was required *inside* `getDashboardStats`, so `getRevenueAnalytics` referenced
   an out-of-scope binding. `/admin/dashboard/revenue` returned 500 on every call, in the
   standalone app too. Hoisted the require to module scope.
2. **`adminVendorController.js:325` — `Class constructor ObjectId cannot be invoked without 'new'`.**
   mongoose 7+ made `ObjectId` a real class. `/admin/vendors/:id/earnings` returned 500.
   Fixed; swept the module for other bare `ObjectId(` calls — none.
3. **`notificationController.js` — `io.sockets.adapter` on a Namespace.**
   Introduced by the socket-namespace move; `.adapter` lives directly on a Namespace. It sits
   inside a `try/catch`, so instead of crashing it would have silently reported every user as
   offline and skipped the in-app socket emit. Reads both shapes now.

These were found by `tests/sp.endpoints.smoke.mjs`, which walks the live express router table
and calls all 129 SP GET endpoints. 4xx is tolerated (missing fixtures); any 5xx fails the run.

## Verification actually run

- `npm test` — **all green**: master 46, `sp.smoke` 38, `sp.runtime` 21, `sp.endpoints` 129 routes / 0×5xx, SP's own 26.
- Real browser, real backend (in-memory Mongo, `scripts/dev-inmemory-server.mjs`): logged in
  through **master's** `/api/v1/auth/admin/login`, loaded `/admin/sp/dashboard` and
  `/admin/sp/vendors`. Pages render, one header, one sidebar, 10 SP API calls succeed,
  `/admin/dashboard/revenue` returns 200.
- `vite build` succeeds; SP chunks present in `dist`.
- Boot log confirms `Service-Provider booking scheduler started` and `[SP Socket] handlers
  attached to namespace /sp`.

## What is still NOT done

**Phase 2 is only partially complete.** Merged so far: sockets (one io, namespace `/sp`),
CORS, Firebase credentials (SP reads master's `FIREBASE_SERVICE_ACCOUNT`; master's app wins the
init guard so SP already uses it), Redis server (SP prefers `REDIS_URL`).

Still duplicated, each still its own instance/config:
`services/cloudinaryService.js`, `services/razorpayService.js`, `services/smsService.js`,
`services/emailService.js`, `services/otpService.js` + `utils/redisOtp.util.js`,
`middleware/rateLimiter.js`, `middleware/uploadMiddleware.js`, and SP's own ioredis pool.

**Razorpay webhook rawBody is unverified.** `app.js` only captures `req.rawBody` for URLs
containing `/webhook/razorpay`. SP verifies payments via `razorpay_signature` on normal POST
bodies rather than a webhook, so this is probably fine — but it has not been exercised against
a real Razorpay callback.

**Phase 8 (data migration) is not started.** No script has run. Your existing SP data is still
in collections named `users`, `bookings`, `transactions`… while the code now reads `sp_*`.
Until the rename/migration runs against one database, the module reads empty collections.

**Phase 9** end-to-end verification against real data has not happened, for the same reason.

---
---

# Phase 8 — data migration

## The clusters are separate

Confirmed by reading both `.env` files (values never printed):

| | host | db |
|---|---|---|
| master | `k9.spowyus.mongodb.net` | `K9` (via `MONGODB_DB_NAME`) |
| service-provider | `cluster0.ozwnh8j.mongodb.net` | `Truliq` |

So this is a **cross-cluster copy with renames**, not the in-place `renameCollection` the
original plan sketched. `scripts/sp-migrate-data.js` was written for that shape.

## `Backend/scripts/sp-migrate-data.js`

Safety properties, all covered by tests:

- **Dry run by default.** Nothing is written without `--apply`.
- **Never drops, renames or deletes** anything, on either cluster. The source is opened
  read-only in practice — no code path writes to it.
- **Idempotent** — documents are upserted by `_id`, so re-running converges.
- **Refuses a non-empty target** unless `--force`, so a second run cannot quietly clobber
  data written since the first.
- **Nothing left behind**: it lists the source's actual collections and loudly reports any
  that are not in the map, with document counts, instead of silently skipping them.
- **Admins merge is insert-only.** An email that already exists on the target is reported and
  skipped, never overwritten — that is somebody's live login. New SP admins are stamped
  `servicesAccess: ['serviceProvider']`, `adminLevel: 'sp_superadmin'`.
- **Identity overlap is reported, not acted on**: it counts phone numbers present in both
  SP's users and master's shared `users`. Those are the accounts the later identity merge
  (plan §4.2) would link. Nothing is merged now.

Modes: `--apply`, `--force`, `--verify`, `--only=a,b,c`.

## `Backend/tests/sp.migration.smoke.mjs` — 30 checks, all passing

Spins up two throwaway MongoDBs (fake Truliq + fake K9), seeds the source with the old
collection names, an unmapped collection, and an admin whose email already exists on the
target, then runs the real script as a child process. Asserts:

- dry run writes literally nothing (all four target counts unchanged)
- apply lands every collection at its `sp_*` name
- **master's `transactions` and `users` are untouched** — SP's land in `sp_transactions` /
  `sp_users`. This is the check that proves the whole rename was worth doing.
- the colliding admin keeps its name and its `['food']` access; the collision appears in the report
- the new SP admin gets `serviceProvider` access
- the shared phone number is counted
- re-running does not duplicate, and refuses to clobber without `--force`
- `--force` upserts rather than duplicating
- `--verify` passes after a good copy

## NOT run against production

The dry run against the real clusters was **not** executed — it needs the Truliq connection
string, and handling those credentials was correctly blocked. Run it yourself:

```
cd Backend
SP_SOURCE_MONGO_URI="<truliq connection string>" npm run migrate:sp-data
```

Read the report — especially the "NOT IN THE MAP" section — before adding `--apply`.

## Full suite after Phase 8

master 46 · sp.smoke 38 · sp.runtime 21 · sp.endpoints 129 routes/0×5xx · sp.migration 30 ·
SP's own 26. All green.

---
---

# Phase 2 — infrastructure de-duplication

I measured each duplicate before touching it. Most of what the plan listed as "duplicated
infra" turned out to be two clients pointed at the **same account via the same env vars** —
real duplication in the file listing, no duplication in behaviour, and rewiring ~20 call
sites across a CJS/ESM boundary to change nothing would have been churn with a regression
budget attached. What follows is what was actually wrong.

## Removed — dead code, zero consumers

| File | Why it was dead |
|---|---|
| `middleware/rateLimiter.js` | its only caller was the standalone `server.js`, which was never ported. Master already applies `apiRateLimiter` to all of `/api`, so SP was double-counted-by-nobody. |
| `services/otpService.js` | superseded by `utils/redisOtp.util.js`; nothing imported it. |

## Fixed — real defects

**SMTP connection leak.** `emailService.js` built a **new nodemailer transport on every
send**, across six send sites. Each one opens its own connection pool and never closes it,
so a burst of mail exhausts connections against the provider. Now memoised, matching how
master's `src/services/email.service.js` already did it. Also fixed `secure` — it was
hardcoded `false`, which is wrong on port 465 (implicit TLS); it now derives from the port.

**OTP lockout policy could diverge.** Both modules read `OTP_MAX_ATTEMPTS`, so their
effective values always agree in a configured environment — but the *fallbacks* differed
(SP 3, master 5), so an unset var gave the platform two different lockout policies. Aligned
to 5.

## Measured and deliberately left alone

| Duplicate | Finding |
|---|---|
| Cloudinary (`config/cloudinary.js`, `services/cloudinaryService.js`, `utils/cloudinaryUpload.js`) | The cloudinary SDK's `config()` is **process-global**. SP and master set the same three env vars, so both calls resolve to one account. Asserted by a test rather than assumed. 18 files import SP's wrapper; rewiring them changes nothing observable. |
| Razorpay | Same `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. Two client objects, one merchant account. Rotating the env var already fixes both — the "second thing to rotate" argument does not hold. |
| SMS | Same `SMS_INDIA_HUB_*` credentials, same provider. |
| Redis | SP holds **one lazy singleton** ioredis connection (not a pool per call), master holds one node-redis client. Two connections total to the same server. Unifying means porting SP's live-tracking geo helpers from ioredis to node-redis — real risk to live tracking, for two connections. Not worth it. |
| OTP storage | No key collision: master stores OTPs in **Mongo** (`food_otps`), SP in **Redis** (`otp:<phone>`). Genuinely separate stores. |
| `middleware/uploadMiddleware.js` | 3 consumers, multer storage is configured at module load — replacing it means an async import in a sync path. Same multer version, same Cloudinary account. |

**One thing worth knowing, not a bug:** because food and SP run independent OTP rate limits
against different stores, the same phone can request `OTP_RATE_LIMIT` codes from each. If you
want a single platform-wide SMS budget per number, that is a deliberate feature, not part of
this cleanup.

## Pinned by tests

`tests/sp.runtime.smoke.mjs` section [4] now asserts: both deleted files stay deleted, the
SMTP transport is reused across calls, SP and master resolve to the same Cloudinary account,
and the OTP fallbacks agree.

Full suite after this phase: master 46 · sp.smoke 38 · sp.runtime 27 · sp.endpoints 129
routes/0×5xx · sp.migration 30 · SP's own 26. All green.

---
---

# Platform-wide OTP rate limit

## What was actually there

| service | throttle | effective |
|---|---|---|
| food (`core/otp`) | Mongo `requestCount`, **per scope** | one quota each for user / restaurant / delivery |
| taxi user login | none | unlimited |
| taxi driver login | none | unlimited |
| taxi driver onboarding | none | unlimited, and open to unauthenticated callers |
| service-provider | Redis `rate:otp:<phone>`, **fails open when Redis is down** | **nothing** — `REDIS_ENABLED` is unset, so `isRedisConnected()` is false and every request was waved through |

So only food throttled anything, and even it handed out a fresh quota per scope. The
practical limit on SMS spend against a single number was close to none.

## What it is now

`src/core/otp/otpRateLimit.service.js` + `otpRateLimit.model.js` — one budget per phone
number, consumed by every OTP send path on the platform.

- **Mongo-backed, not Redis.** A rate limiter that silently vanishes when an optional
  cache is disabled is not a rate limiter. Mongo is always present; Redis is not.
- Keyed by the normalised **last 10 digits** as `_id`, so `+91XXXXXXXXXX`,
  `91XXXXXXXXXX` and `XXXXXXXXXX` are one budget and concurrent requests contend on a
  single document. Reuses master's existing `normalizePhoneToTenDigits`.
- `OTP_RATE_LIMIT` requests per `OTP_RATE_WINDOW` seconds (default 3 / 600) — same env
  vars as before, so no config change is needed.
- Fails open on a DB error, logged. If Mongo is unreachable the platform is down anyway;
  refusing logins on top of that helps nobody.
- Refusals return **429** with a shared `otpRateLimitMessage()` so every service says the
  same thing.

Wired into all five send paths: `core/otp/otp.service.js`, taxi `userOtpService`,
`loginOtpService`, `onboardingService`, and SP's `redisOtp.util.js` (via `await import()`,
since that module is CommonJS and core is ESM).

Food's `requestCount` is still written to the OTP record for support/debugging, but it no
longer enforces anything. SP's Redis counter and its dead `RATE_LIMIT_*` constants are gone.

## Known ceiling

Two genuinely concurrent *first* requests for a number can both open a window and both set
`count = 1`, letting one extra SMS through at a window boundary. Bounded at +1 per window,
marked with a `ponytail:` comment. A findAndModify token bucket would close it; not worth
the complexity unless boundary spend ever shows up.

## Tests — `tests/otp.ratelimit.smoke.mjs`, 26 checks

The one that matters is cross-service: spend the budget across taxi's three entry points,
then confirm **food and service-provider are already exhausted for that number**. Also
covers per-number isolation, window reset, fail-open on junk input, five phone formats
collapsing to one counter, no Redis dependency, and a static check that all five send paths
call `consumeOtpQuota` and that the old per-service counters are gone.

## Worth knowing

In development this now applies to you too: more than `OTP_RATE_LIMIT` logins with the same
test number inside the window will be refused across every service. Raise `OTP_RATE_LIMIT`
locally if that gets annoying.
