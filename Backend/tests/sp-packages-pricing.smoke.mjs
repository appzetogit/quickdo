/**
 * Service packages and vendor custom pricing (plan §3.4).
 *
 * Run: node tests/sp-packages-pricing.smoke.mjs
 *
 *  - admin package CRUD: validation, item names/prices from the catalogue,
 *    toggle, delete;
 *  - customer listing per category, only packages on sale (active, in window);
 *  - a booking with packageId is priced from the package on the server (the
 *    app's figures are ignored), items expanded into bookedItems that add up to
 *    the package price, dispatched on the package's category;
 *  - the commission engine resolves on the package price like any booking;
 *  - vendor custom prices: stored per vendor (the shared catalogue is never
 *    edited), used only with allowVendorCustomPricing, only for the preferred
 *    vendor, clamped to the admin bounds, locked on the booking, shown in
 *    GET /users/providers?serviceId=.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.SP_DISABLE_INVOICE_EMAIL = 'true';
const require = createRequire(import.meta.url);

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

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const res = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});
const call = async (fn, { params = {}, body = {}, query = {}, user = { id: String(oid()) }, userRole } = {}) => {
    const r = res();
    await fn({ params, body, query, user, userRole, app: { get: () => null } }, r);
    return r;
};
const near = (c, km) => ({ lat: c.lat + km / 111.32, lng: c.lng });

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_packages_pricing' });

    require('../src/modules/serviceProvider/models/index.js');
    const Settings = require('../src/modules/serviceProvider/models/Settings.js');
    const Worker = require('../src/modules/serviceProvider/models/Worker.js');
    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const Category = require('../src/modules/serviceProvider/models/Category.js');
    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const BookingRequest = require('../src/modules/serviceProvider/models/BookingRequest.js');
    const UserService = require('../src/modules/serviceProvider/models/UserService.js');
    const User = require('../src/modules/serviceProvider/models/User.js');
    const ServicePackage = require('../src/modules/serviceProvider/models/ServicePackage.js');
    const VendorService = require('../src/modules/serviceProvider/models/VendorService.js');
    const CommissionRule = require('../src/modules/serviceProvider/models/CommissionRule.js');
    for (const M of [Settings, Worker, Vendor, Category, Booking, BookingRequest, UserService, User, ServicePackage, VendorService, CommissionRule]) {
        await M.createCollection().catch(() => {});
    }
    await Worker.syncIndexes();
    await Vendor.syncIndexes();
    await VendorService.syncIndexes();

    const fakeIo = { to: () => ({ emit: () => {} }), emit: () => {} };
    const sockets = require('../src/modules/serviceProvider/sockets/index.js');
    sockets.getIO = () => fakeIo;

    const pkgCtl = require('../src/modules/serviceProvider/controllers/adminControllers/servicePackageController.js');
    const userCtl = require('../src/modules/serviceProvider/controllers/bookingControllers/userBookingController.js');
    const vendorSvcCtl = require('../src/modules/serviceProvider/controllers/vendorControllers/vendorServiceController.js');
    const settingsCtl = require('../src/modules/serviceProvider/controllers/adminControllers/settingsController.js');
    const providerSearch = require('../src/modules/serviceProvider/controllers/userControllers/providerSearchController.js');
    const { resolveCommission } = require('../src/modules/serviceProvider/utils/commission.js');
    const { clampCustomPrice, packagePricing } = require('../src/modules/serviceProvider/services/bookingPricing.js');

    await Settings.collection.insertOne({
        type: 'global', bookingModel: 'worker', searchRadius: 10, preferredProviderTimeoutSec: 60, waveDuration: 60,
        maxSearchTime: 30, serviceGstPercentage: 18, commissionThreshold: 1000, servicePayoutPercentage: 90
    });

    const center = { lat: 18.52, lng: 73.85 };
    const acCat = oid();
    const plumbCat = oid();
    await Category.collection.insertMany([
        { _id: acCat, title: 'AC Repair', slug: 'ac-repair' },
        { _id: plumbCat, title: 'Plumber', slug: 'plumber' }
    ]);
    const acService = oid();
    const gasService = oid();
    const filterAddOn = oid();
    await UserService.collection.insertMany([
        {
            _id: acService, brandId: oid(), categoryId: acCat, title: 'AC service', basePrice: 500, gstPercentage: 18, status: 'active',
            addOns: [{ _id: filterAddOn, name: 'Filter replacement', price: 200, gstPercentage: 18, maxQuantity: 2, isActive: true }]
        },
        { _id: gasService, brandId: oid(), categoryId: acCat, title: 'Gas top-up', basePrice: 1500, gstPercentage: 18, status: 'active' }
    ]);
    let phone = 9500000000;
    await Worker.collection.insertOne({
        _id: oid(), name: 'W', phone: String(phone++), approvalStatus: 'approved', isActive: true, status: 'ONLINE', isOnline: true,
        serviceCategories: ['AC Repair'], rating: 4, subscription: { isActive: true, expiryDate: new Date(Date.now() + 30 * DAY) },
        geoLocation: { type: 'Point', coordinates: [center.lng, center.lat] }
    });
    const userId = oid();
    await User.collection.insertOne({ _id: userId, name: 'Cust', phone: '9300000009', wallet: { balance: 0, penalty: 0 } });
    const user = { id: String(userId) };
    const address = { addressLine1: '1 Road', city: 'Pune', state: 'MH', pincode: '411001', lat: center.lat, lng: center.lng };
    const bookingBody = (over = {}) => ({
        address, scheduledDate: '2026-10-12', scheduledTime: '15:00', timeSlot: { start: '15:00', end: '16:00' },
        paymentMethod: 'pay_at_home', ...over
    });

    console.log('\nadmin packages');
    let pkgId;
    await check('create validates items, category and price', async () => {
        assert.equal((await call(pkgCtl.createPackage, { body: { title: 'X', categoryId: String(acCat), price: 100, items: [] } })).statusCode, 400);
        assert.equal((await call(pkgCtl.createPackage, { body: { title: 'X', categoryId: String(oid()), price: 100, items: [{ serviceId: String(acService) }] } })).statusCode, 400);
        assert.equal((await call(pkgCtl.createPackage, { body: { title: 'X', categoryId: String(acCat), price: -1, items: [{ serviceId: String(acService) }] } })).statusCode, 400);
        assert.equal((await call(pkgCtl.createPackage, { body: { title: 'X', categoryId: String(acCat), price: 100, items: [{ serviceId: String(gasService), addOnId: String(filterAddOn) }] } })).statusCode, 400, 'add-on of another service');
        assert.equal((await call(pkgCtl.createPackage, { body: { title: 'X', categoryId: String(acCat), price: 100, validFrom: '2026-10-10', validTo: '2026-10-01', items: [{ serviceId: String(acService) }] } })).statusCode, 400);
    });
    await check('create takes item names and prices from the catalogue', async () => {
        const r = await call(pkgCtl.createPackage, {
            body: {
                title: 'AC complete care', categoryId: String(acCat), price: 1800,
                items: [{ serviceId: String(acService) }, { serviceId: String(gasService) }, { serviceId: String(acService), addOnId: String(filterAddOn), quantity: 2, unitPrice: 1, name: 'ignored' }]
            }
        });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        pkgId = String(r.body.data._id);
        const items = r.body.data.items;
        assert.deepEqual(items.map((i) => i.name), ['AC service', 'Gas top-up', 'Filter replacement']);
        assert.deepEqual(items.map((i) => i.unitPrice), [500, 1500, 200]);
        assert.equal(r.body.data.catalogValue, 2400);
        assert.equal(r.body.data.savings, 600);
    });
    await check('update, toggle and list', async () => {
        const up = await call(pkgCtl.updatePackage, { params: { id: pkgId }, body: { description: 'Everything your AC needs' } });
        assert.equal(up.statusCode, 200, JSON.stringify(up.body));
        assert.equal(up.body.data.price, 1800, 'untouched fields kept');
        const off = await call(pkgCtl.togglePackage, { params: { id: pkgId }, body: { active: false } });
        assert.equal(off.body.data.active, false);
        const list = await call(pkgCtl.listPackages, { query: { categoryId: String(acCat) } });
        assert.equal(list.body.data.length, 1);
        await call(pkgCtl.togglePackage, { params: { id: pkgId }, body: { active: true } });
    });

    console.log('\ncustomer listing');
    let expiredId;
    await check('only packages on sale are listed, per category, with GST worked out', async () => {
        const later = await ServicePackage.create({ title: 'Next month', categoryId: acCat, price: 100, validFrom: new Date(Date.now() + 10 * DAY), items: [{ serviceId: acService, name: 'AC service', unitPrice: 500 }] });
        const expired = await ServicePackage.create({ title: 'Last month', categoryId: acCat, price: 100, validTo: new Date(Date.now() - DAY), items: [{ serviceId: acService, name: 'AC service', unitPrice: 500 }] });
        expiredId = String(expired._id);
        await ServicePackage.create({ title: 'Plumbing', categoryId: plumbCat, price: 300, items: [{ serviceId: acService, name: 'AC service', unitPrice: 500 }] });
        const r = await call(pkgCtl.listPackagesForCustomer, { query: { categoryId: String(acCat) } });
        assert.equal(r.statusCode, 200);
        assert.deepEqual(r.body.data.map((p) => p.title), ['AC complete care']);
        const p = r.body.data[0];
        assert.equal(p.gstPercentage, 18, 'Settings.serviceGstPercentage by default');
        assert.equal(p.tax, 324);
        assert.equal(p.totalWithGst, 2124);
        assert.equal(p.savings, 600);
        const all = await call(pkgCtl.listPackagesForCustomer, { query: {} });
        assert.equal(all.body.data.length, 2);
        assert.equal((await call(pkgCtl.listPackagesForCustomer, { query: { categoryId: 'nope' } })).statusCode, 400);
        await ServicePackage.deleteOne({ _id: later._id });
    });

    console.log('\npackage booking');
    let pkgBooking;
    await check('a booking with packageId is priced from the package, whatever the app sends', async () => {
        const r = await call(userCtl.createBooking, {
            body: bookingBody({ packageId: pkgId, amount: 1, basePrice: 1, tax: 0, discount: 0, promoCode: 'FREE', promoDiscount: 999 }),
            user
        });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.pricing.source, 'package');
        assert.equal(String(r.body.data.packageId), pkgId);
        pkgBooking = await Booking.findById(r.body.data._id).lean();
        assert.equal(pkgBooking.basePrice, 1800);
        assert.equal(pkgBooking.tax, 324);
        assert.equal(pkgBooking.finalAmount, 2124);
        assert.equal(pkgBooking.promoDiscount, 0, 'no unvalidated promo on a server price');
        assert.equal(String(pkgBooking.serviceId), String(acService), 'first item is the booking service');
        assert.equal(String(pkgBooking.categoryId), String(acCat));
    });
    await check('package items are expanded into bookedItems that add up to the package price', async () => {
        assert.equal(pkgBooking.bookedItems.length, 3);
        const sum = pkgBooking.bookedItems.reduce((s, i) => s + i.card.price * i.quantity, 0);
        assert.ok(Math.abs(sum - 1800) < 0.05, `items add up to ${sum}`);
        assert.equal(pkgBooking.bookedItems[2].quantity, 2);
        assert.equal(pkgBooking.bookedItems[0].brandName, 'AC complete care');
        assert.equal(pkgBooking.bookedItems[1].card.originalPrice, 1500);
    });
    await check('packagePricing splits odd amounts without losing a paisa', async () => {
        const p = packagePricing({ title: 'T', price: 100, items: [{ unitPrice: 1, quantity: 1 }, { unitPrice: 1, quantity: 1 }, { unitPrice: 1, quantity: 1 }] }, 18);
        assert.equal(Math.round(p.bookedItems.reduce((s, i) => s + i.card.price, 0) * 100), 10000);
    });
    await check('packages refuse add-ons, plan benefits, unknown and expired packages', async () => {
        assert.equal((await call(userCtl.createBooking, { body: bookingBody({ packageId: pkgId, addOns: [{ addOnId: String(filterAddOn) }] }), user })).statusCode, 400);
        assert.equal((await call(userCtl.createBooking, { body: bookingBody({ packageId: pkgId, paymentMethod: 'plan_benefit' }), user })).statusCode, 400);
        assert.equal((await call(userCtl.createBooking, { body: bookingBody({ packageId: String(oid()) }), user })).statusCode, 404);
        assert.equal((await call(userCtl.createBooking, { body: bookingBody({ packageId: expiredId }), user })).statusCode, 400);
    });
    await check('the commission engine resolves on the package price', async () => {
        await CommissionRule.create({ scope: 'global', type: 'percentage', value: 10, active: true });
        const snap = await resolveCommission(pkgBooking, { total: pkgBooking.finalAmount, base: pkgBooking.basePrice });
        assert.equal(snap.base, 1800);
        assert.equal(snap.model, 'commission', 'above the ₹1000 threshold');
        assert.equal(snap.amount, 180);
        await CommissionRule.deleteMany({});
    });
    await check('deleting a package leaves bookings made from it intact', async () => {
        const del = await call(pkgCtl.deletePackage, { params: { id: expiredId } });
        assert.equal(del.statusCode, 200);
        assert.equal((await Booking.findById(pkgBooking._id).lean()).basePrice, 1800);
    });

    console.log('\nvendor custom pricing');
    await Settings.updateOne({ type: 'global' }, { $set: { bookingModel: 'vendor' } });
    const vendor = async (name, at) => {
        const _id = oid();
        await Vendor.collection.insertOne({
            _id, name, businessName: name, phone: String(phone++), email: `${name}@t.test`, approvalStatus: 'approved', isActive: true,
            service: ['AC Repair'], rating: 4, address: { city: 'Pune' }, wallet: { dues: 0, cashLimit: 100000 },
            geoLocation: { type: 'Point', coordinates: [at.lng, at.lat] }, settings: { serviceRange: 10 }
        });
        return _id;
    };
    const cheap = await vendor('Cheap', near(center, 1));
    const plain = await vendor('Plain', near(center, 2));
    const vendorUser = { id: String(cheap) };

    await check('a vendor price is stored per vendor and never edits the catalogue', async () => {
        const r = await call(vendorSvcCtl.setServicePricing, { params: { serviceId: String(acService) }, body: { customPrice: 300 }, user: vendorUser });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(r.body.data.customPrice, 300);
        assert.equal(r.body.data.customPricingEnabled, false);
        assert.equal(r.body.data.effectivePrice, 500, 'catalogue price while the setting is off');
        assert.equal((await UserService.findById(acService).lean()).basePrice, 500, 'catalogue untouched');
        const row = await VendorService.findOne({ vendorId: cheap, serviceId: acService }).lean();
        assert.equal(row.customPrice, 300);
        assert.equal((await call(vendorSvcCtl.setServicePricing, { params: { serviceId: String(acService) }, body: { customPrice: -5 }, user: vendorUser })).statusCode, 400);
        const avail = await call(vendorSvcCtl.updateServiceAvailability, { params: { serviceId: String(acService) }, body: { isAvailable: true }, user: vendorUser });
        assert.equal(avail.statusCode, 200);
        assert.equal((await UserService.findById(acService).lean()).status, 'active', 'catalogue status untouched');
    });
    await check('with the setting off, a preferred vendor booking keeps the catalogue price', async () => {
        const r = await call(userCtl.createBooking, { body: bookingBody({ serviceId: String(acService), preferredProviderId: String(cheap) }), user });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.preferredOffer.status, 'offered');
        assert.equal(r.body.data.pricing.source, 'client');
        assert.ok(r.body.data.finalAmount >= 590 - 0.01, `floor at catalogue: ${r.body.data.finalAmount}`);
    });
    await check('settings validate the custom pricing bounds', async () => {
        const bad = await call(settingsCtl.updateSettings, { body: { vendorCustomPriceMinPct: 120, vendorCustomPriceMaxPct: 80 } });
        assert.equal(bad.statusCode, 400);
        const neg = await call(settingsCtl.updateSettings, { body: { vendorCustomPriceMinPct: -1 } });
        assert.equal(neg.statusCode, 400);
        const ok = await call(settingsCtl.updateSettings, { body: { allowVendorCustomPricing: true, vendorCustomPriceMinPct: 70, vendorCustomPriceMaxPct: '' } });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        const s = await Settings.findOne({ type: 'global' }).lean();
        assert.equal(s.allowVendorCustomPricing, true);
        assert.equal(s.vendorCustomPriceMinPct, 70);
        assert.equal(s.vendorCustomPriceMaxPct ?? null, null);
    });
    await check('clampCustomPrice applies the bounds', async () => {
        assert.equal(clampCustomPrice(300, 500, 70, null), 350);
        assert.equal(clampCustomPrice(900, 500, null, 150), 750);
        assert.equal(clampCustomPrice(450, 500, 70, 150), 450);
        assert.equal(clampCustomPrice(450, 500, null, null), 450);
    });
    await check('GET /users/providers?serviceId= shows each vendor\'s price', async () => {
        const r = await call(providerSearch.listProviders, { query: { categoryId: String(acCat), serviceId: String(acService), lat: String(center.lat), lng: String(center.lng) }, user });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const byId = new Map(r.body.data.map((p) => [String(p._id), p]));
        assert.equal(byId.get(String(cheap)).price, 350, '300 clamped to 70% of 500');
        assert.equal(byId.get(String(cheap)).priceSource, 'vendor_custom');
        assert.equal(byId.get(String(plain)).price, 500);
        assert.equal(byId.get(String(plain)).priceSource, 'catalog');
    });
    let lockedId;
    await check('booking the preferred vendor locks their price; the app\'s figures are ignored', async () => {
        const r = await call(userCtl.createBooking, {
            body: bookingBody({ serviceId: String(acService), preferredProviderId: String(cheap), amount: 5000, basePrice: 5000, tax: 900 }),
            user
        });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.pricing.source, 'vendor_custom');
        const b = await Booking.findById(r.body.data._id).lean();
        lockedId = b._id;
        assert.equal(b.basePrice, 350);
        assert.equal(b.tax, 63);
        // Visiting charges are added as on any booking (49 when the app sends a breakdown without them).
        assert.equal(b.finalAmount, 413 + b.visitingCharges);
        assert.equal(String(b.pricing.vendorId), String(cheap));
        assert.equal(b.pricing.lines[0].price, 350);
        assert.equal(b.pricing.lines[0].catalogPrice, 500);
    });
    await check('the locked price stays if the offer passes to another vendor', async () => {
        await Booking.updateOne({ _id: lockedId }, { $set: { vendorId: plain, 'preferredOffer.status': 'timed_out' } });
        const b = await Booking.findById(lockedId).lean();
        assert.equal(b.finalAmount - b.visitingCharges, 413);
        assert.equal(b.pricing.source, 'vendor_custom');
    });
    await check('a vendor without a custom price, or no preferred vendor, gets the catalogue path', async () => {
        const r1 = await call(userCtl.createBooking, { body: bookingBody({ serviceId: String(acService), preferredProviderId: String(plain) }), user });
        assert.equal(r1.body.data.pricing.source, 'client');
        assert.ok(r1.body.data.finalAmount >= 590 - 0.01);
        const r2 = await call(userCtl.createBooking, { body: bookingBody({ serviceId: String(acService) }), user });
        assert.equal(r2.body.data.pricing.source, 'client');
        assert.ok(r2.body.data.finalAmount >= 590 - 0.01);
    });
    await check('a service the vendor switched off is priced from the catalogue', async () => {
        await call(vendorSvcCtl.updateServiceAvailability, { params: { serviceId: String(acService) }, body: { isAvailable: false }, user: vendorUser });
        const r = await call(userCtl.createBooking, { body: bookingBody({ serviceId: String(acService), preferredProviderId: String(cheap) }), user });
        assert.equal(r.body.data.pricing.source, 'client');
        await call(vendorSvcCtl.updateServiceAvailability, { params: { serviceId: String(acService) }, body: { isAvailable: true }, user: vendorUser });
    });
    await check('vendor service list carries the vendor\'s price', async () => {
        const r = await call(vendorSvcCtl.getVendorServices, { query: {}, user: vendorUser });
        assert.equal(r.statusCode, 200);
        const ac = r.body.data.find((s) => String(s._id) === String(acService));
        assert.equal(ac.customPrice, 300);
        assert.equal(ac.effectivePrice, 350);
        assert.equal(ac.customPricingEnabled, true);
    });
    await check('a package price wins over a vendor\'s custom price', async () => {
        const r = await call(userCtl.createBooking, { body: bookingBody({ packageId: pkgId, preferredProviderId: String(cheap) }), user });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.pricing.source, 'package');
        assert.equal(r.body.data.finalAmount, 2124);
    });

    // Let the deferred post-booking work finish before the database goes away.
    await new Promise((r) => setTimeout(r, 1500));
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
