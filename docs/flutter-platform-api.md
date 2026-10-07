# Platform API: recommendations, demand and global settings (SOW plan §7)

New read-only endpoints the Flutter apps can use. All responses use the usual
envelope `{ success, message, data }`. Base: `/api/v1`.

The data behind recommendations and demand is computed every night
(after 02:00 India time) from order history by
`Backend/src/core/analytics/insights.service.js`. Until the first run the lists
are empty; apps should hide the section rather than show an error.

---

## 1. Frequently bought together (customer app, food and quick commerce)

### GET `/platform/recommendations/together?vertical=food|quickCommerce&itemId=<id>&limit=10`

Public. `itemId` is the item id as it appears in the order (`items[].itemId`).

```json
{
  "vertical": "food",
  "itemId": "burger",
  "items": [
    { "itemId": "fries", "name": "Fries", "orders": 31, "confidence": 0.62, "lift": 1.8 },
    { "itemId": "coke", "name": "Coke", "orders": 30, "confidence": 0.6, "lift": 1.1 }
  ],
  "computedAt": "2026-10-07T21:01:12.000Z"
}
```

Ranked by how many orders contained both, then lift. Freebies and BOGO free
items are left out. Show on the item sheet or the cart ("Goes well with").

## 2. Popular near you (customer app, food and quick commerce)

### GET `/platform/recommendations/popular?vertical=food|quickCommerce&lat=<lat>&lng=<lng>&limit=10`

Public. Most-ordered items and sellers in the last 30 days within about 5-15 km
of the point. `scope` is `nearby`, or `all` when there is no data close to the
point (then the lists are the whole service's most popular).

```json
{
  "vertical": "food",
  "scope": "nearby",
  "items": [{ "itemId": "burger", "name": "Burger", "partnerId": "66f0…", "orders": 120 }],
  "partners": [{ "partnerId": "66f0…", "orders": 210 }]
}
```

## 3. Expected demand per zone (rider and driver apps)

### GET `/platform/recommendations/demand?vertical=food|quickCommerce|taxi&zoneId=<optional>&hours=12`

Signed-in users only (any role). Expected orders (or rides) per zone for the
coming hours, busiest zone first: the average of the same hour over the last 8
weeks, scaled by the last 2. Use it to suggest where to wait.

```json
{
  "vertical": "food",
  "hours": 12,
  "zones": [
    {
      "zoneId": "66f0…", "name": "Kothrud", "nextHour": 6.5, "total": 41.2, "trendFactor": 1.1,
      "hours": [{ "at": "2026-10-07T14:00:00.000Z", "expected": 6.5 }]
    }
  ]
}
```

## 4. Global platform settings (every app, before sign-in)

### GET `/platform/global-settings`

Public. Country, currency, phone code and time zone set once in Master
settings > Global platform. `null` delivery / schedule values mean "use the
service's own default".

```json
{
  "countryCode": "IN",
  "currencyCode": "INR",
  "currencySymbol": "₹",
  "phoneCode": "+91",
  "timezone": "Asia/Kolkata",
  "delivery": { "defaultRadiusKm": null },
  "schedule": { "maxDaysAhead": null, "minLeadMinutes": null }
}
```

## 5. Admin broadcasts reach every role

Master broadcasts now go to taxi drivers and Services vendors and workers as
well as customers, restaurants and riders. They arrive as a push (`data.type`
= `admin_broadcast`, `data.broadcastId`, `data.link`) and as an inbox row with
`source: ADMIN_BROADCAST` and `ownerType` `DRIVER`, `VENDOR` or `WORKER` for
those apps. No app change is needed beyond showing inbox rows of those owner
types.
