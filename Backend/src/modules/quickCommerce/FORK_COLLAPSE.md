# Collapsing this fork — what to check before deleting a file

`modules/quickCommerce` is a source fork of `modules/food` plus a fork of `core/`.
Removing it is worth doing, and most of it is mechanical. This file records the
three things that are **not** mechanical, each of which was found by nearly getting
it wrong.

---

## 1. Identical text does not mean identical behaviour

Four files in `core/payments` are **byte-for-byte identical** to master's and still
do completely different things:

```
core/payments/transaction.service.js
    import { FoodUserWallet } from '../../modules/food/user/models/userWallet.model.js';
        resolves to  src/modules/food/user/models/userWallet.model.js

modules/quickCommerce/core/payments/transaction.service.js
    SAME LINE
        resolves to  src/modules/quickCommerce/modules/food/user/models/userWallet.model.js
```

The fork works because it sits at a directory depth where every relative import
lands on its own copy. So:

> **A file being identical to master's is not a reason to delete it. It is a reason
> to check what it binds to.**

Deleting one of these and repointing its importers at master's copy would silently
redirect every wallet write to the other vertical's collection. Nothing would
throw. The money would just go somewhere else.

Collapsing these needs the models passed in rather than imported by path. That is
a real refactor of a money path, and it is deliberately **not** done yet:
`recordTransaction` only runs under BullMQ (currently off) and is scheduled to be
replaced by `core/finance/ledger.service.js`. Refactoring an untestable money path
that is already slated for removal is poor value for the risk.

---

## 2. Check the collection before repointing an import

| what | master | this fork | safe to merge? |
|---|---|---|---|
| OTP | `food_otps` | was `qc_otps` | **yes** — collapsed; OTPs live ~5 min, so the only cost was in-flight logins at deploy |
| refresh tokens | `food_refresh_tokens` | `qc_refresh_tokens` | **no** — holds every live session; merging logs everyone out |
| notifications | `food_notifications` | same | already shared |
| broadcasts | `food_notification_broadcasts` | `qc_broadcast_notifications` | not yet — plus a TTL index master lacks |
| payments | `payments` | same | already shared |
| refunds / settlements / transactions | shared names | `qc_*` | no — needs a migration |
| users | `users` | `qc_users` | no — identity merge, blocked on the dry-run |
| admins | `admins` | `qc_admins` | no — and the permission *shapes* differ |

The rule that falls out: **share the code, keep the collection**, until a migration
is a deliberate decision with a chosen moment. `core/refreshTokens/refreshToken.model.js`
shows the shape — one schema, two model registrations.

---

## 3. Find importers by FILENAME, not by path prefix

```bash
# WRONG — misses './notification.controller.js' and '../refreshTokens/...'
grep -rn "core/notifications/notification.controller" --include=*.js modules/quickCommerce

# RIGHT
grep -rnE "from ['\"][^'\"]*notification\.controller" --include=*.js modules/quickCommerce
```

The wrong form reported **zero importers** for a file that was very much in use.
The same mistake cost an import in the OTP collapse. Both times the thing that
caught it was:

```bash
node -e "process.env.NODE_ENV='test'; import('./src/app.js').then(()=>console.log('ok'))"
```

Run that after every collapse. It loads the whole route tree, so a broken import
fails immediately instead of at the first request to that endpoint.

---

## 4. Which direction has the fork drifted?

Not always the direction you expect. Check before assuming master is newer.

| module | drift |
|---|---|
| `core/otp` | **master ahead** — the fork was missing the rate limiter, phone normalisation and the DLT template. Collapsing was a security fix. |
| `core/notifications` | **fork ahead** — it had a mark-all-read endpoint food did not. Collapsing meant porting the feature *into* master first. |
| `notifications/firebase.service.js` | **fork ahead**, 788 lines against 629, four extra exports. A merge project, not a step. |
| `core/payments/wallet.service.js` | **master ahead** — a customer-facing dedup fix landed in master and never reached here. |

A fix landing on one side only, in both directions, is the actual cost of this
fork. It is why the collapse is worth finishing.

---

## Progress

`modules/quickCommerce/core`: **36 files → 27**.

Done: `otp`, `refreshTokens`, `roles/role.middleware`, `notifications` (4 of 7),
`payments/razorpayWebhook.controller`.

Blocked on a database: `users`, `admin` (both identity merges),
`payments/{refund,settlement,transaction}` models and services (collection
migrations, and the ledger cutover replaces them anyway).

Merge projects, not collapses: `notifications/firebase.service.js`,
`notifications/fcm.routes.js`.

Genuinely vertical-specific, keep: `roles/adminPermission.middleware.js`,
`notifications/models/notificationBroadcast.model.js`.
