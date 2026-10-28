/**
 * Logging out must not be able to fail -- in either auth stack.
 *
 * A rejected logout is not a cosmetic 400: the controller aborts before the
 * fcmToken is unregistered, so the device stays subscribed and a logged-out
 * user keeps receiving push notifications. The cases below are the shapes real
 * clients were observed sending: a null token, and no token field at all.
 *
 * Both validators are exercised here on purpose. The app runs two parallel auth
 * stacks -- src/dtos/auth (mounted at /v1/food/auth) and
 * src/modules/quickCommerce/dtos/auth (mounted at /v1/qc/auth) -- with
 * near-identical code. Fixing one and assuming the other followed is exactly
 * the mistake that left /v1/food/auth/logout still returning 400 after the QC
 * side was repaired, so they are asserted together to keep them from drifting.
 *
 * Run: node src/dtos/auth/__checks__/logout.check.js
 */
import { validateLogoutDto as validateFood } from '../logout.dto.js';
import { validateLogoutDto as validateQc } from '../../../modules/quickCommerce/dtos/auth/logout.dto.js';

const STACKS = [
    ['food (/v1/food/auth)', validateFood],
    ['qc   (/v1/qc/auth)', validateQc],
];

let failures = 0;

const accepts = (stack, validate, label, body) => {
    try {
        const parsed = validate(body);
        console.log(`  PASS  [${stack}] ${label}`);
        return parsed;
    } catch (error) {
        failures += 1;
        console.log(`  FAIL  [${stack}] ${label} -- rejected with: ${error.message}`);
        return null;
    }
};

const rejects = (stack, validate, label, body) => {
    try {
        validate(body);
        failures += 1;
        console.log(`  FAIL  [${stack}] ${label} -- was accepted but should not be`);
    } catch {
        console.log(`  PASS  [${stack}] ${label}`);
    }
};

for (const [stack, validate] of STACKS) {
    // The shapes that were returning 400 in production.
    accepts(stack, validate, 'null refreshToken', { refreshToken: null });
    accepts(stack, validate, 'missing refreshToken', {});
    accepts(stack, validate, 'undefined refreshToken', { refreshToken: undefined });

    // The FCM token must survive parsing, because detaching it is the part of
    // logout that still has to happen when there is no refresh token.
    const withFcm = accepts(stack, validate, 'null refreshToken keeps fcmToken', {
        refreshToken: null,
        fcmToken: 'device-token-abc',
        platform: 'mobile',
    });
    if (withFcm && withFcm.fcmToken !== 'device-token-abc') {
        failures += 1;
        console.log(`  FAIL  [${stack}] fcmToken dropped: ${JSON.stringify(withFcm.fcmToken)}`);
    }

    // A real token still parses through unchanged.
    const normal = accepts(stack, validate, 'a real refreshToken', { refreshToken: 'abc123' });
    if (normal && normal.refreshToken !== 'abc123') {
        failures += 1;
        console.log(`  FAIL  [${stack}] refreshToken not returned intact`);
    }

    // Absence is fine; present-but-wrong is still a client bug worth surfacing.
    rejects(stack, validate, 'empty-string refreshToken still rejected', { refreshToken: '' });
    rejects(stack, validate, 'non-string refreshToken still rejected', { refreshToken: 42 });
}

console.log(failures ? `\n${failures} FAILED` : '\nall logout DTO checks passed (both stacks)');
process.exit(failures ? 1 : 0);
