# Super-app data model: what to unify, what to leave alone

Written against the four order-shaped models actually in this repo, not from first
principles.

## 1. The measurements

| model | top-level fields |
|---|---|
| `FoodOrder` (food) | 130 |
| `QCOrder` (quick-commerce) | 136 |
| `Ride` (taxi) | 173 |
| `SPBooking` (service-provider) | 119 |

Overlap:

| pair | shared fields |
|---|---|
| **food ∩ quick-commerce** | **112** |
| food ∩ taxi | ~9 real domain fields |
| food ∩ service-provider | ~14 real domain fields |
| all four | `userId`, `status`, `type`, `acceptedAt`, `rating` |

(The raw intersections also contain `default`, `enum`, `ref`, `required`, `index`,
`unique`, `timestamps` — those are mongoose option keys, not domain fields. Excluded.)

## 2. What this says

**Your instinct is right about half of it, and the half it is right about is the
expensive half.**

- **food and quick-commerce share 112 of ~130 fields.** They are the same aggregate.
  Keeping them as two models is the duplication worth removing — it is also the one
  that costs you twice for every bug fix.
- **taxi and service-provider share about five real fields with food.** A ride has
  pickup, drop, fare breakdown, surge, driver, route polyline. A service booking has
  vendor, worker, wave alerting, parts catalogue, settlement. A food order has
  restaurant, items, addons, delivery partner, packaging charge.

Forcing all four into one collection would give you a document where ~90% of the
fields are null for any given row, `status` enums that contradict each other
(`picked_up` vs `journey_started` vs `work_done`), and one index set trying to serve
four different query patterns. Every read would need `if (type === ...)`. That is not
a unified model, it is a union type pretending to be a table.

**The rule a backend developer actually applies:** unify what shares a *lifecycle*,
not what shares a *noun*. All four are called "orders" in conversation. Only two of
them have the same lifecycle.

## 3. What to do — three separate moves

### Move 1: collapse food + quick-commerce with a discriminator

This is the real win. Mongoose has the feature built in — it is exactly this problem.

```js
// core/orders/order.model.js  — ONE collection: `orders`
const baseOptions = {
  collection: 'orders',
  discriminatorKey: 'channel',   // 'food' | 'quickCommerce'
  timestamps: true,
};

const orderSchema = new mongoose.Schema({
  // only what BOTH genuinely have — the 112 shared fields
  userId:        { type: ObjectId, ref: 'User', required: true, index: true },
  status:        { type: String, required: true, index: true },
  items:         [orderItemSchema],
  pricing:       pricingSchema,
  payment:       paymentSchema,
  addressSnapshot: addressSchema,
  dispatch:      dispatchSchema,
  placedAt:      Date,
  // ...
}, baseOptions);

export const Order = mongoose.model('Order', orderSchema);

// each vertical adds ONLY its own difference
export const FoodOrder = Order.discriminator('food', new mongoose.Schema({
  restaurantId:    { type: ObjectId, ref: 'Restaurant', index: true },
  addons:          [addonSchema],
  packagingCharge: Number,
}));

export const QuickOrder = Order.discriminator('quickCommerce', new mongoose.Schema({
  darkStoreId:  { type: ObjectId, ref: 'DarkStore', index: true },
  slotId:       ObjectId,
  batchId:      ObjectId,
}));
```

What this buys:

- `Order.find({ userId })` returns both verticals — one query for order history.
- `FoodOrder.find({})` still transparently filters to `channel: 'food'`. Existing
  vertical code keeps working.
- One set of indexes, one status machine, one payment integration, **one place to fix
  a bug**.

The work is not the schema, it is reconciling the ~18 fields where the fork diverged
(`order.model.js` differs by 174 lines) and migrating the documents. Budget it as a
real project: roughly 3 weeks including the data migration and a dual-write period.

### Move 2: leave taxi and service-provider as their own aggregates

`Ride` and `SPBooking` stay separate models in separate collections. They are not
orders; they are different transactions that happen to be initiated by the same
customer.

Attempting a shared base here produces the null-column table described above.

### Move 3: add the thing that actually makes it a super-app

What a super-app genuinely needs is not one giant order table — it is **one place to
answer "what has this customer done across all verticals"**. That is a thin index, not
a merged aggregate:

```js
// core/activity/activity.model.js  — collection: `activities`
{
  userId:     { type: ObjectId, ref: 'User', index: true },
  vertical:   { type: String, enum: ['food','quickCommerce','taxi','serviceProvider'], index: true },
  refModel:   String,     // 'Order' | 'Ride' | 'SPBooking'
  refId:      ObjectId,   // the vertical document
  status:     String,     // normalised: pending | active | completed | cancelled
  amount:     Number,
  title:      String,     // 'Dinner from Olive Kitchen', 'Ride to Airport'
  occurredAt: { type: Date, index: true },
}
```

Written by each vertical when its transaction changes state. Roughly 12 fields, one
compound index on `{ userId, occurredAt }`.

This gives you the unified activity feed, cross-vertical spend, and one notion of
"status" for the customer — **without** forcing four unrelated schemas into one shape.
It is the pattern Swiggy/Uber-style apps use, and it is far cheaper than a merge.

## 4. What else should genuinely be shared

Already done or partly done in this repo:

| concern | state |
|---|---|
| **Identity** (`users`) | food + taxi already share it. service-provider is bridged; quick-commerce is on `qc_users` and should join. |
| **Admin** (`admins`) | shared, gated by `servicesAccess`. Correct already. |
| **OTP rate limit** | unified — one budget per phone across all verticals. |
| **Payments** | still per-vertical (`payments`, `qc_payments`, `sp_transactions`). Genuine candidate for a single `payments` collection with a `vertical` field: a payment IS the same aggregate everywhere — amount, gateway, status, refund. |
| **Notifications** | four implementations. Same argument as payments. |

Payments and notifications are better first targets than orders: smaller, uniform, and
they touch money and deliverability where inconsistency actually hurts.

## 5. Recommended order of work

1. **Unify payments** — one collection, `vertical` field. Small, high value.
2. **Add the activity index** — gives the super-app feed immediately, low risk.
3. **Unify notifications.**
4. **Collapse food + quick-commerce orders** via discriminator. The big one; do it when
   the first three have proven the migration pattern.
5. **Leave taxi and service-provider aggregates alone.** Revisit only if their
   lifecycles actually converge, which today they do not.

## 6. What this means for the work just completed

Nothing done so far blocks any of it. Quick-commerce is isolated on `qc_*`
collections, which is the correct holding position: it keeps the fork from corrupting
food data while the discriminator merge is planned. The isolation is a stepping stone,
not the destination — and step 4 above is where the 112 duplicated fields finally go
away.
