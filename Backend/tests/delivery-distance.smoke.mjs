/**
 * The delivery fee has to follow where the customer actually is.
 *
 * Two clients send the delivery address two different ways: the web sends the
 * whole address object, the Flutter app sends `deliveryAddressId` -- the id of
 * one of the user's saved addresses. Only the first was ever read, so every
 * cart priced from the app arrived with no coordinates, fell to the base
 * distance slab, and was quoted the same fee from 1 km as from 12. Free
 * delivery by radius could never qualify either, because an unmeasured
 * distance does not.
 *
 * It got worse at the end: `POST /food/orders` re-prices, and the app DOES send
 * a full address with coordinates there -- so the customer was shown the base
 * slab and charged the real one.
 *
 * Run:  node tests/delivery-distance.smoke.mjs
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mem = await MongoMemoryServer.create();
process.env.MONGODB_URI = mem.getUri("distest");
process.env.NODE_ENV = "test";
await mongoose.connect(mem.getUri("distest"));

const { FoodItem } = await import("../src/modules/food/admin/models/food.model.js");
const { FoodRestaurant } = await import("../src/modules/food/restaurant/models/restaurant.model.js");
const { FoodFeeSettings } = await import("../src/modules/food/admin/models/feeSettings.model.js");
const { FoodDeliveryCommissionRule } = await import(
  "../src/modules/food/admin/models/deliveryCommissionRule.model.js"
);
const { FoodUser } = await import("../src/core/users/user.model.js");
const pricing = await import("../src/modules/food/orders/services/order-pricing.service.js");

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  if (c) { pass++; console.log(`    PASS  ${n.padEnd(56)}${d}`); }
  else { fail++; console.log(`    FAIL  ${n.padEnd(56)}${d}`); }
};

// Palampur. The restaurant sits at the first point; the two customers are
// roughly 1 km and 9 km away.
const REST = [76.5359, 32.1095];
const NEAR = [76.5390, 32.1150];
const FAR = [76.6100, 32.1750];

await FoodFeeSettings.create({
  deliveryFeeComputationMode: "distance_order_value",
  platformFee: 10, gstRate: 5.6, platformFeeGstRate: 18, isActive: true,
});

// Two slabs that charge genuinely different money.
await FoodDeliveryCommissionRule.create([
  { name: "base", minDistance: 0, maxDistance: 3, userDeliveryFee: 20, commissionPerKm: 0, basePayout: 15, status: true },
  { name: "far", minDistance: 3, maxDistance: null, userDeliveryFee: 60, commissionPerKm: 0, basePayout: 40, status: true },
]);

const restaurant = await FoodRestaurant.create({
  restaurantName: "Distance Test", ownerName: "Owner", status: "approved",
  location: { type: "Point", coordinates: REST },
});
const dish = await FoodItem.create({
  restaurantId: restaurant._id, categoryId: new mongoose.Types.ObjectId(),
  categoryName: "T", name: "dish", price: 200, basePrice: 200, discountPercent: 0,
  variantsEnabled: false, variants: [], foodType: "Veg", isAvailable: true,
  approvalStatus: "approved",
});

const mkAddress = (coords, label) => ({
  label: "Home", street: `${label} street`, city: "Palampur", state: "HP",
  location: { type: "Point", coordinates: coords },
});

const user = await FoodUser.create({
  phone: "9000000001", name: "Test",
  addresses: [mkAddress(NEAR, "near"), mkAddress(FAR, "far")],
});
const nearId = String(user.addresses[0]._id);
const farId = String(user.addresses[1]._id);

const otherUser = await FoodUser.create({
  phone: "9000000002", name: "Other", addresses: [mkAddress(FAR, "someone else")],
});
const othersAddressId = String(otherUser.addresses[0]._id);

const priceIt = async (label, dtoExtra, asUser = user._id) => {
  const out = await pricing.calculateOrderPricing(String(asUser), {
    restaurantId: String(restaurant._id),
    items: [{ itemId: String(dish._id), quantity: 1 }],
    orderType: "delivery", paymentMethod: "cod",
    ...dtoExtra,
  });
  const p = out.pricing;
  const b = p.deliveryFeeBreakdown || {};
  console.log(
    `    ${label.padEnd(42)} fee ${String(p.deliveryFee).padStart(6)}  ` +
    `${String(b.distanceKm ?? "-").padStart(6)} km  slab ${b.distanceRange
      ? `${b.distanceRange.minDistance}-${b.distanceRange.maxDistance ?? "inf"}`
      : "-"}`,
  );
  return p;
};

try {
  console.log("\n  ===== the web's shape: a full address object =====");
  const webNear = await priceIt("address object, 1 km", { deliveryAddress: mkAddress(NEAR, "near") });
  const webFar = await priceIt("address object, 9 km", { deliveryAddress: mkAddress(FAR, "far") });
  console.log("");
  check("the web already prices by distance", webNear.deliveryFee !== webFar.deliveryFee,
    `${webNear.deliveryFee} vs ${webFar.deliveryFee}`);

  console.log("\n  ===== the app's shape: deliveryAddressId only =====");
  const appNear = await priceIt("deliveryAddressId, 1 km", { deliveryAddressId: nearId });
  const appFar = await priceIt("deliveryAddressId, 9 km", { deliveryAddressId: farId });
  console.log("");
  check("an id-only cart is priced by distance too",
    appNear.deliveryFee !== appFar.deliveryFee,
    `${appNear.deliveryFee} vs ${appFar.deliveryFee}`);
  check("the id resolves to the same fee as the object",
    appNear.deliveryFee === webNear.deliveryFee && appFar.deliveryFee === webFar.deliveryFee,
    `${appNear.deliveryFee}/${appFar.deliveryFee}`);
  check("the far cart lands in the far slab",
    appFar.deliveryFeeBreakdown?.distanceRange?.minDistance === 3,
    `min ${appFar.deliveryFeeBreakdown?.distanceRange?.minDistance}`);
  check("the distance is measured, not assumed",
    Number(appFar.deliveryFeeBreakdown?.distanceKm) > 3,
    `${appFar.deliveryFeeBreakdown?.distanceKm} km`);

  console.log("\n  ===== the distance the cart shows the customer =====");
  /*
   * Its own field on the pricing, because the cart prints it beside the
   * delivery fee. Digging it out of deliveryFeeBreakdown would have worked
   * only while the fee came from a distance slab -- a flat-fee platform or a
   * free-delivery order carries no breakdown, and a figure that appears and
   * disappears with the pricing rule is worse than none.
   */
  check("the pricing carries the distance in its own right",
    Number(appFar.distanceKm) > 3 && Number(appNear.distanceKm) < 3,
    `near ${appNear.distanceKm}, far ${appFar.distanceKm}`);
  check("  and it agrees with the figure the fee was computed from",
    Number(appFar.distanceKm) === Number(appFar.deliveryFeeBreakdown?.distanceKm),
    `${appFar.distanceKm} vs ${appFar.deliveryFeeBreakdown?.distanceKm}`);
  check("  rounded to something a person would read",
    /^\d+(\.\d{1,2})?$/.test(String(appFar.distanceKm)),
    `${appFar.distanceKm}`);

  /*
   * A restaurant with no saved coordinates cannot be measured from. The cart
   * must show nothing there rather than "0 km", which is a real answer meaning
   * the customer is standing in the restaurant.
   *
   * An address without coordinates does NOT reach this: the pricing falls back
   * to the customer's saved address, which has them. That fallback is checked
   * above; this is the case that genuinely cannot be measured.
   */
  const unplaced = await FoodRestaurant.create({
    restaurantName: "No Coordinates", ownerName: "Owner", status: "approved",
  });
  const unplacedDish = await FoodItem.create({
    restaurantId: unplaced._id, categoryId: new mongoose.Types.ObjectId(),
    categoryName: "T", name: "dish", price: 200, basePrice: 200, discountPercent: 0,
    variantsEnabled: false, variants: [], foodType: "Veg", isAvailable: true,
    approvalStatus: "approved",
  });
  const unmeasured = await pricing.calculateOrderPricing(String(user._id), {
    restaurantId: String(unplaced._id),
    items: [{ itemId: String(unplacedDish._id), quantity: 1 }],
    orderType: "delivery", paymentMethod: "cod",
    deliveryAddressId: nearId,
  });
  check("an unmeasurable trip reports null, not zero",
    unmeasured.pricing.distanceKm === null,
    `${unmeasured.pricing.distanceKm}`);

  console.log("\n  ===== the quote must match the charge =====");
  // What POST /food/orders does: re-price with the full address the app sends
  // in toOrderPayload. If the two disagree, the customer is charged something
  // other than what they agreed to.
  const atPlacement = await priceIt("re-priced at placement, 9 km",
    { address: mkAddress(FAR, "far"), deliveryAddressId: farId });
  console.log("");
  check("the checkout quote equals the placement charge",
    appFar.deliveryFee === atPlacement.deliveryFee,
    `${appFar.deliveryFee} vs ${atPlacement.deliveryFee}`);

  console.log("\n  ===== no address chosen yet: the default one, not nowhere =====");
  // The cart summary sends no address at all. Quoting a flat base-slab fee that
  // placement then contradicts is worse than quoting the address the customer
  // is almost certainly going to. This user's first address is the near one.
  const noAddress = await priceIt("no address at all", {});
  console.log("");
  check("an addressless cart is priced from the default address",
    noAddress.deliveryFee === appNear.deliveryFee, `${noAddress.deliveryFee}`);
  check("and its distance is measured, not zero",
    Number(noAddress.deliveryFeeBreakdown?.distanceKm) > 0,
    `${noAddress.deliveryFeeBreakdown?.distanceKm} km`);

  console.log("\n  ===== an id is not a way to price from someone else's door =====");
  const stranger = await priceIt("another user's address id", { deliveryAddressId: othersAddressId });
  console.log("");
  check("a stranger's id falls back to this user's own address",
    stranger.deliveryFee === appNear.deliveryFee, `${stranger.deliveryFee}`);
  check("and a junk id does not throw",
    (await priceIt("junk id", { deliveryAddressId: "not-an-id" })).deliveryFee >= 0);

  console.log("\n  ===== free delivery by radius can now qualify =====");
  await FoodFeeSettings.updateOne({}, {
    $set: { freeDeliveryRule: { isEnabled: true, maxDistanceKm: 3, minOrderAmount: 100 } },
  });
  const freeNear = await priceIt("1 km, 200 basket, 3 km/100 rule", { deliveryAddressId: nearId });
  const freeFar = await priceIt("9 km, 200 basket, 3 km/100 rule", { deliveryAddressId: farId });
  console.log("");
  check("the near cart gets its delivery waived", freeNear.deliveryFee === 0,
    `${freeNear.deliveryFee}, waived ${freeNear.deliveryFeeBreakdown?.waivedDeliveryFee}`);
  check("the far cart does not", freeFar.deliveryFee > 0, `${freeFar.deliveryFee}`);

} catch (err) {
  fail++;
  console.log("\n    UNCAUGHT: " + err.message);
  console.log((err.stack || "").split("\n").slice(1, 6).join("\n"));
} finally {
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  await mongoose.disconnect();
  await mem.stop();
  process.exit(fail ? 1 : 0);
}
