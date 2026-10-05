# Ride insurance — Flutter implementation guide (quickdropnew, taxi module)

The backend is done. A rider sees the plans the admin created for the chosen
vehicle (Admin → Price Management → Ride Insurance), may pick one, and the ride
is booked insured. This guide is the app side.

## How it behaves (read first)

- **Server prices everything.** The app shows `premium` from the quote and sends
  only `insurancePlanId`. Never send a premium amount; it is ignored.
- **Charged only if the ride completes.** At booking `ride.fare` does *not*
  include the premium. At completion the server adds it, so the completed
  ride's `fare` does include it. A cancelled ride is never charged.
- **One plan per ride.** Optional: no `insurancePlanId` = uninsured, exactly as
  today. Old app builds keep working.
- **Taxi / intercity rides only.** Parcels get no options.

## 1. Quote — `POST /taxi/rides/quote` (unchanged request)

Each item in `data.quotes` now has `insuranceOptions`:

```json
{
  "vehicleTypeId": "66f...",
  "available": true,
  "fare": { "total": 187, "surge": 0, "...": "..." },
  "insuranceOptions": [
    {
      "id": "6700a...",
      "name": "Accident cover",
      "description": "Accidental injury and hospitalisation during the ride",
      "provider": "ACKO",
      "cover_amount": 100000,
      "terms_url": "https://...",
      "premium_type": "flat",
      "premium_value": 5,
      "premium": 5
    }
  ]
}
```

`premium` is already priced for that vehicle's fare (for a `percent` plan it
differs per vehicle). An empty list = nothing to offer; hide the section.

### Code — `lib/modules/taxi/ride/data/ride_repository.dart`

`quoteFares` currently returns only `FareBreakdown?` per vehicle. Keep that
signature (other callers use it) and add the options alongside:

```dart
class InsuranceOption {
  final String id, name, description, provider, termsUrl, premiumType;
  final double coverAmount, premiumValue, premium;

  const InsuranceOption({
    required this.id, required this.name, required this.description,
    required this.provider, required this.termsUrl, required this.premiumType,
    required this.coverAmount, required this.premiumValue, required this.premium,
  });

  factory InsuranceOption.fromJson(Map<String, dynamic> j) => InsuranceOption(
        id: '${j['id']}',
        name: '${j['name'] ?? ''}',
        description: '${j['description'] ?? ''}',
        provider: '${j['provider'] ?? ''}',
        termsUrl: '${j['terms_url'] ?? ''}',
        premiumType: '${j['premium_type'] ?? 'flat'}',
        coverAmount: (j['cover_amount'] as num?)?.toDouble() ?? 0,
        premiumValue: (j['premium_value'] as num?)?.toDouble() ?? 0,
        premium: (j['premium'] as num?)?.toDouble() ?? 0,
      );
}
```

Put it in `ride/data/models/insurance_option.dart`. Then parse it in the same
loop as the fare. Simplest: return a small record per vehicle.

```dart
typedef VehicleQuote = ({FareBreakdown? fare, List<InsuranceOption> insurance});

Future<Map<String, VehicleQuote>> quoteVehicles({ /* same params as quoteFares */ }) async {
  final data = await api.post(ApiConstants.rideQuote, data: { /* same body */ });
  final quotes = (data is Map ? data['quotes'] : null) as List? ?? const [];
  return {
    for (final q in quotes.whereType<Map>())
      '${q['vehicleTypeId']}': (
        fare: q['fare'] is Map ? FareBreakdown.fromQuote(Map<String, dynamic>.from(q['fare'] as Map)) : null,
        insurance: ((q['insuranceOptions'] as List?) ?? const [])
            .whereType<Map>()
            .map((o) => InsuranceOption.fromJson(Map<String, dynamic>.from(o)))
            .toList(),
      ),
  };
}
```

(Or have `quoteFares` call `quoteVehicles` and map `.fare`, so there is one
request.)

## 2. State — `home/application/booking_state.dart` + `booking_controller.dart`

Add to `BookingState`:

```dart
final Map<String, List<InsuranceOption>> insuranceOptions; // by vehicle id
final String? insurancePlanId;                               // chosen, or null
```

In `BookingController`:

- Where it calls `quoteFares` (around line 195), call `quoteVehicles` instead;
  fill `fareQuotes` from `.fare` and `insuranceOptions` from `.insurance`.
- `selectInsurance(String? planId)` → `state = state.copyWith(insurancePlanId: planId)`.
- **When the selected vehicle changes** (around line 108), clear
  `insurancePlanId` if the new vehicle's options don't contain it. A plan can
  be limited to some vehicles; the server refuses a mismatched one with 400.
- When quotes are refreshed (route or stops changed), do the same check.
- `copyWith` needs a way to set `insurancePlanId` back to null (sentinel or a
  `clearInsurance` flag), since `null` usually means "keep".

## 3. Booking — `POST /taxi/rides`

Add one optional field:

```dart
Future<RideModel> createRide({
  // ...existing params
  String? insurancePlanId,
}) async {
  final data = await api.post(ApiConstants.rides, data: {
    // ...existing body
    if (insurancePlanId != null && insurancePlanId.isNotEmpty) 'insurancePlanId': insurancePlanId,
  });
```

and pass `insurancePlanId: state.insurancePlanId` from the controller's
`createRide` call (around line 259).

**Error:** `400 "This insurance plan is not available for this ride"`. The
plan was switched off or doesn't cover this vehicle/zone. Show the message,
clear the selection, re-quote, and let the rider book again.

## 4. UI — `home/presentation/confirm_booking_screen.dart`

Below the fare, only when the selected vehicle has options:

```
┌──────────────────────────────────────────────┐
│ 🛡  Insure this ride                            │
│ ○ No insurance                                 │
│ ● Accident cover — ₹5                          │
│   Cover up to ₹1,00,000 · by ACKO · Terms ›    │
└──────────────────────────────────────────────┘
Total  ₹192   (₹187 fare + ₹5 insurance)
```

- One option → a switch ("Insure this ride — ₹5"). Several → radio list with
  "No insurance" first. Default is **off**. Don't pre-select; riders must opt in.
- Show `description` and `cover_amount` (format as ₹ with Indian grouping), and
  open `terms_url` in the browser when set.
- The total shown before booking = `fare.total` + selected `premium`.
- `ride_type_screen.dart` (vehicle list) can show a small "Insurance available"
  hint when a vehicle's list is non-empty. Optional.

## 5. The booked ride — `RideModel` (`ride/data/models/ride_model.dart`)

Ride payloads (booking response, socket updates, ride details, history) carry:

```json
"insurance": {
  "plan_id": "6700a...",
  "name": "Accident cover",
  "provider": "ACKO",
  "cover_amount": 100000,
  "premium": 5,
  "charged": false
}
```

`insurance` is `null` for an uninsured ride. Add:

```dart
final RideInsurance? insurance;
// RideInsurance: planId, name, provider, coverAmount, premium, charged
```

Amount the rider will pay / did pay:

```dart
double get payableFare =>
    (insurance != null && !insurance!.charged) ? fare + insurance!.premium : fare;
```

- `charged == false` (booked / on the way / ongoing): `fare` excludes the
  premium, so show `payableFare`.
- `charged == true` (completed): `fare` already includes it. Show `fare`, and
  break it out as a line: "Ride insurance (Accident cover) ₹5".

Use it in:
- `ride_tracking_screen.dart`: the fare chip, plus a "🛡 Insured" badge.
- `ride_completion_payment_sheet.dart`: nothing to add to the amount. The
  completion order is created from the server's `fare`, which already includes
  the premium. Only add the breakdown line.
- `ride_detail_screen.dart` / history: the badge, plus the line when `charged`.
- Cancelled ride: show the plan was not charged (`charged` stays false).

## 6. Test checklist

1. No plans in admin → no insurance section anywhere, booking unchanged.
2. Plan for all vehicles, flat ₹5 → offered on every vehicle; book → ride
   `insurance.premium == 5`, `fare` unchanged; complete → `fare` +5, `charged: true`.
3. Plan for Sedan only, 10% → offered on Sedan only with 10% of its fare;
   switch to Bike → selection cleared.
4. Select plan, admin switches it off, then book → 400 handled, selection cleared, re-quoted.
5. Insured ride cancelled → never charged.
6. Promo + insurance → promo lowers the fare, premium unchanged.
7. Cash ride → rider pays fare incl. premium to driver. (The driver's wallet is
   debited it; nothing to do in the app.)
8. Old app build (no `insurancePlanId`) books normally.
