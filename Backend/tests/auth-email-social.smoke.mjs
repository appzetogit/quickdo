/**
 * Customer email + password sign-in, password recovery, and Google / Apple sign-in
 * (SOW plan 2.3 and 2.4).
 *
 * Run: node tests/auth-email-social.smoke.mjs
 *
 * Isolated in-memory MongoDB replica set. Nothing external is called:
 *   - SMTP is replaced by a recording transport (services/mailTransport.js), so the
 *     emailed codes are read from what would have been sent;
 *   - Google's verifier is replaced by a fake OAuth2Client;
 *   - Apple's JWKS is replaced by a local RSA key, so Apple tokens are REAL signed
 *     JWTs checked by the real verification code (issuer, audience, expiry, nonce,
 *     signature).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.GOOGLE_CLIENT_IDS = 'web-client.apps.googleusercontent.com,android-client.apps.googleusercontent.com';
process.env.APPLE_CLIENT_IDS = 'com.quickdrop.app';
process.env.BULLMQ_ENABLED = 'false';
delete process.env.EMAIL_HOST;

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
const rejects = async (promise, { status, code, message } = {}) => {
    let error;
    try { await promise; } catch (err) { error = err; }
    assert.ok(error, 'expected a rejection');
    if (status) assert.equal(error.statusCode, status, `status ${error.statusCode} (${error.message})`);
    if (code) assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return error;
};

/** The SMTP stand-in: every message, newest last. */
const outbox = [];
const lastCodeFor = (to) => {
    const mail = [...outbox].reverse().find((m) => m.to === to);
    assert.ok(mail, `no email was sent to ${to}`);
    const code = String(mail.text || '').match(/\b(\d{6})\b/)?.[1];
    assert.ok(code, 'no 6-digit code in the email');
    return code;
};

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'auth_email_social' });

    const { config } = await import('../src/config/env.js');
    config.nodeEnv = 'test';
    config.useDefaultOtp = false;
    config.otpRateLimit = 50;
    config.authMaxLoginFailures = 5;
    config.authLockoutMinutes = 15;

    const { __setMailTransportForTests } = await import('../src/services/mailTransport.js');
    __setMailTransportForTests({ sendMail: async (msg) => { outbox.push(msg); return { messageId: `m${outbox.length}` }; } });

    const { FoodUser } = await import('../src/core/users/user.model.js');
    const { FoodRefreshToken } = await import('../src/core/refreshTokens/refreshToken.model.js');
    const { CustomerEmailOtp } = await import('../src/core/auth/customerEmailOtp.model.js');
    const emailAuth = await import('../src/core/auth/emailAuth.service.js');
    const social = await import('../src/core/auth/socialAuth.service.js');
    const { verifyAccessToken } = await import('../src/core/auth/token.util.js');
    await FoodUser.init();
    await CustomerEmailOtp.init();

    console.log('\nemail registration and verification');
    await check('register creates an UNVERIFIED account with a bcrypt hash and emails a 6-digit code', async () => {
        const r = await emailAuth.registerWithEmail({ email: 'Alice@Example.com ', password: 'secret123', name: 'Alice' });
        assert.equal(r.email, 'alice@example.com');
        assert.equal(r.verificationRequired, true);
        const u = await FoodUser.findOne({ loginEmail: 'alice@example.com' }).select('+passwordHash').lean();
        assert.equal(u.emailVerified, false);
        assert.equal(u.phone, undefined, 'no phone needed');
        assert.match(u.passwordHash, /^\$2[aby]\$/);
        assert.notEqual(u.passwordHash, 'secret123');
        lastCodeFor('alice@example.com');
        const stored = await CustomerEmailOtp.findOne({ email: 'alice@example.com' }).lean();
        assert.ok(!JSON.stringify(stored).includes(lastCodeFor('alice@example.com')), 'the code is stored hashed');
    });
    await check('a weak password is refused', async () => {
        await rejects(emailAuth.registerWithEmail({ email: 'weak@example.com', password: 'short', name: 'W' }), { status: 400 });
        await rejects(emailAuth.registerWithEmail({ email: 'weak@example.com', password: 'onlyletters', name: 'W' }), { status: 400 });
    });
    await check('a second email-only account can exist (phone index is partial)', async () => {
        await emailAuth.registerWithEmail({ email: 'second@example.com', password: 'secret123', name: 'Second' });
        assert.equal(await FoodUser.countDocuments({ phone: { $exists: false } }), 2);
    });
    await check('login before verifying is refused with EMAIL_NOT_VERIFIED', async () => {
        await rejects(emailAuth.loginWithEmail({ email: 'alice@example.com', password: 'secret123' }), { status: 403, code: 'EMAIL_NOT_VERIFIED' });
    });
    await check('a wrong code does not verify; the right one signs in', async () => {
        const code = lastCodeFor('alice@example.com');
        const wrong = code === '000000' ? '111111' : '000000';
        await rejects(emailAuth.verifyEmail({ email: 'alice@example.com', otp: wrong }), { status: 401 });
        const r = await emailAuth.verifyEmail({ email: 'alice@example.com', otp: code });
        assert.ok(r.accessToken && r.refreshToken);
        assert.equal(verifyAccessToken(r.accessToken).role, 'USER');
        assert.equal(r.user.emailVerified, true);
        assert.equal(r.user.passwordHash, undefined, 'hash never returned');
        assert.equal(r.user.needsPhone, true);
    });
    await check('a used code cannot be replayed', async () => {
        await rejects(emailAuth.verifyEmail({ email: 'alice@example.com', otp: lastCodeFor('alice@example.com') }), { status: 401 });
    });
    await check('registering a verified email again is a 409', async () => {
        await rejects(emailAuth.registerWithEmail({ email: 'alice@example.com', password: 'other1234', name: 'X' }), { status: 409 });
    });

    console.log('\nlogin and lockout');
    await check('the right password signs in', async () => {
        const r = await emailAuth.loginWithEmail({ email: 'ALICE@example.com', password: 'secret123' });
        assert.ok(r.accessToken);
    });
    await check('wrong passwords and unknown emails get the same answer', async () => {
        const a = await rejects(emailAuth.loginWithEmail({ email: 'alice@example.com', password: 'nope12345' }), { status: 401 });
        const b = await rejects(emailAuth.loginWithEmail({ email: 'nobody@example.com', password: 'nope12345' }), { status: 401 });
        assert.equal(a.message, b.message);
    });
    await check('5 wrong passwords in a row lock the account, even against the right password', async () => {
        await FoodUser.updateOne({ loginEmail: 'alice@example.com' }, { $set: { loginFailures: 0 } });
        for (let i = 0; i < 4; i += 1) {
            await rejects(emailAuth.loginWithEmail({ email: 'alice@example.com', password: `wrong${i}xyz` }), { status: 401 });
        }
        const locked = await rejects(emailAuth.loginWithEmail({ email: 'alice@example.com', password: 'wrong5xyz' }), { status: 423 });
        assert.ok(locked.retryAfterSeconds > 0);
        await rejects(emailAuth.loginWithEmail({ email: 'alice@example.com', password: 'secret123' }), { status: 423 });
    });
    await check('parallel wrong guesses all count (atomic counter)', async () => {
        await emailAuth.registerWithEmail({ email: 'race@example.com', password: 'secret123', name: 'R' });
        await emailAuth.verifyEmail({ email: 'race@example.com', otp: lastCodeFor('race@example.com') });
        await Promise.allSettled(Array.from({ length: 5 }, (_, i) => emailAuth.loginWithEmail({ email: 'race@example.com', password: `bad${i}guess` })));
        const u = await FoodUser.findOne({ loginEmail: 'race@example.com' }).select('+lockedUntil').lean();
        assert.ok(u.lockedUntil && u.lockedUntil > new Date(), 'locked after 5 parallel guesses');
    });
    await check('the lock lifts when it expires, and a good sign-in resets the counter', async () => {
        await FoodUser.updateOne({ loginEmail: 'alice@example.com' }, { $set: { lockedUntil: new Date(Date.now() - 1000), loginFailures: 3 } });
        await emailAuth.loginWithEmail({ email: 'alice@example.com', password: 'secret123' });
        const u = await FoodUser.findOne({ loginEmail: 'alice@example.com' }).select('+loginFailures +lockedUntil').lean();
        assert.equal(u.loginFailures, 0);
        assert.equal(u.lockedUntil, undefined);
    });

    console.log('\npassword recovery');
    await check('forgot-password answers the same for unknown emails and sends nothing', async () => {
        const before = outbox.length;
        const r = await emailAuth.forgotPassword({ email: 'ghost@example.com' });
        assert.match(r.message, /If an account uses this email/);
        assert.equal(outbox.length, before);
    });
    await check('reset with the emailed code sets the new password and signs every device out', async () => {
        const user = await FoodUser.findOne({ loginEmail: 'alice@example.com' }).lean();
        assert.ok(await FoodRefreshToken.countDocuments({ userId: user._id }) > 0);
        await emailAuth.forgotPassword({ email: 'alice@example.com' });
        await emailAuth.resetPassword({ email: 'alice@example.com', otp: lastCodeFor('alice@example.com'), newPassword: 'brandnew99' });
        await rejects(emailAuth.loginWithEmail({ email: 'alice@example.com', password: 'secret123' }), { status: 401 });
        assert.equal(await FoodRefreshToken.countDocuments({ userId: user._id }), 0, 'sessions revoked');
        await emailAuth.loginWithEmail({ email: 'alice@example.com', password: 'brandnew99' });
    });
    await check('a reset code allows OTP_MAX_ATTEMPTS guesses, then even the right code is refused', async () => {
        await emailAuth.forgotPassword({ email: 'alice@example.com' });
        const code = lastCodeFor('alice@example.com');
        const wrong = code === '999999' ? '999998' : '999999';
        for (let i = 0; i < (config.otpMaxAttempts || 5); i += 1) {
            await rejects(emailAuth.resetPassword({ email: 'alice@example.com', otp: wrong, newPassword: 'attacker12' }));
        }
        await rejects(emailAuth.resetPassword({ email: 'alice@example.com', otp: code, newPassword: 'attacker12' }), { message: /Too many attempts/ });
        await emailAuth.loginWithEmail({ email: 'alice@example.com', password: 'brandnew99' });
    });
    await check('emailed codes share the OTP request budget (429 past the limit)', async () => {
        config.otpRateLimit = 2;
        try {
            await emailAuth.forgotPassword({ email: 'budget@example.com' });
            await emailAuth.forgotPassword({ email: 'budget@example.com' });
            await rejects(emailAuth.forgotPassword({ email: 'budget@example.com' }), { status: 429 });
        } finally {
            config.otpRateLimit = 50;
        }
    });

    console.log('\nphone accounts add email sign-in');
    await check('a phone user adds email + password, verifies it, and signs in by email as the same account', async () => {
        const phoneUser = await FoodUser.create({ phone: '9876500001', name: 'Phone Pat', isVerified: true });
        const r = await emailAuth.addEmailLogin(phoneUser._id, { email: 'pat@example.com', password: 'patpass123' });
        assert.equal(r.verificationRequired, true);
        await emailAuth.verifyEmail({ email: 'pat@example.com', otp: lastCodeFor('pat@example.com') });
        const login = await emailAuth.loginWithEmail({ email: 'pat@example.com', password: 'patpass123' });
        assert.equal(String(login.user._id), String(phoneUser._id));
        assert.equal(login.user.phone, '9876500001', 'phone login is untouched');
        const security = await emailAuth.getAccountSecurity(phoneUser._id);
        assert.deepEqual([security.loginEmail, security.emailVerified, security.hasPassword], ['pat@example.com', true, true]);
    });
    await check("adding another account's email is a 409", async () => {
        const other = await FoodUser.create({ phone: '9876500002', isVerified: true });
        await rejects(emailAuth.addEmailLogin(other._id, { email: 'alice@example.com', password: 'whatever12' }), { status: 409 });
    });

    console.log('\nHTTP: codes the app can act on');
    const authRoutes = (await import('../src/core/auth/auth.routes.js')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', authRoutes);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
    const post = async (path, body, token) => {
        const res = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(body),
        });
        return { status: res.status, headers: res.headers, body: await res.json() };
    };
    await check('POST /user/email/login on a locked account: 423, code ACCOUNT_LOCKED, Retry-After', async () => {
        await FoodUser.updateOne({ loginEmail: 'second@example.com' }, { $set: { emailVerified: true, lockedUntil: new Date(Date.now() + 600_000) } });
        const r = await post('/user/email/login', { email: 'second@example.com', password: 'secret123' });
        assert.equal(r.status, 423);
        assert.equal(r.body.code, 'ACCOUNT_LOCKED');
        assert.ok(Number(r.headers.get('retry-after')) > 0);
    });
    await check('POST /user/email/register then /user/email/login: 201, then 403 EMAIL_NOT_VERIFIED', async () => {
        const reg = await post('/user/email/register', { email: 'http@example.com', password: 'httppass1', name: 'H' });
        assert.equal(reg.status, 201);
        const r = await post('/user/email/login', { email: 'http@example.com', password: 'httppass1' });
        assert.equal(r.status, 403);
        assert.equal(r.body.code, 'EMAIL_NOT_VERIFIED');
    });

    console.log('\nGoogle');
    const googlePayloads = {
        'g-alice': { iss: 'https://accounts.google.com', aud: 'web-client.apps.googleusercontent.com', sub: 'g-100', email: 'alice@example.com', email_verified: true, name: 'Alice G' },
        'g-bob': { iss: 'accounts.google.com', aud: 'android-client.apps.googleusercontent.com', sub: 'g-200', email: 'bob@example.com', email_verified: true, name: 'Bob' },
        'g-unverified-alice': { iss: 'https://accounts.google.com', aud: 'web-client.apps.googleusercontent.com', sub: 'g-300', email: 'alice@example.com', email_verified: false },
        'g-other-app': { iss: 'https://accounts.google.com', aud: 'someone-else.apps.googleusercontent.com', sub: 'g-400', email: 'eve@example.com', email_verified: true },
    };
    const googleCalls = [];
    social.__setSocialVerifiersForTests({
        google: {
            verifyIdToken: async ({ idToken, audience }) => {
                googleCalls.push({ idToken, audience });
                const payload = googlePayloads[idToken];
                if (!payload) throw new Error('Invalid token signature');
                return { getPayload: () => payload };
            },
        },
    });
    await check('a bad Google token is rejected (401) and creates nothing', async () => {
        const before = await FoodUser.countDocuments();
        await rejects(social.signInWithProvider('google', { idToken: 'forged' }), { status: 401 });
        assert.equal(await FoodUser.countDocuments(), before);
    });
    await check('the configured client ids are passed as the audience', async () => {
        assert.deepEqual(googleCalls.at(-1).audience, ['web-client.apps.googleusercontent.com', 'android-client.apps.googleusercontent.com']);
    });
    await check('a token issued to another app is rejected', async () => {
        await rejects(social.signInWithProvider('google', { idToken: 'g-other-app' }), { status: 401 });
    });
    await check('Google with a verified email LINKS to the existing email account', async () => {
        const alice = await FoodUser.findOne({ loginEmail: 'alice@example.com' }).lean();
        const r = await social.signInWithProvider('google', { idToken: 'g-alice' });
        assert.equal(String(r.user._id), String(alice._id));
        assert.equal(r.linked, true);
        assert.equal(r.isNewUser, false);
        const again = await social.signInWithProvider('google', { idToken: 'g-alice' });
        assert.equal(String(again.user._id), String(alice._id));
        assert.equal(again.linked, false, 'found by provider id the second time');
        const stored = await FoodUser.findById(alice._id).lean();
        assert.equal(stored.authProviders.length, 1);
    });
    await check('an UNVERIFIED Google email never links to the account that owns it', async () => {
        const alice = await FoodUser.findOne({ loginEmail: 'alice@example.com' }).lean();
        const r = await social.signInWithProvider('google', { idToken: 'g-unverified-alice' });
        assert.notEqual(String(r.user._id), String(alice._id));
        assert.equal(r.isNewUser, true);
        assert.equal(r.user.loginEmail, undefined);
    });
    await check('a new Google user is created with their verified email as sign-in email', async () => {
        const r = await social.signInWithProvider('google', { idToken: 'g-bob' });
        assert.equal(r.isNewUser, true);
        assert.equal(r.user.loginEmail, 'bob@example.com');
        assert.equal(r.user.emailVerified, true);
        assert.equal(r.user.name, 'Bob');
        assert.deepEqual(r.user.authProviders.map((p) => p.provider), ['google']);
        assert.equal(r.user.authProviders[0].subject, undefined, 'provider subject is not sent to clients');
    });
    await check('two simultaneous first sign-ins make ONE account', async () => {
        googlePayloads['g-race'] = { iss: 'https://accounts.google.com', aud: 'web-client.apps.googleusercontent.com', sub: 'g-500', email: 'racer@example.com', email_verified: true };
        const results = await Promise.all([1, 2, 3].map(() => social.signInWithProvider('google', { idToken: 'g-race' })));
        assert.equal(new Set(results.map((r) => String(r.user._id))).size, 1);
        assert.equal(await FoodUser.countDocuments({ 'authProviders.subject': 'g-500' }), 1);
    });

    console.log('\nApple (real signed tokens, local key)');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    social.__setSocialVerifiersForTests({
        google: { verifyIdToken: async () => { throw new Error('not used'); } },
        appleKey: async (kid) => {
            if (kid !== 'apple-k1') throw new Error('unknown kid');
            return pubPem;
        },
    });
    const appleToken = (claims = {}, { key = privateKey, kid = 'apple-k1', expiresIn = '10m' } = {}) => jwt.sign(
        { email_verified: 'true', ...claims },
        key,
        { algorithm: 'RS256', keyid: kid, issuer: claims.iss || 'https://appleid.apple.com', audience: claims.aud || 'com.quickdrop.app', subject: claims.sub || 'apple-1', expiresIn },
    );
    const stripStd = (c) => { const { iss, aud, sub, ...rest } = c; return rest; };
    const signApple = (claims, opts) => appleToken({ ...claims }, opts);
    await check('a valid Apple token signs a new user in (name taken from the request)', async () => {
        const nonce = 'n-123';
        const token = jwt.sign(
            { email: 'carl@privaterelay.appleid.com', email_verified: 'true', nonce: crypto.createHash('sha256').update(nonce).digest('hex') },
            privateKey,
            { algorithm: 'RS256', keyid: 'apple-k1', issuer: 'https://appleid.apple.com', audience: 'com.quickdrop.app', subject: 'apple-carl', expiresIn: '5m' },
        );
        const r = await social.signInWithProvider('apple', { idToken: token, nonce, name: 'Carl' });
        assert.equal(r.isNewUser, true);
        assert.equal(r.user.name, 'Carl');
        assert.equal(r.user.loginEmail, 'carl@privaterelay.appleid.com');
    });
    await check('Apple rejects: wrong audience, wrong issuer, expired, other key, unknown kid, nonce mismatch, unsigned', async () => {
        const cases = [
            jwt.sign({ email_verified: 'true' }, privateKey, { algorithm: 'RS256', keyid: 'apple-k1', issuer: 'https://appleid.apple.com', audience: 'com.evil.app', subject: 'x1', expiresIn: '5m' }),
            jwt.sign({ email_verified: 'true' }, privateKey, { algorithm: 'RS256', keyid: 'apple-k1', issuer: 'https://evil.example.com', audience: 'com.quickdrop.app', subject: 'x2', expiresIn: '5m' }),
            jwt.sign({ email_verified: 'true', exp: Math.floor(Date.now() / 1000) - 3600 }, privateKey, { algorithm: 'RS256', keyid: 'apple-k1', issuer: 'https://appleid.apple.com', audience: 'com.quickdrop.app', subject: 'x3' }),
            jwt.sign({ email_verified: 'true' }, other.privateKey, { algorithm: 'RS256', keyid: 'apple-k1', issuer: 'https://appleid.apple.com', audience: 'com.quickdrop.app', subject: 'x4', expiresIn: '5m' }),
            jwt.sign({ email_verified: 'true' }, privateKey, { algorithm: 'RS256', keyid: 'apple-k9', issuer: 'https://appleid.apple.com', audience: 'com.quickdrop.app', subject: 'x5', expiresIn: '5m' }),
            `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'apple-k1' })).toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'https://appleid.apple.com', aud: 'com.quickdrop.app', sub: 'x6', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.`,
        ];
        for (const [i, token] of cases.entries()) {
            await rejects(social.signInWithProvider('apple', { idToken: token }), { status: 401, message: /Apple sign-in could not be verified/ }).catch((e) => { throw new Error(`case ${i}: ${e.message}`); });
        }
        const withNonce = jwt.sign({ nonce: 'expected' }, privateKey, { algorithm: 'RS256', keyid: 'apple-k1', issuer: 'https://appleid.apple.com', audience: 'com.quickdrop.app', subject: 'x7', expiresIn: '5m' });
        await rejects(social.signInWithProvider('apple', { idToken: withNonce, nonce: 'different' }), { status: 401 });
        assert.equal(await FoodUser.countDocuments({ 'authProviders.subject': { $in: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'] } }), 0);
    });
    await check('Apple sign-in on a squatted, UNVERIFIED email links and discards the squatter password', async () => {
        await emailAuth.registerWithEmail({ email: 'dana@example.com', password: 'squatter1', name: 'Squatter' });
        const pending = await FoodUser.findOne({ loginEmail: 'dana@example.com' }).lean();
        const token = jwt.sign({ email: 'dana@example.com', email_verified: true }, privateKey, { algorithm: 'RS256', keyid: 'apple-k1', issuer: 'https://appleid.apple.com', audience: 'com.quickdrop.app', subject: 'apple-dana', expiresIn: '5m' });
        const r = await social.signInWithProvider('apple', { idToken: token });
        assert.equal(String(r.user._id), String(pending._id));
        assert.equal(r.linked, true);
        const stored = await FoodUser.findById(pending._id).select('+passwordHash').lean();
        assert.equal(stored.passwordHash, undefined, "the squatter's password is gone");
        assert.equal(stored.emailVerified, true);
        await rejects(emailAuth.loginWithEmail({ email: 'dana@example.com', password: 'squatter1' }), { status: 401 });
    });
    await check('linking an Apple account that already belongs to someone else is a 409', async () => {
        const bob = await FoodUser.findOne({ loginEmail: 'bob@example.com' }).lean();
        const token = jwt.sign({}, privateKey, { algorithm: 'RS256', keyid: 'apple-k1', issuer: 'https://appleid.apple.com', audience: 'com.quickdrop.app', subject: 'apple-dana', expiresIn: '5m' });
        await rejects(social.linkProvider(bob._id, 'apple', { idToken: token }), { status: 409 });
    });
    await check('with no client ids configured, a provider is refused outright (503)', async () => {
        const saved = process.env.APPLE_CLIENT_IDS;
        delete process.env.APPLE_CLIENT_IDS;
        try {
            await rejects(social.signInWithProvider('apple', { idToken: signApple(stripStd({})) }), { status: 503 });
        } finally {
            process.env.APPLE_CLIENT_IDS = saved;
        }
    });

    console.log('\nsocial accounts add a phone');
    await check('a social-only user adds a phone by OTP; a phone owned by someone else is refused', async () => {
        config.useDefaultOtp = true; // fixed 1234, nothing is sent by SMS
        try {
            const bob = await FoodUser.findOne({ loginEmail: 'bob@example.com' }).lean();
            await rejects(emailAuth.requestPhoneLink(bob._id, { phone: '9876500001' }), { status: 409 });
            await emailAuth.requestPhoneLink(bob._id, { phone: '9876500077' });
            const r = await emailAuth.verifyPhoneLink(bob._id, { phone: '9876500077', otp: '1234' });
            assert.equal(r.user.phone, '9876500077');
            assert.equal(r.user.needsPhone, false);
        } finally {
            config.useDefaultOtp = false;
        }
    });

    server.close();
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
