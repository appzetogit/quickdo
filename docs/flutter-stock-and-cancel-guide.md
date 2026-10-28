# Flutter guide: stock, low-stock alerts, order-cancel window

Three features went live on the server on 21 Sep 2026. Most of the Flutter code is
already written and pushed; what is left is building, testing and two small
additions. Nothing here needs a server change.

| App | Repo | Commits already pushed |
|---|---|---|
| Partner app (restaurant / store / medical) | `Rish1811/quickdrop_restaurant` | `01e6e0a` Stock screen, `1b90373` stock in product form, `2cd2cb4` send only changed stock |
| Customer app | `Rish1811/quickdropnew` | `5b8ac88` cancel window + countdown |

> **Before you build:** run `git fetch` and check `git log origin/main` matches the commits
> above. GitHub has been force-pushed with injected files (`.vscode/tasks.json`,
> `public/fonts/fa-solid-500.woff2`) several times. If either file exists, stop and tell
> the backend team — do not build from it.

---

## 1. Stock (partner app, stores and medical stores only)

Restaurants never see any of this. Everything is gated on
`ref.watch(sellerVerticalControllerProvider).isQuick`.

### API

All paths are written with `/food/...`; the Dio interceptor rewrites them to `/qc/...`
for quick-commerce sellers (`SellerVertical.resolvePath`). Responses are unwrapped by the
interceptor, so `response.data` is the `data` object.

| Call | Purpose | Body / query |
|---|---|---|
| `GET /food/restaurant/stock` | Rows + summary | `q`, `status` (`''`, `attention`, `in`, `low`, `out`, `untracked`), `page`, `limit` |
| `PATCH /food/restaurant/stock` | Change one row | `{ itemId, variantId, mode: 'set'\|'add', value, lowStockThreshold? }` — `value: null` = stop counting |
| `POST /food/restaurant/stock/bulk` | Several rows | `{ rows: [ ...same shape... ] }` |
| `GET /food/restaurant/stock/history` | One row's changes | `itemId`, `variantId` |

Row shape (one per product size, or one per product without sizes):

```json
{
  "itemId": "…", "variantId": "…" , "itemName": "Amul Butter", "variantName": "500 g",
  "sku": "AB-500", "image": "https://…", "categoryName": "Dairy",
  "stockQty": 12, "lowStockThreshold": 3,
  "status": "in | low | out | untracked", "manuallyOff": false
}
```

`stockQty: null` means not counted — it sells without a limit. That is every product
created before stock existed.

### What is already in the code

| File | What it does |
|---|---|
| `lib/features/stock/data/stock_repository.dart` | Models (`StockRow`, `StockSummary`, `StockMovement`) and the four calls above; `StockRepository.messageOf(e)` turns errors into the server's sentence |
| `lib/features/stock/presentation/stock_screen.dart` | The Stock screen: tiles (All / Need attention / Out), search, list, `+10`, edit sheet (count, −/+, +10/+25/+50, "Warn me when stock falls to", stop counting), history sheet |
| `lib/config/router/app_router.dart` | Route `/stock` |
| `lib/core/network/api_endpoints.dart` | `ApiEndpoints.stock`, `ApiEndpoints.stockHistory` |
| `lib/features/explore/.../explore_screen.dart` | "Stock" card (quick sellers only) |
| `lib/features/inventory/.../inventory_screen.dart` | "Stock" button in the Inventory app bar (quick sellers only) |
| `lib/features/menu_items/...` (model, repository, controller, `food_item_form_sheet.dart`) | "Stock" box in the add/edit item sheet: switch "count stock", **In stock**, **Warn me at**. Products with sizes show "Open Stock" instead, because each size has its own count |

Rules the form already follows — keep them if you touch it:

- Send `stockQty` / `lowStockThreshold` **only when the owner changed them**
  (`sendStock`, `sendLow` in `updateFood`). A form left open while orders come in must
  not put back units those orders took.
- Never send stock for a restaurant (food) seller.
- `null` stops counting; `0` means sold out and hides the product.

### To do

1. `flutter pub get && flutter analyze` — the code was written without a local Flutter
   SDK and has only been bracket/string-checked. Fix anything `analyze` reports (most
   likely an unused import).
2. Build and try it with a quick-commerce store account (see test list below).

---

## 2. Low-stock notifications (partner app)

The server now sends a push **and** an in-app notification when a count crosses the
store's "warn me at" level, or reaches zero. One alert per drop — not one per sale.

Push payload `data`:

```json
{
  "type": "stock_low" | "stock_out",
  "itemId": "…", "variantId": "…", "restaurantId": "…",
  "left": "3",
  "link": "/restaurant/stock"
}
```

Titles/bodies come ready to show, e.g. *"Running low on stock — Only 3 left of Tea (250 g).
Restock soon so it does not sell out."*

### To do

Open the Stock screen when the notification is tapped. Find the handler that routes
notification taps (search for where `data['type']` is read, e.g. `order_cancelled`,
`new_order`) and add:

```dart
case 'stock_low':
case 'stock_out':
  router.push('/stock');
  break;
```

Also make the entry in the notifications list tappable the same way (the in-app record
has `source: 'STOCK_ALERT'` and `metadata.type` with the same values).

Optional nice-to-have: when opening from the alert, pre-filter the Stock screen to
"Need attention" (`_status = 'attention'`) — add an optional constructor argument.

---

## 3. Order-cancel window (customer app)

The admin can now let customers cancel a **food** order for N minutes after the
restaurant accepts (Food panel → Order Cancellation). Off by default.

### API

`GET /food/orders/:id` (the order the tracking/details screens already load) now
includes:

```json
"cancellation": {
  "allowed": true,
  "until": "2026-09-21T12:10:50.764Z",
  "secondsLeft": 179,
  "reason": ""
}
```

- `until: null` + `allowed: true` → still waiting for the restaurant, no deadline.
- `allowed: false` → hide Cancel; `reason` explains why.
- `PATCH /food/orders/:id/cancel` is unchanged. If the window has closed the server
  answers 400 with a sentence such as *"This order can no longer be cancelled: the
  restaurant accepted it more than 5 minutes ago"* — show it as-is.

The order **list** does not carry `cancellation`; screens that only have list data fall
back to "cancel only before the restaurant accepts".

### What is already in the code

| File | What it does |
|---|---|
| `lib/modules/food/data/models/order_model.dart` | Parses `cancellation` into `cancelAllowed` / `cancelUntil`; `canCancel` now follows the server (older server → only `created`); `cancelCountdownLabel` → "You can cancel for 3:42 more" |
| `.../orders/screens/order_tracking_screen.dart` | Shows the countdown label above the Cancel button |
| `.../orders/screens/order_details_screen.dart` | Button reads "CANCEL (TIME-LIMITED)" while a deadline applies |

### To do

1. **Make the countdown tick.** The label is computed from `DateTime.now()` at build
   time. If the tracking screen does not already rebuild every second, add a
   `Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}))` while
   `order.cancelUntil != null`, cancelled in `dispose`. When it reaches zero the button
   disappears by itself (`canCancel` turns false).
2. **Refresh on status change.** When the order socket/poll reports a new status
   (e.g. `preparing`), reload the order so `cancellation` is fresh — the admin may have
   set "stop once the kitchen starts preparing".
3. Show the server's error text in the snackbar if a cancel is refused.
4. `flutter analyze`, build, test (below).

---

## Test checklist

**Partner app — store account**
- [ ] Explore shows a Stock card; Inventory shows a Stock button. A restaurant account shows neither.
- [ ] Stock screen lists every size; search and the three tiles filter.
- [ ] Edit a count → Save → the web Stock page shows the same number.
- [ ] `+10` adds ten. History lists "Edited", "Sold", "Order cancelled".
- [ ] Switch "count stock" off → row shows ∞ / "No limit".
- [ ] Add a product with a stock of 5 in the item sheet; edit it without touching stock after a sale → the count is not reset.
- [ ] Set "warn me at" 3, sell down to 3 → one push "Running low…"; sell to 0 → "Out of stock" and the product disappears from the customer app. Tap → opens Stock.

**Customer app**
- [ ] Admin setting off: after the restaurant accepts, Cancel is gone.
- [ ] Admin on, 5 min: after accept, Cancel shows with a ticking countdown; cancel works and refunds.
- [ ] Wait past 5 min → button disappears; a stale tap shows the server's message.
- [ ] "Stop once the kitchen starts preparing" on: restaurant marks Preparing → Cancel disappears.
- [ ] Picked-up order never shows Cancel.

**Release**
- [ ] Bump `version:` in `pubspec.yaml` for both apps.
- [ ] Partner app has `shorebird.yaml` — these are Dart-only changes, so a Shorebird patch is enough if the current release was built with Shorebird; otherwise build a new APK/AAB.
