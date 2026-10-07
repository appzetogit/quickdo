/**
 * Make a request body safe to keep in the admin activity log.
 *
 * The log exists so somebody can later see WHAT an admin changed. It must never
 * become a second copy of the platform's secrets: a password typed into a reset
 * form, an SMTP password saved in settings, a Razorpay secret, an OTP, a card or
 * bank account number. So:
 *
 *   - any key that names a secret is replaced by '[REDACTED]', whatever its value;
 *   - any string that LOOKS like a card number or a JWT is redacted wherever it is;
 *   - long strings are cut, arrays and objects are capped, depth is limited, and the
 *     whole summary has a size ceiling -- the log is a summary, not an archive.
 *
 * Pure and synchronous, so it is testable on its own.
 */

export const REDACTED = '[REDACTED]';

const SECRET_KEY_PARTS = [
    'password', 'passwd', 'passcode', 'secret', 'token', 'otp', 'cvv', 'cvc',
    'cardnumber', 'card_number', 'cardno', 'accountnumber', 'account_number', 'accountno',
    'iban', 'ifsc', 'aadhaar', 'aadhar', 'apikey', 'api_key', 'privatekey', 'private_key',
    'signature', 'authorization', 'cookie', 'credential', 'session', 'refresh',
];
// Matched only as the whole key (or its suffix), because as substrings they are
// common in harmless names ('pincode', 'passenger', 'monkey').
const SECRET_KEY_EXACT = new Set(['pass', 'pin', 'mpin', 'key', 'pan', 'pannumber', 'pan_number', 'upipin', 'code']);

const MAX_DEPTH = 4;
const MAX_STRING = 200;
const MAX_ARRAY = 10;
const MAX_KEYS = 40;
const MAX_JSON = 4000;

export const isSecretKey = (key) => {
    const k = String(key || '').toLowerCase();
    if (!k) return false;
    if (SECRET_KEY_EXACT.has(k)) return true;
    if (k.endsWith('pin') && k.length <= 6) return true; // mpin, upipin
    if (k.endsWith('key') && k !== 'key' && !/(sort|group|lookup|row|setting|idempotency|cache|route)key$/.test(k)) {
        // apiKey, secretKey, keySecret are covered above; a bare '...Key' is usually a credential.
        return true;
    }
    return SECRET_KEY_PARTS.some((part) => k.includes(part));
};

/** A value that is a secret by its shape, whatever key it sits under. */
const looksSecret = (value) => {
    const s = String(value);
    const digits = s.replace(/[\s-]/g, '');
    if (/^\d{13,19}$/.test(digits)) return true; // card / long account numbers
    if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(s)) return true; // a JWT
    if (/^(rzp_(live|test)_|sk_live_|sk_test_)/.test(s)) return true; // gateway keys
    return false;
};

/**
 * Secrets embedded in free text ("refund to card 4111 1111 1111 1111"): card-length
 * digit runs (spaces / dashes allowed), JWTs and gateway keys are cut out of the
 * string, the rest of it is kept.
 */
const scrubText = (s) => s
    .replace(/\d(?:[ -]?\d){12,18}/g, REDACTED)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED)
    .replace(/\b(?:rzp_(?:live|test)_|sk_live_|sk_test_)\w+/g, REDACTED);

const summarizeValue = (value, depth) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        if (looksSecret(value)) return REDACTED;
        const clean = scrubText(value);
        return clean.length > MAX_STRING ? `${clean.slice(0, MAX_STRING)}…(${clean.length} chars)` : clean;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        if (typeof value === 'number' && looksSecret(String(value))) return REDACTED;
        return value;
    }
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer?.(value)) return `[binary ${value.length} bytes]`;
    if (Array.isArray(value)) {
        if (depth >= MAX_DEPTH) return `[array(${value.length})]`;
        const out = value.slice(0, MAX_ARRAY).map((v) => summarizeValue(v, depth + 1));
        if (value.length > MAX_ARRAY) out.push(`…(+${value.length - MAX_ARRAY} more)`);
        return out;
    }
    if (typeof value === 'object') {
        if (depth >= MAX_DEPTH) return '[object]';
        const out = {};
        const entries = Object.entries(value);
        for (const [k, v] of entries.slice(0, MAX_KEYS)) {
            out[k] = isSecretKey(k) ? REDACTED : summarizeValue(v, depth + 1);
        }
        if (entries.length > MAX_KEYS) out['…'] = `+${entries.length - MAX_KEYS} more keys`;
        return out;
    }
    return `[${typeof value}]`;
};

/**
 * @param {*} body       req.body
 * @param {*} [files]    req.file / req.files (multer): only names and sizes are kept
 * @returns {object|undefined}
 */
export const redactForAudit = (body, files) => {
    let summary = body && typeof body === 'object' && Object.keys(body).length ? summarizeValue(body, 0) : undefined;
    const fileList = files ? (Array.isArray(files) ? files : (files.fieldname ? [files] : Object.values(files).flat())) : [];
    if (fileList.length) {
        summary = { ...(summary || {}), _files: fileList.slice(0, MAX_ARRAY).map((f) => `${f.fieldname || 'file'}:${f.originalname || ''} (${f.size || 0} bytes)`) };
    }
    if (summary === undefined) return undefined;
    const json = JSON.stringify(summary);
    if (json.length > MAX_JSON) {
        return { _truncated: true, _keys: Object.keys(summary).slice(0, MAX_KEYS), _size: json.length };
    }
    return summary;
};

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * Every id a request names: ObjectId path segments, route params and body fields
 * called `id`, `*Id` or `*Ids`. Capped; ids only, never other values.
 */
export const collectTargetIds = ({ path = '', params = {}, body = {} } = {}) => {
    const ids = new Set();
    for (const seg of String(path).split('?')[0].split('/')) {
        if (OBJECT_ID.test(seg)) ids.add(seg);
    }
    for (const v of Object.values(params || {})) {
        if (v && String(v).length <= 64) ids.add(String(v));
    }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        for (const [k, v] of Object.entries(body)) {
            if (!/(^id$|Id$|Ids$|_id$)/.test(k) || isSecretKey(k)) continue;
            for (const one of Array.isArray(v) ? v.slice(0, MAX_ARRAY) : [v]) {
                if (one && (typeof one === 'string' || typeof one === 'number') && String(one).length <= 64) ids.add(String(one));
            }
        }
    }
    return [...ids].slice(0, 20);
};
