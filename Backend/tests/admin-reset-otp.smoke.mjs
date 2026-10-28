/**
 * An admin password reset code cannot be known in advance or guessed.
 *
 * Run: node tests/admin-reset-otp.smoke.mjs
 *
 *  - Food and quick-commerce: with USE_DEFAULT_OTP=true -- set in production for
 *    customer SMS -- every admin reset code was "123456". Anyone who knew an admin's
 *    email could reset the password and sign in as that admin. The code is emailed,
 *    so the SMS reason never applied. Now fixed only outside production.
 *  - Taxi: a random code, but no attempt limit on unauthenticated routes (brute
 *    force within the 10 minutes), and the code was printed to the production log.
 *    Now five wrong codes burn it, and it is logged only in development.
 *
 * SMTP is not configured here, so no email is sent.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

delete process.env.SMTP_HOST;
delete process.env.EMAIL_USER;

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

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'admin_reset' });

    for (const [label, servicePath, configPath, adminPath, otpModelPath] of [
        ['food', '../src/core/auth/auth.service.js', '../src/config/env.js', '../src/core/admin/admin.model.js', '../src/core/admin/adminResetOtp.model.js'],
        ['quick-commerce', '../src/modules/quickCommerce/core/auth/auth.service.js', '../src/modules/quickCommerce/config/env.js', '../src/modules/quickCommerce/core/admin/admin.model.js', '../src/modules/quickCommerce/core/admin/adminResetOtp.model.js'],
    ]) {
        console.log(`\n${label}`);
        const { config } = await import(configPath);
        const service = await import(servicePath);
        const { FoodAdmin } = await import(adminPath);
        const { AdminResetOtp } = await import(otpModelPath);
        const email = `admin-${label}@t.test`;
        await FoodAdmin.collection.insertOne({ email, name: 'Admin', password: 'x', role: 'ADMIN', isActive: true });

        const saved = { nodeEnv: config.nodeEnv, useDefaultOtp: config.useDefaultOtp };
        try {
            await check(`${label}: production with USE_DEFAULT_OTP issues a random code, never 123456`, async () => {
                config.nodeEnv = 'production';
                config.useDefaultOtp = true;
                const seen = new Set();
                for (let i = 0; i < 5; i += 1) {
                    await service.requestAdminForgotPasswordOtp(email);
                    const row = await AdminResetOtp.findOne({ email }).lean();
                    assert.notEqual(row.otp, '123456');
                    assert.match(row.otp, /^\d{6}$/);
                    seen.add(row.otp);
                }
                assert.ok(seen.size > 1, 'codes vary');
            });
            await check(`${label}: submitting 123456 does not reset the password in production`, async () => {
                config.nodeEnv = 'production';
                config.useDefaultOtp = true;
                await service.requestAdminForgotPasswordOtp(email);
                let refused = false;
                try { await service.resetAdminPasswordWithOtp(email, '123456', 'attacker-pass'); } catch { refused = true; }
                assert.ok(refused, 'reset with 123456 was accepted');
            });
            await check(`${label}: development keeps the fixed code for local testing`, async () => {
                config.nodeEnv = 'development';
                config.useDefaultOtp = true;
                await service.requestAdminForgotPasswordOtp(email);
                assert.equal((await AdminResetOtp.findOne({ email }).lean()).otp, '123456');
            });
        } finally {
            config.nodeEnv = saved.nodeEnv;
            config.useDefaultOtp = saved.useDefaultOtp;
        }
    }

    console.log('\ntaxi');
    const taxi = await import('../src/modules/taxi/admin/services/adminService.js');
    const { Admin } = await import('../src/modules/taxi/admin/models/Admin.js');
    const taxiEmail = 'taxi-admin@t.test';
    const setCode = (code) => Admin.updateOne({ email: taxiEmail }, {
        $set: { resetPasswordOtp: code, resetPasswordExpires: new Date(Date.now() + 600_000), resetPasswordAttempts: 0 },
    });
    await Admin.collection.insertOne({ email: taxiEmail, name: 'Taxi Admin', password: 'x', status: 'active' });
    const reset = (otp) => taxi.resetPassword({ email: taxiEmail, otp, password: 'new-pass-123' }).then(() => 'ok', (e) => e.statusCode || e.message);

    await check('taxi: five wrong codes burn the code, so the right one no longer works', async () => {
        await setCode('482913');
        for (let i = 0; i < 5; i += 1) assert.equal(await reset('000000'), 400);
        assert.equal(await reset('482913'), 400, 'brute force past the limit still succeeded');
    });
    await check('taxi: parallel guesses cannot all slip under the limit', async () => {
        await setCode('777111');
        await Promise.all(Array.from({ length: 20 }, () => reset('123123')));
        assert.equal(await reset('777111'), 400);
    });
    await check('taxi: the right code within the limit still resets the password', async () => {
        await setCode('555666');
        assert.equal(await reset('111111'), 400);
        assert.equal(await reset('555666'), 'ok');
        assert.equal(await reset('555666'), 400, 'a used code cannot be reused');
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
