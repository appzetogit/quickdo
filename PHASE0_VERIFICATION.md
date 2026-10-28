# Phase 0 — verification report

The report owed at the end of Phase 0. What changed, what is now authoritative,
what is not, and what is still unproven.

Written against the working tree. **Nothing is committed** — a `git diff` shows
the whole change set.

---

## 1. Invariants, and whether they actually hold

The ten Phase 0 invariants, answered honestly. "Enforced" means something rejects
a violation; "prepared" means the mechanism exists but nothing consumes it yet.

| Invariant | State | Where |
|---|---|---|
| One authoritative financial mutation path | **prepared** | `ledger.service.append` built; no writer points at it |
| No duplicate money mutations | **partially enforced** | deposits already were; webhook amount now checked; ledger key unique index **not yet built** |
| No silently lost money | **enforced** | all 10 swallowing sites now write `failed_financial_operations` |
| No unauthorized financial mutation | **recorded, not yet refused** | 13 money routes gated, tolerant mode by default |
| One partner cannot receive conflicting work | **enforced behind a flag** | QC now claims the lock; `UNIFIED_DISPATCH_ENABLED` still off |
| Negative balance represented correctly | **prepared** | ledger records it; `recordTransaction`'s throw not yet removed |
| Identity cannot be incorrectly merged | **unchanged** | untouched deliberately — dry-run never ran |
| Duplicate provider events are harmless | **partially** | order flag was already idempotent; ledger call still is not |
| Customer wallet history not duplicated | **enforced** | merge implemented + pinned; the route was not live |
| Every critical mutation auditable | **partially** | `admin_audits` records authorization + HTTP outcome, not the money move |

**Four of ten fully hold. Nothing claimed here is stronger than what the code does.**

---

## 2. What changed

### Behaviour changed in production paths — one item only

**P0-13 — the food Razorpay webhook accepted any captured amount.** A ₹1 capture
marked a ₹900 order paid and dispatched it. The quick-commerce fork has validated
this since it was written; the food handler never got the fix. Both now share
`core/payments/capturedAmount.js`.

*Visible effect*: orders whose `pricing.total` changed after checkout will now log
`AMOUNT MISMATCH` and be marked failed instead of silently settling. Mismatches
return **200** — a non-200 makes Razorpay retry an event that can never succeed.

### Behind a flag — no effect until switched on

| Change | Flag | Default |
|---|---|---|
| QC takes the cross-vertical busy-lock | `UNIFIED_DISPATCH_ENABLED` | off |
| Financial routes refuse unauthorized admins | `FINANCE_PERMISSIONS_ENFORCED` | off |
| Eligibility engine measured against all 3 dispatchers | `ELIGIBILITY_SHADOW_ENABLED` | off |

### Additive — new, read by nothing

`core/assignment/*`, `core/finance/{eligibilityRules, eligibility.service,
eligibilityShadow, idempotencyKeys, ledgerEntry.model, partnerBalance.model,
ledger.service, deadLetter, failedFinancialOperation.model}`,
`core/admin/{financeAuthz, requireFinancePermission.middleware, models/adminAudit}`,
`core/payments/{capturedAmount, mergeWalletHistory}`,
`scripts/backfill-wallet-idempotency-keys.js`.

### Converged — two writers became one

- `adminService.adjustDriverWallet` → `applyDriverWalletAdjustment`. Removes a
  read-compute-write that **lost updates** under concurrency, and a second block
  rule that disagreed with the first.
- `driverAssignmentService.reconcileDriverAssignment` → `reconcileAssignments`.
  Same signature, both callers untouched; now vertical-aware.

### Corrected

- Cash tips wrote `amount = tip` with an unchanged balance. Folding the ledger
  would have overstated every driver's balance by their lifetime tips. Now
  `amount: 0` with the figure in `metadata.tipAmount`; **both driver-earnings
  aggregations updated** so tip reporting did not silently drop to zero.
- `getUserWalletForFrontend` concatenated two transaction stores under a comment
  promising deduplication that was never written.

---

## 3. What is now authoritative

| Concept | Authoritative | No longer authoritative |
|---|---|---|
| Captured-amount rule | `capturedAmount.capturedAmountMatches` | food's absent check; QC's inline copy |
| Busy-lock / concurrency | `core/assignment/assignment.service` | `driverAssignmentService`'s own impl; QC's `partnerHasActiveDelivery` |
| Terminal-status tables | `core/assignment` (per vertical) | the food-only copy in `driverAssignmentService` |
| Taxi wallet mutation | `applyDriverWalletAdjustment` | `adminService`'s read-compute-write |
| Idempotency keys | `core/finance/idempotencyKeys` | ad-hoc `metadata.referenceKey` strings |
| Financial authorization | `core/admin/financeAuthz` | bare `role === 'ADMIN'` on 13 routes |
| Eligibility (once cut over) | `core/finance/eligibilityRules` | 3 dispatcher-local calculations |
| Balance (once cut over) | `ledger_entries` fold | 5 divergent sources |

---

## 4. Migrations and backfills required

**None of the shipped changes needs a migration to deploy.** These are
preconditions for the *next* phase.

1. **`node scripts/backfill-wallet-idempotency-keys.js`** — dry-run by default,
   writes nothing (verified: the only write is `COMMIT`-guarded). Its collision
   report is the gate: two rows sharing `(driverId, referenceKey)` mean the old
   check-then-act dedupe **already double-credited someone**. Those rows are not
   stamped; they need a decision. The unique index cannot build until it reports
   clean.
2. **`activeAssignment` → `activeAssignments[]`** — only needed before enabling
   stacking. The claim filter carries a legacy guard so un-backfilled drivers are
   handled correctly without it.
3. **Admin permission grants** — read `admin_audits` where
   `toleratedViolation: true`, grant `wallet.write` to the admins it names, confirm
   it stops growing, then set `FINANCE_PERMISSIONS_ENFORCED=true`.
4. **Identity** — nothing run, nothing changed. Deliberate.

---

## 5. What could still break

| Risk | Likelihood | Mitigation in place |
|---|---|---|
| Orders with post-checkout total changes now fail at the webhook | low | logged loudly as `AMOUNT MISMATCH`; 200 returned so no retry storm |
| Tip earnings misreported | very low | both aggregations read `$ifNull: [metadata.tipAmount, amount]`; old rows still work |
| Admin adjustment block threshold changed | low | deliberate convergence; documented at the call site |
| Dead-letter write slows a job during a Mongo outage | low | bounded to 2s (measured 2.3s) instead of mongoose's 10s buffer |
| Two new `Driver` indexes build on first connect | low | small collection; mirror index kept so dispatch queries are unaffected |
| `ledger.append` requires a replica set | **unknown** | fails loudly rather than degrading — **confirm production topology** |

---

## 6. What is NOT proven

Stated plainly, because the difference matters more than the line count.

**Proven** — everything with a check: the captured-amount rule (13), idempotency
key taxonomy (17), assignment matrix (29), finance authorization (21), eligibility
(38 across two files), ledger invariant (21), wallet history merge (15), shared
`users` schema behaviour (8). **40 check files, all passing.**

**CORRECTION.** An earlier version of this section said `ledger.append` could not
be tested because no database was reachable. That was wrong: `Backend/tests/`
already runs against an in-memory MongoDB **replica set** via
`mongodb-memory-server`, which is exactly what `append` needs. I had judged the
work untestable without looking for the harness the repo already had.

`tests/ledger.append.smoke.mjs` now covers it, and it is in `npm test`:

- the transaction — a losing insert rolls the balance increment back with it,
  asserted on both balance and version
- E11000 as a success path — a replay returns the ORIGINAL row, and eight
  concurrent replays of one key credit once
- `$inc` under contention — twenty concurrent appends all land, none lost
- negative balances recorded rather than refused (the P0-8 case)
- the reconciler catching both a tampered balance and a MISSING entry, the second
  of which a sum alone would hide

`tests/assignment.claim.smoke.mjs` does the same for the busy-lock, also in
`npm test`: three verticals racing for one driver produce exactly one winner; the
new claim racing the OLD acquire produces exactly one winner across ten rounds;
the mirror keeps food and taxi from double-booking a QC rider; both release
regressions are pinned; and reconcile keeps a live `qc_orders` lock rather than
clearing it. A mutation run -- removing the capacity and legacy guards -- fails
three of those checks, so they are not passing vacuously. The existing
`assignment.smoke.mjs` still passes 12/12 through the rewritten reconcile.

**Still not proven:**

- Whether the eligibility engine's verdicts match reality — that is what shadow
  mode exists to answer, and it needs production traffic rather than a test.
- Every migration script. None has run against real data.

**No production database was reachable** (`ECONNREFUSED 127.0.0.1:27017`), so
P0-9's safe / ambiguous / conflicting counts remain unknown. I did not estimate
them. `scripts/analyse-identity-merge.mjs` is written and read-only, waiting on a
connection.

---

## 7. Six bugs the checks caught in my own code

Listed because they are the argument for writing the checks first.

1. **`Number.isFinite(Number(null))` is `true`.** Every unset policy value is
   null, so `maxDistanceKm: null` became a ceiling of **zero kilometres** and
   `minimumWalletBalance: null` became "block any balance ≤ 0" — which, given taxi
   encodes debt as a negative balance, would have blocked most of the fleet.
   Eleven checks failed at once.
2. **`pre('validate')` is skipped by `validateSync()`** — the ledger invariant
   would have looked enforced while validating nothing on every synchronous path,
   and `updateOne` skips such hooks entirely. Moved to a path validator.
3. **Unguarded release re-mirrored the legacy lock field**, so releasing a job a
   driver did not hold cleared a live lock belonging to a different job.
4. **`requireReason` defaulted independently of `enforcing`**, so tolerant mode
   passed the permission check and then returned 400 — breaking the very queue the
   staged rollout exists to keep working.
5. **`decide(null)` returned 401 regardless of enforcement**, which would have
   hard-locked any admin not in the `admins` collection out of the payout queue on
   the deploy that promises to change nothing.
6. **The tip change would have zeroed tip earnings** on the driver's screen —
   `driverController` summed `$amount`. Caught by tracing the reader before
   changing the writer.

And one measured rather than reasoned: the dead letter **blocked for 10 seconds**
with Mongo down, five times per job.

---

## 8. Recommended next actions, in order

1. **Run the backfill dry-run.** Read-only. Its output decides whether P0-4 is a
   day's work or an incident.
2. **Confirm the Razorpay webhook URL** configured in the dashboard. If only
   `/v1/payments/webhook` is live, quick-commerce orders have been reconciling
   solely via client-driven `/verify` — check for QC orders in `pending_payment`
   against a captured payment.
3. **Confirm the production MongoDB topology** is a replica set.
4. **`ELIGIBILITY_SHADOW_ENABLED=true`** in staging, then production for a week.
   Read the `WOULD_BLOCK` / `WOULD_ALLOW` lines. Expect genuine `WOULD_BLOCK` from
   taxi — it has never had a cash gate at candidate selection.
5. **Grant permissions** from `admin_audits`, then enforce.
6. **Enable `UNIFIED_DISPATCH_ENABLED`** per city once 4 and 5 are settled.

The ledger dual-write has started (§8a). Still to come: the reconciler's fourteen
clean nights, then the cutover.

## 8a. Ledger dual-write — taxi wallet (shipped, flag off)

**Authoritative:** `taxidrivers.wallet` + `wallettransactions`, unchanged.
**Non-authoritative:** `ledger_entries`. Written, never read.

`applyDriverWalletAdjustment` is the single writer every balance-moving taxi row
goes through (ride settlement, commission, top-up, admin adjustment). After it
creates the wallet row it calls `core/finance/ledgerMirror.js`:

- **Off unless `LEDGER_DUAL_WRITE_ENABLED=true`.** Off is exactly the old behaviour,
  and a test checks that.
- **Cannot fail the ride.** Not awaited; a failure is dead-lettered as `UNMIRRORED`
  (not `UNPAID` -- the money moved, only its record is missing) with a payload
  that replays cleanly.
- **Never records rolled-back money.** Inside a transaction, the entry is queued
  and written only when *that* transaction's commit succeeds. Two tempting designs
  were tested and were wrong, so the reasons are recorded here: the driver's
  `isCommitted` getter counts ABORTED as committed, and flushing at session end
  lost an earlier commit on a reused session.
- **Keyed on the source row** (`source_row:wallettransactions:<id>`), not the ride,
  so the ledger records what the wallet actually did, double credits included, and
  the Phase 3 backfill can overlap it safely.
- **Ledger balance = net movement since enabling**, not the wallet balance. There are
  no opening balances until Phase 3. Reconcile rows with
  `reconcileTaxiWalletMirror({ since })`, not balances.

Tested: `tests/ledger.mirror.smoke.mjs`, 10 checks against a real replica set,
driving the real writer. Mutation-verified: mirroring straight away inside a
transaction fails 3 of them.

**To enable:** confirm prod is a replica set (Atlas is), set the flag, reload
`master-api`, and note the time. Run `reconcileTaxiWalletMirror({ since })` daily;
`missing` should be empty apart from rows whose dead letter is still unreplayed.

## 8b. Ledger projection — food and quick-commerce riders (shipped, not yet run)

**Authoritative:** `riderFinance`, derived on read from orders, deposits, bonuses
and withdrawals. **Non-authoritative:** the projected `ledger_entries`.

Food and QC have no stored rider balance, so no single writer exists to
dual-write from. `core/finance/deliveryLedgerProjector.js` computes each source
item's target (an order's earning while delivered, a withdrawal's hold while
pending or approved, ...), compares it with what the ledger already holds, and
appends only the difference. Running it twice appends nothing. When the source
changes (delivery reversed, withdrawal rejected, earning edited, order
reassigned), it appends a `#revN` correction and never rewrites a row. The owner
is part of the key, so a reassigned order's reversal and its new rider's earning
don't collide.

`reconcilePartner` checks the projected ledger against
`sumDeliveryMoneyForVertical`, which is the same calculation every rider balance
uses, not a copy of it.

**Found on the way, fixed separately (`f862bd7`):** riderFinance never read the
`qc_*` collections at all, so approved QC withdrawals could be requested again.
Someone should check `qc_delivery_withdrawals` for riders whose approved total
exceeds their earnings.

Tested: 14 planning checks plus `tests/ledger.projector.smoke.mjs` (9 checks,
replica set, both verticals, concurrent runs). If the projector stops holding
pending withdrawals, 5 of those 9 fail.

**To run:** `npm run ledger:project-delivery` does a read-only dry run. Add
`-- --commit` to append; it refuses to run without a replica set and the unique
index, then reconciles every partner and exits 1 on any disagreement. Nothing in
the app reads these entries.

## 8c. Nightly reconciliation — the fourteen-night clock (shipped, flag off)

`core/finance/ledgerNightly.js`, started from `server.js`, checks every 15 minutes
and runs once per IST night after 03:00. The steps:

1. **delivery projection** (`LEDGER_PROJECTION_ENABLED`): project, then reconcile
   every partner against riderFinance
2. **taxi mirror** (`LEDGER_DUAL_WRITE_ENABLED` + `LEDGER_MIRROR_SINCE`): every
   wallet transaction from the last two days has its entry (rows under 10 minutes
   old are left for the next night)
3. **internal consistency**, always: each owner's running balance equals the fold
   of their entries

Each night is one row in `ledger_reconcile_runs`, and inserting that row is the
claim, so several instances on the cluster still run it once (checked with five
at once). A run that dies is taken over after 2 hours. `cleanStreak` is the
number the cutover waits on:

```js
db.ledger_reconcile_runs.find({}, { night: 1, clean: 1, cleanStreak: 1 }).sort({ night: -1 }).limit(14)
```

**What a streak does and doesn't mean.** It resets on a dirty night and on a
missed night. A night where every part was switched off is not clean. The
delivery part re-projects before it reconciles, so it proves the projector's
formulas match riderFinance; it can't catch edits to the source documents,
because riderFinance is the authority for those. A non-zero `appended` on a
quiet night is the thing to look at. The taxi part and the internal-consistency
part are genuine cross-checks.

**To enable:** `LEDGER_NIGHTLY_ENABLED=true`, plus whichever parts you want:
`LEDGER_PROJECTION_ENABLED=true`, and for taxi `LEDGER_DUAL_WRITE_ENABLED=true`
with `LEDGER_MIRROR_SINCE=<ISO time mirroring was switched on>`.

---

## 9. The final test, re-answered

> *"If I change a genuinely global business rule once, will all four verticals obey it?"*

**Still no — but the reason has changed.** It was "there is no one place to change
it." It is now "the one place exists, is tested, and nothing consumes it yet."

That is a smaller gap, and shadow mode is how it closes: not by trusting the new
engine, but by proving against a week of real traffic that its answer is the one
the platform should have been giving all along.
