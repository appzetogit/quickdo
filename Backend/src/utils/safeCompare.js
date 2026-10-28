import crypto from 'crypto';

/**
 * Constant-time comparison for HMAC signatures and other secrets.
 *
 * `===` on a signature returns as soon as two bytes differ, so response time leaks
 * how many leading characters were correct and the value can be recovered byte by
 * byte. Lengths are compared first because timingSafeEqual throws when the buffers
 * differ in length — that length check is itself non-constant-time, which is fine:
 * the length of a hex-encoded HMAC is public.
 *
 * Non-string or empty input is a mismatch, never a pass.
 *
 * Service-Provider code cannot import this (it is CommonJS by its own package.json)
 * and inlines the same three lines.
 *
 * @param {string} expected signature computed server-side
 * @param {string} actual signature supplied by the caller
 * @returns {boolean}
 */
export const safeSignatureEqual = (expected, actual) => {
    if (typeof expected !== 'string' || !expected) return false;
    if (typeof actual !== 'string' || !actual) return false;
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(actual);
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
};
