# Taxi API: changes for the Flutter apps (SOW plan §4)

This document lists every taxi endpoint and socket event that is new or has changed for the rider and driver apps, plus the delivery-partner signup change (§4.11).

- **Base URL:** `https://<host>/api/v1/taxi` (delivery partner: `https://<host>/api/v1/food/delivery`).
- **Auth:** `Authorization: Bearer <accessToken>` for the user or driver role. `GET /public/trip/:token` needs no token.
- **Response envelope:** `{ success, message?, data? }`. Errors return `success: false` with an HTTP 4xx/5xx status and a `message` you can show as-is.
- **Coordinates:** `pickup` and `drop` are `[lng, lat]` arrays, as before. Stops are objects `{ lat, lng, address }`.
- Every new field has a default that keeps today's behaviour. An app that sends none of the new fields books and prices one-way rides exactly as before.

---

## 1. Multiple stops (§4.1)

### POST `/rides/quote` and POST `/rides`: send stops with coordinates

```json
{
  "pickup": [75.8843673, 22.728214],
  "drop": [75.8968202, 22.75521],
  "stops": [
    { "lat": 22.741, "lng": 75.8851, "address": "Stop A, Palasia" },
    { "lat": 22.748, "lng": 75.8902, "address": "Stop B, Geeta Bhawan" }
  ],
  "vehicleTypeIds": ["66f..."]
}
```

- Send up to **5** stops, in order. The server also accepts `{ latitude, longitude }` or `{ location: [lng, lat] }`.
- A stop with no usable coordinate is dropped. The server prices and stores only stops it can measure and navigate to. Do not send address-only stops.
- The quote returns `stopCount`, the number of stops it priced. Send the **same** stops to `POST /rides`. The booking is priced the same way, so its fare equals the quote.
- A stop outside the pickup's service zone is refused with 400, as the drop is.

### The ride now carries `stops`

`POST /rides` (`data.ride`), `GET /rides/:rideId`, `GET /rides/active/me`, the `ride:state` socket event and the driver offer all include this:

```json
"stops": [
  { "address": "Stop A, Palasia", "lat": 22.741, "lng": 75.8851, "order": 1, "reachedAt": null },
  { "address": "Stop B, Geeta Bhawan", "lat": 22.748, "lng": 75.8902, "order": 2, "reachedAt": "2026-10-07T10:21:33.000Z" }
]
```

A plain A-to-B ride has `stops: []`.

### Driver: the offer (`rideRequest` socket event)

The offer now includes `stops`, `tripType` and `returnAt`. Show the stops before the driver accepts. Use them as navigation waypoints:

`https://www.google.com/maps/dir/?api=1&destination=<dropLat>,<dropLng>&waypoints=<lat>,<lng>|<lat>,<lng>&travelmode=driving`

Pass only the stops whose `reachedAt` is `null`.

### Driver: reached a stop

**REST:** POST `/drivers/rides/:rideId/stops/:order/reached` (no body)

**Socket:** emit `ride:stop:reached` with `{ "rideId": "...", "order": 1 }`

Both work only while the trip is under way (`liveStatus` is `started` or `arrived`). Calling twice keeps the first time.

```json
{
  "success": true,
  "data": {
    "rideId": "66f...",
    "order": 1,
    "reachedAt": "2026-10-07T10:21:33.000Z",
    "stops": [ { "address": "Stop A, Palasia", "lat": 22.741, "lng": 75.8851, "order": 1, "reachedAt": "2026-10-07T10:21:33.000Z" } ]
  }
}
```

Errors: 409 if the trip has not started. 404 if the ride has no such stop or is not this driver's ride.

The ride room (rider and driver) receives `ride:stop:updated` with the same `data` object.

---

## 2. Round trip in the normal ride flow (§4.2)

Intercity is now part of the normal ride flow (decision D3). There is no separate intercity flow. A rider picks **one way** or **round trip** on the vehicle screen. Outstation rates still apply when `transport_type: "intercity"` is sent, as before.

### POST `/rides/quote` and POST `/rides`

```json
{
  "pickup": [75.88, 22.72],
  "drop": [76.0, 22.9],
  "vehicleTypeIds": ["66f..."],
  "tripType": "round_trip",
  "returnAt": "2026-10-08T18:30:00.000Z",
  "scheduledAt": "2026-10-08T09:00:00.000Z"
}
```

- `tripType` is `one_way` (the default) or `round_trip`.
- `returnAt` is the time the rider wants to leave the destination. It is optional, and without it the driver turns straight round. It must be after the outbound trip arrives (departure plus trip duration) and within 7 days. Otherwise the request returns 400 with a message to show.
- `scheduledAt` sets the departure time, so send it to the quote as well. The round-trip waiting time and the night charge (§4) are worked out from it. Without it, departure is now.

### How the server prices it

| Line | Meaning |
|---|---|
| `baseFare + distanceFare + timeFare` | The outbound trip, as for a one-way ride |
| `returnTripFare` | The outbound trip fare × the admin's `round_trip_return_factor` (default 1) |
| `roundTripWaitingCharge` | Each started hour waited at the destination, after `round_trip_wait_free_minutes` (default 60), × `round_trip_wait_per_hour` (default 0) |

Service tax and the platform fee apply to the total of these lines, then surge is added. **Do not compute a round-trip fare in the app.** Show `fare.total` from the quote.

### Quote response (one row per vehicle type), new fields marked `// new`

```json
{
  "vehicleTypeId": "66f...",
  "available": true,
  "fare": {
    "baseFare": 70, "distanceFare": 236.3, "timeFare": 81.2,
    "returnTripFare": 310.0,          // new
    "roundTripWaitingCharge": 100,    // new
    "nightCharge": 0,                 // new (§4)
    "serviceTax": 0, "platformFee": 0,
    "subtotal": 797.5, "serviceTaxPercent": 0, "tripType": "round_trip",   // tripType new
    "roundOff": 0.0, "fareBeforeSurge": 798, "surge": 0, "total": 798,
    "surgePercent": 0, "surgeSlotName": "",
    "nightChargeWindow": ""           // new: e.g. "22:00-06:00" when a night charge applied
  },
  "measuredDistanceMeters": 23100,    // one way
  "measuredDurationMinutes": 55.4,
  "distanceSource": "road",
  "tripType": "round_trip",           // new
  "returnAt": "2026-10-08T18:30:00.000Z", // new
  "stopCount": 0                      // new
}
```

### The ride

`tripType` (`one_way` or `round_trip`) and `returnAt` are on the ride, in `ride:state` and in the driver offer. `pricingSnapshot` adds `trip_type`, `return_trip_fare`, `round_trip_waiting_charge`, `night_charge_amount`, `night_charge_window` and `priced_distance_meters` (both legs of a round trip).

For a round trip, the driver taps **Arrived** at the destination as usual, waits, drives back, and then completes. The trip is traced the whole way.

---

## 3. Tolls (§4.3)

### Driver: add a toll during the trip

1. Upload the receipt photo with the existing upload endpoint, POST `/common/upload/image`. Send the `image` file as multipart, with `folder=toll-receipts`. Then read `data.url` from the response.
2. POST `/drivers/rides/:rideId/tolls`

```json
{ "amount": 85, "receiptPhotoUrl": "https://res.cloudinary.com/.../receipt.jpg", "lat": 22.81, "lng": 75.93, "at": "2026-10-07T10:40:00Z" }
```

`lat`, `lng` and `at` are optional. Without them the server uses the driver's last position and the current time.

```json
{
  "success": true,
  "data": {
    "rideId": "66f...",
    "toll": { "id": "66f...", "amount": 85, "receiptPhotoUrl": "https://...", "at": "...", "lat": 22.81, "lng": 75.93,
              "status": "approved", "autoApproved": true, "reviewedAt": "...", "note": "" },
    "tolls": [ /* every toll on the ride, same shape */ ],
    "autoApproveLimit": 100
  }
}
```

- A toll is approved straight away while the ride's auto-approved tolls, this one included, stay within the admin's per-ride limit. With a limit of 0 (the default), an admin reviews every toll. Otherwise the toll's `status` is `pending` until an admin approves or rejects it.
- Errors (400): no `receiptPhotoUrl`; `amount` is 0 or less, or over 5,000; more than 20 tolls on the ride. A request outside the trip returns 409.
- The ride room receives `ride:tolls:updated` with `{ rideId, tolls }` when a toll is added or reviewed.

### In the fare

At completion, the **approved** tolls are added to the fare as their own line: `tollChargeAmount` on the ride, in `ride:state` and in `ride:status:updated`. Pending or rejected tolls are not added. Anything the driver app sends as `additionalCharge` is still ignored. No commission is taken on tolls.

If an admin approves a toll after the ride has been paid for, the rider is not charged again. The platform pays the toll into the driver's wallet once, as a wallet transaction with reason `taxi_toll_after_completion`.

---

## 4. Night charge (§4.4)

This needs no request change. The admin sets a night window on the vehicle's price, for example 22:00–06:00 (India time, and it may run past midnight). They also set it as a percentage of the fare or a fixed amount. The night charge is separate from time-slot surge.

- **Quote:** the night charge is in `fare.nightCharge` and included in `fare.total`. `fare.nightChargeWindow` names the window. The pickup time is `scheduledAt`, or now.
- **Ride:** `nightChargeAmount` holds the night charge priced at booking. It is already inside the agreed fare. Show it as a line ("Night charge, included"), not as an extra on top.

---

## 5. Extra kilometres (§4.5)

This needs no request change. At completion the server compares the distance it traced against the quoted distance. It traces from the ride's own `ride:driver-location:update` events while the rider is on board, between start and completion, so the driver app must keep sending them during the trip. If the traced distance is longer than the quoted distance plus the admin's tolerance, the extra kilometres are charged at the per-km price:

- `distanceChargeAmount` on the ride is the extra-km line. It was always 0 before.
- `extraDistance` on the ride (and in `ride:state`):

```json
"extraDistance": { "quotedMeters": 5000, "tracedMeters": 9000, "traceReliable": true, "allowanceKm": 0.5, "extraKm": 3.5 }
```

Nothing extra is charged when there is no trace, when the trace is unreliable (fewer than 10 points, a gap of more than 3 minutes between updates, or more than 3 impossible jumps), or when the admin has not switched extra-km charging on. Movements under 25 m are treated as GPS jitter and not counted.

---

## 6. Live ETA (§4.6)

The ride room receives a new socket event, `ride:eta:updated`. The server sends it from the driver's location updates, at most once every 15 seconds:

```json
{ "rideId": "66f...", "target": "pickup", "etaMinutes": 7, "distanceMeters": 2350, "nextStopOrder": null,
  "source": "directions", "updatedAt": "2026-10-07T10:05:12.000Z" }
```

- `target` is `pickup` until the trip starts, then `drop`. The drop ETA runs through the stops not yet reached, and `nextStopOrder` names the next one.
- `source` is `directions` (from Google), `directions_cached` (the last road time scaled to the distance left) or `estimate` (no Maps key: straight line × 1.4 at 25 km/h).

---

## 7. SOS (§4.7)

All SOS entry points now use one service. On trigger it:

1. saves the alert;
2. alerts the admins over the socket and FCM;
3. sends an SMS to each of the rider's trusted contacts, or the driver's emergency contacts, with the live trip link. Without a ride, it sends a map link instead;
4. keeps recording the location until an admin resolves the alert.

If the SOS is pressed again on the same ride while the alert is still open, it adds to that alert and does not text the contacts again.

### Trigger

POST `/users/sos` (rider) or POST `/drivers/sos` (driver)

```json
{ "rideId": "66f...", "location": { "lat": 22.731, "lng": 75.886 }, "notes": "optional" }
```

`location` also accepts `{ "coordinates": [lng, lat] }`. The old POST `/safety/sos` with `{ trip_id, latitude, longitude }` still works and goes through the same service. Only the caller's own ride is attached to the alert.

```json
{
  "success": true,
  "data": {
    "id": "66f...", "status": "active", "sourceApp": "user", "rideId": "66f...",
    "location": { "lat": 22.731, "lng": 75.886, "coordinates": [75.886, 22.731] },
    "shareUrl": "https://<web>/track-trip/9f2c...",
    "contactsNotified": [ { "name": "Mother", "phoneMasked": "******4444", "status": "sent", "reason": "" } ],
    "logs": [ { "actorRole": "system", "message": "SOS triggered from user app", "createdAt": "..." } ]
  }
}
```

The response also includes the other existing fields: rider and driver names, addresses and `createdAt`.

A 403 means the admin has switched SOS off.

### Location updates while the alert is open

Send this every 10 seconds until the alert is no longer `active`:

POST `/users/sos/:alertId/location` or POST `/drivers/sos/:alertId/location`

```json
{ "location": { "lat": 22.74, "lng": 75.89 } }
```

The server keeps at most one point every 10 seconds. The response is `{ "recorded": true }`, or `{ "recorded": false }` if the point was too soon or the alert has been resolved. During a ride the driver's ride location updates are also recorded on the alert.

### Contacts

These endpoints are unchanged. Riders manage trusted contacts at `/safety/trusted-contacts`, and drivers manage emergency contacts at `/drivers/emergency-contacts`.

---

## 8. Live trip sharing (§4.8)

### POST `/safety/trip/share` (rider)

Request body: `{ "trip_id": "<rideId>" }`. Only the rider's own ride can be shared (404 otherwise). The response now includes `url`. While a link is still valid, calling this again returns the same link.

```json
{ "success": true, "data": { "token": "9f2c...48 hex", "trip_id": "66f...", "expiry_time": "...", "status": "active",
  "url": "https://<web>/track-trip/9f2c..." } }
```

Share the `url`. It opens the public web page `/track-trip/:token`.

### GET `/public/trip/:token` (no auth)

```json
{
  "success": true,
  "data": {
    "status": "ongoing", "liveStatus": "started", "statusLabel": "On trip", "isLive": true,
    "tripType": "one_way", "stopsTotal": 2, "stopsReached": 1,
    "location": { "lat": 22.73, "lng": 75.885, "heading": 90, "updatedAt": "..." },
    "driver": { "firstName": "Suresh", "vehicleNumber": "MP09AB1234", "vehicle": "White Maruti Dzire" },
    "expiresAt": "...", "updatedAt": "..."
  }
}
```

- The response contains no phone numbers, surnames, addresses, fare, OTP or ids.
- `location` is `null` once the ride is no longer live (completed or cancelled).
- A token that does not exist returns 404. An expired or revoked link returns 410. Links last 24 hours.

---

## 9. Driver approval (§4.9)

A new driver is now `approve: false, status: "pending"` unless whoever creates it says otherwise. That includes admin-created drivers, unless the admin ticks "Approve now". The driver app's existing pending and approval-status screens (`GET /drivers/approval-status`, `GET /drivers/me` with `allowPending`) apply as before.

---

## 10. Delivery partner signup: vehicle RC (§4.11)

POST `/api/v1/food/delivery/register` (multipart), and PATCH `/food/delivery/profile`

- New file field **`vehicleRcPhoto`**. You can send the URL of an RC photo you already uploaded as the text field `vehicleRcPhoto` instead.
- New optional text field **`vehicleRcNumber`**, normalised to upper case with no spaces. It defaults to `vehicleNumber`.
- **Required for every motorised vehicle**, which means any `vehicleType` except `bicycle`/`cycle`. Without it, registration returns 400 with "Vehicle RC photo is required for a motorised vehicle".
- An RC uploaded as an admin-defined catalogue document (`doc_<key>_front` where the key or name contains "rc" or "registration certificate") also counts.

---

## 11. Socket events summary

| Event | Direction | Payload |
|---|---|---|
| `rideRequest` | server → driver | adds `stops`, `tripType`, `returnAt` |
| `ride:state` | server → ride room | adds `stops`, `tripType`, `returnAt`, `tolls`, `tollChargeAmount`, `nightChargeAmount`, `extraDistance` |
| `ride:status:updated` | server → ride room | adds `tollChargeAmount`, `nightChargeAmount` |
| `ride:stop:reached` | driver → server | `{ rideId, order }` |
| `ride:stop:updated` | server → ride room | `{ rideId, order, reachedAt, stops }` |
| `ride:tolls:updated` | server → ride room | `{ rideId, tolls }` |
| `ride:eta:updated` | server → ride room | see §6 |

---

## 12. Admin endpoints (for reference; used by the admin panel)

- GET `/admin/trips/tolls?status=pending|approved|rejected|all&page&limit` returns `{ results: [{ rideId, rideStatus, pickupAddress, dropAddress, fare, completedAt, driver, toll }], paginator }`.
- PATCH `/admin/trips/:rideId/tolls/:tollId` takes `{ decision: "approve"|"reject", note? }` and returns `{ rideId, toll, settledToDriver }`. Deciding a toll twice returns 409.
- PATCH `/admin/general-settings/transport-ride` with `{ settings: { toll_auto_approve_limit: "100" } }` sets the per-ride toll auto-approve limit in rupees. 0 means review every toll.
- Set prices (`/admin/types/set-prices`) take these new fields: `round_trip_return_factor`, `round_trip_wait_free_minutes`, `round_trip_wait_per_hour`, `night_charge { enabled, start "HH:MM", end "HH:MM", type: percentage|fixed, value }` and `extra_km_charge { enabled, tolerance_type: percent|km, tolerance_value }`.
- GET `/admin/safety/alerts?status=active|resolved|all` now lists the unified SOS alerts as `{ results, paginator }`. PATCH `/admin/safety/alerts/:id/resolve` takes `{ note }`.
