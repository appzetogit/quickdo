/**
 * The customer's bill, end to end: pricing, the saved order, and the payout ledger.
 *
 * The bill is the one screen an arithmetic slip is visible on to every customer
 * on every order, so this drives the real pricing call rather than the pure
 * maths, and then a real save, because several of the figures only survive if
 * the order schema declares them -- it is strict, and silently drops what it
 * does not know.
 *
 * What it holds to account:
 *
 *   - every line printed adds up to the total charged;
 *   - the food and its packaging are taxed; the delivery fee, the surge and the
 *     tip are the rider's money and are not;
 *   - a GST-inclusive restaurant has its tax EXTRACTED from the listed price
 *     rather than added to it -- 5% of 200 is 10, but the 5% inside 200 is
 *     9.52, and the wrong one of those overstates tax on every dish;
 *   - commission is charged on the listed food net of that tax, and never on
 *     the packaging or the rider's money;
 *   - the payout ledger credits the restaurant only what it actually earned,
 *     including not crediting it a packaging charge the platform kept.
 *
 * Run:  node tests/gst.pricing.smoke.mjs
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mem = await MongoMemoryServer.create();
process.env.MONGODB_URI = mem.getUri("gsttest");
process.env.NODE_ENV = "test";
await mongoose.connect(mem.getUri("gsttest"));

const { FoodItem } = await import("../src/modules/food/admin/models/food.model.js");
const { FoodRestaurant } = await import("../src/modules/food/restaurant/models/restaurant.model.js");
const { FoodFeeSettings } = await import("../src/modules/food/admin/models/feeSettings.model.js");
const pricing = await import("../src/modules/food/orders/services/order-pricing.service.js");
const { billAddsUp } = await import("../src/modules/food/shared/billing.js");
const { FoodOrder } = await import("../src/modules/food/orders/models/order.model.js");
const { FoodUser } = await import("../src/core/users/user.model.js");
const { createInitialTransaction, getRestaurantCommissionSnapshot } = await import(
  "../src/modules/food/orders/services/foodTransaction.service.js"
);

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  if (c) { pass++; console.log(`    PASS  ${n.padEnd(54)}${d}`); }
  else { fail++; console.log(`    FAIL  ${n.padEnd(54)}${d}`); }
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const GST = 5;

const settings = await FoodFeeSettings.create({
  deliveryFeeComputationMode: "distance_order_value",
  deliveryFee: 25,
  platformFee: 10,
  gstRate: GST,
  platformFeeGstRate: 18,
  isActive: true,
});

const setPackaging = (packagingCharge) =>
  FoodFeeSettings.updateOne({ _id: settings._id }, { $set: { packagingCharge } });

const make = async (label, priceIncludesGst, itemPackaging = 0) => {
  const r = await FoodRestaurant.create({
    restaurantName: `T ${label}`,
    ownerName: "Test Owner",
    status: "approved",
    priceIncludesGst,
    location: { type: "Point", coordinates: [76.5359, 32.1095] },
  });
  const dish = await FoodItem.create({
    restaurantId: r._id, categoryId: new mongoose.Types.ObjectId(), categoryName: "T",
    name: `dish ${label}`, price: 200, basePrice: 200, discountPercent: 0,
    variantsEnabled: false, variants: [], foodType: "Veg", isAvailable: true,
    approvalStatus: "approved",
    packagingCharge: itemPackaging > 0 ? { isEnabled: true, amount: itemPackaging } : undefined,
  });
  return { r, dish };
};

const priceIt = async (label, x, extra = {}) => {
  const out = await pricing.calculateOrderPricing(String(new mongoose.Types.ObjectId()), {
    restaurantId: String(x.r._id),
    items: [{ itemId: String(x.dish._id), quantity: 1 }],
    deliveryAddress: { address: "T", location: { type: "Point", coordinates: [76.5390, 32.1150] } },
    orderType: "delivery", paymentMethod: "cod", tip: 10,
    ...extra,
  });
  const p = out.pricing;
  const b = p.bill;
  console.log(`\n  --- ${label} ---`);
  console.log("    prices include GST :", b.pricesIncludeGst);
  console.log("    Item amount        :", b.netItemAmount);
  console.log("    Packaging charges  :", b.netPackagingFee, `(${p.packagingMode || "off"})`);
  console.log(`    GST @ ${b.gstRate}%           :`, b.gstOnItems);
  console.log("    Delivery fee       :", b.deliveryFee);
  console.log("    Surge fee          :", b.surgeAmount);
  console.log("    Platform fee       :", b.platformFee, "+", b.platformFeeGst, "govt");
  console.log("    Tip                :", b.tip);
  console.log("    Round off          :", b.roundOff);
  console.log("    GRAND TOTAL        :", b.grandTotal);
  console.log("    commission base    :", p.commissionableAmount, " subtotal:", p.subtotal);
  return p;
};

/** Save an order the way order.service.js does, and read it back. */
const saveAndReload = async (r, p, overrides = {}) => {
  const doc = await FoodOrder.create({
    userId: new mongoose.Types.ObjectId(),
    restaurantId: r._id,
    items: [{ itemId: "x", name: "dish", price: 200, quantity: 1 }],
    deliveryAddress: { street: "1 Test Rd", city: "Palampur", state: "HP" },
    pricing: {
      subtotal: p.subtotal, tax: p.tax, total: p.total,
      packagingFee: p.packagingFee, deliveryFee: p.deliveryFee,
      platformFee: p.platformFee, surgeAmount: p.surgeAmount, discount: p.discount,
      bill: p.bill,
      commissionableAmount: p.commissionableAmount,
      pricesIncludeGst: p.pricesIncludeGst,
      packagingMode: p.packagingMode,
      netItemAmount: p.netItemAmount,
      netPackagingFee: p.netPackagingFee,
      gstRate: p.gstRate,
      platformFeeGst: p.platformFeeGst,
      platformFeeGstRate: p.platformFeeGstRate,
      tip: p.tip, roundOff: p.roundOff, totalBeforeTip: p.totalBeforeTip,
      ...overrides,
    },
    payment: { method: "cash", status: "cod_pending" },
  });
  return FoodOrder.findById(doc._id).lean();
};

try {
  // =====================================================================
  console.log("\n  ===== 1. inclusive vs exclusive, no packaging =====");
  const exc = await make("exclusive", false);
  const inc = await make("inclusive", true);

  const e = await priceIt("EXCLUSIVE  (every restaurant's default)", exc);
  const i = await priceIt("INCLUSIVE", inc);

  console.log("");
  check("exclusive: tax added on top", e.bill.netItemAmount === 200 && e.bill.gstOnItems === 10,
    `${e.bill.netItemAmount} + ${e.bill.gstOnItems}`);
  check("inclusive: tax taken out of the price",
    i.bill.netItemAmount === 190.48 && i.bill.gstOnItems === 9.52,
    `${i.bill.netItemAmount} + ${i.bill.gstOnItems}`);
  check("inclusive: net + tax is the listed 200", near(i.bill.netItemAmount + i.bill.gstOnItems, 200));
  check("extraction is not 5% of the gross", i.bill.gstOnItems !== e.bill.gstOnItems, "9.52 vs 10");
  check("the inclusive customer pays the tax less",
    e.bill.grandTotal - i.bill.grandTotal === 10, `${e.bill.grandTotal} - ${i.bill.grandTotal}`);
  check("both bills reconcile", billAddsUp(e.bill) && billAddsUp(i.bill));
  check("subtotal keeps its old meaning for both", e.subtotal === 200 && i.subtotal === 200);
  check("commission base: the listed food when exclusive", e.commissionableAmount === 200,
    `${e.commissionableAmount}`);
  check("commission base: the net when inclusive", i.commissionableAmount === 190.48,
    `${i.commissionableAmount}`);

  // =====================================================================
  console.log("\n  ===== 2. the restaurant's own packaging charge =====");
  await setPackaging({ isEnabled: true, mode: "RESTAURANT", adminChargePerOrder: 0 });
  const excPack = await make("exclusive+pack", false, 20);
  const incPack = await make("inclusive+pack", true, 21);

  const ep = await priceIt("EXCLUSIVE, Rs 20 packaging", excPack);
  const ip = await priceIt("INCLUSIVE, Rs 21 packaging", incPack);

  console.log("");
  check("packaging is its own line, not folded into the food",
    ep.bill.netItemAmount === 200 && ep.bill.netPackagingFee === 20,
    `${ep.bill.netItemAmount} + ${ep.bill.netPackagingFee}`);
  check("food and packaging are one supply: 5% of 220", ep.bill.gstOnItems === 11,
    `${ep.bill.gstOnItems}`);
  check("an inclusive restaurant's packaging is inclusive too",
    ip.bill.netPackagingFee === 20, `${ip.bill.netPackagingFee} out of 21`);
  check("the inclusive customer pays exactly what was listed",
    near(ip.bill.netItemAmount + ip.bill.netPackagingFee + ip.bill.gstOnItems, 221),
    "200 + 21");
  check("commission is NOT charged on the packaging",
    ep.commissionableAmount === 200 && ip.commissionableAmount === 190.48,
    `${ep.commissionableAmount} / ${ip.commissionableAmount}`);
  check("both packaging bills reconcile", billAddsUp(ep.bill) && billAddsUp(ip.bill));

  // =====================================================================
  console.log("\n  ===== 3. the platform's flat packaging charge =====");
  await setPackaging({ isEnabled: true, mode: "ADMIN", adminChargePerOrder: 21 });
  const ap = await priceIt("INCLUSIVE restaurant, ADMIN packaging", incPack);
  console.log("");
  // Business rule 2026-09-29: an inclusive restaurant's packaging -- whoever
  // set it -- has no GST added on top; the tax is inside it, like the food's.
  check("packaging on an inclusive restaurant has its GST inside it",
    near(ap.bill.netPackagingFee, 20), `${ap.bill.netPackagingFee}`);
  check("so the tax is extracted from both the food and the packaging",
    near(ap.bill.gstOnItems, 9.52 + 1), `${ap.bill.gstOnItems}`);
  check("a bill that mixes the two still reconciles", billAddsUp(ap.bill));

  // =====================================================================
  console.log("\n  ===== 4. what the order actually stores =====");
  await setPackaging({ isEnabled: true, mode: "RESTAURANT", adminChargePerOrder: 0 });
  const ip2 = await priceIt("INCLUSIVE, Rs 21 packaging (again)", incPack);
  const back = await saveAndReload(incPack.r, ip2);
  const sp = back.pricing || {};
  console.log("");
  console.log("    stored bill        :", sp.bill ? "yes" : "MISSING");
  console.log("    commission base    :", sp.commissionableAmount);
  console.log("    packaging mode     :", sp.packagingMode);
  console.log("    net item / packing :", sp.netItemAmount, "/", sp.netPackagingFee);
  console.log("    tip / roundOff     :", sp.tip, "/", sp.roundOff);
  console.log("");
  check("the bill survives the save", sp.bill?.grandTotal === ip2.bill.grandTotal,
    `grandTotal ${sp.bill?.grandTotal}`);
  check("the stored bill still reconciles", billAddsUp(sp.bill || {}));
  check("the commission base survives the save", sp.commissionableAmount === 190.48,
    `${sp.commissionableAmount}`);
  check("pricesIncludeGst survives the save", sp.pricesIncludeGst === true);
  check("packagingMode survives the save", sp.packagingMode === "RESTAURANT", `${sp.packagingMode}`);
  check("the printed net lines survive the save",
    sp.netItemAmount === 190.48 && sp.netPackagingFee === 20,
    `${sp.netItemAmount} / ${sp.netPackagingFee}`);

  const snap = await getRestaurantCommissionSnapshot({ restaurantId: incPack.r._id, pricing: sp });
  check("commission is charged on the net, not the gross", near(snap.baseAmount, 190.48),
    `base ${snap.baseAmount}`);

  // =====================================================================
  console.log("\n  ===== 5. the payout ledger =====");
  const txn = await createInitialTransaction(back);
  console.log("    restaurant share   :", txn?.amounts?.restaurantShare);
  check("the restaurant is credited the net food plus its own packaging",
    near(txn?.amounts?.restaurantShare, 190.48 + 20), `${txn?.amounts?.restaurantShare}`);

  const adminPacked = await saveAndReload(incPack.r, ip2, { packagingMode: "ADMIN" });
  const adminTxn = await createInitialTransaction(adminPacked);
  console.log("    with ADMIN packing :", adminTxn?.amounts?.restaurantShare);
  check("a platform-kept packaging charge is not credited to the restaurant",
    near(adminTxn?.amounts?.restaurantShare, 190.48), `${adminTxn?.amounts?.restaurantShare}`);
  console.log("    platform profit    :", txn?.amounts?.platformNetProfit,
    " (admin packing:", adminTxn?.amounts?.platformNetProfit, ")");
  check("the platform keeps the packaging only in admin mode",
    near(adminTxn?.amounts?.platformNetProfit - txn?.amounts?.platformNetProfit, 20),
    `${adminTxn?.amounts?.platformNetProfit} vs ${txn?.amounts?.platformNetProfit}`);
  // Every rupee the customer paid is credited to somebody: the restaurant, the
  // rider, the platform, or the government. A split that does not add back up
  // to what was charged is money the ledger has invented or lost.
  // The bill's round-off is no longer a loose remainder added on here -- the
  // customer pays it and the ledger credits it to the platform, so it arrives
  // inside platformNetProfit.
  const a = txn?.amounts || {};
  const b = ip2.bill;
  const accounted = a.restaurantShare + a.riderShare + a.platformNetProfit
    + b.gstOnItems + b.platformFeeGst;
  console.log("    rider share (tip)  :", a.riderShare);
  console.log("    accounted for      :", Math.round(accounted * 100) / 100,
    "of", b.grandTotal);
  check("the tip reaches the rider", near(a.riderTipPay, 10), `${a.riderTipPay}`);
  check("every rupee charged is credited to somebody",
    near(accounted, b.grandTotal), `${Math.round(accounted * 100) / 100} vs ${b.grandTotal}`);

  // The coupon the ledger needs before it can attribute a discount to anyone.
  const coupon = await saveAndReload(exc.r, e, {
    discount: 50, couponCode: "SAVE50", appliedCoupon: { code: "SAVE50" },
  });
  console.log("    stored couponCode  :", coupon.pricing?.couponCode ?? "DROPPED");
  check("the coupon survives the save, so a discount can be attributed",
    coupon.pricing?.couponCode === "SAVE50", `${coupon.pricing?.couponCode}`);

  // =====================================================================
  console.log("");
  console.log("  ===== the order is CHARGED what the bill says =====");
  // createOrder re-derives pricing.total after pricing has run. Anything that
  // sum forgets is money the customer is not charged -- or is charged twice.
  const { createOrder } = await import("../src/modules/food/orders/services/order.service.js");
  // COD is refused with nobody online to collect the cash.
  const { FoodDeliveryPartner } = await import(
    "../src/modules/food/delivery/models/deliveryPartner.model.js"
  );
  await FoodDeliveryPartner.create({
    name: "Rider", phone: "9000000099", availabilityStatus: "online",
  });
  // The rider's cash limit comes from codOrderLimit; without one, COD is refused.
  await FoodFeeSettings.updateOne({ _id: settings._id }, { $set: { codOrderLimit: 5000 } });
  const buyer = await FoodUser.create({
    phone: "9000000009", name: "Buyer",
    addresses: [{ label: "Home", street: "1 Test Rd", city: "Palampur", state: "HP",
      location: { type: "Point", coordinates: [76.5390, 32.1150] } }],
  });

  for (const [label, r] of [["EXCLUSIVE", exc], ["INCLUSIVE", inc]]) {
    const quoted = await pricing.calculateOrderPricing(String(buyer._id), {
      restaurantId: String(r.r._id),
      items: [{ itemId: String(r.dish._id), quantity: 1 }],
      deliveryAddress: { address: "T", location: { type: "Point", coordinates: [76.5390, 32.1150] } },
      orderType: "delivery", paymentMethod: "cod", tip: 10,
    });
    const created = await createOrder(String(buyer._id), {
      restaurantId: String(r.r._id),
      items: [{ itemId: String(r.dish._id), quantity: 1 }],
      address: { label: "Home", street: "1 Test Rd", city: "Palampur", state: "HP",
        location: { type: "Point", coordinates: [76.5390, 32.1150] } },
      customerName: "Buyer", customerPhone: "9000000009",
      paymentMethod: "cash", pricing: quoted.pricing, tip: 10,
    });
    const order = created?.order || created;
    const sp = order.pricing || {};
    console.log(`    ${label.padEnd(12)} quoted ${String(quoted.pricing.bill.grandTotal).padStart(8)}` +
      `   saved ${String(sp.total).padStart(8)}   amountDue ${order.payment?.amountDue}`);
    check(`${label}: the saved total is the quoted grand total`,
      near(sp.total, quoted.pricing.bill.grandTotal),
      `${sp.total} vs ${quoted.pricing.bill.grandTotal}`);
    check(`${label}: the customer is asked for that same amount`,
      near(order.payment?.amountDue, quoted.pricing.bill.grandTotal),
      `${order.payment?.amountDue}`);
    check(`${label}: the stored bill agrees with the stored total`,
      near(sp.bill?.grandTotal, sp.total), `${sp.bill?.grandTotal} vs ${sp.total}`);
    check(`${label}: the tip the customer chose survives to the order`,
      near(sp.tip, 10), `${sp.tip}`);
  }

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
