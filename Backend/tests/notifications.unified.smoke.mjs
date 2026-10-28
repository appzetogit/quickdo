// Unified notification inbox.
//
// The point of this test is as much what STAYED separate as what merged. Four of the
// eight models named "notification" are not inbox entries at all -- they are campaigns,
// delivery logs and channel config -- and merging them would have been wrong.
//
// Run: node tests/notifications.unified.smoke.mjs

import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let failures = 0;
const check = (name, fn) => {
    if (fn.constructor.name === 'AsyncFunction') throw new Error(`check("${name}") given an async fn`);
    try { fn(); console.log(`  ok   ${name}`); }
    catch (err) { failures++; console.log(`  FAIL ${name}\n         ${err.message}`); }
};

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.NODE_ENV = 'test';
await mongoose.connect(process.env.MONGO_URI);

const { FoodNotification } = await import('../src/core/notifications/models/notification.model.js');
const { FoodNotification: QCNotification } = await import(
    '../src/modules/quickCommerce/core/notifications/models/notification.model.js'
);

const oid = () => new mongoose.Types.ObjectId();

console.log('\n[1] existing food behaviour is unchanged');
{
    // Exactly the shape food wrote before this change -- no vertical.
    const legacy = await FoodNotification.create({
        ownerType: 'USER', ownerId: oid(), title: 'Order placed', message: 'Your order is in.',
    });
    check('a legacy-shaped write still succeeds', () => assert.ok(legacy._id));
    check('vertical defaults to food', () => assert.equal(legacy.vertical, 'food'));
    check('still on food_notifications', () => assert.equal(FoodNotification.collection.name, 'food_notifications'));
}

console.log('\n[2] quick-commerce shares the collection but labels itself');
{
    check('QC points at the shared collection', () => assert.equal(QCNotification.collection.name, 'food_notifications'));

    const qc = await QCNotification.create({
        ownerType: 'USER', ownerId: oid(), title: 'Delivered', message: '10 min.',
    });
    // The whole reason the QC model is a schema clone rather than a re-export: its seven
    // call sites never name a vertical, so a re-export would have labelled them 'food'.
    check('a QC write with no vertical is labelled quickCommerce', () => assert.equal(qc.vertical, 'quickCommerce'));

    // QC had drifted ahead of food on this enum value; core absorbed it.
    const support = await QCNotification.create({
        ownerType: 'USER', ownerId: oid(), title: 'Re: ticket', message: 'Resolved.', source: 'SUPPORT_RESPONSE',
    });
    check('SUPPORT_RESPONSE still validates', () => assert.equal(support.source, 'SUPPORT_RESPONSE'));
}

console.log('\n[3] the broadcast fan-out upsert carries the vertical');
{
    // notification.service.js fans broadcasts out with bulkWrite+upsert, which does NOT
    // run a document save. If schema defaults did not apply on insert here, every
    // broadcast-delivered QC notification would land unlabelled.
    const ownerId = oid();
    const broadcastId = oid();
    await QCNotification.bulkWrite([{
        updateOne: {
            filter: { broadcastId, ownerType: 'USER', ownerId },
            update: { $set: { title: 'Sale', message: '50% off', dismissedAt: null }, $setOnInsert: { isRead: false } },
            upsert: true,
        },
    }], { ordered: false });

    const doc = await QCNotification.findOne({ broadcastId }).lean();
    check('the upserted doc exists', () => assert.ok(doc));
    check('upsert is labelled quickCommerce, not food and not blank', () => assert.equal(doc.vertical, 'quickCommerce'));
}

console.log('\n[4] service-provider mirrors into the shared inbox');
{
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { mirrorNotification } = require('../src/modules/serviceProvider/utils/mirrorNotification.js');

    const vendorId = oid();
    await mirrorNotification({
        _id: oid(), vendorId, type: 'booking_assigned', title: 'New booking',
        message: 'A job was assigned.', relatedType: 'Booking', relatedId: oid(), data: { jobId: 7 },
    });

    const mirrored = await FoodNotification.findOne({ vertical: 'serviceProvider' }).lean();
    check('the SP notification reached the shared inbox', () => assert.ok(mirrored));
    check('vendorId became a VENDOR owner', () => {
        assert.equal(mirrored.ownerType, 'VENDOR');
        assert.equal(String(mirrored.ownerId), String(vendorId));
    });
    check("SP's free-form type lands in category, not the source enum", () => assert.equal(mirrored.category, 'booking_assigned'));
    check('the SP relation is retained', () => assert.equal(mirrored.metadata.relatedType, 'Booking'));

    // The mirror must never be able to fail a notification that already delivered.
    let threw = null;
    try {
        await mirrorNotification({ _id: oid(), vendorId: oid() }); // no title/message -> required-field error
        await mirrorNotification(null);
        await mirrorNotification({ _id: oid() }); // no recipient at all
    } catch (err) { threw = err; }
    check('a failing mirror is swallowed, never thrown', () => assert.equal(threw, null));
}

console.log('\n[5] one customer, every vertical, one query');
{
    const ownerId = oid();
    await FoodNotification.create({ ownerType: 'USER', ownerId, title: 'Food', message: 'a' });
    await QCNotification.create({ ownerType: 'USER', ownerId, title: 'QC', message: 'b' });
    await FoodNotification.create({ vertical: 'serviceProvider', ownerType: 'USER', ownerId, title: 'SP', message: 'c', source: 'BOOKING' });
    await FoodNotification.create({ vertical: 'taxi', ownerType: 'USER', ownerId, title: 'Taxi', message: 'd', source: 'RIDE' });

    const inbox = await FoodNotification.find({ ownerType: 'USER', ownerId }).lean();
    check('all four verticals come back from one query', () => {
        assert.deepEqual(inbox.map((n) => n.vertical).sort(), ['food', 'quickCommerce', 'serviceProvider', 'taxi']);
    });
    const justQC = await FoodNotification.countDocuments({ ownerType: 'USER', ownerId, vertical: 'quickCommerce' });
    check('filtering by vertical narrows correctly', () => assert.equal(justQC, 1));
}

console.log('\n[6] the models that are NOT inboxes stayed separate');
{
    // Eight files matched "notification". Only three were the same aggregate. These are
    // the other four, and each is a different thing:
    //
    //   BroadcastNotification    -- an admin campaign, fanned OUT to many inbox rows
    //   taxi promotions          -- also a campaign (send_to / sent_at / status)
    //   SPNotificationLog        -- a delivery-attempt log
    //   TaxiNotificationChannel  -- channel configuration
    //
    // Folding a campaign into the inbox would turn one admin action into a row that
    // looks like a user's notification; folding a delivery log in would double every
    // entry. Same word, four aggregates.
    const { BroadcastNotification } = await import('../src/core/notifications/models/notificationBroadcast.model.js');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const SPNotificationLog = require('../src/modules/serviceProvider/models/NotificationLog.js');
    const { Notification: TaxiPromoNotification } = await import('../src/modules/taxi/admin/promotions/models/Notification.js');

    const names = {
        inbox: FoodNotification.collection.name,
        broadcast: BroadcastNotification.collection.name,
        spLog: SPNotificationLog.collection.name,
        taxiCampaign: TaxiPromoNotification.collection.name,
    };
    check('all four live in distinct collections', () => {
        assert.equal(new Set(Object.values(names)).size, 4, JSON.stringify(names));
    });
    check('none of them was merged into the inbox', () => {
        for (const [k, v] of Object.entries(names)) {
            if (k !== 'inbox') assert.notEqual(v, names.inbox, `${k} collapsed into the inbox`);
        }
    });

    // A campaign is addressed to a segment, an inbox entry to one owner. That is the
    // structural reason they are not the same aggregate.
    check('the taxi campaign is addressed to a segment, not an owner', () => {
        const paths = Object.keys(TaxiPromoNotification.schema.paths);
        assert.ok(paths.includes('send_to'), 'expected send_to');
        assert.ok(!paths.includes('ownerId'), 'a campaign should not have a single owner');
    });
}

await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
