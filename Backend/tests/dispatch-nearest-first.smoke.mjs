/**
 * Food dispatch searches 15 km first: a rider 30 km away is not offered an
 * order while one 5 km away is online (no zones set up).
 * Run: node tests/dispatch-nearest-first.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'dispatch_near' });
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { __testables } = await import('../src/modules/food/orders/services/order-dispatch.service.js');

const at = [75.88, 22.72];
const r = await FoodRestaurant.create({ restaurantName: 'R', ownerName: 'O', status: 'approved', location: { type: 'Point', coordinates: at } });
const now = new Date();
const near = await FoodDeliveryPartner.create({ name: 'Near', phone: '9600000001', status: 'approved', availabilityStatus: 'online', lastLat: 22.72 + 0.045, lastLng: 75.88, lastLocationAt: now });
const far = await FoodDeliveryPartner.create({ name: 'Far', phone: '9600000002', status: 'approved', availabilityStatus: 'online', lastLat: 22.72 + 0.27, lastLng: 75.88, lastLocationAt: now });

let failed = 0;
try {
  const { partners } = await __testables.listNearbyOnlineDeliveryPartners(r._id, { maxKm: 15 });
  const ids = partners.map((p) => String(p.partnerId));
  assert.ok(ids.includes(String(near._id)), `near rider missing: ${JSON.stringify(partners)}`);
  assert.ok(!ids.includes(String(far._id)), `30 km rider offered at the 15 km step: ${JSON.stringify(partners)}`);
  console.log('  PASS  15 km step offers the 5 km rider, not the 30 km one');
} catch (e) { failed = 1; console.log(`  FAIL  ${e.message}`); }

await mongoose.disconnect();
await server.stop();
console.log(failed ? '1 FAILED' : 'all nearest-first checks passed');
process.exit(failed);
