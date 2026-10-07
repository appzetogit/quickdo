# Quick commerce API: changes for the Flutter apps (SOW plan §5)

This document lists the quick-commerce (QC) endpoints that are new or have changed for the customer app, the store (partner) app and the delivery app: the multi-store cart, self-pickup, delivery slots, proof of delivery, search suggestions, barcode lookup, loyalty points, FAQs and vendor customer analytics.

- **Base URLs:** `https://<host>/api/v1/qc` for quick commerce, `https://<host>/api/v1/platform` for the shared features (FAQs, loyalty rules, delivery slots).
- **Auth:** `Authorization: Bearer <accessToken>`. Customer endpoints need a QC customer token. Store endpoints need a store token. The delivery app keeps calling the **food** rider endpoints (`/api/v1/food/delivery/...`); QC orders reach it through them (§10).
- **Response envelope:** `{ success, message, data }`. Errors return `success: false`, an HTTP 4xx/5xx status and a `message` you can show as-is.
- **Money** is in rupees, numbers with up to 2 decimals. Order totals are charged to the rupee (`roundOff` holds the difference).
- **Times** are ISO 8601 instants. Slot times (`startTime`, `endTime`, `date`) are Indian time (IST).
- Everything below is **backward compatible**. Old request bodies still work, and old response fields keep their meaning. New fields are only added.

---

## 1. Multi-store cart (§5.1)

A basket may hold items from up to 5 stores. Put the store on every line as `storeId`. If all lines are from one store, the order is placed exactly as before: one order, no parent, and `restaurantId` may be sent instead of the per-line `storeId`.

With lines from two or more stores the server creates:

- one **parent order** (`MSO-…`). It holds the single payment and the single coupon.
- one **child order** per store (`FOD-…`). Each child has its own store acceptance, rider, tracking, OTP, cancellation and refund. Track, cancel and rate each child with the existing `/orders/:orderId/...` endpoints.

The shared charges are split between the stores by item value, to the paisa. Each child keeps its share:

| Charge | Rule |
|---|---|
| Delivery fee | One fee for the basket: the highest fee any single store would charge (0 for pickup). It is split by item value. |
| Platform fee | Charged once and split by item value. |
| Coupon | Checked once against the whole basket. If the coupon covers only some stores, only those stores share the discount. |
| Loyalty points | Redeemed once and split by item value after the coupon. |

The `quick` delivery mode is not offered on multi-store orders. Each child is priced as `basic`.

### POST `/orders/calculate`, multi-store quote

```json
{
  "items": [
    { "itemId": "66f…a1", "name": "Rice 5kg", "price": 300, "quantity": 1, "storeId": "66e…01" },
    { "itemId": "66f…b2", "name": "Milk 1L",  "price": 100, "quantity": 1, "storeId": "66e…02" }
  ],
  "deliveryAddress": { "location": { "coordinates": [75.88, 22.73] } },
  "couponCode": "SAVE40",
  "fulfilmentType": "delivery",
  "loyaltyPoints": 0
}
```

```json
{
  "isMultiStore": true,
  "fulfilmentType": "delivery",
  "stores": [
    { "storeId": "66e…01", "storeName": "Corner Kirana", "items": [ … ], "pricing": { "subtotal": 300, "deliveryFee": 22.5, "platformFee": 4.5, "discount": 30, "total": 301, "…": "…" } },
    { "storeId": "66e…02", "storeName": "Fresh Dairy",   "items": [ … ], "pricing": { "subtotal": 100, "deliveryFee": 7.5,  "platformFee": 1.5, "discount": 10, "total": 100, "…": "…" } }
  ],
  "items": [ { "…": "every line", "storeId": "…" } ],
  "pricing": {
    "subtotal": 400, "tax": 0, "deliveryFee": 30, "deliveryFeeGst": 5.4, "platformFee": 6, "platformFeeGst": 0,
    "discount": 40, "loyaltyDiscount": 0, "loyaltyPoints": 0, "roundOff": -0.4, "total": 401,
    "couponCode": "SAVE40", "currency": "INR", "fulfilmentType": "delivery", "splitBasis": "subtotal"
  }
}
```

A single-store quote returns the same shape as before. If `loyaltyPoints` was sent, it also returns `loyalty` (see §7).

### POST `/orders`, placing it

Same body as before, with `storeId` on each line. `restaurantId` and `pricing` are now optional. The new optional fields are `fulfilmentType`, `slotId`, `loyaltyPoints`, `contactlessDelivery` and `couponCode` (the old `pricing.couponCode` still works). `address` is required unless `fulfilmentType` is `pickup`.

```json
{
  "items": [ { "itemId": "…", "name": "Rice 5kg", "price": 300, "quantity": 1, "storeId": "66e…01" },
             { "itemId": "…", "name": "Milk 1L",  "price": 100, "quantity": 1, "storeId": "66e…02" } ],
  "address": { "label": "Home", "street": "12 MG Road", "city": "Indore", "state": "MP", "location": { "type": "Point", "coordinates": [75.88, 22.73] } },
  "paymentMethod": "razorpay",
  "couponCode": "SAVE40"
}
```

Response (201) for a multi-store basket:

```json
{
  "order": { "isMultiStore": true, "parentOrderId": "6701…", "orderId": "MSO-1A2B3C4D5E", "status": "pending_payment", "pricing": { "total": 401, "…": "…" }, "children": [ { "orderMongoId": "…", "orderId": "FOD-…", "restaurantId": { "restaurantName": "Corner Kirana", "…": "…" }, "pricing": { "…": "…" }, "parentSplit": { "deliveryFee": 22.5, "platformFee": 4.5, "discount": 30, "loyaltyDiscount": 0, "loyaltyPoints": 0, "basis": "subtotal" } } ] },
  "parentOrder": { "…": "same as order" },
  "orders": [ "…the children…" ],
  "razorpay": { "key": "rzp_…", "orderId": "order_…", "amount": 40100, "currency": "INR", "parentOrderId": "6701…" }
}
```

- **Cash:** each child is `cod_pending`. Each rider collects that child's own total.
- **Wallet:** the wallet is debited **once**, for the parent total.
- **Razorpay:** open the checkout with `razorpay.orderId` (one payment for all stores). Then call verify with the **parent** id:

### POST `/orders/verify-payment`

```json
{ "orderId": "6701…  (or MSO-1A2B3C4D5E)", "razorpayOrderId": "order_…", "razorpayPaymentId": "pay_…", "razorpaySignature": "…" }
```

This returns `{ order: <parent view>, payment }`. Every child becomes paid and goes to its store. The webhook does the same thing if the app closes before verifying. If a child's payment window has expired meanwhile, that child's share is refunded automatically.

If the customer closes the payment sheet, call `DELETE /orders/<parentId or MSO- number>/pending-payment`. This cancels every waiting child and returns the points.

If one store cannot take its part (for example it went offline), the whole checkout is refused with that store's message. Nothing is charged, and the stock, coupon and points are given back.

### Order list and detail

- `GET /orders` is unchanged. Each child is listed on its own and carries `parentOrderId`.
- `GET /orders?groupByParent=true` lists a multi-store checkout as one entry: `{ isMultiStore: true, parentOrderId, orderId: "MSO-…", status, pricing, payment, createdAt, children: [orders] }`. Single-store orders keep their usual shape.
- `GET /orders/parent/:parentId` (id or `MSO-` number) returns the parent with all children.
- `GET /orders/:orderId` on a child adds `parentOrder: { parentOrderId, orderNumber, status, pricing, payment, siblings: [{ orderId, orderNumber, storeId, total }] }`.

### Cancelling and refunds

Cancel each child with `PATCH /orders/:childId/cancel`. A store reject, a timeout or an admin cancel also works per child. A refund returns **that child's total** to the original payment (Razorpay, a partial refund on the shared payment, or the wallet). It happens once, however often it is retried. The other children are not affected.

---

## 2. Self-pickup (§5.2)

Send `"fulfilmentType": "pickup"` to `/orders/calculate` and `/orders`. A pickup order:

- has no delivery fee, no delivery-fee GST and no rider. `address` is optional; the order is filed at the store's address.
- returns a 4-digit `pickupOtp` in the place-order response, and in `GET /orders/:orderId` for the customer until it is collected. Show it on the order screen. It is never sent to the store or to riders.
- is accepted and packed by the store as usual. The store then enters the customer's code to hand the order over, and the order becomes `delivered`. A cash order is marked paid at the counter.

### Store app: POST `/restaurant/orders/:orderId/pickup/verify`

```json
{ "otp": "4821" }
```

This returns `{ order }` with `orderStatus: "delivered"`. Errors: `400 Wrong pickup code`; `400 Accept and pack the order before handing it over.`; `400 Too many wrong codes…` (after 5 wrong attempts; support can still mark the order delivered); `400 This order has already been collected.`

### Store app: listing pickup orders

`GET /restaurant/orders?fulfilmentType=pickup` (or `delivery`). The other filters are unchanged. Every order now carries `fulfilmentType: "delivery" | "pickup"`.

---

## 3. Scheduled delivery and slots (§5.3)

Admins set up delivery slots per zone, each with a capacity per day. **If a zone has no slots, `scheduledAt` works exactly as before (any time).** Once a zone has slots, `scheduledAt` must fall inside an open slot that still has room. The order is then stored at the slot's start time and holds one place in that slot (the place is freed again if the order is cancelled).

### GET `/api/v1/platform/delivery-slots/available?vertical=quickCommerce&zoneId=<zone>&days=3` (public)

```json
{
  "slotsEnabled": true,
  "days": [
    { "date": "2026-10-08", "slots": [
      { "slotId": "6703…", "label": "Morning", "startTime": "09:00", "endTime": "11:00",
        "scheduledAt": "2026-10-08T03:30:00.000Z", "endsAt": "2026-10-08T05:30:00.000Z",
        "capacity": 20, "remaining": 7, "available": true }
    ] }
  ]
}
```

`slotsEnabled: false` means no slots are configured, so let the customer pick any time (old behaviour). `available: false` means the slot is full or has closed for booking (`cutoffMinutes` before its start).

### Placing a scheduled order

Add `"scheduledAt": "<slot.scheduledAt>"` and, optionally, `"slotId"` to `POST /orders`. Errors: `400 Pick one of the available delivery slots for the scheduled time.`; `400 That delivery slot is full. Please pick another one.`; `400 That delivery slot is closed for booking…`

The order carries `scheduledAt` and `deliverySlot: { slotId, date, startTime, endTime, label }`. The store can accept and pack it at any time. Rider search starts `orders.scheduledDispatchLeadMinutes` before the slot (default 30 minutes; it can be changed in Master settings). Riders are not offered the order before then.

---

## 4. Proof of delivery (§5.4)

The rider can photograph the drop. The photo is **required** when the customer's handover code is not used for the order, which happens in two cases:

- the admin turned the code off (`delivery.dropOtpRequired = false`, Master settings), or
- the customer asked for a contactless drop (`"contactlessDelivery": true` on `POST /orders`).

When the code is used, the photo is optional and completion works as before.

### Delivery app: completing with a photo

1. Upload the photo: `POST /api/v1/uploads/image` (multipart, field `file`, optional `folder=delivery/drop-proof`, rider token). This returns `data.url`.
2. Complete with `PATCH /api/v1/food/delivery/orders/:orderId/complete`:

```json
{ "dropProof": { "photoUrl": "https://…/drop-proof/abc.webp", "lat": 22.7201, "lng": 75.8801 }, "otp": "1234 (when the code is used)" }
```

Without a photo when one is required, this returns `400 Take a photo of the delivery to complete it (no handover code on this order).`

The order then carries `dropProof: { photoUrl, lat, lng, at }`. The customer (`GET /orders/:orderId`) and admin see it.

---

## 5. Search suggestions and recent searches (§5.5)

### GET `/search/suggest?q=mil&limit=10&zoneId=<zone>`

No token is needed. With a customer token the response also includes their recent searches. Results are prefix matches (the start of the name or of any word) on product, category and brand names. They are ranked by units ordered in the last 90 days, then by closeness of the match. The same product sold by several stores appears once.

```json
{
  "query": "mil",
  "suggestions": [
    { "type": "product",  "id": "66f…", "text": "Milk Bread", "image": "…", "brand": "Harvest", "storeId": "66e…", "categoryId": "…", "popularity": 9 },
    { "type": "category", "id": "66c…", "text": "Milk & Dairy", "image": "…", "popularity": 4 },
    { "type": "brand",    "id": "milky mist", "text": "Milky Mist", "products": 6, "popularity": 2 }
  ],
  "recent": [ { "term": "atta", "at": "2026-10-07T10:00:00.000Z" } ]
}
```

To run the full search after the customer picks a suggestion, use the existing `GET /search/products?q=`.

### Recent searches (customer token)

| | |
|---|---|
| `GET /search/recent` | `{ recent: [{ term, at }] }`, newest first, up to 15 |
| `POST /search/recent` `{ "q": "atta" }` | Call this when the customer submits a search. It moves the term to the top, case-insensitively de-duplicated. |
| `DELETE /search/recent?term=atta` | Removes one term. Without `term` it clears the whole list. |

---

## 6. Barcode lookup (§5.6)

The app scans the code with the camera, then calls:

### GET `/products/by-barcode/:code?zoneId=<zone>` (public)

```json
{
  "code": "8901030012345",
  "products": [
    { "id": "66f…", "storeId": "66e…", "name": "Amul Milk 500ml", "brand": "Amul", "packSize": "500 ml", "price": 32, "mrp": 34,
      "image": "…", "barcode": "8901030012345", "inStock": true, "variants": [],
      "store": { "id": "66e…", "name": "Corner Kirana", "image": "…", "isAcceptingOrders": true } }
  ]
}
```

- Spaces and hyphens are ignored. A 12-digit UPC scan also finds the same product stored as a 13-digit EAN.
- The same product from several stores comes back once per store. In-stock items come first, then cheaper ones.
- `404 No product with this barcode here` when nothing matches in a live store.

**Store and admin apps:** products accept `barcode` (or `ean`) on create and update. Numeric EAN-8, UPC-A, EAN-13 and GTIN-14 codes must have a correct check digit; otherwise the request returns `400 Barcode … has a wrong check digit`. The bulk-upload Excel template has an optional **Barcode / EAN** column.

---

## 7. Loyalty points (§5.7)

Points are **off** until an admin turns them on. Once on, customers earn points when an order is delivered (on the item value they paid for) and redeem them at checkout. Points belong to the customer's single platform account, so points earned on Quick can be spent on Food and the other way round. Points expire after the admin's number of days. If an order that used points is cancelled, the points come back.

### GET `/loyalty/me` (QC customer token)

```json
{
  "enabled": true, "balance": 120, "worth": 30, "expiringIn30Days": 15,
  "rules": { "pointsPerRupee": 0.1, "rupeesPerPoint": 0.25, "maxRedeemPercent": 20, "expiryDays": 365 },
  "history": [ { "type": "earn", "points": 18, "orderRef": "FOD-…", "expiresAt": "…", "createdAt": "…" } ]
}
```

`type` is one of `earn`, `burn` (redeemed), `reverse_burn` (returned from a cancelled order), `expire` or `adjust`.

### GET `/loyalty/quote?points=200&orderValue=450`

```json
{ "points": 90, "discount": 22.5, "requested": 200, "balance": 120, "maxPoints": 90, "capped": true, "enabled": true, "rupeesPerPoint": 0.25 }
```

### Redeeming

Send `"loyaltyPoints": <n>` with `/orders/calculate` and `/orders`. The server reduces the request to the balance and to `maxRedeemPercent` of the item value, so the order may use fewer points than asked. The applied amount is on `pricing.loyaltyPoints` and `pricing.loyaltyDiscount`. It comes off the payable amount after GST. Food customers use the same endpoints under `/api/v1/platform/loyalty/me` and `/quote`.

---

## 8. FAQs (§5.8)

### GET `/api/v1/platform/faqs?vertical=quickCommerce&category=&includeGeneral=true` (public)

`vertical` is one of `quickCommerce` (or `quick`), `food`, `taxi`, `serviceProvider`, `delivery`, `store` or `general`. The general questions are included unless `includeGeneral=false` is sent. Inactive questions are never returned.

```json
{
  "vertical": "quickCommerce",
  "faqs": [ { "id": "…", "vertical": "quickCommerce", "category": "Orders", "question": "…", "answer": "…", "sortOrder": 1 } ],
  "categories": [ { "name": "Orders", "items": [ { "id": "…", "question": "…", "answer": "…" } ] } ]
}
```

---

## 9. Store app: customer analytics (§5.9)

`GET /restaurant/analytics` (the existing QC store analytics, same `from`/`to`) now also returns:

```json
{
  "newCustomers": 12, "returningCustomers": 30, "totalCustomers": 42,
  "repeatCustomers": 9, "repeatRatePercent": 21.43,
  "topCustomers": [
    { "customerId": "…", "name": "Ravi", "phone": "******4567", "orders": 6, "spend": 2310, "averageOrderValue": 385, "firstOrderAt": "…", "lastOrderAt": "…", "isNew": false }
  ]
}
```

Definitions: **returning** customers also ordered before the range; **repeat** customers ordered at least twice inside the range. Phone numbers are masked. `?topCustomers=20` changes the list size (maximum 50).

---

## 10. Delivery app: QC orders (§5.10)

The delivery app keeps using the food rider endpoints. QC orders appear in the same lists (`/food/delivery/orders/available`, `/food/delivery/orders/current` and the current-trips list), and accept, reached-pickup, pickup, reached-drop, OTP, cash/QR and complete all work with the QC order id. Every QC order sent to a rider now also carries:

```json
{
  "vertical": "quickCommerce", "serviceLabel": "Quick", "sellerNoun": "store", "storeName": "Corner Kirana",
  "pickList": [ { "itemId": "…", "name": "Amul Milk 500ml", "variantName": "", "brand": "Amul", "packSize": "500 ml", "quantity": 2, "image": "…" } ],
  "itemCount": 2, "scheduledAt": null, "deliverySlot": null, "contactlessDelivery": false, "parentOrderId": null
}
```

Show "Store" instead of "Restaurant" and the pick list at pickup. Pickup orders are never offered to riders. Scheduled orders are offered only from the slot's rider-search time; before that, accepting one returns `400 This is a scheduled order…`. For the proof-of-delivery photo see §4.

---

## Admin endpoints (web admin panel, for reference)

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/v1/platform/delivery-slots/admin`, `PATCH/DELETE …/admin/:id` | Delivery slots `{ vertical, zoneId|null, label, startTime, endTime, daysOfWeek[0-6], capacity, cutoffMinutes, isActive }` |
| `GET /api/v1/platform/loyalty/admin/settings?vertical=`, `PUT …/admin/settings` | Loyalty rules `{ vertical?, enabled, pointsPerRupee, rupeesPerPoint, maxRedeemPercent, expiryDays }` |
| `GET /api/v1/platform/loyalty/admin/ledger?userId=&page=&limit=` | Ledger rows |
| `GET/POST /api/v1/platform/faqs/admin`, `PATCH/DELETE …/admin/:id`, `PUT …/admin/reorder` | FAQs |
| Master settings keys | `delivery.dropOtpRequired` (default on), `orders.scheduledDispatchLeadMinutes` (default 30), `loyalty.*` |
