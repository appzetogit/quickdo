# Master Product audit — what exists, what is authoritative, what is not

Traced against the code at `2d0a2c1`. No code changed. This is Steps 1–4 of the
brief; implementation phases are in the companion plan.

Where my earlier pass was wrong, it is corrected here and marked **[correction]**.

---

## 1. What already exists (the six questions, per service)

The single most important finding of this audit: **the master infrastructure is
not a sketch. Most of it is well built, carefully reasoned and, in two cases,
more correct than what it replaces.** The gap is not design quality. It is
*reach* — each piece is consumed by one or two callers instead of all four
verticals, and the connective tissue is behind a disabled flag.

### 1.1 `core/finance/riderFinance.service.js` — unified rider money

**What it is.** One balance and one cash-in-hand per *person* across taxi, food
and QC. Resolves identity across the three partner records, splits the taxi
signed balance into "owed to rider" and "cash in their pocket", sums both
verticals, clamps **once** after summing, and returns `isBlocked` + `blockReason`
+ a full provenance breakdown.

**Is it correct?** Yes, and unusually so. The comments document two real bugs it
exists to prevent (per-vertical clamping enabling infinite re-withdrawal; deposit
money vanishing when the food figure clamps first). `splitSignedTaxiBalance` is
the right way to decode taxi's encoding. The `driverWallet` pass-through exists
so a caller inside an open transaction sees its own uncommitted balance.

**Two real defects:**

- It is a **read-path aggregation, not a ledger.** `resolveDeliveryMoney` runs
  four aggregations over `food_orders`, deposits, bonuses and withdrawals on every
  call. Balance is recomputed, never stored, so it cannot be reconciled,
  point-in-time queried, or audited — "why did this change?" has no answer.
- **Service Provider is absent.** An SP worker's earnings and cash are invisible
  to it. `resolveDeliveryMoney` covers food + QC only.

**Why isn't it used everywhere?** [correction] My first pass said no dispatcher
calls it. More precisely:

| vertical | calls `getRiderFinance`? | enforced where? |
|---|---|---|
| Taxi | **yes** — `ensureDriverWalletCanAcceptRide` (`walletService.js:210`) | at **ride accept** |
| Food | no | at **dispatch** (its own math, `order-dispatch.service.js:197-264`) |
| QC | no | at **dispatch** (a third source, `:255`) |
| SP | no | nowhere |

So there are two problems, not one: three different *calculations*, and three
different *enforcement points*. Taxi is the only vertical that blocks on the
unified figure, and it does so too late to keep an ineligible driver out of the
candidate pool — `matchingService.js:80` filters only on the cached
`wallet.isBlocked` flag.

**What prevents it becoming the source of truth?** It computes but does not
*store*, so nothing can be reconciled against it; and it has no SP arm.

**What migrates to it?** `deliveryFinance.service.js` (food), its QC fork,
`getCashBlockedPartnerIds` (QC), the food dispatch cash block, `serializeDriverWallet`.

**What gets deleted?** All of the above, plus the dead `food_delivery_wallets`
collection once Phase 3 lands.

### 1.2 `core/finance/financeLock.js` — per-person money lock

**What it is.** A TTL'd unique-key lock keyed on the *person*, not the partner
record, so a food withdrawal and a QC withdrawal queue behind each other. Its
docstring correctly explains why a Mongo transaction alone would not help (write
skew: each request only inserts its own row, so there is no conflict to detect).

**Is it correct?** The mechanism is. Two gaps:

- **Only withdrawals take it.** Cash deposits, admin adjustments, settlements and
  refunds all mutate the same derived balance without it.
- A holder that overruns `holdMs = 30s` does not know it lost the lock; the
  token-scoped delete prevents it releasing someone else's, but not from writing.

**What migrates to it?** Every derived-balance decision: deposit verify,
admin wallet adjust, settlement, refund-to-wallet, cancellation fee recovery.

### 1.3 `unifiedDispatchService.js` — the one candidate query

**What it is.** A 52-line `$geoNear` returning online, capable, **free** drivers
whose `workMode` accepts the service. Correctly names the `key: 'location'` index
(the `Driver` schema has two `2dsphere` indexes, so an unkeyed `$geoNear` throws).

**Is it correct?** As far as it goes. It omits cash/wallet eligibility, KYC,
suspension, service-area and concurrent-job limits — it is a *candidate* query,
not an eligibility engine.

**Why isn't it used?** It is **imported by nobody.** Food, QC and taxi each
hand-roll an equivalent-but-different filter. It is dead code that documents the
intended design.

**What prevents it becoming authoritative?** It queries `Driver`, but food and QC
dispatch from `FoodDeliveryPartner` / `QCDeliveryPartner` pools and only *filter*
by the linked driver. Until the pools collapse onto `Driver`, this can only ever
be a post-filter — which is exactly what `filterByUnifiedWorkMode` is, twice,
copied.

### 1.4 `driverAssignmentService.js` — atomic busy-lock

**What it is.** `activeAssignment: {type, id, at} | null` on `Driver`, claimed
with a single-document CAS, released only if the lock still points at the same
job, plus `reconcileDriverAssignment` to self-heal a stale lock.

**Is it correct?** The primitive is correct and the release guard is right. But:

- **QC never acquires or releases it.** `grep acquireDriverAssignment` returns
  food (`order-delivery.service.js:285`) and taxi (`rideService.js:1950`) only.
  QC's dispatch *filters* on `activeAssignment: null` but never sets it. So a
  driver on a QC order still reads as free, and food or taxi will take them.
  **This is a live cross-vertical double-booking hole.** (P0)
- **`reconcileDriverAssignment` only understands `FoodOrder` for `type:'delivery'`.**
  QC orders live in `qc_orders`. Were QC to start locking today, every QC lock
  would look "stale, job not found" and be cleared immediately.
- `TERMINAL_ORDER_STATUSES` omits every QC-specific terminal status.
- **One slot only.** Stacking of any kind is structurally impossible, so the
  Food+Food, Food+QC, Taxi+SP combinations the brief asks about cannot be
  expressed at all — not configured off, *unrepresentable*.
- **SP does not participate.** A worker on an SP booking is free for everything.
- All of it is gated on `UNIFIED_DISPATCH_ENABLED`, **default false**
  (`config/env.js:198`). With the flag off, food's `acquireDeliveryLock` returns
  `true` unconditionally.

Credit where due: food's accept path is a **properly guarded transition** —
`findOneAndUpdate` filtered on `orderStatus` *and* `dispatch.status`, and it
releases the busy-lock when the accept does not land. It is the best-implemented
state transition in the repo and should be the template.

### 1.5 `core/identity/` — identity linking

**What it is.** `ensureDeliveryCapability` / `ensureQuickCommerceCapability`
create and link the other vertical's partner record at registration;
`applyPartnerCapabilities` lets an admin set exactly which streams a person may
work; `ensurePlatformUser` (in `identityLink.service.js`) is migrating customers
onto an explicit `platformUserId`.

**Is it correct?** The intent is right and `normalizeCapabilities` /
`coerceWorkMode` are careful. But the mechanism is the thing the brief explicitly
rejects: **matching is `{ phone: { $regex: '1234567890$' } }`** — a suffix regex,
unindexed (so a collection scan per lookup), and a heuristic. A reused phone
number silently merges two people's financial history.

**What prevents it becoming authoritative?** [the single biggest blocker in the
repo] Every capability filter contains this:

```js
if (!linked) return true;   // not migrated yet — don't block
```

The docstring is explicit that food-app signups never create the unified half, so
*most partners are unlinked* — and every unlinked partner bypasses every
capability rule. Admin capability decisions are advisory for the majority of the
fleet. Until the backfill runs and this waiver is removed, nothing downstream of
identity can be trusted.

Also: `syncDeliveryApproval` swallows its own failures (`logger.error; return`).
A driver can end up approved for rides and pending for food, with no alert.

### 1.6 `core/payments/transaction.service.js` — **the ledger nobody mentioned**

This did not appear in my first pass and it changes the picture.

**What it is.** `recordTransaction()` — a real double-entry-shaped ledger write:
a `Transaction` row with `balanceAfter`, `category`, `module`, `orderId`,
`paymentId`, `metadata`, plus the wallet balance update, inside one MongoDB
transaction. Its own comment says it is *"the ONLY way to change wallet balances."*

**Is it correct?** No — and the claim is false. Five defects:

1. **It is food-only.** `resolveWallet` maps to `FoodUserWallet`,
   `FoodRestaurantWallet`, `FoodDeliveryWallet`, `FoodAdminWallet`; `module`
   defaults to `'food'`. QC has a **forked copy** of the entire file.
2. **It hard-blocks negative balances**:
   `if (type === 'debit' && entityType !== 'admin' && newBalance < 0) throw`.
   This is precisely the debt-hiding the brief forbids — it is not a `Math.max`,
   it is a refusal to record a real debt.
3. **No idempotency key.** Nothing prevents the same webhook, retry or double-tap
   producing two rows and two credits.
4. **Read-modify-write on the balance.** It reads `wallet.balance`, computes, then
   `$set`s an absolute value. Under concurrency the transaction aborts — and every
   caller in `payment.processor.js` wraps it in `try { } catch { logger.error }`.
   **A lost credit is logged and swallowed.** (P0)
5. **It is not the only writer.** `applyDriverWalletAdjustment` (taxi) writes
   `Driver.wallet.balance` directly; `riderFinance` derives a different number;
   `deliveryFinance` derives a third; SP has its own `Transaction` model.

**Why isn't it used everywhere?** Because it only runs inside the BullMQ payment
processor, and `BULLMQ_ENABLED` defaults off. That is *why* `riderFinance` can
truthfully describe `food_delivery_wallets` as a dead collection — it is dead
because the only thing that writes it is not running. **Turning on the queue
workers silently activates a second, divergent wallet source of truth.** (P0)

**Also**: `getUserWalletForFrontend` has a comment saying
`// Deduplicate by checking if an embedded txn has a matching new txn` followed by
a plain `[...convertedNewTxns, ...convertedEmbedded]`. **The dedup was never
written.** Customers can see the same transaction twice.

### 1.7 `modules/taxi/driver/services/walletService.js` — the best money code here

`applyDriverWalletAdjustment` is the strongest financial primitive in the
repository and should be the *template* for the master ledger, not a thing to
replace:

- balance updated via a **Mongo aggregation-pipeline update** (`$add` on the
  server), so concurrent adjustments cannot lose each other;
- `isBlocked` derived from the **post-update** balance in the same atomic op —
  the comment records that deriving it from a pre-read snapshot lost updates;
- **no clamping** — the balance goes negative naturally;
- writes a `WalletTransaction` row with `balanceBefore` / `balanceAfter` /
  `cashLimit` / `isBlockedAfter`.

Its remaining defect is idempotency: `applyDriverWalletAdjustmentByReference`
dedupes with `findOne({'metadata.referenceKey'})` **then** writes — a check-then-act
race with no unique index behind it. Two concurrent settlements for the same ride
both find nothing and both credit.

`WalletTransaction` is the correct ledger *shape*. It needs three fields to become
the master one: `vertical`, `idempotencyKey` (unique), `actor`.

### 1.8 `core/modules/moduleRegistry.js` — genuinely master-level already

A per-vertical kill switch that deliberately never blocks reads, admin routes or
payment webhooks. Correct as-is. The one master service with no gap.

### 1.9 `core/roles/` — permissions exist and are not enforced

`serviceAccess.middleware.js` correctly enforces per-vertical admin access
server-side. But `core/admin/adminAccess.util.js` implements a full
`resource.action` permission model whose **only caller is
`adminHierarchy.service.js`** — it is never used as route middleware. Food admin
routes are gated by `role === 'ADMIN' || 'SUPER_ADMIN'` and nothing else, so
**any admin can adjust any partner's wallet.** (P0)

---

## 2. Master Product Map

| Concept | Current implementations | Verticals | Conflict | Existing master | Target |
|---|---|---|---|---|---|
| **Customer identity** | `FoodUser`→`users`, `TaxiUser`→**`users`**, `QCUser`→`qc_users`, `SPUser`→`sp_users` | F Q T S | **two schemas on one collection**; phone-regex joins | `identityLink.ensurePlatformUser` (partial) | GLOBAL — `PlatformUser` + per-vertical profiles |
| **Partner identity** | `FoodDeliveryPartner`, `QCDeliveryPartner`, `TaxiDriver`, `SPWorker` | F Q T S | 4 records per person | `driverCapabilities` linking (partial) | GLOBAL — `Partner` + capabilities |
| **Availability** | `availabilityStatus` (F), same (Q), `isOnline`+`isOnRide` (T), `isOnline`+`status` (S) | F Q T S | **4 independent truths, none syncs** | none | GLOBAL — one status service |
| **Busy / concurrency** | `Driver.activeAssignment` | F T | QC + SP absent; single slot | `driverAssignmentService` | GLOBAL — `activeAssignments[]` + rules |
| **Eligibility** | dispatch-time (F), dispatch-time (Q), accept-time (T), none (S) | F Q T S | 3 calculations, 3 enforcement points | `riderFinance` | GLOBAL — `eligibility.evaluate` |
| **Partner wallet** | derived (F), derived+stored (Q), embedded signed (T), `Transaction` (S), plus `core/payments` ledger | F Q T S | 5 sources | `riderFinance` (read) / `transaction.service` (write) | GLOBAL — one ledger |
| **Cash exposure** | recomputed (F), stored field (Q), negative balance (T), controller (S) | F Q T S | 3 encodings | `riderFinance` | GLOBAL |
| **Money lock** | `financeLock` | F (withdrawals) | deposits/adjustments unlocked | `financeLock` | GLOBAL |
| **Candidate search** | 3 hand-rolled `$geoNear`/haversine | F Q T | — | `unifiedDispatchService` (unused) | GLOBAL + vertical scoring |
| **Job lifecycle** | 12-state (F), forked (Q), 5+7-state (T), 14-state (S) | F Q T S | `picked_up` vs `journey_started` vs `work_done` | none | GLOBAL base + vertical extension |
| **State transitions** | guarded (F), guarded (Q), `obj.status = x; save()` (T), table-in-one-controller (S) | F Q T S | TOCTOU in T and S | food's pattern | GLOBAL — guarded transitions |
| **Payments / webhooks** | `core/payments` + **QC fork** + inline (T) + `paymentController` (S) | F Q T S | 2 public Razorpay webhooks | `core/payments` | GLOBAL |
| **Notifications** | `core/notifications` + **byte-for-byte QC fork** + `pushNotificationService` (T) + `firebaseAdmin` (S) | F Q T S | 2 Firebase inits | `core/notifications` | GLOBAL + vertical templates |
| **Config** | ~12 settings models × 2 (fork) + taxi + SP | F Q T S | no hierarchy, no precedence | none | GLOBAL — 4-level resolver |
| **Admin permissions** | `role === ADMIN` on routes; `hasResourcePermission` unused | F Q T S | no financial authz | `adminAccess.util` (unused) | GLOBAL — enforced middleware |
| **Ratings** | on order/restaurant/partner (F,Q), on ride/driver (T), `Review` (S) | F Q T S | 4 models | none | GLOBAL + vertical strategy |
| **Support tickets** | 3 models (F) + 3 forked (Q) + 1 (T) + inline (S) | F Q T S | 7 implementations | none | GLOBAL |
| **Cancellation** | per-controller everywhere | F Q T S | no shared fee/penalty/refund path | none | GLOBAL + vertical policy |
| **Geo / service area** | `zone.model`+`zoneMatching` (F) + fork (Q), `Zone`/`ServiceLocation` (T), `City` (S) | F Q T S | 3 area models | none | GLOBAL |
| **Idempotency** | `middleware/idempotency.js` on 4 routes | F Q | everything else unprotected | the middleware | GLOBAL on all money routes |
| **Audit** | `core/activity` (thin index) | F Q T S | no financial/admin audit | `core/activity` | GLOBAL — extend |
| **Module kill-switch** | `moduleRegistry` | F Q T S | none | **already master** | keep |
| **Frontend API client** | `src/services/api`, `Taxi/shared/api`, `ServiceProvider/services/api` | F Q T S | 3 clients, 5+ token keys | none | GLOBAL |
| **Frontend wallet UI** | `Food/pages/user/Wallet`, `admin/DeliveryBoyWallet`, `Taxi/.../DriverWallet`, `Taxi/user/Wallet`, `SP/Transactions` | F Q T S | 5+ screens | none | GLOBAL components |

---

## 3. Prioritized issues

### P0 — data corruption / financial risk

| id | issue |
|---|---|
| P0-1 | `TaxiUser` and `FoodUser` schemas both write `collection: 'users'` |
| P0-2 | QC assigns drivers without acquiring the busy-lock → cross-vertical double-booking |
| P0-3 | `recordTransaction` failures swallowed by `catch { logger.error }` in `payment.processor.js` → silent lost credits |
| P0-4 | No idempotency on any wallet credit/debit; `byReference` dedupe is check-then-act with no unique index |
| P0-5 | Razorpay webhook handlers (two of them) have no idempotency → duplicate credit on provider retry |
| P0-6 | Enabling BullMQ activates a second divergent wallet writer against `food_delivery_wallets` |
| P0-7 | `hasResourcePermission` never used as middleware → any admin can adjust any wallet, unaudited |
| P0-8 | `recordTransaction` refuses to record a debt (`newBalance < 0` throws) → real negative balances are unrepresentable |
| P0-9 | Phone-suffix identity matching can merge two people (reused number) into one financial identity |
| P0-10 | `getUserWalletForFrontend` merges two transaction sources with the dedup unimplemented |

### P1 — cross-vertical business inconsistency

| id | issue |
|---|---|
| P1-1 | Three cash/eligibility calculations; three different enforcement points |
| P1-2 | Taxi has no cash gate at candidate selection — only a cached `isBlocked` flag |
| P1-3 | Four independent availability truths, none synced |
| P1-4 | `if (!linked) return true` waiver makes capability rules advisory for most partners |
| P1-5 | `reconcileDriverAssignment` knows only `FoodOrder`; QC locks would be cleared instantly |
| P1-6 | SP participates in no master system |
| P1-7 | Taxi/SP status writes are read-modify-write; SP's transition table is bypassed by other controllers |
| P1-8 | `syncDeliveryApproval` fails silently → split approval state |
| P1-9 | Single-slot `activeAssignment` makes stacking unrepresentable |
| P1-10 | `financeLock` covers withdrawals only |

### P2 — duplicated architecture

QC fork (≈370 files incl. its own `core/`) · two notification stacks · two Firebase
inits · two webhook routes · 7 support-ticket models · 4 rating models · 3 zone
models · settings duplicated per vertical · 3 frontend API clients · 5+ wallet screens.

### P3 — operational / UX

`NODE_ENV !== 'production'` dispatches `pending` partners · stale-GPS partners
offered work at `distanceKm: 999` · no Partner 360 · no global admin search · no
config provenance · admin panel built by string substitution.

### P4 — optimization

Unindexed phone-regex lookups · `riderFinance` runs 4 aggregations per call ·
no caching on config reads.

---

## 4. Fifty-three additional edge cases

**Concurrency & assignment**

1. QC assigns driver A; taxi assigns A one second later — neither knows (P0-2).
2. Food and taxi acquire in the same millisecond; CAS makes one lose — the loser's order stays `unassigned` with no retry trigger.
3. Lock acquired, order write succeeds, socket emit fails — driver never sees the job, lock held until the staleness sweep.
4. Driver accepts on phone and tablet simultaneously; food's guarded update makes one win, but both clients show "accepted".
5. Offer times out server-side while the driver's accept is in flight.
6. `reconcileDriverAssignment` runs while a job is being created — job not yet persisted, lock judged stale and cleared.
7. Capability revoked between candidate selection and offer acceptance.
8. Partner suspended between claim and accept — nothing re-checks.
9. Zone redrawn mid-dispatch; every candidate filtered out; order silently unassigned.
10. Two `2dsphere` indexes on `Driver` — any new `$geoNear` without `key` throws at runtime only.
11. Pool rides deliberately bypass the busy-lock; a pooled driver is still `activeAssignment: null` and can be given a food order.
12. Driver's `workMode` changed to `taxi` while holding a food order.
13. Restaurant with no coordinates → distance check skipped entirely; only zone applies.
14. Stale-GPS partner (>10 min) kept at `distanceKm: 999` when no zone is configured.
15. `NODE_ENV !== 'production'` allows `pending` (unapproved) partners into dispatch.
16. Order cancelled between lock acquisition and the `findOneAndUpdate`.
17. Driver deleted/soft-deleted while holding a lock.
18. Two admins force-clear the same lock concurrently.
19. SP worker on a booking is invisible to every other dispatcher.
20. Reassignment (`dispatchService:1154`) releases the old driver's lock *before* the new claim succeeds — a window where neither is assigned.

**Finance**

21. Razorpay retries a webhook; both handlers (core and QC fork) accept it.
22. A food payment webhook reaches the QC handler — both routes are public and both verify the same signature.
23. `recordTransaction` aborts on write conflict; caller logs and continues; the partner is never credited.
24. Two settlements for one ride pass `byReference` dedupe concurrently (no unique index).
25. Cash deposit verified twice (`/wallet/deposit/verify` has no idempotency middleware).
26. Withdrawal approved while a deposit for the same rider commits — different lock domains.
27. Refund issued after the rider's earning was already settled and withdrawn.
28. Partial refund: commission and platform fee not proportionally reversed anywhere.
29. Admin adjusts a taxi wallet mid-transaction from `adminService:4293`.
30. Rider earning negative (commission > delivery fee), clamped to 0 — platform silently forgives the debt.
31. Cash tip counted as platform cash-in-hand, inflating exposure.
32. Rider crosses the cash ceiling *during* a food delivery — food re-checks at next dispatch, taxi never does.
33. Rider with QC earnings but no `driverId`: `linked: false`, half their money invisible.
34. Two partner records for one phone, only one carrying `driverId` — the other's money is unreachable.
35. BullMQ enabled in one environment and not another → two different balances for the same rider.
36. `lockWalletAmount` locks against a balance a different writer is concurrently changing.
37. Admin wallet allowed negative, partner wallet not — asymmetric and undocumented.
38. Settlement runs while a job is active; the job's earning lands after the cut-off and is attributed to the wrong cycle.
39. Currency is hardcoded `'INR'` in `recordTransaction` with no validation upstream.
40. `ADMIN_ENTITY_OID` is a hardcoded ObjectId; a real document with that id would collide.

**Identity & config**

41. Phone changed by the user — every suffix-regex join silently re-points.
42. Same phone stored `+919…` / `919…` / `0919…`; suffix works, exact joins do not.
43. Two `platformUserId` backfills run concurrently → two platform users for one phone.
44. Partner linked to a driver that was later deleted (dangling `driverId`).
45. Config changed while jobs are in flight — cash limit lowered mid-delivery.
46. Conflicting overrides with no precedence rule (city says ₹2,200, vertical says ₹2,500, today whichever model is read wins).
47. Settings singleton document missing → `Number(undefined) || 0` yields limit 0, which every reader interprets as "no limit".
48. Two admins save the same settings document; last write wins, no audit.

**Availability & operations**

49. Driver goes online in the delivery app; taxi dispatch cannot see them (`isOnline` untouched).
50. App killed while online — no heartbeat expiry anywhere; the partner stays "online" forever.
51. Location jump (GPS spoof / tunnel exit) accepted without a plausibility check.
52. Module disabled while jobs are active — writes blocked, in-flight jobs uncompletable by the partner.
53. Partner KYC expires mid-shift; nothing re-evaluates until the next registration event.

---

## 5. Financial / data-loss risk register

Format per the brief: Severity · Root cause · Current · Correct · Fix · Tests.

**F1 — Silent lost credit on wallet write failure**
*P0.* Root cause: `payment.processor.js` wraps every `creditWallet` in
`try { } catch { logger.error }`; `recordTransaction` aborts its Mongo transaction
on write conflict and rethrows. Current: the partner is simply not paid; the only
trace is a log line. Correct: the credit must be retried or dead-lettered, never
dropped. Fix: make the job fail so BullMQ retries; add a retry loop around the
transaction; add a `pending_credits` dead-letter. Tests: force a write conflict
and assert the balance is eventually correct and the job retried.

**F2 — Duplicate credit from a replayed webhook**
*P0.* Root cause: no idempotency key on `Transaction`; both Razorpay handlers are
public. Current: a provider retry credits twice. Correct: second delivery is a
no-op returning the first result. Fix: unique index on
`(idempotencyKey)`; derive it from the provider event id; single handler.
Tests: POST the same signed payload twice, assert one row and one balance change.

**F3 — Double settlement race**
*P0.* Root cause: `applyDriverWalletAdjustmentByReference` does `findOne` then
write, with no unique index on `metadata.referenceKey`. Current: two concurrent
settlements for one ride both credit. Correct: the second is rejected by the
index. Fix: unique compound index `(driverId, metadata.referenceKey)`; catch
E11000 as "already applied". Tests: fire two identical settlements in parallel.

**F4 — Debt erased at the boundary**
*P0.* Root cause: `recordTransaction` throws when a debit would make the balance
negative; `deliveryFinance` and food dispatch clamp with `Math.max(0, …)`.
Current: a genuine debt cannot be recorded, so it silently ceases to exist and the
partner is un-restricted. Correct: the ledger records the debt; the *eligibility*
layer decides what a negative balance means. Fix: remove the throw and the
per-vertical clamps; move the decision into `eligibility.evaluate`. Tests: debit
₹250 against ₹100 and assert balance `-150`, `financiallyRestricted: true`, and
that the active job is unaffected.

**F5 — Two live wallet sources depending on an env var**
*P0.* Root cause: `food_delivery_wallets` is written only by the BullMQ processor,
which is off; `riderFinance` therefore derives from orders instead. Current:
turning queues on makes two systems disagree. Correct: one writer. Fix: the ledger
cutover (Phase 3) with a reconciler before the switch. Tests: reconciler must be
clean for 14 consecutive nights.

**F6 — Money attributed to the wrong vertical**
*P1.* Root cause: `recordTransaction` hardcodes `module = 'food'`;
`WalletTransaction` has no vertical field at all. Current: revenue-by-vertical is
unanswerable from the data. Correct: every entry carries `vertical` + `jobType` +
`jobId`. Fix: add the fields, backfill from `orderId`/`rideId` shape. Tests:
sum per vertical equals sum of that vertical's completed jobs.

**F7 — Money attributed to the wrong partner**
*P1.* Root cause: `resolveRiderIdentity` returns one partner id when a person has
two unlinked records; phone-suffix matching can bind a reused number to the wrong
person. Current: earnings attach to whichever record dispatch used. Correct: one
partner id, explicit link. Fix: `platformUserId`/`partnerId` FKs; backfill with a
dry-run flagging any phone matching more than one name. Tests: backfill dry-run
must report zero ambiguous matches before it is allowed to write.

**F8 — Duplicate transactions shown to customers**
*P1.* Root cause: `getUserWalletForFrontend` concatenates the ledger and the
embedded array with the dedup unimplemented. Current: same payment appears twice.
Correct: one list. Fix: read the ledger only after cutover; until then dedupe on
`(orderId, amount, type)`. Tests: a wallet with both sources returns each txn once.

**F9 — Cash exposure understated across verticals**
*P1.* Root cause: taxi's candidate filter reads the cached `wallet.isBlocked`, not
combined cash. Current: a rider at the food cash ceiling is still offered rides.
Correct: combined exposure evaluated at candidate selection. Fix: call
`eligibility.evaluate` in `matchingService`. Tests: rider with ₹1,900 combined cash
and a ₹2,000 limit is excluded from taxi, food and QC candidate sets alike.

**F10 — Unauthorized financial mutation**
*P0.* Root cause: no permission middleware on admin wallet routes. Current: any
`ADMIN` token can adjust any balance, with no audit row. Correct: `PARTNER_WALLET_ADJUST`
required and every adjustment audited with actor + reason. Fix: mount
`requirePermission`; write an audit entry inside the same transaction. Tests: an
admin lacking the permission gets 403; a successful adjust produces exactly one
audit row.

**F11 — Refund after settlement**
*P2.* Root cause: no link between refund and the settlement that already paid out
the earning. Current: the platform eats the difference silently. Correct: a refund
reverses the corresponding commission and rider earning, creating a recoverable
negative if needed. Fix: reversal entries referencing the original `idempotencyKey`.
Tests: refund a settled order, assert three reversal entries and a recoverable debt.

**F12 — Lost update on `lockWalletAmount`**
*P2.* Root cause: read-modify-write `wallet.save()` outside any transaction.
Current: two concurrent locks overwrite each other. Fix: `$inc` with a guard on
available balance. Tests: two parallel locks of ₹100 against ₹150 — exactly one
succeeds.

---

## 6. Master Product invariants (automatable as `__checks__`)

The repo already has the right idiom: 30+ dependency-free `*.check.js` files.
Invariants belong there.

**Identity** — one phone → one `PlatformUser`; one person → one `Partner`; every
vertical profile has exactly one parent partner; no dangling `driverId`; no
`Partner` without `platformUserId`.

**Finance** — one partner → one balance; balance equals the fold of its ledger
entries; every ledger entry has a unique `idempotencyKey`; every entry names a
vertical, a job and an actor; `balanceAfter − balanceBefore === amount`;
`sum(all partner balances) === platform wallet liability`; cash-in-hand equals
collected minus deposited, per person, never per vertical; no money mutation
exists without a corresponding ledger entry.

**Eligibility** — every dispatcher's decision for `(partner, job)` is byte-equal
to `eligibility.evaluate`; a financially restricted partner appears in no
candidate set of any vertical; eligibility is evaluated at candidate selection
*and* re-validated at accept.

**Assignment** — `count(activeAssignments) <= maxConcurrentJobs`; every active
assignment points at a non-terminal job; every non-terminal assigned job has a
matching lock; no partner holds assignments in a combination the rules forbid;
a partner never appears in two verticals' active job sets unless stacking permits it.

**Capability** — a partner only ever holds jobs for capabilities they have;
revoking a capability removes them from that pool within one dispatch cycle.

**State** — every status change is a permitted transition; no terminal status is
ever left; every transition is a guarded atomic update, not read-modify-write;
every transition writes a history entry.

**Config** — every effective value resolves to exactly one source level; the
resolver reports provenance; no setting is read directly from a model by anything
except the resolver.

**Admin** — every financial and configuration mutation has an audit row with
actor, before, after and reason; no financial route is reachable without its
permission.

**Availability** — one partner has exactly one availability state; every vertical
reads the same field; an online partner has a heartbeat newer than the staleness
threshold.

---

## 7. Target architecture — what becomes authoritative

Nothing here is a new invention where an existing implementation can be promoted.

| Master service | Built from | Absorbs |
|---|---|---|
| `core/identity/Partner` | `driverCapabilities` + `TaxiDriver` | `FoodDeliveryPartner`, `QCDeliveryPartner`, `SPWorker` |
| `core/identity/PlatformUser` | `identityLink` (finish it) | `FoodUser`/`TaxiUser` split, `QCUser`, `SPUser` |
| `core/finance/ledger` | **`WalletTransaction`'s shape** + `applyDriverWalletAdjustment`'s pipeline-update technique | `transaction.service`, QC fork, `deliveryFinance`, SP `Transaction` |
| `core/finance/balance` | `riderFinance` (stop deriving, start folding) | `serializeDriverWallet`, `deliveryFinance` |
| `core/finance/eligibility` | `riderFinance.resolveBlockState`, extended | food dispatch cash block, `getCashBlockedPartnerIds`, `ensureDriverWalletCanAcceptRide` |
| `core/finance/lock` | `financeLock` (widen its callers) | — |
| `core/assignment/candidates` | `unifiedDispatchService` (give it callers) | 3 hand-rolled filters |
| `core/assignment/claim` | `driverAssignmentService` (array + rules) | — |
| `core/jobs/transitions` | **food's guarded `findOneAndUpdate` pattern** | taxi/SP read-modify-write |
| `core/config/resolver` | new — nothing exists | ~24 settings models |
| `core/modules` | already authoritative | — |
| `core/admin/permissions` | `adminAccess.util` (give it middleware) | `requireAdmin` |
| `core/notifications` | existing | QC fork, taxi, SP |
| `core/activity` | existing (extend to finance/admin) | — |

**Enforcement points become uniform**, which today they are not:

```
job created
   ↓
candidate search        ← core/assignment/candidates
   ↓
eligibility.evaluate    ← core/finance/eligibility   (the ONLY gate)
   ↓
vertical scoring        ← per-vertical strategy
   ↓
atomic claim            ← core/assignment/claim + stacking rules
   ↓
offer → accept          ← eligibility RE-validated, guarded transition
```

**Active vs new work** — the distinction the brief asks for, made explicit:

| gate | applies to | on breach |
|---|---|---|
| `evaluateForNewJob` | candidate search, offer, accept | partner excluded |
| `evaluateForActiveJob` | continuing an accepted job | **always allowed to complete**; completion is how the debt gets settled |

A partner who goes negative or crosses the cash ceiling mid-delivery finishes that
delivery — cancelling it would strand a customer and, in the cash case, prevent
the very deposit that clears the block. Only *new* work stops.

---

## 8. Beyond refactoring — what would make it feel like one product

Missing today, and each is now cheap once the master entities exist:

- **Partner 360** — one screen: identity, KYC, capabilities, live status, location,
  vehicle, active jobs across all four verticals, one balance, full ledger, cash
  exposure with provenance, settlements, per-vertical job history, ratings,
  cancellations, penalties, support threads, audit trail.
- **Global admin search** — one box resolving user / partner / order / ride /
  booking / payment / transaction / ticket by id, phone or reference.
- **Config provenance UI** — "Effective ₹1,500 · source: Partner override · set by
  X on date", with the other three levels shown greyed.
- **Cross-vertical customer view** — one order history, one address book, one
  wallet, one support inbox.
- **Platform health** — unassigned jobs by vertical, assignment success rate,
  average time-to-assign, financially restricted partner count, total cash held by
  partners, wallet liability, reconciler status.
- **Money trace** — given any job, the full set of ledger entries it produced and
  who they moved money between.

---

## 9. The final test

> *"If I change a genuinely global business rule once, will all four verticals obey it?"*

**Today: no.** Changing the cash limit updates `FoodFeeSettings`. Food obeys at
dispatch. QC reads a different model and a different stored field. Taxi obeys only
at accept, via a cached flag. SP never hears about it.

**After Phases 1–2 (eligibility + assignment): yes, for partner-facing rules** —
capability, availability, cash, wallet, concurrency, service area.

**After Phase 6 (config hierarchy): yes, with an explainable override chain.**

The measurable exit criterion: a `__checks__` invariant that replays a sample of
`(partner, job)` pairs through every vertical's dispatcher and asserts each
decision is byte-identical to `eligibility.evaluate`. Until that check passes and
stays green, the work is not done.

---

## 10. Recommended next step

I have not changed any code. The first change I would make is the smallest one
with the largest effect and no behavioural risk:

**Phase 0** — four items, roughly a week, each independently revertible:
split the `users` collection (P0-1); make QC acquire and release the busy-lock
(P0-2); add a unique idempotency index to the two existing ledger models (P0-4);
mount permission middleware on financial admin routes (P0-7).

None of these require the flag, the fork collapse, or any migration. They stop the
three live bugs that can corrupt data or lose money while the larger phases run.

Say the word and I will start there — or, if you would rather see the design
first, I will write the `eligibility.evaluate` interface and its `__checks__`
against the three existing implementations so the divergence is visible before
anything moves.
