// Phase 4/5/6 exit criterion: boots the REAL server.js (not just app.js) against an
// in-memory MongoDB and proves the two things Phase 1 deliberately left switched off
// are now actually running -- the /sp socket namespace and the booking scheduler --
// without disturbing master's own io.
//
// Run: node tests/sp.runtime.smoke.mjs

import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failures = 0;
const check = (name, fn) => {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n         ${err.message}`);
    }
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.REDIS_ENABLED = 'false';
process.env.BULLMQ_ENABLED = 'false';

// server.js calls startServer() on import and never resolves a handle, so give it a
// moment to finish binding, then interrogate the live singletons it wired up.
await import('../server.js');
await new Promise((r) => setTimeout(r, 4000));

const { getIO } = await import('../src/config/socket.js');
const { tryGetIO } = await import('../src/modules/serviceProvider/sockets/index.js');
const { getScheduler } = await import('../src/modules/serviceProvider/services/bookingScheduler.js');
const { isOriginAllowed } = await import('../src/config/env.js');

console.log('\n[1] sockets');

const rootIo = getIO();
check('master root io exists', () => assert.ok(rootIo));

const spNs = tryGetIO();
check('SP namespace was attached', () => assert.ok(spNs, 'configureSPSocketServer never ran'));
check("SP namespace path is '/sp'", () => assert.equal(spNs.name, '/sp'));
check('SP is a namespace of master io, not a second server', () =>
    assert.equal(rootIo._nsps.get('/sp'), spNs));
check('master default namespace is untouched', () => assert.ok(rootIo._nsps.get('/')));

check('SP namespace exposes .adapter (the notificationController path)', () =>
    assert.ok(spNs.adapter && spNs.adapter.rooms instanceof Map));

check('SP namespace has an auth middleware registered', () =>
    assert.ok(spNs._fns.length > 0, 'no ns.use() handler -- sockets would be unauthenticated'));

console.log('\n[2] booking scheduler');

const scheduler = getScheduler();
check('scheduler instance was created', () => assert.ok(scheduler, 'initializeScheduler never ran'));
const { config: envConfig } = await import('../src/config/env.js');
check('BACKGROUND_JOBS_ENABLED defaults to on (live behaviour unchanged)', () =>
    assert.equal(envConfig.backgroundJobsEnabled, true));
check('scheduler is running', () => assert.equal(scheduler.isRunning, true));
check('scheduler holds a timer handle', () => assert.ok(scheduler.intervalId));
check('scheduler got the SP namespace as its io', () => assert.equal(scheduler.io, spNs));

console.log('\n[3] CORS — SP front-ends can still reach this backend');

for (const origin of ['https://homster.in', 'https://www.homster.in', 'https://truliq.com', 'https://www.truliq.com']) {
    check(`${origin} allowed`, () => assert.equal(isOriginAllowed(origin), true));
}
check('an unrelated origin is still rejected', () =>
    assert.equal(isOriginAllowed('https://evil.example.com'), false));

console.log('\n[4] shared infrastructure — one instance, not two');

{
    const { createRequire } = await import('node:module');
    const { existsSync } = await import('node:fs');
    const require = createRequire(import.meta.url);

    // Dead duplicates removed in the phase-2 cleanup. Both had zero consumers: SP's
    // rate limiter was only ever wired up by the standalone server.js (not ported,
    // and master already rate-limits all of /api), and otpService was superseded by
    // utils/redisOtp.util.js.
    for (const dead of ['../src/modules/serviceProvider/middleware/rateLimiter.js', '../src/modules/serviceProvider/services/otpService.js']) {
        const url = new URL(dead, import.meta.url);
        check(`${dead.split('/').pop()} stays deleted`, () => assert.equal(existsSync(url), false));
    }

    // The SMTP transport must be reused. Rebuilding it per send opens a fresh
    // connection pool each time and exhausts the provider under a mail burst.
    process.env.EMAIL_HOST ||= 'smtp.example.test';
    process.env.EMAIL_USER ||= 'u';
    process.env.EMAIL_PASS ||= 'p';
    const email = require('../src/modules/serviceProvider/services/emailService.js');
    const t1 = email._createTransporter();
    const t2 = email._createTransporter();
    check('SP reuses one nodemailer transport across sends', () => assert.equal(t1, t2));

    // Cloudinary's SDK config is process-global. SP and master both call config()
    // with the same three env vars, so the "duplicate" resolves to one account --
    // assert that rather than assume it.
    const spCloudinary = require('../src/modules/serviceProvider/config/cloudinary.js');
    const masterCloudinary = (await import('cloudinary')).v2;
    check('SP and master share one Cloudinary config (same global SDK)', () =>
        assert.equal(spCloudinary.config().cloud_name, masterCloudinary.config().cloud_name));

    // OTP: master stores in Mongo (food_otps), SP in Redis (otp:<phone>). Different
    // stores, so no key collision -- but the lockout policy should still agree.
    // Both read process.env.OTP_MAX_ATTEMPTS, so their EFFECTIVE values always agree
    // in a configured environment. What can silently diverge is the fallback used when
    // the var is unset, which is what this pins. (Comparing SP's literal against
    // master's *resolved* value would be wrong -- master's .env sets 3, default 5.)
    const readFile = (await import('node:fs/promises')).readFile;
    const spSrc = await readFile(new URL('../src/modules/serviceProvider/utils/redisOtp.util.js', import.meta.url), 'utf8');
    const masterSrc = await readFile(new URL('../src/config/env.js', import.meta.url), 'utf8');
    const spDefault = Number(spSrc.match(/OTP_MAX_ATTEMPTS\)\s*\|\|\s*(\d+)/)?.[1]);
    const masterDefault = Number(masterSrc.match(/OTP_MAX_ATTEMPTS\s*\|\|\s*(\d+)/)?.[1]);
    check(`OTP max-attempts fallback agrees (sp=${spDefault}, master=${masterDefault})`, () => {
        assert.ok(Number.isFinite(spDefault) && Number.isFinite(masterDefault), 'could not parse both defaults');
        assert.equal(spDefault, masterDefault);
    });
    check('both modules read the same OTP_MAX_ATTEMPTS env var', () => {
        assert.match(spSrc, /process\.env\.OTP_MAX_ATTEMPTS/);
        assert.match(masterSrc, /process\.env\.OTP_MAX_ATTEMPTS/);
    });
}

console.log('\n[5] Firebase — one app, master owns the Realtime DB URL');

{
    // The SP module initialises Firebase at import time, before server.js calls
    // initializeFirebaseRealtime(). Two things broke because of that ordering:
    //   1. config/firebase.js referenced databaseURL inside its already-initialised
    //      early return, but declared it below -- a TDZ ReferenceError that was
    //      invisible while that branch was dead.
    //   2. SP hardcoded the Truliq RTDB URL, which would have become the default
    //      app's database for the WHOLE process -- pointing master's live delivery
    //      tracking at the wrong Firebase project.
    const { readFile } = await import('node:fs/promises');

    const fbSrc = await readFile(new URL('../src/config/firebase.js', import.meta.url), 'utf8');
    const declIdx = fbSrc.indexOf('const databaseURL');
    const useIdx = fbSrc.indexOf('db = databaseURL ?');
    check('config/firebase declares databaseURL before the early return uses it', () => {
        assert.ok(declIdx > -1 && useIdx > -1, 'could not locate both sites');
        assert.ok(declIdx < useIdx, 'databaseURL is still declared after its first use (TDZ)');
    });

    const spFbSrc = await readFile(new URL('../src/modules/serviceProvider/services/firebaseAdmin.js', import.meta.url), 'utf8');
    check('SP does not hardcode a Realtime DB URL into initializeApp', () =>
        assert.doesNotMatch(spFbSrc, /databaseURL:\s*["']https:\/\/truliq-default-rtdb/));
    check('SP prefers the platform-configured RTDB url', () =>
        assert.match(spFbSrc, /VITE_FIREBASE_DATABASE_URL/));

    // initializeFirebaseRealtime must not throw on the already-initialised path,
    // which is the path that actually runs inside master.
    const { initializeFirebaseRealtime } = await import('../src/config/firebase.js');
    check('initializeFirebaseRealtime() survives being called twice', () => {
        assert.doesNotThrow(() => {
            initializeFirebaseRealtime();
            initializeFirebaseRealtime();
        });
    });
}

console.log('\n[6] shutdown');

check('scheduler.stop() clears the timer', () => {
    scheduler.stop();
    assert.equal(scheduler.isRunning, false);
});

await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
