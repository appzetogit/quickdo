# Phase 0 — P0 validation and implementation plan

Every P0 from the audit re-opened and traced through routes → controllers →
services → models → queues → webhooks → frontend. **No code changed.**

**Three of my ten P0s did not survive validation.** Two were wrong, one was
materially narrower than I stated. They are marked **REFUTED** / **NARROWED**
below with the evidence. Four *new* P0-class findings surfaced during tracing and
are added as P0-11 … P0-14.

---

## Part 1 — Validation results

| id | claim | verdict |
|---|---|---|
| P0-1 | two schemas on `users` | **CONFIRMED**, mechanism identified |
| P0-2 | QC never takes the busy-lock | **CONFIRMED** |
| P0-3 | wallet-write failures silently swallowed | **CONFIRMED**, 3 distinct sites |
| P0-4 | no idempotency on money mutations | **NARROWED** — deposits are already hardened; ledger writes are not |
| P0-5 | webhook duplication | **NARROWED** — order flag is idempotent; the ledger call is not; **food lacks an amount check QC has** |
| P0-6 | BullMQ activates a divergent writer | **CONFIRMED** |
| P0-7 | no financial authorization | **CONFIRMED** |
| P0-8 | negative balance blocked | **CONFIRMED**, one site (`recordTransaction`) |
| P0-9 | phone-suffix identity merge | **CONFIRMED**; dry-run **not runnable from here** |
| P0-10 | duplicate customer wallet transactions | **CONFIRMED**, root cause found |
| P0-11 | **new** — second taxi wallet writer with lost-update | CONFIRMED |
| P0-12 | **new** — ledger rows whose amount ≠ balance delta | CONFIRMED |
| P0-13 | **new** — food webhook accepts any captured amount | CONFIRMED |
| P0-14 | **new** — only one webhook URL can be configured | CONFIRMED (design) |

### Corrections to the audit

**P0-4 is largely wrong on deposits.** I claimed `/wallet/deposit/verify` was
unprotected. It is not. `deliveryFinance.service.js:320-420` already:

- refuses the client's amount and settles what the **gateway** reports
  (`fetchRazorpayPayment`, `capturedPaise`), with a comment documenting the ₹1-paid /
  ₹50,000-claimed exploit this closed;
- verifies the payment belongs to the claimed order and is captured;
- makes the **write itself the claim** — an upsert keyed on `razorpayPaymentId`,
  backed by a **unique partial index** on the model (`:53`), so the loser of a race
  gets the winner's row rather than writing a second;
- and the **QC fork has the same hardening** with its own unique index (`:48`).

This is the best idempotency implementation in the repository. It is the pattern
the rest of Phase 0 should copy, not something to fix.

**P0-5 is narrower than I said.** `razorpayWebhook.controller.js:52` is a guarded
transition — `findOneAndUpdate({razorpayOrderId, "payment.status": {$ne:'paid'}})`.
A replayed webhook finds no document and skips the credit path. The paid-flag is
idempotent. What is *not* idempotent is the ledger call inside it, which is
wrapped in `catch { logger.error }`.

---

## Part 2 — Financial mutation inventory

Every path that can move partner or customer money. `Auth?` = does it require a
financial permission (not merely `ADMIN`).

| # | Writer | Collection | Operation | Vertical | Trigger | Atomic? | Idempotent? | Auth? | Authoritative? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `walletService.applyDriverWalletAdjustment` | `taxidrivers.wallet` + `wallettransactions` | pipeline `$add` | Taxi | ride settle, top-up, onboarding | **yes** (server-side pipeline) | no | n/a | **yes, for taxi** |
| 2 | `dispatchService.applyDriverWalletAdjustmentByReference` | same | wraps #1 | Taxi | cancellation fee, pool settle | yes | **check-then-act** (`findOne` on `metadata.referenceKey`, no unique index) | n/a | via #1 |
| 3 | `adminService.js:4390` | `taxidrivers.wallet` + `wallettransactions` | **read-modify-write + `save()`** | Taxi | admin adjustment | **NO — lost update** | no | **ADMIN only** | **conflicts with #1** |
| 4 | `rideService.js:2796` | `wallettransactions` only | `create` | Taxi | cash tip | n/a | no | n/a | **writes a row with `balanceBefore === balanceAfter`** |
| 5 | `transaction.service.recordTransaction` | `food_user_wallets`, `food_restaurant_wallets`, `food_delivery_wallets`, `food_admin_wallets` + `transactions` | read-compute-`$set` in a Mongo txn | Food | payment processor (BullMQ) | txn-atomic, **no retry** | **no** | n/a | claims to be; **is not** |
| 6 | QC fork of #5 | `qc_*` equivalents | same | QC | same | same | no | n/a | no |
| 7 | `payment.processor.js:91` | `food_delivery_wallets` | `$inc totalDeliveries` | Food | order paid | yes | **no** | n/a | no |
| 8 | `deliveryFinance.verifyDeliveryCashDepositPayment` | `food_delivery_cash_deposits` | upsert-as-claim | Food | rider deposit | **yes** | **yes** (unique partial index) | n/a | **yes** |
| 9 | QC fork of #8 | `qc_delivery_cash_deposits` | same | QC | same | yes | yes | n/a | yes |
| 10 | `deliveryFinance.requestDeliveryWithdrawal` | `food_delivery_withdrawals` | `create` under `withFinanceLock` | Food | rider withdrawal | lock-guarded | no | n/a | yes |
| 11 | QC fork of #10 | `qc_delivery_withdrawals` | same | QC | same | lock-guarded | no | n/a | yes |
| 12 | `admin.service.js:5356` | `food_delivery_withdrawals` | approve/reject under lock | Food | admin | lock-guarded | no | **ADMIN only** | yes |
| 13 | `admin.service.js:4655/5378/6041` | `food_delivery_wallets` | `findOneAndUpdate` | Food | admin wallet edit | single-doc | no | **ADMIN only** | **conflicts with derived balance** |
| 14 | QC `admin.service.js:5161/5504/6050/6149` | `qc_delivery_wallets` | same | QC | admin wallet edit | single-doc | no | **ADMIN only** | conflicts |
| 15 | `DeliveryBonusTransaction` create | `delivery_bonus_transactions` | `create` | Food/QC | admin bonus | n/a | no | ADMIN only | feeds derived balance |
| 16 | `core/payments/refund.service.js` | `food_user_wallets.balance` | `$inc`/`$set` | Food | refund | single-doc | no | ADMIN only | partial |
| 17 | QC fork of #16 | `qc_user_wallets` | same | QC | refund | single-doc | no | ADMIN only | partial |
| 18 | `userWallet.service.js` | `food_user_wallets.transactions[]` | `unshift` + `save()` | Food | top-up, spend | **read-modify-write** | no | n/a | **balance source** |
| 19 | `cashback.service.js:97` | same embedded array | `unshift` + `save()` | Food | cashback award | RMW | dedupes on `priorAwards` (app-level) | n/a | yes |
| 20 | QC forks of #18/#19 | `qc_user_wallets` | same | QC | same | RMW | same | n/a | yes |
| 21 | `taxi subscriptionService` | `taxi_user_wallets` | balance write | Taxi | subscription | RMW | no | n/a | separate customer wallet |
| 22 | SP `vendorWalletController` | SP `Transaction`, `Withdrawal` | `withTransaction` | SP | vendor settle/withdraw | txn-atomic | no | SP role only | yes, for SP |
| 23 | SP `workerWalletController` | same | `withTransaction` | SP | worker withdraw | txn-atomic | no | SP role only | yes, for SP |
| 24 | SP `cashCollectionController` | SP `Transaction` + `Booking` | `withTransaction` | SP | cash collected | txn-atomic | partial (status guard) | SP role only | yes, for SP |
| 25 | SP `settlementController` | SP `Settlement` | `withTransaction` | SP | admin settlement | txn-atomic | no | ADMIN only | yes, for SP |
| 26 | `razorpayWebhook.controller` (core) | `food_orders.payment` | guarded `findOneAndUpdate` | Food | provider event | **yes** | **yes** (flag), **no** (ledger) | signature | yes for the flag |
| 27 | QC fork of #26 | `qc_orders.payment` | same **+ amount cross-check** | QC | provider event | yes | yes / no | signature | yes for the flag |
| 28 | `foodTransaction.service` | `food_transactions` | commission split | Food | order lifecycle | varies | no | n/a | commission record |
| 29 | `restaurantFinance.service` | `food_restaurant_withdrawals` | under lock | Food | restaurant payout | lock-guarded | no | ADMIN only | yes |
| 30 | `riderFinance.getRiderFinance` | — | **read only** | T+F+QC | every wallet read | n/a | n/a | n/a | **the read authority** |

**What the table says.** There is no single authoritative path and there never
was; there are *four* roughly-authoritative ones (#1 taxi, #8 deposits, #22-25 SP,
#18 customer) plus five that conflict with them (#3, #5, #13, #14, #16). The
convergence target is #1's *technique* (server-side pipeline update, signed
amount, before/after captured atomically) applied to #8's *idempotency model*
(unique index, write-as-claim).

**Silently swallowed failures** — the complete list:

| site | what is lost | correct handling |
|---|---|---|
| `queues/processors/payment.processor.js:72,99,118` | restaurant commission, rider earning, platform profit | **rethrow** → BullMQ retries with backoff → DLQ after N |
| QC fork of the same file | same | same |
| `razorpayWebhook.controller.js:82` | ledger row for a captured payment | enqueue a reconcile job; never swallow |
| `driverCapabilities.syncDeliveryApproval` | approval state divergence (not money) | surface to admin; retry |
| `ensureDeliveryCapability` / `ensureQuickCommerceCapability` | capability grant | already correct to swallow (must not fail signup), but must enqueue a repair |

---

## Part 3 — P0 implementation plan

### P0-3 / P0-6 — one authoritative financial mutation path

1. **Files** — new `core/finance/ledger.service.js`, `core/finance/models/ledgerEntry.model.js`; changed: `queues/processors/payment.processor.js` (+QC fork), `core/payments/transaction.service.js` (+fork), `modules/taxi/admin/services/adminService.js:4390`, `modules/taxi/services/rideService.js:2796`.
2. **Current** — five writers, three swallow failures, one (#3) loses updates.
3. **Root cause** — no ledger primitive existed, so each vertical grew its own.
4. **Fix** — `ledger.append({ownerType, ownerId, vertical, jobType, jobId, type, amount /* signed */, idempotencyKey, actor, reason })`. Balance updated by **aggregation-pipeline `$add`** (the `applyDriverWalletAdjustment` technique), `balanceBefore`/`balanceAfter` captured in the same atomic op, insert of the ledger row guarded by a unique index on `idempotencyKey`. Phase 0 **dual-writes only**: existing writers keep working and additionally append. Nothing reads the ledger yet.
5. **Migration** — none in Phase 0. Backfill from existing `wallettransactions` + orders + deposits happens in Phase 3.
6. **Indexes** — `{idempotencyKey: 1}` unique; `{ownerType:1, ownerId:1, createdAt:-1}`; `{vertical:1, createdAt:-1}`; `{jobId:1}`.
7. **API** — none.
8. **Frontend** — none.
9. **Queues** — `payment.processor.js` stops swallowing: rethrow so BullMQ retries; add `attempts: 5`, exponential backoff, and a `failed` handler writing to a `dead_letter_credits` collection. **BullMQ stays off** until the reconciler is clean.
10. **Tests** — `__checks__/ledger.check.js`: same key twice → one row; concurrent appends → balance = sum of amounts; negative amount permitted; every row's `balanceAfter - balanceBefore === amount`.
11. **Rollback** — ledger is additive and read by nothing; drop the collection.
12. **Depends on** — P0-4 (the index *is* the mechanism).

### P0-4 — idempotency

1. **Files** — new `core/idempotency/keys.js`; changed: the two `WalletTransaction` write sites, `transaction.service.js`, `refund.service.js` (+forks), admin adjust paths.
2. **Current** — deposits are correctly protected (#8/#9). Nothing else is. `byReference` (#2) is check-then-act with no index.
3. **Root cause** — application-level `if exists` used where a unique index is required.
4. **Fix** — a key *derived from the operation's own semantics*, never a universal one:

   | operation | key |
   |---|---|
   | provider webhook | `rzp:event:<event.id>` |
   | payment capture | `rzp:payment:<payment_id>` |
   | ride settlement | `ride:<rideId>:settle` |
   | order earning | `order:<orderId>:rider_earning` |
   | commission | `order:<orderId>:commission` |
   | cash deposit | `rzp:payment:<payment_id>` *(already)* |
   | withdrawal | `withdrawal:<withdrawalId>:<status>` |
   | refund | `refund:<refundId>` |
   | admin adjustment | `admin:<adminId>:<clientRequestId>` — client-supplied, so a double-click collapses but two deliberate identical adjustments do not |
   | cancellation fee | `ride:<rideId>:cancellation_fee` |

   Retry returns the **original result**, not an error: catch E11000, re-read by key, return it.
5. **Migration** — backfill `idempotencyKey` on existing `wallettransactions` from `metadata.referenceKey` where present; rows without one get `legacy:<_id>` so the unique index can be built.
6. **Indexes** — unique `{driverId:1, idempotencyKey:1}` on `wallettransactions` (**build `{background: true}` after the backfill, or it will fail on existing duplicates**); unique `{idempotencyKey:1}` on the new ledger.
7. **API** — admin financial endpoints accept an optional `Idempotency-Key` header; `middleware/idempotency.js` already implements this and is mounted on four routes — extend the mount, do not rewrite it.
8. **Frontend** — admin panel sends a per-form-submission UUID on financial actions.
9. **Queues** — retries become safe by construction.
10. **Tests** — per key type: same key twice → one effect, second returns the first result; two concurrent → one E11000, both callers get the same result.
11. **Rollback** — drop the indexes; keys become inert metadata.
12. **Depends on** — nothing. **This is the true root of the dependency graph.**

### P0-5 / P0-13 / P0-14 — webhook convergence

1. **Files** — `core/payments/controllers/razorpayWebhook.controller.js`, its QC fork, `routes/index.js:127`, `modules/quickCommerce/routes/index.js:84`.
2. **Current** — one Razorpay account, one `RAZORPAY_WEBHOOK_SECRET`, **two** public handlers, each looking up orders in **its own** collection. Both are signature-safe and both are idempotent on the paid flag. **But the two have diverged in opposite directions**: QC validates the captured amount against `pricing.total` and refuses a mismatch; **food does not — it marks an order paid for any captured amount**. Food has an inline `timingSafeEqual`; QC uses a shared util.
3. **Root cause** — P0-13 is the fork: a real fix landed on one side only. P0-14 is structural: Razorpay accepts one URL per event, so **whichever handler is not configured never runs**, and that vertical's orders reconcile only via the client-driven `/verify`. If the client closes the app after payment, that money is stranded.
4. **Fix** — one handler at `/v1/payments/webhook`. It resolves the order by `razorpayOrderId` across **both** order collections (until Phase 4 merges them), applies the amount cross-check unconditionally, and appends a ledger entry keyed `rzp:event:<id>`. QC's route becomes a 308 to the canonical path so an already-configured dashboard URL keeps working.
5. **Migration** — none. Operational step: confirm which URL is live in the Razorpay dashboard **before** deploying, and check for stranded QC orders in `pending_payment` with a captured payment.
6. **Indexes** — unique `{idempotencyKey}` covers replay.
7. **API** — one route; the other redirects. No client change.
8. **Frontend** — none.
9. **Queues** — ledger failure enqueues a reconcile job instead of `logger.error`.
10. **Tests** — same webhook twice; two concurrent identical; retry after partial failure; arrival after cancellation (must not re-open); arrival for an amount ≠ order total (must refuse and alert); arrival for a QC order at the food route (must resolve, not no-op).
11. **Rollback** — remove the redirect, restore the second mount.
12. **Depends on** — P0-4.

### P0-7 — financial authorization

1. **Files** — new `core/admin/requirePermission.middleware.js`; changed: `modules/food/admin/routes/admin.routes.js` (+QC fork), `modules/taxi/admin/routes/*`, SP admin routes; uses the existing `core/admin/adminAccess.util.js` unchanged.
2. **Current** — `requireAdmin` checks `role === 'ADMIN' || 'SUPER_ADMIN'`. `hasResourcePermission` exists, is correct, and has exactly one caller (`adminHierarchy.service.js`) — never middleware.
3. **Root cause** — the model was built and never mounted.
4. **Fix** — mount `requirePermission('partner_wallet','adjust')` etc. on the ~14 money-affecting endpoints (wallet adjust, withdrawal approve/reject, cash-limit set, settlement, refund, bonus grant, commission override, deposit reversal). Each handler additionally requires a `reason` and writes an audit entry **inside the same transaction as the mutation**.
5. **Migration** — grant existing admins the permissions implied by their current role, so nobody loses access on deploy. Dry-run the grant and print the diff.
6. **Indexes** — `{actorId:1, createdAt:-1}` on the audit collection.
7. **API** — financial endpoints gain a required `reason`; **breaking for the admin panel**, so ship the frontend change first behind a tolerant server (accept missing `reason` for one release, log it, then enforce).
8. **Frontend** — reason field on financial dialogs; handle 403 distinctly from 401.
9. **Queues** — none.
10. **Tests** — admin without permission → 403; with → 200 + exactly one audit row; mutation failure → no audit row (same transaction).
11. **Rollback** — unmount the middleware; permissions become inert.
12. **Depends on** — nothing. Fully parallel.

### P0-8 / P0-11 / P0-12 — negative balance and the taxi writers

1. **Files** — `core/payments/transaction.service.js:108` (+fork), `modules/taxi/admin/services/adminService.js:4390`, `modules/taxi/services/rideService.js:2796`, `deliveryFinance.service.js:91,101`, `order-dispatch.service.js:263`.
2. **Current** —
   - `recordTransaction` **throws** when a debit would go negative (`entityType !== 'admin'`). The debt is not recorded, so it ceases to exist.
   - `adminService:4390` is a **second** taxi wallet writer doing read-modify-write with `driver.save()`, and it uses a **different block rule** (`nextBalance < -cashLimit`) than `walletService` (`balance <= minimumBalanceForOrders`). Two concurrent adjustments lose one; an admin adjustment racing a ride settlement loses one.
   - `rideService:2796` writes a ledger row for a cash tip with `balanceBefore === balanceAfter` and a non-zero `amount`. **Folding the ledger will overstate the balance by the sum of all tips.**
3. **Root cause** — balance and eligibility were never separated; the taxi admin path predates `applyDriverWalletAdjustment`.
4. **Fix** —
   - Delete the negative-balance throw. The ledger records what happened.
   - Split the decision: `evaluateForNewJob(partner, job)` may return `financiallyRestricted`; `evaluateForActiveJob(partner, job)` **never blocks on balance** — an in-flight delivery completes, because completing it is how the cash gets deposited and the block clears.
   - Point `adminService:4390` at `applyDriverWalletAdjustment` so there is one taxi writer and one block rule.
   - Give the tip row `type: 'cash_tip_direct'` with `amount: 0` and the tip in `metadata`, or exclude the type from the fold — either way the invariant `sum(amount) === balance` must hold.
5. **Migration** — none for the throw. For P0-12, a one-off correction of existing tip rows before the ledger fold is trusted.
6. **Indexes** — none.
7. **API** — wallet responses gain `financiallyRestricted` + `restrictionReasons[]` alongside `balance`; `balance` may now be negative. **Clients must not assume `balance >= 0`.**
8. **Frontend** — partner apps render a negative balance as debt, not as an error or a zero; admin Partner 360 shows balance and restriction separately.
9. **Queues** — none.
10. **Tests** — debit ₹250 against ₹100 → balance `-150`, restricted, **active job still completable**; two concurrent admin adjustments → both applied; fold of all ledger amounts === stored balance, tips included.
11. **Rollback** — restore the throw; negative balances already written stay (correctly) visible.
12. **Depends on** — P0-3 (the ledger must exist before the throw is removed, or a debt has nowhere to land).

### P0-2 — QC assignment locking

1. **Files** — `modules/quickCommerce/modules/food/orders/services/order-delivery.service.js` (accept/cancel/complete), `.../order-dispatch.service.js:294`, `modules/taxi/driver/services/driverAssignmentService.js`.
2. **Current** — QC **filters** on `activeAssignment: null` but **never acquires or releases**. So: a driver on a QC order still reads free and food or taxi will claim them; and QC itself has no guard against two QC orders. Food and taxi both acquire; SP does not participate at all.
3. **Root cause** — QC forked from food *before* the busy-lock existed and never picked it up.
4. **Fix** — do **not** copy food's wrapper. Generalise the primitive first:
   - `activeAssignment` (single embedded doc) → `activeAssignments: [{jobType, jobId, at}]`, keeping a virtual for the old shape so nothing reading it breaks;
   - `claim(partnerId, jobType, jobId, {maxConcurrent, allowedCombinations})` as one CAS:
     `updateOne({_id, $expr: {$lt: [{$size:'$activeAssignments'}, max]}, 'activeAssignments.jobType': {$nin: forbidden}}, {$addToSet: ...})` — `$addToSet` makes re-claim idempotent;
   - defaults preserve today's behaviour exactly: `maxConcurrent = 1`, all combinations forbidden. **Stacking becomes representable without becoming enabled.**
   - `reconcile` must learn QC: `type: 'delivery'` currently resolves only `FoodOrder`, so a QC lock would be judged "job not found → stale" and cleared instantly. Add a `vertical` field to the assignment and a per-vertical terminal-status resolver.
   - Then wire QC accept/cancel/complete/timeout/reassign, and food's `partnerAcceptsDeliveries` equivalent.
5. **Migration** — one-off: `activeAssignment` → `activeAssignments[]` (or write both for one release and read the array).
6. **Indexes** — replace `{isOnline, serviceCapabilities, workMode, 'activeAssignment.type'}` with the array equivalent.
7. **API** — none.
8. **Frontend** — none.
9. **Queues** — a periodic `reconcileDriverAssignment` sweep so a crashed process cannot strand a partner.
10. **Tests** — the cross-vertical matrix the brief asks for: Food+Food, Food+QC, Food+Taxi, Taxi+Taxi, Taxi+SP, QC+Taxi — each asserted against its configured rule; concurrent claims from two verticals → exactly one wins; QC lock survives reconcile; release only clears its own job.
11. **Rollback** — `UNIFIED_DISPATCH_ENABLED` already gates the food/taxi side; gate the QC wiring the same way.
12. **Depends on** — nothing financial. Can run in parallel with the money work.

### P0-1 — the `users` collection

1. **Files** — `core/users/user.model.js:147`, `modules/taxi/user/models/User.js:221`, every auth path for both, `core/identity/identityLink.service.js`, `scripts/link-user-identities.js`.
2. **Current** — `FoodUser` and `TaxiUser` are **two mongoose schemas over one collection**, both declaring `phone` unique. Field diff:
   - shared (24): `phone, countryCode, name, email, profileImage, addresses{label,street,city,state,zipCode,location,isDefault,...}, fcmTokens, fcmTokenMobile, dateOfBirth, anniversary, gender, referralCode, referredBy, referralCount, isVerified, isActive, role`
   - **food only**: `isBlockedFromCOD`
   - **taxi only**: `password, status, active, deletedAt, deletion_reason, deletionRequest{...}, currentRideId, pending_cancellation_due, referredRideCompletionCount, referralRewardGrantedAt`
3. **Root cause** — the identity core is genuinely shared; the divergence is purely additive. Under mongoose's default `strict`, a document hydrated by one schema does not carry the other's paths, so **`save()` on a full document can drop the other vertical's fields**. That is the corruption mechanism — not the shared collection itself.
   **This is a hypothesis about mongoose behaviour, not something I observed in production data. Step 1 of this fix is a test that proves or disproves it.** If `save()` turns out to preserve unknown paths in this mongoose version, P0-1 drops from P0 to P2 and the fix is much smaller.
4. **Fix (assuming confirmed)** — smallest safe change, in order:
   a. a `__checks__` test that round-trips a document through both schemas and asserts no field loss;
   b. if it fails: make both models share **one** schema definition (`core/users/userSchema.js`) with vertical fields declared optional on it. One collection, one schema, two model names during transition. **No data migration, no id change, no rename** — this is a code-level fix only;
   c. audit every `save()` on a user for full-document writes and convert to targeted `$set`;
   d. only then, in Phase 1, layer `PlatformUser` on top with explicit `platformUserId` links.
5. **Migration** — **none for (b).** Existing documents already live in `users` with their existing `_id`s; a wider schema simply stops discarding fields.
6. **Indexes** — taxi declares one extra (`deletionRequest.status`). Harmless, keep.
7. **API** — none.
8. **Frontend** — none.
9. **Queues** — none.
10. **Tests** — round-trip both ways asserting zero field loss; a taxi login followed by a food profile update preserves `password` and `currentRideId`; `phone` uniqueness holds across both models.
11. **Rollback** — revert the shared schema; nothing was migrated.
12. **Depends on** — nothing. But do **not** start the `PlatformUser` migration until P0-9's dry-run is clean.

### P0-9 — identity matching

1. **Files** — `core/identity/identityLink.service.js:31`, `core/identity/driverCapabilities.service.js:27`, `core/activity/identityResolver.js`, `scripts/link-user-identities.js`.
2. **Current** — matching is `{ phone: new RegExp(\`${last10}$\`) }`. Unindexed (collection scan per lookup). The existing script is **dry-run by default** (both writes are inside `if (COMMIT)` — verified) but reports only `linked / created / already / unusablePhone`. **It does not detect ambiguity at all**: if two `users` rows share a phone suffix, `findOne` silently picks one.
3. **Root cause** — a suffix regex is not an identity relation.
4. **Fix** — do **not** change matching behaviour yet. First add reporting:
   - normalise to E.164 where a country code is derivable; keep the raw value;
   - classify every candidate pair as **safe** (exactly one match, names compatible), **ambiguous** (>1 match on the suffix), **conflicting** (one match but names/emails disagree), or **unusable** (<10 digits);
   - migrate **only** the `safe` bucket; everything else lands in a `identity_review_queue` collection for an operator, never auto-merged.
   - Handle explicitly: `+91` / `91` / leading `0` / spaces and dashes; a 10-digit suffix collision between two genuinely different international numbers; a number that changed hands.
5. **Migration** — the safe bucket only, idempotent, `platformUserId` stamped and never overwritten.
6. **Indexes** — `{phoneNormalized: 1}` (new field, backfilled) to replace the regex scan; `{platformUserId: 1}` on each satellite.
7. **API** — none.
8. **Frontend** — an admin review screen for the queue (Phase 1, not Phase 0).
9. **Queues** — none.
10. **Tests** — `+919876543210` / `919876543210` / `09876543210` / `9876543210` all normalise identically; two different numbers sharing a 10-digit suffix are **ambiguous, not merged**; re-running the migration changes nothing.
11. **Rollback** — `platformUserId` is additive; unset it.
12. **Depends on** — P0-1 (b).

> **I could not run the dry-run.** `Backend/.env` points at `mongodb://…localhost:27017` and no mongod is reachable from this machine (`ECONNREFUSED 127.0.0.1:27017`). I will not guess at counts. Give me a connection string, or run the enhanced script yourself once I have written it and paste the output — the safe/ambiguous/conflicting split decides whether P0-9's migration is a day or a month.

### P0-10 — duplicate customer wallet transactions

1. **Files** — `core/payments/wallet.service.js:111-160` (+QC fork), `modules/food/user/services/userWallet.service.js:23`, `cashback.service.js:97`, `refund.service.js`, `core/payments/transaction.service.js`.
2. **Current** — a customer's history has **two stores**: the embedded `FoodUserWallet.transactions[]` array and the `transactions` collection. `getUserWalletForFrontend` carries the comment `// Deduplicate by checking if an embedded txn has a matching new txn` and then does `[...convertedNewTxns, ...convertedEmbedded]`. **The dedup was never written.** Balance comes only from the embedded document, so the two can also disagree in total.
3. **Root cause** — the ledger was introduced beside the embedded array instead of replacing it; the merge function was left half-finished.
4. **Fix** — fix it at the source, not in the reader: the embedded array becomes the sole store for Phase 0 (it is what balance is computed from), and any path that writes both stops writing to `transactions`. The reader returns one list. In Phase 3 both are replaced by the master ledger, with a backfill. **Not** a UI-level dedup.
5. **Migration** — identify customers with rows in both stores for the same `orderId` before changing the reader, so a genuine double-credit is not hidden by the fix.
6. **Indexes** — `{entityType:1, entityId:1, orderId:1}` on `transactions` to make that reconciliation query cheap.
7. **API** — `GET /food/user/wallet` returns one deduplicated list; total may change for affected users.
8. **Frontend** — none (the shape is unchanged), but pagination becomes correct.
9. **Queues** — none.
10. **Tests** — a wallet with the same txn in both stores returns it once; cross-vertical transactions both appear; pagination totals match the unpaginated count; refunds appear once; two payment sources for one order appear as two rows, not deduped away.
11. **Rollback** — restore the concatenation.
12. **Depends on** — nothing. Fully parallel.

---

## Part 4 — Dependency graph and recommended order

```
P0-4 idempotency keys + unique indexes        ← root, blocks 3 others
   ├── P0-3/6 ledger + stop swallowing failures
   │       └── P0-8/11/12 negative balance, taxi writer convergence
   └── P0-5/13/14 webhook convergence

P0-7 admin financial authz          ── independent, ship anytime
P0-2 QC assignment locking          ── independent of all money work
P0-10 customer wallet duplication   ── independent
P0-1(b) shared user schema          ── independent
   └── P0-9 identity dry-run + safe-only migration
```

**Recommended order — this differs from the one you sketched, in three places:**

| # | work | why here |
|---|---|---|
| 1 | **Financial mutation inventory** | done, above — it is what produced the reordering |
| 2 | **P0-4** idempotency keys + unique indexes | every later money fix is unsafe without it; and the index build needs the backfill done first, which is slow |
| 3 | **P0-7** admin financial authz | **moved up from your #5.** It is fully independent, needs no migration, and closes an *unauthorized-mutation* hole that is live right now. Nothing gained by waiting |
| 4 | **P0-10** customer wallet duplication | **moved up from your #9.** Independent, small, and it is customer-visible today |
| 5 | **P0-3/6** ledger dual-write + stop swallowing failures | needs #2 |
| 6 | **P0-5/13/14** webhook convergence | needs #2; **P0-13 (food accepts any captured amount) is the most exploitable single bug found and could be split out and shipped at #3 if you want it sooner** |
| 7 | **P0-8/11/12** negative balance + taxi writer convergence | **moved after the ledger**, not before. Removing the negative-balance throw before a ledger exists means the debt has nowhere to be recorded — you would trade a hidden debt for a lost one |
| 8 | **P0-2** QC assignment locking | independent; sized as its own piece because generalising to `activeAssignments[]` touches the taxi index and schema |
| 9 | **P0-1(b)** shared user schema, after the round-trip test | the test may downgrade this |
| 10 | **P0-9** identity dry-run, then safe-bucket migration only | **blocked on a database connection I do not have** |
| 11 | **Reconciliation verification** | the ledger fold must match every existing balance for 14 nights before anything reads from it |

**Three things I will not do in Phase 0**, and why:

- **Not enable BullMQ.** It is the switch that activates writer #5/#7 against `food_delivery_wallets`. It stays off until the reconciler is clean.
- **Not migrate any identity.** P0-9's dry-run has not run. Merging on a heuristic is the one mistake here that cannot be undone.
- **Not read from the new ledger.** Phase 0 dual-writes only. Authority moves in Phase 3, after reconciliation.

---

## Part 5 — What I need from you

1. **A database connection** (a read-only replica or a staging restore is ideal) so P0-9's dry-run produces real safe / ambiguous / conflicting counts. Without it that item cannot leave the plan.
2. **Confirmation of which Razorpay webhook URL is configured** in the dashboard — `/v1/payments/webhook`, `/v1/qc/payments/webhook`, or both. This determines whether P0-14 is a latent design flaw or a live stranded-payments incident.
3. **A decision on P0-7's breaking change**: financial admin endpoints will require a `reason`. I plan one tolerant release (accept-and-log) before enforcing. Say if you would rather enforce immediately.
4. **Go / no-go on the order above.** I would start at #2 (P0-4), with #3 (P0-7) in parallel since they touch nothing in common.

Say go and I will start with P0-4: the idempotency key taxonomy, the backfill, and the unique indexes — plus the `__checks__` that prove a replay is harmless before anything else is built on top.
