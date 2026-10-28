/**
 * A small food world for the order smoke tests: an in-memory Mongo, the
 * platform's fee settings, one restaurant with a Rs 200 dish, one rider online,
 * and helpers that drive the REAL validators and services the way the apps call
 * them: /calculate first, then placement echoing back the quoted `pricing`.
 *
 * The numbers every test can lean on, for the Rs 200 dish on cash:
 *
 *   food 200 + GST 5% 10 + delivery 30 + platform fee 10 + its 18% GST 1.80
 *   = 251.80, rounded to Rs 252. The rider is paid the Rs 30 delivery share.
 *
 * Not a test itself; imported by the food-*.smoke.mjs files.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

export const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

export function makeChecker() {
    let pass = 0;
    let fail = 0;
    const check = (label, cond, detail = '') => {
        if (cond) pass += 1;
        else fail += 1;
        console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail !== '' ? `   [${detail}]` : ''}`);
    };
    return {
        check,
        summary() {
            console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
            return fail;
        },
    };
}

/** Runs fn and returns the error it threw, or null. */
export async function thrownBy(fn) {
    try {
        await fn();
        return null;
    } catch (err) {
        return err;
    }
}

export const ADDRESS = Object.freeze({
    label: 'Home',
    street: '1 Test Rd',
    city: 'Palampur',
    state: 'HP',
    location: { type: 'Point', coordinates: [76.539, 32.115] },
});

export async function startFoodWorld(dbName) {
    // Set before anything imports the config. dotenv never overrides a variable
    // that is already set, so a real gateway key in .env cannot be picked up:
    // this fake one gets an authentication failure, and outside production the
    // helper then falls back to a mock order.
    process.env.NODE_ENV = 'test';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_smoke_fixture';
    process.env.RAZORPAY_KEY_SECRET = 'smoke_fixture_secret';

    const mem = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mem.getUri(dbName);
    await mongoose.connect(mem.getUri(dbName));

    const src = '../src';
    const m = {
        FoodItem: (await import(`${src}/modules/food/admin/models/food.model.js`)).FoodItem,
        FoodRestaurant: (await import(`${src}/modules/food/restaurant/models/restaurant.model.js`)).FoodRestaurant,
        FoodFeeSettings: (await import(`${src}/modules/food/admin/models/feeSettings.model.js`)).FoodFeeSettings,
        FoodDeliveryCommissionRule: (await import(`${src}/modules/food/admin/models/deliveryCommissionRule.model.js`)).FoodDeliveryCommissionRule,
        FoodUser: (await import(`${src}/core/users/user.model.js`)).FoodUser,
        FoodDeliveryPartner: (await import(`${src}/modules/food/delivery/models/deliveryPartner.model.js`)).FoodDeliveryPartner,
        FoodOrder: (await import(`${src}/modules/food/orders/models/order.model.js`)).FoodOrder,
        FoodTransaction: (await import(`${src}/modules/food/orders/models/foodTransaction.model.js`)).FoodTransaction,
        FoodOffer: (await import(`${src}/modules/food/admin/models/offer.model.js`)).FoodOffer,
        FoodOfferUsage: (await import(`${src}/modules/food/admin/models/offerUsage.model.js`)).FoodOfferUsage,
        FoodAddon: (await import(`${src}/modules/food/restaurant/models/foodAddon.model.js`)).FoodAddon,
        FoodFreebieOffer: (await import(`${src}/modules/food/admin/models/freebieOffer.model.js`)).FoodFreebieOffer,
    };
    const validators = await import(`${src}/modules/food/orders/validators/order.validator.js`);
    const pricing = await import(`${src}/modules/food/orders/services/order-pricing.service.js`);
    const orderService = await import(`${src}/modules/food/orders/services/order.service.js`);
    const ledger = await import(`${src}/modules/food/orders/services/foodTransaction.service.js`);
    const wallet = await import(`${src}/modules/food/user/services/userWallet.service.js`);

    await m.FoodFeeSettings.create({
        deliveryFeeComputationMode: 'distance_order_value',
        platformFee: 10,
        gstRate: 5,
        platformFeeGstRate: 18,
        codOrderLimit: 5000,
        isActive: true,
    });
    await m.FoodDeliveryCommissionRule.create({
        name: 'base', minDistance: 0, maxDistance: null,
        userDeliveryFee: 30, commissionPerKm: 0, basePayout: 0, status: true,
    });
    const restaurant = await m.FoodRestaurant.create({
        restaurantName: 'Smoke Kitchen',
        ownerName: 'Owner',
        status: 'approved',
        location: { type: 'Point', coordinates: [76.5359, 32.1095] },
    });
    // COD is refused with nobody online to collect the cash.
    const rider = await m.FoodDeliveryPartner.create({
        name: 'Rider', phone: '9000000099', availabilityStatus: 'online',
    });

    const makeDish = (overrides = {}) => m.FoodItem.create({
        restaurantId: restaurant._id,
        categoryId: new mongoose.Types.ObjectId(),
        categoryName: 'T',
        name: 'Paneer Tikka',
        price: 200,
        basePrice: overrides.price ?? 200,
        discountPercent: 0,
        variantsEnabled: false,
        variants: [],
        foodType: 'Veg',
        isAvailable: true,
        approvalStatus: 'approved',
        ...overrides,
    });
    const dish = await makeDish();

    let phoneSeq = 9100000000;
    const makeUser = () => {
        phoneSeq += 1;
        return m.FoodUser.create({ phone: String(phoneSeq), name: 'Buyer', addresses: [{ ...ADDRESS }] });
    };

    /** A cart line as both apps send it: id, name, the price they showed, quantity. */
    const appLine = (item, extra = {}) => ({
        itemId: String(item._id), name: item.name, price: item.price, quantity: 1, ...extra,
    });

    /** POST /food/orders/calculate, through its validator. */
    const quote = async (userId, body) => {
        const dto = validators.validateCalculateOrderDto({
            restaurantId: String(restaurant._id), deliveryAddress: ADDRESS, ...body,
        });
        return (await pricing.calculateOrderPricing(String(userId), dto)).pricing;
    };

    /** POST /food/orders, through its validator. Defaults to cash. */
    const place = async (userId, body) => {
        const dto = validators.validateCreateOrderDto({
            restaurantId: String(restaurant._id),
            address: { ...ADDRESS },
            customerName: 'Buyer',
            customerPhone: '9000000001',
            paymentMethod: 'cash',
            ...body,
        });
        return orderService.createOrder(String(userId), dto);
    };

    /** The saved order behind a createOrder result. */
    const saved = (res) => m.FoodOrder.findById(res?.order?._id ?? res?.order?.id).lean();

    const stop = async () => {
        await mongoose.disconnect();
        await mem.stop();
    };

    return {
        m, validators, pricing, orderService, ledger, wallet,
        restaurant, rider, dish, makeDish, makeUser, appLine, quote, place, saved, stop,
    };
}
