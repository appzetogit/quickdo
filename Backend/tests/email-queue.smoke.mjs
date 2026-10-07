/**
 * The email queue (SOW plan 2.6): queues/email.queue.js and its worker.
 *
 * Run: node tests/email-queue.smoke.mjs
 *
 * No Redis and no SMTP: the SMTP transport is replaced by a recording stand-in
 * (services/mailTransport.js) and the BullMQ queue by a fake ({ add }).
 *
 *   - with BullMQ off (the default) every email is sent directly -- the fallback;
 *   - with a queue, emails are queued, one-time codes with jobs that delete
 *     themselves, and attachments survive JSON as base64;
 *   - a queue that refuses the job falls back to sending directly;
 *   - the worker's processor sends a queued job and throws on an SMTP rejection
 *     (so BullMQ retries), and skips quietly when SMTP is not configured;
 *   - invoices, booking / onboarding emails and password codes all go through it;
 *   - the worker is registered with the others and run by the pm2 worker process.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.BULLMQ_ENABLED = 'false';
delete process.env.EMAIL_HOST;
delete process.env.EMAIL_USER;
delete process.env.EMAIL_PASS;

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const outbox = [];
let smtpMode = 'ok';
const transport = {
    sendMail: async (msg) => {
        if (smtpMode === 'reject') throw new Error('550 mailbox unavailable');
        outbox.push(msg);
        return { messageId: `<m${outbox.length}@test>` };
    },
};

const main = async () => {
    const mailTransport = await import('../src/services/mailTransport.js');
    const queue = await import('../src/queues/email.queue.js');
    const { processEmailJob } = await import('../src/queues/processors/email.processor.js');
    const { sendCustomerCodeEmail, sendAdminResetOtpEmail } = await import('../src/utils/email.js');

    console.log('\nno SMTP configured');
    await check('sendEmail skips quietly (no throw) and the processor does not retry', async () => {
        mailTransport.__setMailTransportForTests(null);
        const r = await queue.sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'x' });
        assert.equal(r.skipped, true);
        const p = await processEmailJob({ id: 'j0', data: { to: 'a@example.com', subject: 'Hi' } });
        assert.equal(p.skipped, true);
        assert.equal(await sendCustomerCodeEmail('a@example.com', '123456', 'verify_email'), false);
    });

    mailTransport.__setMailTransportForTests(transport);
    console.log('\nBullMQ off: direct send (fallback)');
    await check('sends immediately, with the default From and without the internal fields', async () => {
        const r = await queue.sendEmail({ kind: 'invoice', sensitive: false, to: 'b@example.com', subject: 'Invoice', html: '<b>x</b>' });
        assert.deepEqual([r.queued, r.sent], [false, true]);
        const msg = outbox.at(-1);
        assert.equal(msg.to, 'b@example.com');
        assert.ok(msg.from, 'a From header is always set');
        assert.equal(msg.kind, undefined);
        assert.equal(msg.sensitive, undefined);
    });
    await check('an SMTP rejection on direct send throws (callers handle it as before)', async () => {
        smtpMode = 'reject';
        try {
            await assert.rejects(queue.sendEmail({ to: 'c@example.com', subject: 'x', text: 'y' }), /550/);
            assert.equal(await sendCustomerCodeEmail('c@example.com', '654321', 'password_reset'), false, 'code sender reports false, never throws');
        } finally {
            smtpMode = 'ok';
        }
    });

    console.log('\nwith a queue');
    const jobs = [];
    let queueMode = 'ok';
    queue.__setEmailQueueForTests({
        add: async (name, data, opts) => {
            if (queueMode === 'down') throw new Error('Connection is closed.');
            jobs.push({ name, data, opts });
            return { id: String(jobs.length) };
        },
    });
    await check('an email is queued, not sent, and the job is plain JSON', async () => {
        const before = outbox.length;
        const pdf = Buffer.from('%PDF-1.4 test');
        const r = await queue.sendEmail({ kind: 'invoice', to: 'd@example.com', subject: 'Invoice', html: '<p>x</p>', attachments: [{ filename: 'inv.pdf', content: pdf, contentType: 'application/pdf' }] });
        assert.deepEqual([r.queued, r.sent], [true, false]);
        assert.equal(outbox.length, before);
        const job = jobs.at(-1);
        assert.equal(job.name, 'invoice');
        assert.equal(job.opts.attempts, 5);
        const roundTrip = JSON.parse(JSON.stringify(job.data));
        assert.equal(roundTrip.attachments[0].encoding, 'base64');
        assert.equal(Buffer.from(roundTrip.attachments[0].content, 'base64').toString(), '%PDF-1.4 test');
    });
    await check('one-time codes are queued as sensitive jobs that delete themselves', async () => {
        assert.equal(await sendCustomerCodeEmail('e@example.com', '246810', 'password_reset'), true);
        const job = jobs.at(-1);
        assert.equal(job.name, 'password_reset');
        assert.equal(job.opts.removeOnComplete, true);
        assert.equal(job.opts.removeOnFail, true);
        assert.equal(await sendAdminResetOtpEmail('admin@example.com', '135790'), true);
        assert.equal(jobs.at(-1).opts.removeOnComplete, true);
    });
    await check('the worker sends a queued job exactly as it was queued', async () => {
        const job = jobs.find((j) => j.name === 'invoice');
        const before = outbox.length;
        const r = await processEmailJob({ id: 'j1', data: JSON.parse(JSON.stringify(job.data)) });
        assert.equal(r.sent, true);
        assert.equal(outbox.length, before + 1);
        assert.equal(outbox.at(-1).attachments[0].encoding, 'base64');
    });
    await check('the worker throws on an SMTP rejection so BullMQ retries it', async () => {
        smtpMode = 'reject';
        try {
            await assert.rejects(processEmailJob({ id: 'j2', data: { to: 'f@example.com', subject: 'x' } }), /550/);
        } finally {
            smtpMode = 'ok';
        }
    });
    await check('a queue that refuses the job falls back to sending directly', async () => {
        queueMode = 'down';
        const before = outbox.length;
        const r = await queue.sendEmail({ kind: 'booking_confirmation', to: 'g@example.com', subject: 'Booked', text: 'ok' });
        assert.deepEqual([r.queued, r.sent], [false, true]);
        assert.equal(outbox.length, before + 1);
        queueMode = 'ok';
    });

    console.log('\nevery email goes through it');
    await check('food invoices are queued', async () => {
        const { sendFoodInvoiceEmail } = await import('../src/services/email.service.js');
        const ok = await sendFoodInvoiceEmail({ orderId: 'FOD-1', createdAt: new Date(), items: [], pricing: { total: 100 } }, { email: 'h@example.com', name: 'H' });
        assert.equal(ok, true);
        assert.equal(jobs.at(-1).name, 'invoice');
        assert.equal(jobs.at(-1).data.to, 'h@example.com');
    });
    await check('service-provider booking, onboarding and OTP emails are queued (OTP as sensitive)', async () => {
        process.env.EMAIL_USER = 'u';
        process.env.EMAIL_PASS = 'p';
        process.env.EMAIL_HOST = 'smtp.example.test';
        try {
            const sp = require('../src/modules/serviceProvider/services/emailService.js');
            await sp.sendOnboardingStatusEmail({ email: 'v@example.com', name: 'Vendor <b>' }, { role: 'vendor', status: 'rejected', reason: 'Blurry <script>' });
            const onboarding = jobs.at(-1);
            assert.equal(onboarding.name, 'onboarding_status');
            assert.ok(!onboarding.data.html.includes('<script>'), 'reason is escaped');
            await sp.sendOTPEmail('w@example.com', '987654', 'password_reset');
            assert.equal(jobs.at(-1).name, 'otp');
            assert.equal(jobs.at(-1).opts.removeOnComplete, true);
        } finally {
            delete process.env.EMAIL_USER;
            delete process.env.EMAIL_PASS;
            delete process.env.EMAIL_HOST;
        }
    });
    await check('no module sends mail around the queue any more', async () => {
        const files = [
            'src/services/email.service.js',
            'src/utils/email.js',
            'src/modules/quickCommerce/utils/email.js',
            'src/modules/taxi/services/mailService.js',
            'src/modules/serviceProvider/services/emailService.js',
        ];
        for (const f of files) {
            const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
            assert.ok(!/\.sendMail\(/.test(src), `${f} calls sendMail directly`);
        }
    });

    console.log('\nworker wiring');
    await check('the email worker is in the bundled worker list and the queue list', async () => {
        const bundle = readFileSync(new URL('../src/queues/workers/index.js', import.meta.url), 'utf8');
        assert.match(bundle, /'\.\/email\.worker\.js'/);
        const { QUEUE_NAMES, EMAIL_QUEUE } = await import('../src/queues/queue.constants.js');
        assert.ok(QUEUE_NAMES.includes(EMAIL_QUEUE));
        const pm2 = readFileSync(new URL('../../deploy/ecosystem.config.cjs', import.meta.url), 'utf8');
        assert.match(pm2, /script: 'src\/queues\/workers\/index\.js'/, 'pm2 runs the bundled workers');
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        assert.equal(pkg.scripts['worker:email'], 'node src/queues/workers/email.worker.js');
    });

    queue.__setEmailQueueForTests(undefined);
    mailTransport.__setMailTransportForTests(null);
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
