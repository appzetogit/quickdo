/**
 * Auto-renewing provider subscriptions on Razorpay Subscriptions (plan §3.2).
 * Razorpay is mocked; nothing leaves the machine.
 *
 * Run: node tests/sp-recurring-subscription.smoke.mjs
 *
 *  - without Razorpay keys every recurring endpoint answers 503 'Payments not configured';
 *  - the plan's billingMode decides: one_time plans refuse /recurring, recurring
 *    plans refuse the one-off create-order, 'both' allows either;
 *  - plan sync creates one Razorpay plan and a new one only when price/duration change;
 *  - create returns subscription_id for Checkout and reuses an unfinished one;
 *    a running one-off term defers the first charge (start_at);
 *  - webhooks: activated turns auto-renew on; charged adds a term and books
 *    platform fee + remainder once per payment (redelivery is a no-op); halted /
 *    cancelled turn auto-renew off and keep the paid term; a late 'activated'
 *    cannot revive a cancelled subscription; unknown subscriptions are ignored,
 *    ours are adopted from their notes;
 *  - expiry reminders skip auto-renewing providers;
 *  - cancel at cycle end / now; vendors work the same way;
 *  - the core Razorpay webhook routes subscription.* events here.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// No Razorpay keys: set (empty) before anything loads .env, which never overrides.
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';
const WEBHOOK_SECRET = 'sp-recurring-webhook-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
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
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; }
});
const call = async (fn, { params = {}, body = {}, query = {}, user, userRole } = {}) => {
    const r = res();
    await fn({ params, body, query, user, userRole }, r);
    return r;
};
const secs = (d) => Math.floor(d.getTime() / 1000);

// ── Mock Razorpay ─────────────────────────────────────────────────────────
const gatewayCalls = { plans: [], subscriptions: [], cancels: [] };
let seq = 0;
const mockGateway = {
    plans: {
        create: async (o) => { gatewayCalls.plans.push(o); return { id: `plan_mock_${++seq}`, ...o }; }
    },
    subscriptions: {
        create: async (o) => { gatewayCalls.subscriptions.push(o); return { id: `sub_mock_${++seq}`, status: 'created', short_url: `https://rzp.io/i/${seq}`, ...o }; },
        cancel: async (id, atCycleEnd) => { gatewayCalls.cancels.push({ id, atCycleEnd }); return { id, status: atCycleEnd ? 'active' : 'cancelled' }; }
    }
};

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_recurring_subscription' });

    require('../src/modules/serviceProvider/models/index.js');
    const Settings = require('../src/modules/serviceProvider/models/Settings.js');
    const Worker = require('../src/modules/serviceProvider/models/Worker.js');
    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const Plan = require('../src/modules/serviceProvider/models/WorkerSubscriptionPlan.js');
    const ProviderSubscription = require('../src/modules/serviceProvider/models/ProviderSubscription.js');
    const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
    const Notification = require('../src/modules/serviceProvider/models/Notification.js');
    const PlatformEarning = require('../src/modules/serviceProvider/models/PlatformEarning.js');
    for (const M of [Settings, Worker, Vendor, Plan, ProviderSubscription, Transaction, Notification, PlatformEarning]) {
        await M.createCollection().catch(() => {});
    }
    await ProviderSubscription.syncIndexes();

    const recurring = require('../src/modules/serviceProvider/services/recurringSubscription.js');
    const ctl = require('../src/modules/serviceProvider/controllers/paymentControllers/recurringSubscriptionController.js');
    const oneOff = require('../src/modules/serviceProvider/controllers/paymentControllers/subscriptionPaymentController.js');
    const { sendSubscriptionReminders } = require('../src/modules/serviceProvider/services/subscriptionReminder.js');

    await Settings.collection.insertOne({ type: 'global', subscriptionPrice: 1000, subscriptionPlatformFee: 100, subscriptionRemainderLabel: 'provider_pool' });

    const oneTimePlan = await Plan.create({ title: 'Monthly (one-off)', price: 1000, durationDays: 30 });
    const recurringPlan = await Plan.create({ title: 'Monthly auto-renew', price: 1000, durationDays: 30, billingMode: 'recurring' });
    const bothPlan = await Plan.create({ title: 'Quarterly', price: 2700, durationDays: 90, billingMode: 'both' });
    const shortPlan = await Plan.create({ title: 'Trial', price: 10, durationDays: 3, billingMode: 'recurring' });

    let phone = 9600000000;
    const newWorker = async (over = {}) => {
        const _id = oid();
        await Worker.collection.insertOne({ _id, name: 'W', phone: String(phone++), approvalStatus: 'approved', isActive: true, ...over });
        return _id;
    };
    const workerId = await newWorker();
    const worker = { user: { id: String(workerId) }, userRole: 'WORKER' };

    console.log('\nno Razorpay keys');
    await check('every recurring endpoint answers 503 Payments not configured', async () => {
        assert.equal(recurring.isConfigured(), false);
        const c = await call(ctl.createRecurringSubscription, { ...worker, body: { planId: String(recurringPlan._id) } });
        assert.equal(c.statusCode, 503);
        assert.equal(c.body.message, 'Payments not configured');
        assert.equal(c.body.code, 'PAYMENTS_NOT_CONFIGURED');
        assert.equal((await call(ctl.cancelRecurringSubscription, { ...worker })).statusCode, 503);
        assert.equal((await call(ctl.syncPlanToRazorpay, { params: { id: String(recurringPlan._id) } })).statusCode, 503);
        const g = await call(ctl.getRecurringSubscription, { ...worker });
        assert.equal(g.statusCode, 200);
        assert.equal(g.body.paymentsConfigured, false);
    });

    recurring.setGatewayForTests(mockGateway);

    console.log('\nplans');
    await check('periods follow durationDays; too-short plans are refused', async () => {
        assert.deepEqual(recurring.periodFor(30), { period: 'monthly', interval: 1 });
        assert.deepEqual(recurring.periodFor(90), { period: 'monthly', interval: 3 });
        assert.deepEqual(recurring.periodFor(365), { period: 'yearly', interval: 1 });
        assert.deepEqual(recurring.periodFor(14), { period: 'weekly', interval: 2 });
        assert.deepEqual(recurring.periodFor(10), { period: 'daily', interval: 10 });
        assert.throws(() => recurring.periodFor(3));
        assert.equal(recurring.totalCountFor({ durationDays: 30 }), 120);
        assert.equal(recurring.totalCountFor({ durationDays: 30, recurringTotalCount: 12 }), 12);
    });
    await check('billingMode decides which flow a plan is sold through', async () => {
        const r1 = await call(ctl.createRecurringSubscription, { ...worker, body: { planId: String(oneTimePlan._id) } });
        assert.equal(r1.statusCode, 400);
        assert.equal(r1.body.code, 'ONE_TIME_ONLY');
        const r2 = await call(oneOff.createSubscriptionOrder, { ...worker, body: { planId: String(recurringPlan._id) } });
        assert.equal(r2.statusCode, 400);
        assert.equal(r2.body.code, 'RECURRING_ONLY');
        const r3 = await call(oneOff.createSubscriptionOrder, { ...worker, body: { planId: String(bothPlan._id) } });
        assert.equal(r3.statusCode, 200, 'one-off still works for a both plan (mock order without keys)');
        const r4 = await call(ctl.createRecurringSubscription, { ...worker, body: { planId: String(shortPlan._id) } });
        assert.equal(r4.statusCode, 400);
    });
    await check('sync creates one Razorpay plan, and a new one only after a price change', async () => {
        const before = gatewayCalls.plans.length;
        const s1 = await call(ctl.syncPlanToRazorpay, { params: { id: String(bothPlan._id) } });
        assert.equal(s1.statusCode, 200, JSON.stringify(s1.body));
        assert.equal(s1.body.data.razorpayPlan.period, 'monthly');
        assert.equal(s1.body.data.razorpayPlan.interval, 3);
        assert.equal(s1.body.data.razorpayPlan.amount, 270000);
        await call(ctl.syncPlanToRazorpay, { params: { id: String(bothPlan._id) } });
        assert.equal(gatewayCalls.plans.length, before + 1, 'unchanged plan is not re-created');
        await Plan.updateOne({ _id: bothPlan._id }, { $set: { price: 2500 } });
        const s3 = await call(ctl.syncPlanToRazorpay, { params: { id: String(bothPlan._id) } });
        assert.equal(gatewayCalls.plans.length, before + 2);
        assert.notEqual(s3.body.data.razorpayPlan.id, s1.body.data.razorpayPlan.id);
    });

    console.log('\nworker subscription');
    let subId;
    await check('create returns the subscription id for Checkout', async () => {
        const r = await call(ctl.createRecurringSubscription, { ...worker, body: { planId: String(recurringPlan._id) } });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        subId = r.body.data.subscriptionId;
        assert.match(subId, /^sub_mock_/);
        assert.equal(r.body.data.amount, 100000);
        assert.equal(r.body.data.firstChargeAt, null);
        const sent = gatewayCalls.subscriptions.at(-1);
        assert.equal(sent.total_count, 120);
        assert.equal(sent.notes.providerType, 'worker');
        assert.equal(sent.notes.providerId, String(workerId));
        assert.equal(sent.start_at, undefined);
        const rec = await ProviderSubscription.findOne({ razorpaySubscriptionId: subId }).lean();
        assert.equal(rec.status, 'created');
    });
    await check('an unfinished checkout on the same plan is handed back', async () => {
        const r = await call(ctl.createRecurringSubscription, { ...worker, body: { planId: String(recurringPlan._id) } });
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.data.subscriptionId, subId);
    });

    const subEntity = (over = {}) => ({ id: subId, status: 'active', notes: {}, ...over });
    const hook = (event, payload) => recurring.handleSubscriptionWebhook(event, payload);

    await check('subscription.activated turns auto-renew on', async () => {
        await hook('subscription.authenticated', { subscription: { entity: subEntity({ status: 'authenticated' }) } });
        await hook('subscription.activated', { subscription: { entity: subEntity() } });
        const w = await Worker.findById(workerId).lean();
        assert.equal(w.subscription.autoRenew, true);
        assert.equal(w.subscription.razorpaySubscriptionId, subId);
        assert.equal(w.subscription.gatewayStatus, 'active');
        assert.equal((await ProviderSubscription.findOne({ razorpaySubscriptionId: subId }).lean()).status, 'active');
    });
    const end1 = new Date(Date.now() + 30 * DAY);
    const charge = (paymentId, currentEnd, paidCount) => ({
        subscription: { entity: subEntity({ current_start: secs(new Date()), current_end: secs(currentEnd), paid_count: paidCount }) },
        payment: { entity: { id: paymentId, amount: 100000, order_id: `order_${paymentId}`, invoice_id: `inv_${paymentId}`, status: 'captured' } }
    });
    await check('subscription.charged activates the term and books fee + remainder', async () => {
        const out = await hook('subscription.charged', charge('pay_rec_1', end1, 1));
        assert.equal(out.charged, true, JSON.stringify(out));
        const w = await Worker.findById(workerId).lean();
        assert.equal(w.subscription.isActive, true);
        assert.equal(Math.abs(new Date(w.subscription.expiryDate) - end1) < 1000, true, 'expiry is the gateway cycle end');
        assert.equal(w.subscription.planName, 'Monthly auto-renew');
        assert.equal(w.subscription.lastPaymentId, 'pay_rec_1');
        const rows = await Transaction.find({ referenceId: 'pay_rec_1' }).sort({ type: 1 }).lean();
        assert.deepEqual(rows.map((r) => [r.type, r.amount]), [['subscription_platform_fee', 100], ['subscription_remainder', 900]]);
        assert.equal(rows[0].metadata.subscriptionId, subId);
        assert.equal(rows[0].metadata.recurring, true);
        assert.equal(rows[1].metadata.ledgerAccount, 'provider_pool');
        assert.equal(String(rows[0].workerId), String(workerId));
    });
    await check('a redelivered charge is applied once', async () => {
        const out = await hook('subscription.charged', charge('pay_rec_1', end1, 1));
        assert.equal(out.duplicate, true);
        assert.equal(await Transaction.countDocuments({ referenceId: 'pay_rec_1' }), 2);
    });
    const end2 = new Date(end1.getTime() + 30 * DAY);
    await check('the next charge extends the term', async () => {
        await hook('subscription.charged', charge('pay_rec_2', end2, 2));
        const w = await Worker.findById(workerId).lean();
        assert.ok(Math.abs(new Date(w.subscription.expiryDate) - end2) < 1000);
        assert.equal(await Transaction.countDocuments({ referenceId: { $in: ['pay_rec_1', 'pay_rec_2'] } }), 4);
        const rec = await ProviderSubscription.findOne({ razorpaySubscriptionId: subId }).lean();
        assert.equal(rec.paidCount, 2);
        assert.deepEqual(rec.chargedPaymentIds, ['pay_rec_1', 'pay_rec_2']);
    });
    await check('status reports auto-renew; a second subscription is refused', async () => {
        const g = await call(ctl.getRecurringSubscription, { ...worker });
        assert.equal(g.body.data.status, 'active');
        assert.equal(g.body.data.paidCount, 2);
        const again = await call(ctl.createRecurringSubscription, { ...worker, body: { planId: String(recurringPlan._id) } });
        assert.equal(again.statusCode, 409);
    });
    await check('expiry reminders skip auto-renewing providers', async () => {
        const manual = await newWorker({ subscription: { isActive: true, expiryDate: new Date(Date.now() + 2 * DAY), planName: 'X' } });
        await Worker.updateOne({ _id: workerId }, { $set: { 'subscription.expiryDate': new Date(Date.now() + 2 * DAY) } });
        const sent = await sendSubscriptionReminders();
        assert.equal(sent, 1);
        assert.ok((await Worker.findById(manual).lean()).subscription.reminderSentFor);
        assert.equal((await Worker.findById(workerId).lean()).subscription.reminderSentFor ?? null, null);
        await Worker.updateOne({ _id: workerId }, { $set: { 'subscription.expiryDate': end2 } });
    });
    await check('subscription.halted turns auto-renew off and keeps the paid term', async () => {
        await hook('subscription.pending', { subscription: { entity: subEntity({ status: 'pending' }) } });
        let w = await Worker.findById(workerId).lean();
        assert.equal(w.subscription.gatewayStatus, 'pending');
        assert.equal(w.subscription.autoRenew, true, 'still retrying');
        await hook('subscription.halted', { subscription: { entity: subEntity({ status: 'halted' }) } });
        w = await Worker.findById(workerId).lean();
        assert.equal(w.subscription.autoRenew, false);
        assert.equal(w.subscription.gatewayStatus, 'halted');
        assert.equal(w.subscription.isActive, true);
        assert.ok(new Date(w.subscription.expiryDate) > new Date());
        // A successful retry brings it back.
        await hook('subscription.activated', { subscription: { entity: subEntity() } });
        assert.equal((await Worker.findById(workerId).lean()).subscription.autoRenew, true);
    });
    await check('cancel at cycle end: auto-renew off now, a late activated cannot turn it back on', async () => {
        const r = await call(ctl.cancelRecurringSubscription, { ...worker, body: {} });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.deepEqual(gatewayCalls.cancels.at(-1), { id: subId, atCycleEnd: true });
        assert.equal(r.body.data.cancelAtCycleEnd, true);
        assert.equal((await Worker.findById(workerId).lean()).subscription.autoRenew, false);
        await hook('subscription.activated', { subscription: { entity: subEntity() } });
        assert.equal((await Worker.findById(workerId).lean()).subscription.autoRenew, false);
    });
    await check('subscription.cancelled ends it; nothing revives it afterwards', async () => {
        await hook('subscription.cancelled', { subscription: { entity: subEntity({ status: 'cancelled' }) } });
        const rec = await ProviderSubscription.findOne({ razorpaySubscriptionId: subId }).lean();
        assert.equal(rec.status, 'cancelled');
        const out = await hook('subscription.activated', { subscription: { entity: subEntity() } });
        assert.ok(out.ignored);
        const w = await Worker.findById(workerId).lean();
        assert.equal(w.subscription.gatewayStatus, 'cancelled');
        assert.equal(w.subscription.isActive, true, 'the paid term runs to its end');
        assert.equal((await call(ctl.cancelRecurringSubscription, { ...worker })).statusCode, 404);
    });

    console.log('\nvendors, one-off overlap, adoption');
    const vendorId = oid();
    const runningUntil = new Date(Date.now() + 20 * DAY);
    await Vendor.collection.insertOne({
        _id: vendorId, name: 'V', businessName: 'V Services', phone: String(phone++), email: 'v@t.test', approvalStatus: 'approved', isActive: true,
        subscription: { isActive: true, expiryDate: runningUntil, planName: 'Monthly (one-off)' }
    });
    const vendor = { user: { id: String(vendorId) }, userRole: 'VENDOR' };
    let vendorSub;
    await check('a vendor with a running one-off term is first charged when it ends', async () => {
        const r = await call(ctl.createRecurringSubscription, { ...vendor, body: { planId: String(recurringPlan._id) } });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        vendorSub = r.body.data.subscriptionId;
        assert.equal(gatewayCalls.subscriptions.at(-1).start_at, secs(runningUntil));
        assert.ok(r.body.data.firstChargeAt);
        assert.equal(gatewayCalls.subscriptions.at(-1).notes.providerType, 'vendor');
    });
    await check('a vendor charge books rows against the vendor and never shortens the paid term', async () => {
        await recurring.handleSubscriptionWebhook('subscription.activated', { subscription: { entity: { id: vendorSub, status: 'active' } } });
        const cycleEnd = new Date(runningUntil.getTime() + 30 * DAY);
        await recurring.handleSubscriptionWebhook('subscription.charged', {
            subscription: { entity: { id: vendorSub, status: 'active', current_end: secs(cycleEnd), paid_count: 1 } },
            payment: { entity: { id: 'pay_vendor_1', amount: 100000 } }
        });
        const v = await Vendor.findById(vendorId).lean();
        assert.ok(Math.abs(new Date(v.subscription.expiryDate) - cycleEnd) < 1000);
        assert.equal(v.subscription.autoRenew, true);
        const rows = await Transaction.find({ referenceId: 'pay_vendor_1' }).lean();
        assert.equal(rows.length, 2);
        assert.ok(rows.every((r) => String(r.vendorId) === String(vendorId)));
    });
    await check('cancel now (atCycleEnd false) cancels at once', async () => {
        const r = await call(ctl.cancelRecurringSubscription, { ...vendor, body: { atCycleEnd: false } });
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.data.status, 'cancelled');
        assert.deepEqual(gatewayCalls.cancels.at(-1), { id: vendorSub, atCycleEnd: false });
        const v = await Vendor.findById(vendorId).lean();
        assert.equal(v.subscription.autoRenew, false);
        assert.equal(v.subscription.isActive, true);
    });
    await check('unknown subscriptions are ignored; ours are adopted from their notes', async () => {
        const out = await recurring.handleSubscriptionWebhook('subscription.activated', { subscription: { entity: { id: 'sub_someone_else', notes: {} } } });
        assert.ok(out.ignored);
        const lost = await newWorker();
        await recurring.handleSubscriptionWebhook('subscription.charged', {
            subscription: { entity: { id: 'sub_lost', status: 'active', notes: { type: 'sp_provider_subscription', providerType: 'worker', providerId: String(lost), planId: String(recurringPlan._id) } } },
            payment: { entity: { id: 'pay_lost_1', amount: 100000 } }
        });
        const rec = await ProviderSubscription.findOne({ razorpaySubscriptionId: 'sub_lost' }).lean();
        assert.equal(rec.status, 'active');
        const w = await Worker.findById(lost).lean();
        assert.equal(w.subscription.isActive, true);
        assert.ok(new Date(w.subscription.expiryDate) > new Date(Date.now() + 29 * DAY), 'no gateway cycle end: plan duration');
    });
    await check('admin list shows each subscription with its auto-renew state', async () => {
        const r = await call(ctl.listProviderSubscriptions, { query: {} });
        assert.equal(r.statusCode, 200);
        const lost = r.body.data.find((x) => x.subscriptionId === 'sub_lost');
        assert.equal(lost.autoRenew, true);
        const cancelled = r.body.data.find((x) => x.subscriptionId === subId);
        assert.equal(cancelled.autoRenew, false);
        assert.equal(cancelled.status, 'cancelled');
        const v = r.body.data.find((x) => x.subscriptionId === vendorSub);
        assert.equal(v.providerName, 'V Services');
    });

    console.log('\ncore webhook');
    await check('the Razorpay webhook routes subscription.* here, once per delivery', async () => {
        const { handleRazorpayWebhook } = await import('../src/core/payments/controllers/razorpayWebhook.controller.js');
        const w = await newWorker();
        const body = {
            event: 'subscription.charged',
            payload: {
                subscription: { entity: { id: 'sub_via_core', status: 'active', notes: { type: 'sp_provider_subscription', providerType: 'worker', providerId: String(w), planId: String(recurringPlan._id) } } },
                payment: { entity: { id: 'pay_via_core', amount: 100000 } }
            }
        };
        const rawBody = Buffer.from(JSON.stringify(body));
        const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
        const req = { headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_sp_1' }, body, rawBody };
        const r1 = res();
        await handleRazorpayWebhook(req, r1);
        assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
        const r2 = res();
        await handleRazorpayWebhook(req, r2);
        assert.equal(r2.body.duplicate, true);
        assert.equal(await Transaction.countDocuments({ referenceId: 'pay_via_core' }), 2);
        assert.equal((await Worker.findById(w).lean()).subscription.autoRenew, true);
    });

    await new Promise((r) => setTimeout(r, 300));
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
