# Food API: changes for the Flutter apps (SOW plan §6)

This document lists the food endpoints that are new or have changed for the customer app and the restaurant (partner) app: reports, analytics, settlement statements, GSTIN checks, restaurant email sign-in, the onboarding menu step, the order invoice PDF and its numbering, loyalty points at checkout and proof of delivery.

- **Base URL:** `https://<host>/api/v1/food`
- **Auth:** `Authorization: Bearer <accessToken>`. Restaurant endpoints need a restaurant token. `/orders/*` needs a customer token. The two `public` endpoints below need no token.
- **Response envelope:** JSON endpoints return `{ success, message, data }`. Errors return `success: false` with an HTTP 4xx/5xx status and a `message` you can show as-is.
- **File endpoints** return the file itself, not JSON. They set `Content-Type` (`text/csv; charset=utf-8` or `application/pdf`) and `Content-Disposition: attachment; filename="..."`. Download the bytes, then save or share them. On an error they return the usual JSON envelope with a 4xx status.
- **Dates** are `YYYY-MM-DD` and are read as Indian (IST) calendar days. `from` and `to` are both inclusive.
- **Money** is in rupees as numbers with up to 2 decimals.

> **Quick-commerce stores** use the restaurant panel with `/qc/...` paths. The endpoints in §1–§3 also exist under `/qc/restaurant` with the same shapes (store GST, multi-store and pickup differences in [flutter-qc-api.md](./flutter-qc-api.md) §11).

---

## 1. Sales analytics (§6.2)

### GET `/restaurant/analytics/sales?from&to&groupBy`

| Query | Default | Notes |
|---|---|---|
| `from`, `to` | last 30 days (last 365 for `month`) | At most 731 days. |
| `groupBy` | `day` | `day`, `week` (weeks start on Monday) or `month`. Anything else returns 400. |

MongoDB does the aggregation. Money comes from **delivered** orders only. Order counts include every order the restaurant saw. Online orders that were never paid (`pending_payment`) are excluded.

```json
{
  "range": { "from": "2026-09-15", "to": "2026-09-30", "groupBy": "day", "timezone": "Asia/Kolkata" },
  "totals": {
    "orders": 4, "delivered": 3, "preparing": 0, "outForDelivery": 0, "cancelled": 1, "rejected": 0,
    "grossSales": 615, "taxableValue": 600, "packaging": 10, "gst": 30, "commission": 60, "payout": 500,
    "avgOrderValue": 205, "uniqueCustomers": 3, "repeatCustomers": 1, "newCustomers": 2, "repeatRate": 33.33
  },
  "series": [
    { "period": "2026-09-15", "label": "15 Sep", "start": "...", "end": "...", "orders": 0, "delivered": 0, "grossSales": 0, "payout": 0, "...": "same fields as totals" }
  ],
  "empty": false
}
```

- `series` has one entry for **every** bucket in the range, including buckets with zero orders. You can draw a chart from it directly.
- `empty: true` means there were no orders in the range. Show an empty state. Never show sample data.
- `grossSales` is the food subtotal plus the restaurant's own packaging. `gst` is the GST on the food. `rejected` counts `cancelled_by_restaurant`. `cancelled` counts customer and admin cancellations.
- `payout` is the ledger's restaurant share for the order. If an order has no ledger entry, the server uses the same formula the ledger uses.

## 2. Downloadable reports (§6.1)

### GET `/restaurant/reports?type&format&from&to[&groupBy]` → file

| `type` | Rows |
|---|---|
| `orders` (default) | Every order: date, status, payment, item subtotal, GST, packaging, discount you funded, commission, payout |
| `sales` | One row per day, week or month (`groupBy`), plus a total row |
| `commission` | Delivered orders: taxable value, commission %, commission |
| `gst` | Delivered orders: taxable value, GST %, CGST, SGST, total GST |
| `payouts` | Withdrawals and settlements requested in the period |

- `format` is `csv` (default) or `pdf`. Up to 366 days per report.
- The filename is `<type>-report_<from>_to_<to>.<csv|pdf>`.
- CSV files start with a UTF-8 byte-order mark. A cell that starts with `= + - @` gets a `'` prefix, so spreadsheets show it as text.

## 3. Settlement statements (§6.3)

A settlement cycle runs from the **15th of one month to the 14th of the next** (IST). A cycle is named by the month it starts in: `2026-09` covers 15 Sep–14 Oct 2026. The statement covers every captured or authorised ledger entry created in the cycle. These are the same entries the finance balance and withdrawals use.

### GET `/restaurant/settlements?limit=6`

Returns `{ statements: [ { id, label, from, to, start, end, status: "open" | "closed", totals } ] }`, newest cycle first. `limit` can be 1–36.

### GET `/restaurant/settlements/:cycleId`

```json
{
  "restaurant": { "name": "Spice Hub", "code": "REST2a9f01", "address": "...", "gstin": "27AAPFU0939F1ZV", "legalName": "", "fssai": "", "email": "" },
  "cycle": { "id": "2026-09", "label": "15 Sep 2026 - 14 Oct 2026", "from": "2026-09-15", "to": "2026-10-14", "status": "open" },
  "totals": {
    "orders": 3, "refundedOrders": 1,
    "itemSales": 605, "taxableValue": 600, "gstCollected": 30, "packaging": 10,
    "commission": 60, "restaurantDiscounts": 50, "otherAdjustments": 0, "deductions": 110,
    "netPayout": 500, "settledOrders": 0, "paidOut": 300
  },
  "payoutsMade": [ { "type": "withdrawal", "amount": 300, "at": "...", "reference": "UTR123" } ],
  "lines": [ { "orderId": "FOD-...", "date": "16 Sep 2026, 12:00 pm", "paymentMethod": "razorpay", "itemSubtotal": 200, "taxableValue": 200, "gst": 10, "packaging": 10, "commission": 20, "restaurantDiscount": 0, "adjustment": 0, "payout": 190, "settled": false } ]
}
```

- `netPayout = taxableValue + packaging − commission − restaurantDiscounts + otherAdjustments`. This always holds.
- `gstCollected` is shown for information only. The platform pays it under section 9(5), so it is not part of the payout.
- `paidOut` is the money paid to the restaurant **during** the cycle: approved withdrawals and processed settlements.
- A bad cycle id, such as `2026-13` or `sept`, returns 400.

### GET `/restaurant/settlements/:cycleId/download?format=pdf|csv` → file

`pdf` (the default) returns the full statement. `csv` returns the order lines. The filename is `settlement-statement_<cycleId>.<ext>`.

## 4. GSTIN verification (§6.4)

### POST `/restaurant/gst/verify` (public, rate limited)

Body: `{ "gstin": "27AAPFU0939F1ZV", "legalName"?: "...", "panNumber"?: "...", "state"?: "..." }`

```json
{
  "status": "verified",
  "provider": "http",
  "gstin": "27AAPFU0939F1ZV",
  "formatValid": true,
  "checksumValid": true,
  "stateCode": "27",
  "stateName": "Maharashtra",
  "legalName": "SPICE HUB PRIVATE LIMITED",
  "tradeName": "Spice Hub",
  "address": "1, MG Road, Pune, Maharashtra, 411001",
  "taxpayerStatus": "Active",
  "mismatches": [ { "field": "legalName", "provided": "Curry Palace", "registered": "SPICE HUB PRIVATE LIMITED" } ],
  "reason": "",
  "checkedAt": "..."
}
```

| `status` | Meaning |
|---|---|
| `verified` | The GST register lookup found an active taxpayer. |
| `offline_valid` | No lookup provider is configured. The format and check character are valid. |
| `invalid` | The format is wrong or the 15th (check) character does not match, which usually means a typo. **Registration refuses this.** |
| `not_found` / `inactive` | The register lookup found no taxpayer, or found one whose status is not Active. |
| `error` | The provider could not be reached. This does not block signup, and the GSTIN is re-checked at review. |

`mismatches[].field` is `legalName`, `pan` (the PAN inside the GSTIN differs from the PAN given) or `state`.

Onboarding should call this when the GSTIN reaches 15 characters. If the applicant left the legal name or address empty, fill them from the result. Never overwrite what they typed.

**Registration (`POST /restaurant/register`)** runs the same check. It rejects an `invalid` GSTIN with 400, fills a blank `gstLegalName` or `gstAddress` from the register, and stores the result on the restaurant as `gstVerification`.

## 5. Restaurant email sign-in (§6.5)

These endpoints are for outlets that already exist. **New outlets still register by phone**, because the owner's phone identifies the outlet. The email that the owner gives at onboarding (`ownerEmail`) then works as a second way to sign in.

### POST `/auth/restaurant/email/request-otp`

Body: `{ "email": "owner@restaurant.com" }` returns `{ "message": "If a restaurant uses this email, a sign-in code is on its way.", "codeLength": 6 }`.

The server gives the same answer whether or not an outlet uses the address, and emails a code only when one does. Requests are rate limited.

### POST `/auth/restaurant/email/verify-otp`

Body: `{ "email", "otp": "123456", "fcmToken"?, "platform"?: "mobile" | "web" }`

The response has **the same shape as** `POST /auth/restaurant/verify-otp`:

- If the outlet is approved, the response is `{ accessToken, refreshToken, user, needsRegistration: false }`.
- If the outlet is pending or rejected, the response is `{ pendingApproval: true, isRejected, rejectionReason, message, phone, email }`.

| Error | Meaning |
|---|---|
| 401 | Wrong, expired or already-used code. |
| 409 `EMAIL_MULTIPLE_OUTLETS` | The email belongs to more than one outlet. Ask the owner to sign in with that outlet's phone number. |

## 6. Menu step during onboarding (§6.6)

### GET `/restaurant/bulk-upload/template/blank` (public) → `.xlsx`

This is the empty menu sheet. It has the same columns as the signed-in `/restaurant/bulk-upload/template`.

### POST `/restaurant/register`: two new optional multipart fields

| Field | Type | Notes |
|---|---|---|
| `firstItems` | string (JSON array) | `[{ "name", "price", "category"?, "foodType"?: "Veg" \| "Non-Veg", "description"?, "prepTime"? }]`, up to 25. |
| `menuSheet` | file (.xlsx) | A filled bulk-menu sheet. |

The server adds both through the existing bulk-upload importer after it creates the restaurant. The dishes go into the normal approval queue. A bad sheet **never fails the registration**. When either field is sent, the response includes `data.menuImport`:

```json
{
  "menuImport": {
    "firstItems": { "success": 2, "failed": 1, "details": [ { "row": 3, "error": "\"Free lunch\": enter a price above 0" } ] },
    "sheet": { "success": 0, "failed": 0, "error": "That file is not an .xlsx workbook. ..." }
  }
}
```

## 7. Order invoice PDF (§6.7)

### GET `/orders/:orderId/invoice` (customer) → `application/pdf`

- `:orderId` is the order id (`FOD-...`) or its Mongo `_id`.
- The invoice is available once the order is **delivered**. Before that, the endpoint returns 409 with `message` "The invoice is available once the order has been delivered".
- Another customer's order returns 403. An unknown order returns 404.
- The PDF is built from the bill stored at placement: items with add-ons, item amount, packaging, coupon, taxable value, CGST and SGST (half each of the food GST), delivery fee, platform fee and its GST, tip, loyalty points redeemed, round-off and total paid. It prints the restaurant's GSTIN and FSSAI number.
- **Invoice number.** Each restaurant has its own sequential series, restarting every financial year (1 April, IST). The default format is `<prefix>/<FY short>/<5-digit seq>`, for example `R7F3A/2627/00045` (16 characters, GST-compliant). The default prefix is `R` plus the last 4 characters of the restaurant id, uppercased. The number is given once, when the order is delivered, and is stored on the order as `invoice.number` (with `invoice.fy`, `invoice.seq` and `invoice.issuedAt`). Orders delivered before numbering began have no `invoice` and keep `FD-<orderId>`. Show `invoice.number` when it is present; do not build the number yourself.
- The filename is `invoice-<orderId>.pdf`.

Admins set the format and prefix in the settings registry: `invoice.numberFormat` (global or per vertical; tokens `{prefix}`, `{fy}` = `2026-27`, `{fyShort}` = `2627`, `{fyStart}`, `{seq}` / `{seq:N}`) and `invoice.prefix` (global, per vertical, or per restaurant at partner level, for example `ST123`; `{code}` is the last 4 characters of the id). GST allows at most 16 characters in an invoice number (letters, digits, `/` and `-`). The server enforces this: if the configured format or prefix renders anything longer or with other characters, it logs a warning and uses the compliant default instead. Numbers already given never change.

---

## 8. Loyalty points at checkout

Food checkout redeems loyalty points the same way quick commerce does (core loyalty ledger, rules for the `food` vertical). It is off until an admin turns on `loyalty.enabled`. While it is off, the fields below are accepted and do nothing.

- **Balance:** `GET /api/v1/platform/loyalty/me` returns `{ enabled, balance, worth, rules: { rupeesPerPoint, maxRedeemPercent, ... }, history }`. Show a "Use points" switch only when `enabled` is true and `balance > 0`.
- **Quote:** `POST /orders/calculate` accepts `loyaltyPoints` (a number). Send the balance if the customer switched on "Use points". The server clamps it to the balance and to `maxRedeemPercent` of the food value (item total minus coupon). It does not refuse the request. The response has:
  - `pricing.loyaltyPoints` and `pricing.loyaltyDiscount`: what is actually used.
  - `pricing.total`: the amount payable, already net of the points. `pricing.roundOff` and `pricing.bill.grandTotal`/`roundOff`/`loyaltyDiscount` are updated to match.
  - `loyalty`: `{ points, discount, requested, balance, maxPoints, capped, enabled }`. Show "up to N points on this order" when `capped` is true.
- **GST:** points are a payment, not a discount. They come off after GST, so the tax lines do not change. Print a separate "Loyalty points (N)" line with `-loyaltyDiscount` after the tip and before the round-off.
- **Place:** `POST /orders` accepts `loyaltyPoints` at the top level (or echoed in `pricing.loyaltyPoints`). Send `pricing.loyaltyPoints` from the quote. The server re-quotes, spends the points when the order is placed (once per order), and stores them on `pricing.loyaltyPoints`/`loyaltyDiscount` and `loyalty.pointsRedeemed`. If the balance changed in the meantime, fewer points are used and the total is higher. Re-read `pricing.total` from the response before you open the payment sheet.
- **Cancel:** a cancelled order gives its points back, once (`loyalty.reversedAt` is set). An unpaid online order that is replaced by a newer order with the same coupon, or by a newer order that redeems points, is cancelled and its points come back.
- **Earning:** a delivered order earns points on the food value paid for (item total minus coupon minus points). `loyalty.pointsEarned` is set on the order.
- If points would cover the whole payable amount, the order is refused with "Points cannot pay for the whole order. Use fewer points."

---

## 9. Proof of delivery (delivery partner app)

Food deliveries follow the quick-commerce rule (`core/delivery/dropProof.js`).

- When the admin turns off the customer handover code for food (`delivery.dropOtpRequired` = false, global, per vertical or per zone), the rider must send a photo to complete. With the code in use, the photo is optional and the code is still required.
- `PATCH /delivery/orders/:orderId/reached-drop` now returns `order.dropPhotoRequired` (`true` when the code is off). When it is true, open the photo step instead of the code step.
- `PATCH /delivery/orders/:orderId/complete` accepts `{ dropProof: { photoUrl, lat, lng } }` (or the flat `dropPhotoUrl`, `lat`, `lng`). Upload the photo first with `POST /api/v1/uploads/image` (field `file`) and send the returned `url`. A photo that is not an `http(s)` URL or a `/uploads/` path returns 400. Without a photo when one is required, the response is 400 "Take a photo of the delivery to complete it (no handover code on this order)."
- The photo is stored on the order as `dropProof { photoUrl, lat, lng, at }`. The customer's order details (`GET /orders/:orderId`) and the admin order view show it.
