# Master Product: audit and implementation plan

Written against the code in this repo as of `2d0a2c1`, not from first principles.
It continues `SUPERAPP_DATA_MODEL.md`, `QUICK_COMMERCE_INTEGRATION_PLAN.md` and
`SERVICE_PROVIDER_INTEGRATION_PLAN.md` rather than replacing them.

There are **four** verticals in the tree, not three. `modules/serviceProvider`
(199 files) is a home-services marketplace with its own users, workers, wallets,
settlements and bookings. Any plan that only names Food / Quick Commerce / Taxi
leaves a quarter of the duplication in place.

---

## 0. The headline

Two facts dominate everything below.

**1. Quick Commerce is a source fork of Food, not a vertical.**

```
Backend/src/modules/food/                        248 files
Backend/src/modules/quickCommerce/modules/food/  234 files   <-- a copy
Backend/src/modules/quickCommerce/core/           36 files   <-- a copy of core/
```

`modules/quickCommerce/` contains its own `core/users`, `core/payments`,
`core/notifications`, `core/otp`, `core/roles`, `core/refreshTokens`,
`core/admin`, its own `middleware/`, its own `dtos/`, and a full copy of the
food domain down to `chat`, `landing`, `dining` and `restaurant`. Every
quick-commerce file is a divergent copy of a food file with the mongoose model
name and collection rewritten. `SUPERAPP_DATA_MODEL.md` already measured the
order models: **112 of ~130 fields shared**.

This is not "duplicated logic worth unifying some day". It is the reason every
food bug has to be fixed twice and usually is not.

**2. The unification has already started, is well built, and nothing consumes it.**

`core/finance/riderFinance.service.js` is a genuinely good single source of
truth for rider money across taxi + food + QC. `core/identity/` links the
identities. `core/finance/financeLock.js` closes the derived-balance write-skew
hole. `modules/taxi/driver/services/driverAssignmentService.js` implements an
atomic cross-service busy-lock. `unifiedDispatchService.js` implements the one
eligible-driver query all dispatchers should use.

But:

- `findEligibleUnifiedDrivers()` is **imported by nobody**. Food and QC dispatch
  each hand-roll the same filter instead (`order-dispatch.service.js:32` and the
  QC fork's `:294`).
- `getRiderFinance()` is called only from **wallet read screens and withdrawal
  approval**. No dispatcher calls it. So the unified eligibility decision exists
  and is not the decision that gates work.
- The whole unified path is behind `UNIFIED_DISPATCH_ENABLED`, **default off**
  (`config/env.js:198`).

So the work is less "design a master platform" than "finish, connect and switch
on the master platform that is half-built, then collapse the fork that keeps
recreating the problem."

---

## A. Master Product issues — where it behaves as separate products

| # | Issue | Evidence |
|---|---|---|
| A1 | QC is a full fork of Food incl. its own `core/` | `modules/quickCommerce/core/{users,payments,notifications,otp,roles,admin}` |
| A2 | Four customer identities | `FoodUser`→`users`, `QCUser`→`qc_users`, `TaxiUser`→**`users`**, `SPUser`→`sp_users` |
| A3 | **Two schemas write the same `users` collection** | `core/users/user.model.js:147` and `modules/taxi/user/models/User.js:221` both declare `collection: 'users'` |
| A4 | Four partner/worker identities | `FoodDeliveryPartner`, `QCDeliveryPartner`, `TaxiDriver`, `SPWorker` |
| A5 | Five-plus wallets | `food_delivery_wallets`, `qc_delivery_wallets`, `food_user_wallets`, `qc_user_wallets`, `TaxiUserWallet`, embedded `Driver.wallet`, SP vendor/worker/user wallets |
| A6 | Three dispatchers, three eligibility rules | see G1 |
| A7 | Two notification stacks, plus two more | `core/notifications/*` vs `modules/quickCommerce/core/notifications/*` (file-for-file copy); plus `taxi/services/pushNotificationService.js`, `serviceProvider/services/firebaseAdmin.js` |
| A8 | Two Razorpay webhook handlers | `core/payments/controllers/razorpayWebhook.controller.js` and the QC copy |
| A9 | Two Firebase initialisations | `config/firebase.js`, `modules/quickCommerce/config/firebase.js` |
| A10 | Admin panel unified by **string substitution** | `AdminSidebar.jsx` rebases `/admin/food/*` paths and rewrites labels word-by-word via `verticalVocabulary.js` |
| A11 | Taxi admin is a separate frontend module | `Frontend/src/modules/Taxi` (389 files) vs `Frontend/src/modules/Food` (599) |
| A12 | Settings scattered across ~12 models per vertical | `feeSettings`, `businessSettings`, `cashbackSettings`, `referralSettings`, `AdminAppSetting`, `AdminBusinessSetting`, SP `Settings`, each duplicated in QC |
| A13 | No master job/order concept | `FoodOrder`, `QCOrder`, `Ride`, `Delivery`, `SPBooking`, `BusBooking`, `PoolingBooking`, `RentalBookingRequest` |

---

## B. Duplicate logic (concrete)

| Concept | Food | Quick Commerce | Taxi | Service Provider |
|---|---|---|---|---|
| Dispatch | `order-dispatch.service.js` (507 L) | same file, forked (797 L) | `dispatchService.js` (1625 L) + `matchingService.js` (462 L) | wave alerting in booking controllers |
| Partner wallet | derived on read (`deliveryFinance.service.js`) | derived plus a **stored** `cashInHand` | signed embedded `Driver.wallet.balance` | `Transaction` + `Withdrawal` |
| Cash limit | `FoodFeeSettings.codOrderLimit` / `deliveryCashLimit` | its own copy | encoded as negative `minimumBalanceForOrders` | `cashCollectionController.js` |
| Notifications | `core/notifications` | byte-for-byte fork | `pushNotificationService.js` | `firebaseAdmin.js` + `mirrorNotification.js` |
| Payments / refunds | `core/payments` | fork | inline in `rideService.js` | `paymentController.js` |
| OTP / refresh tokens / roles | `core/*` | fork | `UserAuthSession`, `DriverLoginSession` | `Token.js` |
| Support tickets | 3 models (user, restaurant, delivery) | the same 3, forked | `SupportTicket.js` | in booking flow |
| Ratings | on `order`, `restaurant`, `deliveryPartner` | forked | on `Ride`, `Driver` | `Review.js`, `Worker`, `Vendor` |
| Chat | `food/chat` | fork | `taxi/chat` | — |
| Zones / service areas | `zone.model.js` + `zoneMatching.js` | fork | `Zone.js`, `ServiceLocation.js` | `City.js` |
| Promo / coupons | `offer`, `offerUsage`, `bogoOffer`, `freebieOffer` | fork | `PromoCode`, `PromoRedemption`, `PromoUserCounter` | `Plan.js` |
| Commission | `foodTransaction.service.js` | fork | `SetPrice.js` + `adminService` | `PlatformEarning.js` |

---

## C. Globalization classification

**GLOBAL** — one implementation, no vertical branch:
Auth, OTP, refresh tokens, roles/permissions, users, partner identity, partner
state machine, partner capabilities, wallet and ledger, cash limits,
transactions, payments, webhooks, refunds, settlements, KYC and documents,
addresses, geolocation and distance, service areas, notification transport,
audit log, idempotency, admin permissions, support tickets, file uploads,
Firebase init.

**GLOBAL + VERTICAL STRATEGY** — one engine, pluggable rules:
Assignment/dispatch, eligibility, pricing, commission, cancellation, refund
policy, ratings, promotions, job lifecycle, notification templates, settlement
schedules, configuration resolution, analytics aggregation.

**VERTICAL-SPECIFIC** — genuinely different, keep separate:
Restaurant / menu / kitchen state / Petpooja; dark-store inventory / picking /
packing / returns; ride lifecycle, fare metering, pooling, rentals, bus and seat
booking, safety and SOS; SP vendor / worker / parts catalogue / service
catalogue.

**Order aggregates:** collapse Food + QC into one discriminated `orders`
collection (per `SUPERAPP_DATA_MODEL.md` Move 1). Keep `Ride` and `SPBooking`
separate — they share about five real domain fields with an order; merging
produces a null-column table.

---

## D. Data model problems

1. **`users` collection served by two different schemas** (A3). A taxi write can
   drop or reshape fields the food schema requires. Highest-severity data issue
   in the repo.
2. **QC models carry a stale `collection:` option** that the third `model()`
   argument overrides — `deliveryWallet.model.js:30` says `food_delivery_wallets`,
   line 33 registers `qc_delivery_wallets`. Reading the schema tells you the wrong
   collection.
3. **`food_delivery_wallets` is a designed-but-dead collection** — zero documents,
   no reader, no writer (documented in `riderFinance.service.js`). Food derives its
   wallet on every read from orders + deposits + bonuses + withdrawals.
4. **No ledger.** There is no append-only `wallet_transactions` with
   `balance_before` / `balance_after`. Taxi has `WalletTransaction`; food and QC
   have none; SP has its own `Transaction`. A balance cannot be reconstructed or
   audited platform-wide.
5. **Cash-in-hand encoded three ways**: explicit field (QC), derived (food),
   negative signed balance (taxi). `splitSignedTaxiBalance()` exists only to undo
   the third.
6. **Identity linkage is by phone regex suffix** (`{ phone: /1234567890$/ }`) —
   unindexed, O(collection), and a heuristic. `identityLink.service.js` is
   migrating this to an explicit `platformUserId`; it is not finished.
7. **Status enums contradict**: `picked_up` / `journey_started` / `work_done` /
   `on_the_way` for the same lifecycle point across the four verticals.
8. **Settings are per-vertical singleton documents** with no hierarchy, no
   region or partner override, and no precedence rule.
9. Duplicate support-ticket models (six of them), duplicate `Admin`, `Category`,
   `Zone`, `Notification`, `Settlement` and `Transaction` models.

---

## E. API problems

- `/v1/food/delivery/wallet`, the QC equivalent under `/v1/qc/...`, the taxi
  driver wallet, and SP's `/vendor/wallet` + `/worker/wallet` are five endpoints
  for one balance. Target: **`/v1/partner/wallet`**.
- `/v1/food/delivery/availability` (PATCH) vs the taxi online toggle vs SP
  `/worker/toggle-online` — three writers to one availability concept, none
  authoritative. Target: **`/v1/partner/status`**.
- `/v1/auth` and `/v1/food/auth` are the same router mounted twice
  (`routes/index.js:95,98`); QC and SP have their own auth entirely.
- Two public webhook routes for one Razorpay account.
- `requireModuleEnabled(MODULES.X)` gates whole verticals, but there is no
  equivalent gate on the shared `/v1/food/*` and `/v1/auth` mounts.
- Idempotency is applied to exactly **four** routes platform-wide
  (`order.routes.user.js:27,28` in both trees, plus QC returns). Every other money
  and state-changing endpoint is unprotected — including
  `/wallet/deposit/verify`.

---

## F. Frontend problems

- `Frontend/src/modules/Food` (599 files) is the admin panel for Food, Quick
  Commerce **and** Medical, unified by `rebaseAdminMenu()` doing URL rewriting
  plus regex word substitution on every menu label. It works, but domain
  vocabulary by `String.replace` is a maintenance trap: a new label is
  mislabelled by default and the failure is silent. The comment at
  `AdminSidebar.jsx:173` records that this already caused QC banner uploads to
  land in food.
- `Frontend/src/modules/Taxi` (389 files) and `ServiceProvider` (107) are
  separate admin implementations — separate API clients (`Taxi/shared/api`,
  `ServiceProvider/services/api.js`, `src/services/api`), separate auth state,
  separate tables, pagination and toasts.
- `DeliveryV2` (56 files) is a third partner-facing UI alongside whatever Food
  and Taxi already have.
- No shared wallet widget, transaction table, partner-status chip, or
  assignment panel.

---

## G. Business logic problems

**G1 — three different answers to "may this partner take this job".**

```
Food   (order-dispatch.service.js:197-264)
       recomputes cashInHand from delivered orders minus completed deposits,
       clamps at 0, compares the projected figure against FoodFeeSettings.
       Does NOT read the taxi wallet.

QC     (order-dispatch.service.js:255)
       reads a STORED wallet.cashInHand field and excludes >= limit.
       Different number, different source, same business rule.

Taxi   (dispatchService.js:1373, matchingService.js:80)
       checks only wallet.isBlocked and isOnRide. NO cash check at all.

riderFinance.getRiderFinance()
       the correct combined answer, with both gates.
       Called by NO dispatcher.
```

A rider at the cash ceiling from food deliveries is still offered rides. This is
exactly the bypass described in §8 of the brief, and it is live.

**G2 — negative balances are clamped in the wrong place, twice over.**
`riderFinance` is careful about this (it clamps once after summing, and its
comments explain the double-withdrawal bug that clamping early caused). But
`deliveryFinance.service.js:91,101` and `order-dispatch.service.js:263` still
clamp per-vertical before any summing, and taxi encodes owed cash as a negative
balance that then has to be split apart. There is no single signed ledger
balance anywhere.

**G3 — the busy-lock is correct but optional.** `claimDriverAssignment()` is a
proper atomic CAS. It is only consulted when `UNIFIED_DISPATCH_ENABLED=true`,
which is off. With it off, food and taxi can both assign the same person.

**G4 — capability enforcement waves through unlinked partners.** Every matcher
treats "no `driverId`" as "not migrated, allow"
(`order-dispatch.service.js:51`). Every food-app signup is unlinked (see the
`ensureUnifiedDriverForPartner` docstring), so admin capability decisions have no
effect on the majority of partners.

**G5 — commission and pricing computed in three unrelated places**, with
`Math.max(0, …)` clamps scattered through controllers
(`foodTransaction.service.js:77-95`, `order-pricing.service.js:487`, taxi
`SetPrice`, SP `PlatformEarning`).

**G6 — cancellation has no shared framework.** Each vertical decides who
cancelled, what the fee is, and whether a penalty applies, in its own controller.

**G7 — refunds** exist in `core/payments/refund.service.js`, in the QC fork of
it, and inline in SP and taxi.

---

## H. Edge cases (32 beyond the brief)

**Assignment and concurrency**

1. Two dispatchers `$geoNear` the same driver in the same tick; both offer; the driver double-accepts on two devices.
2. Driver accepts a ride while a food offer is still open on screen — the stale offer accepts against a now-busy driver.
3. `claimDriverAssignment` succeeds but the subsequent order write fails: driver locked to a job that does not exist, with no compensating release except the staleness sweep.
4. Order cancelled after the claim but before the driver opens the app — lock held on a dead order.
5. Driver goes offline mid-offer; the offer timer still fires and assigns.
6. Zone deleted or redrawn while an order is dispatching — `filterCandidatesToZone` drops every candidate and the order is silently unassigned.
7. Restaurant has no coordinates (`order-dispatch.service.js:70`): distance is ignored entirely, only zone applies.
8. Stale GPS (>10 min) partner is kept with `distanceKm: 999` when no zone is enforced — an offer to someone possibly in another city.
9. `NODE_ENV !== 'production'` allows `pending` partners to be dispatched (`:104`), so a staging rehearsal does not reproduce production behaviour.
10. Two `2dsphere` indexes on `Driver` mean any `$geoNear` written without an explicit `key` throws — and only at runtime.

**Money**

11. Withdrawal approved at the same moment a cash deposit is verified: `financeLock` covers withdrawals, deposits do not take it.
12. Razorpay sends the same webhook twice; the handler has no idempotency key, so the credit lands twice.
13. A Razorpay webhook for a food payment arrives at the QC fork's handler — both routes are public and both accept any signature-valid event.
14. Payment captured, order write fails: money taken, no order, no refund path.
15. Refund issued for an order whose rider earning was already settled.
16. Cash deposit verified twice (double-tap on `/wallet/deposit/verify`, which has no idempotency middleware).
17. Partner crosses the cash ceiling *during* a job: food recomputes on next dispatch, taxi never notices.
18. Admin adjusts a taxi wallet while a delivery withdrawal is mid-approval — different lock domains, same money.
19. Negative `riderEarning` from a commission rule larger than the delivery fee, clamped to 0, silently losing the platform's recovery.
20. Tip paid in cash counted as platform cash-in-hand.
21. A rider with QC earnings and no taxi link gets `linked: false`, and their QC money is invisible on the taxi wallet screen.
22. Two partner records (food and QC) exist for one phone but only one carries `driverId` — `resolveRiderIdentity` returns one id and half the money.

**Identity and state**

23. Phone number reused by a new person: `ensurePlatformUser` suffix-matches them onto the previous owner's history.
24. Same phone stored as `+919…` in one vertical and `919…` in another — the suffix match works, exact joins do not.
25. Driver approved on taxi but `syncDeliveryApproval` fails silently (it logs and returns): approved for rides, pending for food, no alert.
26. Capability revoked while online — `coerceWorkMode` fixes it on the next write, but a driver sitting online is never re-coerced.
27. Suspension applied while the partner holds cash: no rule for who collects it.
28. Partner logs in on two devices. `DriverLoginSession` is taxi-only; food and QC have no session concept, so two live sockets both write availability.
29. Customer exists in `users` (food) and `qc_users` with different addresses; an order placed in one vertical cannot reuse the other's address book.
30. Module disabled via `requireModuleEnabled` while jobs are in flight — those jobs become unreachable through the API.
31. Order placed against a restaurant whose zone has no approved partner and no fallback: stuck in `pending` with no timeout.
32. A `FinanceLock` holder overruns `holdMs = 30s`; a second holder takes over and both write.

---

## I. Race conditions

| # | Where | Nature | Present mitigation |
|---|---|---|---|
| I1 | Cross-vertical assignment | Two dispatchers claim one driver | `claimDriverAssignment` CAS — **behind a disabled flag** |
| I2 | Derived-balance withdrawal | Write skew: two reads pass, two rows inserted | `withFinanceLock` — withdrawals only |
| I3 | Cash deposit verify | Double credit | none |
| I4 | Payment webhook | Duplicate delivery | none |
| I5 | Order accept | Double-accept from retry or a second device | none outside the four idempotent routes |
| I6 | Partner availability | Multiple devices toggling | none |
| I7 | Wallet adjust vs withdrawal approve | Different lock domains, same money | partial |
| I8 | Capability change vs dispatch | Eligibility read before the change, assigned after | none |
| I9 | Promo redemption | `PromoUserCounter` incremented non-atomically | partial (`idempotency_key` on `PromoRedemption`) |
| I10 | Order status transitions | No guarded state machine; any status can overwrite any other | none |

The general fix is one pattern applied everywhere: **guarded transitions**
(`updateOne({_id, status: from}, {$set: {status: to}})`, treating
`modifiedCount === 0` as "someone else got there") plus **idempotency keys on
every money mutation**, not just four routes.

---

## J. Target architecture

```
                          core/
  identity/      platformUser, partner, capabilities, linking, KYC, documents
  finance/       ledger (append-only), balance, cashLimit, eligibility, locks
  assignment/    JobRouter + per-vertical Strategy, offer lifecycle, busy-lock
  jobs/          Job base + status machine; Order discriminator (food|qc)
  config/        hierarchical settings resolver
  notifications/ one transport, per-vertical templates
  ratings/       one Rating model, polymorphic rated_entity
  cancellation/  one framework, per-vertical policy
  payments/      one gateway facade, one webhook, idempotent
  geo/           location, distance, ETA, service areas, geofence
  audit/         one append-only audit log
  admin/         one permission set, server-enforced
```

Key shapes:

```js
// core/identity — one row per person, whatever they do
Partner {
  _id, platformUserId, phone, name, kycStatus,
  status,                                                   // OFFLINE|ONLINE|BUSY|SUSPENDED|BLOCKED|PENDING_KYC
  capabilities: ['taxi','foodDelivery','quickCommerce'],    // admin-controlled
  workMode, vehicle: {...}, serviceAreaIds: [...],
  activeAssignments: [{ jobType, jobId, at }],              // array, not one slot — this is what makes stacking possible
  maxConcurrentJobs,                                         // resolved from config, never hardcoded
  legacy: { foodPartnerId, qcPartnerId, taxiDriverId, spWorkerId }
}

// core/finance — the ONE ledger. Balance is a fold of this, not a guess.
LedgerEntry {
  _id, ownerType: 'partner'|'user'|'merchant', ownerId,
  vertical, jobType, jobId,
  type,                                                     // EARNING|CASH_COLLECTED|SETTLEMENT|WITHDRAWAL|ADJUSTMENT|PENALTY|INCENTIVE
  amount,                                                   // SIGNED. never clamped.
  balanceBefore, balanceAfter, cashBefore, cashAfter,
  idempotencyKey,                                           // unique index
  actor: { kind: 'admin'|'system'|'partner', id }, reason, createdAt
}
PartnerBalance { partnerId, balance, cashInHand, version }   // snapshot, rebuildable from the ledger

// core/assignment — one decision, consumed by every vertical
eligibility.evaluate(partnerId, job) -> {
  eligible,
  reasons: ['CASH_LIMIT_EXCEEDED','NOT_CAPABLE','OUT_OF_AREA','MAX_JOBS', ...]
}
```

**Configuration hierarchy** — resolved by one service, precedence fixed and
documented:

```
PARTNER  >  CITY/ZONE  >  VERTICAL  >  GLOBAL DEFAULT
```

One `settings` collection, `{ scope, scopeId, key, value, updatedBy, updatedAt }`,
unique on `(scope, scopeId, key)`. `resolve(key, { vertical, zoneId, partnerId })`
walks the four levels and returns the value **plus which level supplied it** — the
admin UI shows the provenance, so "why is this partner's limit ₹2,200" is
answerable.

---

## K. Migration plan

Sequenced so each phase ships independently and nothing needs a big-bang cutover.
The repo already proves this style works: `riderFinance` shipped as a read-path
change with no data move at all.

### Phase 0 — stop the bleeding (1 week)

- **Freeze `modules/quickCommerce/` to bug fixes only.** Every new QC feature
  goes into `modules/food` behind a channel check. Announce it; otherwise the
  fork keeps growing.
- Fix A3: give `TaxiUser` its own collection, or reconcile the two schemas. Two
  schemas on one collection is a live data-corruption risk.
- Delete the stale `collection:` options from the QC schemas (D2) — they are
  actively misleading.
- Add `__checks__` covering the three eligibility implementations, so the
  divergence is visible in CI rather than in production.

### Phase 1 — one eligibility decision (2 weeks) — *highest value per unit of effort*

- Extend `riderFinance` into `core/finance/eligibility.service.js`:
  `evaluate(partnerId, { vertical, cashExposure, jobType })` returning
  `{ eligible, reasons[] }`, reading configuration through the hierarchy resolver.
- Replace the cash block in food `order-dispatch.service.js:197-264` with a call
  to it. Then QC's. Then add it to taxi `matchingService.js` — taxi has no cash
  check today, so this is a behaviour change: ship it in shadow mode first (log
  what it *would* have blocked for a week, review, then enforce).
- Delete the three local implementations.
- Exit criterion: `grep -r cashInHand Backend/src` returns only `core/finance`.

### Phase 2 — one assignment engine (3 weeks)

- Make `findEligibleUnifiedDrivers` the only candidate query, and have food, QC
  and taxi call it. Give it a `strategy` argument for per-vertical scoring.
- Turn `UNIFIED_DISPATCH_ENABLED` on in staging, then city by city in production.
- Backfill the link for every unlinked partner (`ensureUnifiedDriverForPartner`
  over `food_delivery_partners` and `qc_delivery_partners`), then **remove the
  "unlinked implies allow" waiver** (G4). Until it goes, capability rules are
  advisory.
- Generalise `activeAssignment` (a single slot) to `activeAssignments[]` plus a
  config-resolved `maxConcurrentJobs`. That is what makes stacking — Cases A and
  B in the brief — configurable rather than hardcoded. Keep the CAS; the claim
  becomes
  `updateOne({_id, $expr: {$lt: [{$size: '$activeAssignments'}, max]}}, {$push: …})`.

### Phase 3 — the ledger (3 weeks)

- Introduce `LedgerEntry` and `PartnerBalance`. **Dual-write**: every existing
  money path also appends an entry, while `riderFinance` stays the read path.
- Build a reconciler that folds the ledger and compares it to the derived figure.
  Run it nightly until it is clean for two consecutive weeks.
- Flip reads to `PartnerBalance`. Keep the derived path behind a flag for one
  release, then delete it and the dead `food_delivery_wallets` collection.
- Only now remove the `Math.max(0, …)` clamps. The ledger balance is signed by
  construction, so a negative balance falls out of the design rather than being
  specially permitted.
- Add the `idempotencyKey` unique index and route every credit, debit, refund
  and webhook through it.

### Phase 4 — collapse Food and QC orders (3 weeks, per `SUPERAPP_DATA_MODEL.md`)

- One `orders` collection with `discriminatorKey: 'channel'`. `FoodOrder` and
  `QuickOrder` become discriminators, so existing vertical code keeps working.
- Reconcile the ~18 diverged fields first — the two `order.model.js` files differ
  by 174 lines. That reconciliation is the actual work, not the schema.
- Dual-write, backfill, verify counts, cut reads over, drop the old collection.

### Phase 5 — collapse the QC fork (4–6 weeks, incremental)

Directory by directory, easiest and safest first:
`core/otp` → `core/refreshTokens` → `core/roles` → `core/notifications` →
`config/firebase` → `core/payments` (and down to one webhook handler) →
`middleware` → `dtos` → `core/users` → `core/admin` → the food domain copies.

Each step: point the QC route at the master module, run the QC checks, delete the
copy. Roughly 370 files removed.

### Phase 6 — config hierarchy and master admin (3 weeks)

- Build `core/config/resolver.js` and the `settings` collection. Migrate
  `FoodFeeSettings`, `deliveryCashLimit`, taxi `AdminBusinessSetting` and the QC
  copies into it, reading through the resolver with the old models as fallback.
- Add the **Master / Global Settings** section to the admin panel:
  Partner Rules · Financial Rules · Assignment · Global Platform.
- Add server-side permission checks (`GLOBAL_SETTINGS_EDIT`,
  `PARTNER_WALLET_ADJUST`, `ASSIGNMENT_RULES_EDIT`, `FINANCIAL_RULES_EDIT`). The
  current panel relies on frontend hiding.

### Phase 7 — the long tail (ongoing)

One `Rating`, one cancellation framework, one support-ticket model (replacing
six), one audit log, shared frontend components (wallet card, transaction table,
partner-status chip), master dashboard and cross-vertical reporting.

Then Service Provider, deliberately left until the pattern is proven on the three
verticals that already share a partner.

### Sequencing rationale

Phase 1 before Phase 2: a unified dispatcher that consults three different
eligibility rules is *worse* than three dispatchers, because the inconsistency
becomes invisible. Phase 3 before removing the clamps: permitting negative
balances on top of a derived, clamped, per-vertical calculation just produces
wrong numbers faster. Phase 4 before Phase 5: collapsing the order models is what
makes most of the QC fork obviously redundant.

### Risk register

| Risk | Mitigation |
|---|---|
| Taxi cash gate blocks earning drivers on day one | Shadow mode for a week; per-city rollout; a `cashLimitEnforced` config key |
| Ledger disagrees with the derived balance | Dual-write, nightly reconciler, two clean weeks before cutover |
| Order migration loses a diverged field | Field-level diff of the two `order.model.js` reviewed by hand before dual-write |
| Identity backfill merges two people on a reused phone | Dry-run first; flag any phone matching more than one name for manual review |
| Fork freeze ignored | CI check: fail the build on new files under `modules/quickCommerce/` |

### Definition of done

- `grep -r "cashInHand" Backend/src` returns only `core/finance`.
- `grep -r "Math.max(0," Backend/src | grep -i balance` is empty.
- `modules/quickCommerce/core/` does not exist.
- Every money mutation carries an idempotency key.
- One partner row, one balance, one status per person.
- An admin sets the cash limit once, and a taxi override is a deliberate act with
  visible provenance rather than a second copy of the setting.
