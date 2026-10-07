/**
 * Support accepting an order from the admin panel, on the quick-commerce fork.
 *
 * Run: node tests/qc-admin-order-status.smoke.mjs
 *
 * The panel's Accept and Reject buttons both PATCH `/orders/:id/status`. The
 * food module has had that route all along; this fork had only `/accept` and
 * `/reject`, which no panel calls -- so every Accept on a quick-commerce order
 * answered 404 and the screen said "Failed to accept order".
 *
 * Pinned here: the route the panel actually calls exists; and, now that the
 * Medical vertical is gone, a LEGACY prescription order still in flight can
 * only be cancelled until its customer had agreed the bill -- nothing can price
 * or bill it any more -- while one already agreed goes through.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_admin_status' });

const BASE = '../src/modules/quickCommerce/modules/food';
const orderService = await import(`${BASE}/orders/services/order.service.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);
const { FoodRestaurantCommission } = await import(`${BASE}/admin/models/restaurantCommission.model.js`);
const adminRouter = (await import(`${BASE}/admin/routes/admin.routes.js`)).default;

const id = () => new mongoose.Types.ObjectId();
const zoneId = id();
const pharmacyId = id();
const userId = id();
const adminId = id();

// =============================================================================
console.log('\n[1] the route the admin panel calls');

/** Every path the router answers, with the methods it answers on. */
const routesOf = (router) => {
    const out = [];
    for (const layer of router?.stack || []) {
        if (layer?.route?.path) {
            out.push({
                path: layer.route.path,
                methods: Object.keys(layer.route.methods || {}),
            });
        }
    }
    return out;
};

const routes = routesOf(adminRouter);

await check('THE BUG: PATCH /orders/:orderId/status exists', () => {
    const row = routes.find((r) => r.path === '/orders/:orderId/status');
    assert.ok(row, 'the panel PATCHes this and got a 404');
    assert.ok(row.methods.includes('patch'), `answers ${row.methods.join(', ')}`);
});

await check('the older /accept and /reject are still answered', () => {
    for (const path of ['/orders/:orderId/accept', '/orders/:orderId/reject']) {
        assert.ok(routes.find((r) => r.path === path), `${path} is gone`);
    }
});

// =============================================================================
console.log('\n[2] a legacy prescription order, accepted by support');

await QCZone.collection.insertOne({
    _id: zoneId,
    name: 'Central',
    isActive: true,
    coordinates: [
        { latitude: 12.8, longitude: 77.5 },
        { latitude: 12.8, longitude: 77.8 },
        { latitude: 13.1, longitude: 77.8 },
        { latitude: 13.1, longitude: 77.5 },
    ],
});
await FoodRestaurant.collection.insertOne({
    _id: pharmacyId,
    restaurantName: 'City Pharmacy',
    status: 'approved',
    storeType: 'pharmacy',
    zoneId,
    isActive: true,
    isAcceptingOrders: true,
    location: { type: 'Point', coordinates: [77.6, 12.9], latitude: 12.9, longitude: 77.6 },
});
await FoodFeeSettings.create({
    deliveryFee: 30, deliveryFeeRanges: [], platformFee: 10, gstRate: 5, isActive: true,
});
await FoodRestaurantCommission.create({
    restaurantId: pharmacyId, defaultCommission: { type: 'percentage', value: 10 }, status: true,
});

const address = {
    street: '1 MG Road', city: 'Bengaluru', state: 'KA', phone: '9000000000',
    latitude: 12.95, longitude: 77.62,
    location: { type: 'Point', coordinates: [77.62, 12.95] },
};

/** A prescription order as the removed Medical vertical left it in qc_orders. */
const legacyOrder = async (bill, extra = {}) => {
    const _id = id();
    await FoodOrder.collection.insertOne({
        _id,
        order_id: `MED-${String(_id).slice(-8)}`,
        userId,
        restaurantId: pharmacyId,
        zoneId,
        prescriptionOnly: true,
        prescription: { required: true, status: 'approved', imageUrl: 'https://cdn.example/rx/1.jpg', bill },
        items: [],
        deliveryAddress: address,
        customerName: 'Asha',
        pricing: { subtotal: 0, total: 0, currency: 'INR' },
        payment: { method: 'cash', status: 'cod_pending' },
        orderStatus: 'created',
        createdAt: new Date(),
        ...extra,
    });
    return String(_id);
};

const accept = (orderId) => orderService.updateOrderStatusAdmin(
    orderId, 'confirmed', 'Order accepted by admin', String(adminId),
);

await check('refused while the customer never agreed a bill', async () => {
    const orderId = await legacyOrder({ status: 'submitted', amount: 240 });
    await assert.rejects(() => accept(orderId), /can no longer be fulfilled/);
});

await check('  and the reason is a sentence, not a 404', async () => {
    const orderId = await legacyOrder({ status: 'none' });
    const err = await accept(orderId).catch((e) => e);
    assert.equal(err.name, 'ValidationError');
    assert.ok(err.message.length > 20, err.message);
});

await check('accepted when the customer had approved the bill', async () => {
    const orderId = await legacyOrder(
        { status: 'approved', amount: 240 },
        {
            items: [{ itemId: id(), name: 'Medicines (as billed)', price: 240, quantity: 1 }],
            pricing: { subtotal: 240, total: 280, currency: 'INR' },
        },
    );
    const order = await accept(orderId);
    assert.ok(order, 'nothing came back');
    const stored = await FoodOrder.findById(orderId).lean();
    assert.equal(stored.orderStatus, 'confirmed');
});

// =============================================================================
console.log('\n[3] cancelling is never gated');

await check('support can cancel a legacy prescription order nobody priced', async () => {
    const orderId = await legacyOrder({ status: 'none' });
    await orderService.updateOrderStatusAdmin(
        orderId, 'cancelled_by_admin', 'Medical service removed', String(adminId),
    );
    const stored = await FoodOrder.findById(orderId).lean();
    assert.equal(stored.orderStatus, 'cancelled_by_admin');
});

// =============================================================================
console.log('\n[4] an ordinary catalogue order is untouched by any of this');

await check('support accepts a normal order with no prescription', async () => {
    const plain = await FoodOrder.create({
        userId: id(),
        restaurantId: pharmacyId,
        zoneId,
        items: [{ itemId: id(), name: 'Bread', price: 30, quantity: 1 }],
        deliveryAddress: address,
        customerName: 'Asha',
        customerPhone: '9000000000',
        pricing: { subtotal: 30, total: 30, currency: 'INR' },
        payment: { method: 'cash', status: 'cod_pending' },
        orderStatus: 'created',
    });
    await orderService.updateOrderStatusAdmin(
        String(plain._id), 'confirmed', 'Accepted by admin', String(adminId),
    );
    const stored = await FoodOrder.findById(plain._id).lean();
    assert.equal(stored.orderStatus, 'confirmed');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
