# Service Provider API: changes for the Flutter apps (SOW plan §3.2–3.6)

This document lists every endpoint that is new or has changed for the customer, vendor and worker apps.

- **Base URL:** `https://<host>/api/v1/sp`. The legacy `/api/...` prefixes still work.
- **Auth:** `Authorization: Bearer <accessToken>` with the right role (user, vendor, worker or admin).
- **Response envelope:** `{ success, message?, data? }`. Errors return `success: false` with an HTTP 4xx/5xx status. Some errors also carry a `code`.

Whether jobs go to vendors or to workers depends on the admin setting `bookingModel`. The endpoints below work the same way for both roles. Where a path says `{vendors|workers}`, use the path for the logged-in role. Vendor booking actions sit under `/vendors/bookings/:id/self/...` and worker job actions sit under `/workers/jobs/:id/...`.

---

## 1. Onboarding and profile (vendor and worker)

### GET `/{vendors|workers}/onboarding`

Returns the onboarding profile and the verification checklist.

```json
{
  "success": true,
  "data": {
    "_id": "66f...",
    "email": "ravi@example.com",
    "isEmailVerified": false,
    "approvalStatus": "pending",
    "gst": { "number": "27ABCDE1234F1Z5", "document": "https://.../gst.pdf", "verified": false },
    "pan": { "number": "ABCDE1234F", "document": "https://.../pan.jpg" },
    "serviceRadiusKm": 12,
    "experienceYears": 6,
    "certifications": [
      { "name": "ITI Electrician", "issuer": "NCVT", "document": "https://...", "expiresAt": "2028-01-01T00:00:00.000Z" }
    ],
    "categoryIds": ["66a1...", "66a2..."],
    "categories": ["AC Repair", "Plumber"],
    "bankDetails": { "accountNumber": "XXXXXX7890", "ifscCode": "ICIC0000001", "accountHolderName": "Ravi", "bankName": "ICICI", "upiId": "" },
    "verification": {
      "required": ["aadhaar", "address"],
      "missing": ["address"],
      "items": {
        "aadhaar":    { "status": "verified", "verifiedAt": "2026-10-07T10:00:00Z", "note": null, "required": true },
        "pan":        { "status": "pending",  "verifiedAt": null, "note": null, "required": false },
        "gst":        { "status": "pending",  "verifiedAt": null, "note": null, "required": false },
        "address":    { "status": "rejected", "verifiedAt": "2026-10-07T10:05:00Z", "note": "Upload a utility bill", "required": true },
        "background": { "status": "pending",  "verifiedAt": null, "note": null, "required": false }
      }
    }
  }
}
```

Field notes:

- `pan` and `serviceRadiusKm` appear for workers only. Vendor PAN is part of vendor registration, as before. For vendors, the service range is `settings.serviceRange`.
- The bank account number is always masked in responses.

### PUT `/{vendors|workers}/onboarding`

Send any subset of these fields. Fields you leave out are not changed.

```json
{
  "gst": { "number": "27abcde1234f1z5", "document": "https://.../gst.pdf" },
  "pan": { "number": "abcde1234f", "document": "https://.../pan.jpg" },
  "experienceYears": 6,
  "serviceRadiusKm": 12,
  "certifications": [{ "name": "ITI Electrician", "issuer": "NCVT", "document": "https://...", "expiresAt": "2028-01-01" }],
  "categories": ["AC Repair", "66a2c0ffee..."]
}
```

- Upload files first through the existing upload endpoints, then send the URLs here.
- GSTIN and PAN formats are validated, and both are uppercased.
- Changing the GST number resets `gst.verified` and the `gst` checklist item to pending. A provider can never verify their own GST.
- `serviceRadiusKm` is worker only, from 1 to 200. Send `null` to use the platform default. Assignment uses it.
- `certifications` replaces the whole list.
- `categories` (or `categoryIds`) takes category ids, titles or slugs, mixed freely. The server stores both the ids and the names. An unknown id returns 400. An unknown name is kept as free text.

The response is the same as GET `/onboarding`. Errors are 400, for example `{ "success": false, "message": "gst.number is not a valid GSTIN" }`.

### PUT `/{vendors|workers}/bank-details`

The body can be the bank details object itself, or wrapped as `{ "bankDetails": {...} }`.

```json
{ "accountNumber": "1234567890", "ifscCode": "ICIC0000001", "accountHolderName": "Ravi Kumar", "bankName": "ICICI", "upiId": "ravi@okicici" }
```

- Provide either an account number, IFSC and holder name together, or a `upiId` on its own.
- The IFSC must match `^[A-Z]{4}0[A-Z0-9]{6}$` and is uppercased.
- The account number must be 9 to 18 digits.

Response:

```json
{ "success": true, "message": "Bank details saved", "data": { "bankDetails": { "accountNumber": "XXXXXX7890", "ifscCode": "ICIC0000001", "accountHolderName": "Ravi Kumar", "bankName": "ICICI", "upiId": "ravi@okicici" } } }
```

### Withdrawals now use the saved bank details (changed)

These endpoints are `POST /vendors/withdraw` and `POST /workers/wallet/withdraw`.

- `bankDetails` is now optional. If you leave it out, the details saved on the profile are used.
- If the request includes `bankDetails`, they are validated as described above. Invalid details return 400.
- If neither the request nor the profile has details, the server returns 400 with `"No bank details on your profile. Save them with PUT /bank-details or send bankDetails."`.

### Email verification

**POST `/{vendors|workers}/email/send-otp`**

- Body: `{}` sends a code to the email on file.
- Body: `{ "email": "new@example.com" }` changes the email first, which resets `isEmailVerified`, then sends the code.
- If the email is already used by someone else, the server returns 409.
- The code is 6 digits and valid for 5 minutes. Requests count against the phone's shared OTP limit and return 429 when it is exceeded.

```json
{ "success": true, "message": "Verification code sent to ravi@example.com", "data": { "email": "ravi@example.com" } }
```

**POST `/{vendors|workers}/email/verify`**

Body: `{ "otp": "123456" }`. On success, the response is:

```json
{ "success": true, "message": "Email verified", "data": { "email": "ravi@example.com", "isEmailVerified": true } }
```

A wrong or expired code returns 400.

### Availability calendar

A provider without a calendar is treated as always available. A booking only skips a provider whose calendar says they are off at the booked slot. Instant bookings check the current time. Times are 24-hour `HH:mm` in IST, and days run from 0 (Sunday) to 6 (Saturday).

**GET `/{vendors|workers}/availability`**

```json
{ "success": true, "data": {
  "configured": true, "timezone": "Asia/Kolkata",
  "weekly": [
    { "day": 1, "off": false, "slots": [{ "start": "09:00", "end": "13:00" }, { "start": "14:00", "end": "19:00" }] },
    { "day": 0, "off": true, "slots": [] }
  ],
  "overrides": [
    { "date": "2026-10-20", "type": "leave", "slots": [], "note": "Diwali" },
    { "date": "2026-10-26", "type": "custom", "slots": [{ "start": "18:00", "end": "21:00" }], "note": null }
  ]
} }
```

How a slot is checked:

- An override for the date wins. A `leave` override means the provider is off all day. A `custom` override means only its slots count that day.
- If there is no override and `weekly` is empty, the provider is available all week.
- Otherwise, the provider is available only on listed days and only within the slots for that day.

**PUT `/{vendors|workers}/availability`**

Body: `{ "weekly": [...], "overrides": [...] }`.

- Each array replaces what is stored. Leave an array out to keep it as it is.
- For each slot, `start` must be before `end`. `end` may be `"24:00"`.

**POST `/{vendors|workers}/availability/overrides`**

Body: `{ "date": "2026-10-20", "type": "leave", "note": "Diwali" }`. For custom hours, use `{ "date": "...", "type": "custom", "slots": [{ "start": "10:00", "end": "12:00" }] }`. Sending an override for a date that already has one replaces it.

**DELETE `/{vendors|workers}/availability/overrides/:date`**

Removes the override for that date, for example `/availability/overrides/2026-10-20`.

All of the availability write endpoints return the same `data` shape as GET.

### Approval (behaviour change)

- An admin cannot approve a vendor or worker until the required checklist items are verified.
- By default, vendors need `aadhaar`, `pan` and `address`, and workers need `aadhaar` and `address`. Admins can change these lists in Settings.
- Apps can show `verification.missing` from GET `/onboarding`.

---

## 2. Booking (customer app)

### GET `/users/providers?categoryId=&lat=&lng=&date=YYYY-MM-DD&time=HH:mm`

Lists the providers the customer can choose from. Results are ranked by rating (60%) and closeness (40%).

- Only eligible providers are listed: approved, active, on duty (workers), subscribed, within their service radius, and available at the slot.
- Leave out `date` to check the current time.
- `providerType` is `vendor` or `worker`, depending on the admin's `bookingModel`.

```json
{ "success": true,
  "data": [
    { "_id": "66w1...", "providerType": "worker", "name": "Ravi", "profilePhoto": "https://...", "rating": 4.8,
      "totalReviews": 52, "completedJobs": 140, "experienceYears": 6, "certifications": ["ITI Electrician"],
      "distanceKm": 2.4, "score": 0.884 }
  ],
  "meta": { "providerType": "worker", "slot": { "dateStr": "2026-10-12", "weekday": 1, "minutes": 900 } } }
```

### POST `/users/bookings` (changed: new optional fields)

The existing body is unchanged. Two optional fields are new:

```json
{
  "serviceId": "66s...",
  "address": { "addressLine1": "1 MG Road", "city": "Pune", "state": "MH", "pincode": "411001", "lat": 18.52, "lng": 73.85 },
  "scheduledDate": "2026-10-12", "scheduledTime": "15:00", "timeSlot": { "start": "15:00", "end": "16:00" },
  "paymentMethod": "pay_at_home",
  "preferredProviderId": "66w1...",
  "addOns": [{ "addOnId": "66ad...", "quantity": 2 }]
}
```

**`addOns`** are chosen from the service's `addOns[]`. Each add-on has `_id`, `name`, `description`, `price`, `gstPercentage` (`null` means the service GST applies), `maxQuantity` and `isActive`.

- The server prices add-ons from the catalogue. It adds them to `basePrice`, to `tax` (add-on GST) and to `finalAmount`, on top of whatever the app priced.
- Do not include add-ons in the app's own `basePrice`/`tax`/`amount` breakdown.
- Add-ons that are unknown, inactive, over `maxQuantity` or listed twice return 400.
- Add-ons are separate from the extras a provider adds at billing (`extraCharges` / bill items).

**`preferredProviderId`** is an `_id` from GET `/users/providers`.

- If that provider is still eligible, they get the job alone first ("wave 0"). They have `preferredProviderTimeoutSec` to accept, which the admin sets and defaults to 120 seconds.
- If they don't accept in time, the booking goes to the normal waves of nearby providers.
- If the provider is no longer eligible, the booking goes straight to the normal waves.

New fields in the response:

```json
{ "success": true, "data": {
  "_id": "66b...", "bookingNumber": "BK...", "status": "searching", "finalAmount": 1062,
  "addOns": [{ "addOnId": "66ad...", "name": "Filter replacement", "price": 200, "quantity": 2, "gstPercentage": 18, "total": 400 }],
  "addOnsTotal": 472,
  "preferredOffer": { "providerType": "worker", "providerId": "66w1...", "offeredAt": "...", "expiresAt": "...", "status": "offered" }
} }
```

`preferredOffer.status` is one of these values:

| Status | Meaning |
|---|---|
| `offered` | The preferred provider has the offer now |
| `accepted` | The preferred provider accepted |
| `timed_out` | The offer expired and the booking moved to the normal waves |
| `unavailable` | The preferred provider was not eligible, so the booking went straight to the waves |

`preferredOffer` is `null` when no preferred provider was given.

### GET `/users/bookings/:id` (changed)

- `workPhotos` is now `{ before: [photo], after: [photo] }`, where each photo is `{ url, uploadedAt, uploadedBy, lat, lng }`. Older bookings return their photos under `after`.
- The response also includes `addOns`, `addOnsTotal`, `preferredOffer`, `acceptedQuoteId` and `invoiceNumber`.

### GET `/users/bookings/:id/invoice`

Returns the invoice as a PDF file, with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="<invoiceNumber>.pdf"`.

- The invoice is available once the booking status is `work_done` or `completed`. Before that, the server returns 400 `{ "success": false, "message": "The invoice is available once the work is completed" }`.
- Another customer's booking returns 404.
- The invoice number looks like `INV-2026-000123`. It uses the admin's invoice prefix and is assigned once per booking.
- The invoice shows the company GSTIN, PAN and SAC from admin Settings.
- Every completed booking also emails the PDF once to the customer's email address, if one is on file.

---

## 3. Quotes (consultancy categories)

- A category with `isConsultancy: true` is quote-based.
- The customer sends a request, nearby eligible providers send quotes, and the customer accepts one.
- An accepted quote becomes a normal booking at the quoted price, already assigned to that provider. A vendor booking becomes `confirmed` and a worker booking becomes `assigned`. From there it follows the usual start, visit, complete and pay flow.
- A request is open for `quoteRequestExpiryHours` (default 48). A quote is valid for `validForHours`, which defaults to `quoteValidityHours` (72) and never runs past the request's own expiry.

### Customer

**POST `/users/quotes/requests`**

```json
{
  "categoryId": "66c...",
  "serviceId": "66s...",
  "requirementText": "Shift a 2BHK from Kothrud to Baner, 3rd floor, no lift",
  "requirementImages": ["https://.../room1.jpg"],
  "address": { "addressLine1": "...", "city": "Pune", "state": "MH", "pincode": "411038", "lat": 18.50, "lng": 73.80 },
  "scheduledDate": "2026-10-20",
  "timeSlot": { "start": "09:00", "end": "12:00" }
}
```

- `serviceId`, `requirementImages`, `scheduledDate` and `timeSlot` are optional.
- If the category is not a consultancy category, the server returns 400.

```json
{ "success": true, "message": "Sent to 4 provider(s) near you",
  "data": { "_id": "66q...", "bookingNumber": "QR...", "status": "quote_requested", "quoteExpiresAt": "...", "providersNotified": 4 } }
```

**GET `/users/quotes/requests`**

Lists the customer's requests, each with `quoteCount` and `lowestQuote`.

**GET `/users/quotes/requests/:bookingId`**

Returns the request and its quotes, cheapest first:

```json
{ "success": true, "data": {
  "request": { "_id": "66q...", "status": "quote_requested", "requirementText": "...", "quoteExpiresAt": "..." },
  "quotes": [{
    "_id": "66qt...", "status": "submitted", "providerType": "worker",
    "provider": { "_id": "66w1...", "name": "Ravi Movers", "profilePhoto": null, "rating": 4.7, "totalJobs": 80 },
    "lineItems": [{ "name": "Packing", "quantity": 1, "price": 1000, "total": 1000 }, { "name": "Truck", "quantity": 1, "price": 2000, "total": 2000 }],
    "subtotal": 3000, "gstPercentage": 18, "tax": 540, "visitingCharges": 100, "amount": 3640,
    "note": "Sunday ok", "validUntil": "..."
  }]
} }
```

**POST `/users/quotes/:quoteId/accept`**

- Body: `{ "paymentMethod": "pay_at_home" }`. The allowed values are `pay_at_home`, `cash`, `online`, `razorpay` and `wallet`.
- The response `data` is the booking: `status` is `assigned` or `confirmed`, `finalAmount` equals the quote `amount`, `basePrice` is the quote `subtotal`, and `tax` and `visitingCharges` come from the quote.
- All other quotes are rejected.
- If the quote has expired, was withdrawn, or the request is closed, the server returns 400.
- To pay online, use the existing payment endpoints with the booking id.

**POST `/users/quotes/requests/:bookingId/cancel`**

Body: `{ "reason": "..." }`, which is optional.

### Provider (vendor or worker)

**GET `/{vendors|workers}/quotes/requests`**

Lists open requests offered to this provider, each with `distance` and `myQuote` (`null` if the provider hasn't quoted yet).

**POST `/{vendors|workers}/quotes/requests/:bookingId`**

Submits a quote. Sending it again revises the same quote.

```json
{
  "lineItems": [{ "name": "Packing", "price": 1000 }, { "name": "Truck", "price": 2000, "quantity": 1 }],
  "gstPercentage": 18,
  "visitingCharges": 100,
  "validForHours": 48,
  "note": "Sunday ok"
}
```

- `gstPercentage` defaults to the platform service GST.
- The response is 201 for a new quote and 200 for a revision. `data` is the quote with `subtotal`, `tax` and `amount` worked out by the server.
- If the request was not offered to this provider, the server returns 404.

**POST `/{vendors|workers}/quotes/:quoteId/withdraw`**

Withdraws a submitted quote.

---

## 4. Work-verification photos (vendor and worker)

- **Photo shape:** `{ url, uploadedAt, uploadedBy, lat, lng }`. Upload the image file first, then send its URL.
- **Where photos are required:** `before` photos when work starts (visit verify) and `after` photos when the job is completed. Each category can switch this off with `requireWorkPhotos`, which is on by default.

### POST `/workers/jobs/:id/photos` and POST `/vendors/bookings/:id/self/photos`

```json
{ "phase": "before", "photos": ["https://.../b1.jpg", { "url": "https://.../b2.jpg", "lat": 18.52, "lng": 73.85 }], "lat": 18.52, "lng": 73.85 }
```

- Up to 10 photos per call.
- The request-level `lat`/`lng` fill in any photo that doesn't have its own.
- `before` photos are accepted once the job is `journey_started`, `visited` or `in_progress`. `after` photos are accepted once it is `visited`, `in_progress` or `work_done`.

```json
{ "success": true, "message": "2 before photo(s) saved", "data": { "workPhotos": { "before": [ ... ], "after": [] } } }
```

### Visit verify (changed)

The endpoints are `POST /workers/jobs/:id/visit/verify` and `POST /vendors/bookings/:id/self/visit/verify`.

- You can add `"beforePhotos": [url | {url,lat,lng}]` to the existing `{ otp, location }` body. You can also upload them first with `/photos`.
- If the job has no before photo and the category requires one, the server returns 400 `{ "code": "BEFORE_PHOTOS_REQUIRED" }`. The OTP is not used up, so the app can upload and retry.

### Complete (changed)

The endpoints are `POST /workers/jobs/:id/complete` and `POST /vendors/bookings/:id/self/complete`.

- You can add `"afterPhotos": [...]`, or keep sending the old `"workPhotos": [urls]`, which are now stored as after photos. You can also upload them first with `/photos`.
- Without an after photo, the server returns 400 `{ "code": "AFTER_PHOTOS_REQUIRED" }`.

The customer sees both sets in GET `/users/bookings/:id` under `workPhotos.before` and `workPhotos.after`.

---

## 5. Worker earnings

### GET `/workers/dashboard/earnings?period=daily|weekly|monthly&from=ISO-date`

The default range is the last 30 days for `daily`, 12 weeks for `weekly` and 12 months for `monthly`.

```json
{ "success": true, "data": {
  "period": "daily", "from": "2026-09-07T...",
  "summary": { "today": 2500, "thisWeek": 6100, "thisMonth": 18200, "total": 54000 },
  "earningsData": [ { "period": "2026-10-06", "earnings": 1300, "revenue": 1500, "jobs": 1 }, { "period": "2026-10-07", "earnings": 2500, "revenue": 2800, "jobs": 2 } ]
} }
```

- Weekly periods look like `2026-W41` (ISO week) and monthly periods look like `2026-10`. All periods use IST.
- For direct-model jobs, earnings are the worker's share after the booking's commission.
- For workers on a vendor's team, the vendor's recorded payments count on the day they were paid.

### GET `/workers/stats` (changed)

The response now also includes `earningsBreakdown: { today, thisWeek, thisMonth }`.
