# Quick-Commerce → Master Integration Plan

**Source:** `D:\projects\quick` — backend 326 JS files, frontend (Vite/React), already live on your VPS
as pm2 `quick-commerce-api`, port 5004, `quick.appzeto.com`, from `/opt/quick-commerce/Backend`.

**Written after** the service-provider integration, so §5 is the list of things that actually
bit us rather than a list of things that might.

---

## 1. The first thing you need to know

`quick/backend/package.json` says:

```json
"name": "appzeto-food-backend"
```

and its models are `Restaurant, Menu, Order, Zone, Offer, Payment, RestaurantWallet,
DeliveryBoyCommission, OutletTimings, HeroBanner, FeeSettings, LandingPageSettings…`

**Quick-commerce is a fork of your food app.** It is not a new domain the way
service-provider was (vendors / workers / bookings). It is the same lineage, evolved
separately.

That creates a strategic choice which has to be made before any code moves.

---

## 2. The choice: separate module, or genuine merge

### Option A — treat it as a fourth module (RECOMMENDED)

`src/modules/quickCommerce/**`, models prefixed `QC*`, collections `qc_*`, mounted at
`/api/v1/qc`. Identical to what we did for service-provider.

- **Cost:** ~8–10 days. You permanently maintain two forks of food-shaped code.
- **Risk:** low. Nothing existing is touched; food and taxi keep their collections.
- **Honest downside:** a bug fixed in food's order flow will not be fixed in quick's,
  and vice versa, forever.

### Option B — merge it into the food module

Reconcile `Order` with `FoodOrder`, `Restaurant` with `FoodRestaurant`, and so on.

- **Cost:** months, not days. Every schema difference is a data migration and a
  behaviour decision.
- **Risk:** high, and it lands on your **live** food business.
- Only worth it if the two products are converging into one.

**Recommendation: A.** Ship the integration, keep the fork question as a separate,
deliberate product decision. Option B is not something to start by accident.

Everything below assumes A.

---

## 3. What is genuinely easier than service-provider

| | service-provider | quick-commerce |
|---|---|---|
| Module system | CommonJS into an ESM backend — needed a nested `package.json` | **already ESM** (`"type": "module"`) — no shim |
| Admin slot in master | had to be added | **already exists**: `quickCommerce` is in `ADMIN_MODULES` and the `servicesAccess` enum, and `AdminRouter.jsx:327` has a `quick-commerce/*` placeholder |
| Collection collisions | most of 29 | **3** |
| Already deployed on the VPS | no | yes — pm2 `quick-commerce-api`, port 5004 |

Master's food module is already namespaced (`food_orders`, `food_items`, `food_offers`…),
which is why the collision count is so low.

---

## 4. The collisions — all three of them

Quick's models declare almost no explicit `collection:`, so mongoose pluralises them.
Three of those land on collections master already owns:

| quick model | pluralises to | master owner | action |
|---|---|---|---|
| `User` | `users` | `FoodUser` + `TaxiUser` (shared identity) | **decide** — see below |
| `Admin` | `admins` | `FoodAdmin` + `TaxiAdmin` + `SPAdmin` | **merge**, same as SP |
| `Payment` | `payments` | `core/payments` | **rename** → `qc_payments` |

The other 54 get `qc_*` prefixes for hygiene, so nothing can collide later.

**`Admin`** merges into the shared `admins` collection with `servicesAccess` gating —
exactly what `serviceProvider` does now. Reuse `utils/serviceAccess.js` as the template;
it is 20 lines.

**`User`** is the real decision. Quick's user schema is food-shaped, so it is *closer* to
master's `users` than service-provider's ever was. Still: start on `qc_users`, migrate
later. Shipping an identity merge on day one is how you turn a low-risk integration into
an outage.

---

## 5. The nine traps — every one of these actually happened

This is the part that keeps other functionality undisturbed. Each cost real time during
the service-provider work.

1. **`MONGODB_DB_NAME` is decorative.** `config/db.js` calls `mongoose.connect(uri)` with
   no `dbName`, and nothing reads that variable. The database comes from the URI path —
   and your URI has none, so **everything runs on `test`**, not `K9`. Setting
   `MONGODB_DB_NAME` to isolate a staging instance isolates nothing; it silently joins
   production. Put the database in the URI path or not at all.

2. **A migration script must derive collection names from the models, never guess.** I
   hardcoded `adminthirdpartysettings`; the model is `TaxiAdminThirdPartySetting`, so
   mongoose reads `taxiadminthirdpartysettings`. Every value went into a stray collection
   nothing read, while the panel showed an empty form and the API quietly served from env.

3. **Sockets must become a namespace, and shipped clients break silently.** Master owns
   one `io`. A second `new Server(httpServer)` fights it for `/socket.io`. Attach as
   `io.of('/qc')` — but any already-shipped mobile build connecting to the root namespace
   will authenticate successfully and then **receive nothing**. Decide before cutover
   whether old clients must keep working.

4. **Background jobs on a second instance write to production.** Master's `server.js`
   runs `recoverStuckOrders()` on boot, which nulls the delivery partner on stuck orders
   and re-dispatches them. A second instance pointed at the live database re-dispatches
   real riders' orders on every restart. `BACKGROUND_JOBS_ENABLED=false` exists now —
   set it on any instance that shares a primary's database.

5. **Role vocabulary differs per module.** food issues `ADMIN`, taxi `super-admin`,
   service-provider `super_admin`. An account carries one role string, so satisfying one
   module locks the account out of another. Quick-commerce will bring a fourth spelling —
   normalise it on the way in, and check `grant-sp-access.js --list` for the pattern.

6. **Vite bakes `import.meta.env` at build time.** Anything configurable must come from
   `/api/v1/env/public` at runtime (`Frontend/src/config/runtimeEnv.js`), or changing it
   means a frontend redeploy.

7. **Mount order inside the ported router is load-bearing.** Transcribe the source
   `server.js` block verbatim. In service-provider, `cityManagement.routes.js` had a
   path-less `router.use(isSuperAdmin)` mounted ahead of everything, which gated the whole
   admin surface. Re-ordering "for tidiness" changes authorisation.

8. **Register every model eagerly.** A model that registers only when some controller
   happens to import it first makes `populate()` throw `MissingSchemaError` on whichever
   endpoint nobody tested. One `models/index.js` that imports all of them.

9. **Ported admin routes carry the old path prefix.** The service-provider panel's menu
   pointed at `/admin/users` while it was now mounted at `/admin/sp/users`, so every click
   fell through master's catch-all to the food admin. Rewrite route paths — and *only*
   route paths. `/admin/bookings` is also an API path; a blind find-replace breaks every
   API call.

---

## 6. Phases

| # | Phase | Days | Notes |
|---|---|---|---|
| 0 | Copy to `src/modules/quickCommerce/`, merge deps | 0.5 | ESM, so no `package.json` shim. Exclude `node_modules`, `dist`, the debug/scratch files at repo root. |
| 1 | Rename 57 models `QC*`, pin `qc_*` collections, rewrite refs, mount at `/api/v1/qc` + legacy prefixes | 2 | Automate the rename; verify with a boot test that every ref resolves. |
| 2 | De-duplicate infra | 1.5 | **Measure first.** For service-provider most "duplicates" were the same account via the same env vars; only two things were real. |
| 3 | Admin: `servicesAccess: 'quickCommerce'` gate + role normalisation | 1 | The slot already exists in the enum. |
| 4 | Sockets → `io.of('/qc')` | 1 | Plus the shipped-client decision from trap 3. |
| 5 | Background jobs + schedulers into `server.js`, gated | 0.5 | |
| 6 | Env merge + CORS origins | 0.5 | |
| 7 | Admin panel → `/admin/qc/*`, replacing the placeholder | 3 | Route-prefix rewrite per trap 9. |
| 8 | Data migration script (dry-run first, derive collections from models) | 2 | |
| 9 | Verification | 2 | Endpoint sweep on both prefixes; full customer journey. |
| | **Total** | **~14** | |

---

## 7. Deployment

It is already on the box, which makes this easier than service-provider was.

- Keep `quick-commerce-api` (port 5004, `quick.appzeto.com`) **running and untouched**.
- Deploy the merged build side-by-side as it is now: `/opt/master`, pm2 `master-api`,
  port 5007, `superapp.appzeto.com`.
- Cut `quick.appzeto.com` over to 5007 only after the migration has run and been verified.
- Never `pm2 delete all` / `restart all` — that box runs 13 apps.

---

## 8. What to verify before calling it done

- `npm test` — the existing 300+ checks must still pass untouched.
- An endpoint sweep over every QC GET route on **both** prefixes, failing on any 5xx
  (`tests/sp.endpoints.smoke.mjs` is the template).
- Food and taxi order flows end-to-end — they share `users` and `admins` with the new module.
- A food-only admin gets **403** on QC endpoints, and the QC tab is hidden for them.
- The shipped quick-commerce mobile/web clients still work on their original paths.
