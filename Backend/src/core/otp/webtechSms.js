/**
 * Login codes by SMS through WebTech (smpp.webtechsolution.co), sender QKDRPS.
 *
 * Switched on by SMS_PROVIDER=webtech with WEBTECH_SMS_AUTH_KEY set; otherwise
 * every caller keeps using SMS India Hub exactly as before. The auth key is
 * the panel's "Private Auth Token-Key" (API Collections page), so the panel
 * password is never needed here. All values live in the server's .env only.
 *
 * DLT: the text must match the registered template character for character,
 * spaces before the full stops included, or the operator drops the message.
 * Registered "App Login Temp" (id 1077028660045857084):
 *   Your Quickdrop Login OTP is {#num#} . Do not Share it with anyone . Quickdrops Pvt Ltd
 * WEBTECH_SMS_TEMPLATE_TEXT overrides it; {{OTP}} (or the panel's {#num#} /
 * {#var#}) marks where the code goes.
 *
 * Used by the shared OTP service (customer, rider, seller), taxi's SMS service
 * and the service-provider module, so one switch moves every login code.
 */

export const WEBTECH_DEFAULT_TEMPLATE =
    'Your Quickdrop Login OTP is {{OTP}} . Do not Share it with anyone . Quickdrops Pvt Ltd';
export const WEBTECH_DEFAULT_TEMPLATE_ID = '1077028660045857084';

const str = (v) => String(v ?? '').trim();

export function webtechConfig() {
    return {
        url: str(process.env.WEBTECH_SMS_URL) || 'http://smpp.webtechsolution.co/http-tokenkeyapi.php',
        authKey: str(process.env.WEBTECH_SMS_AUTH_KEY),
        senderId: str(process.env.WEBTECH_SMS_SENDER_ID) || 'QKDRPS',
        // Route 1 is this account's transactional route (route 2 from the panel's example is refused).
        route: str(process.env.WEBTECH_SMS_ROUTE) || '1',
        templateId: str(process.env.WEBTECH_SMS_TEMPLATE_ID) || WEBTECH_DEFAULT_TEMPLATE_ID,
        templateText: str(process.env.WEBTECH_SMS_TEMPLATE_TEXT) || WEBTECH_DEFAULT_TEMPLATE,
        timeoutMs: Number(process.env.WEBTECH_SMS_TIMEOUT_MS) || 15000,
    };
}

/** Is WebTech the provider for login codes right now? */
export const webtechEnabled = () =>
    str(process.env.SMS_PROVIDER).toLowerCase() === 'webtech' && Boolean(webtechConfig().authKey);

/** The message for this code, or null when the template has nowhere to put it. */
export function webtechMessage(otp, template = webtechConfig().templateText) {
    const code = str(otp);
    if (!code) return null;
    const msg = str(template).replace(/\{\{\s*OTP\s*\}\}|\{#\s*(num|numeric|var)\s*#\}/gi, code);
    return msg.includes(code) ? msg : null;
}

// Failures: the panel's codes 002-011 and 021-023, or any refusal wording
// ("Please Provide valid routeid" came back as plain text with HTTP 200).
// Success looks like "msg-id : ODUxNDkwMQ==".
const FAILURE = /\b0(0[2-9]|1[01]|2[1-3])\b|failed|invalid|valid\s*route|provide|insufficient|not\s+found|oops/i;

/**
 * Send one login code. Never throws.
 * @returns {Promise<{ sent: boolean, error?: string, response?: string }>}
 */
export async function sendOtpViaWebtech(phone, otp) {
    const cfg = webtechConfig();
    if (!cfg.authKey) return { sent: false, error: 'WEBTECH_SMS_AUTH_KEY is not set' };
    const number = String(phone || '').replace(/\D/g, '').slice(-10);
    if (number.length !== 10) return { sent: false, error: 'not a 10-digit mobile number' };
    const message = webtechMessage(otp, cfg.templateText);
    if (!message) return { sent: false, error: 'template has no place for the code' };

    const url = new URL(cfg.url);
    url.searchParams.set('authentic-key', cfg.authKey);
    url.searchParams.set('senderid', cfg.senderId);
    url.searchParams.set('route', cfg.route);
    url.searchParams.set('number', number);
    url.searchParams.set('message', message);
    url.searchParams.set('templateid', cfg.templateId);

    try {
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(cfg.timeoutMs) });
        const text = (await res.text()).trim();
        const masked = number.replace(/^(\d{2})\d{5}/, '$1*****');
        if (!res.ok || !text || FAILURE.test(text)) {
            console.error(`[SMS webtech] not sent to ${masked}: HTTP ${res.status} ${text.slice(0, 200)}`);
            return { sent: false, error: text.slice(0, 200) || `HTTP ${res.status}`, response: text };
        }
        console.info(`[SMS webtech] sent to ${masked}: ${text.slice(0, 120)}`);
        return { sent: true, response: text };
    } catch (err) {
        console.error(`[SMS webtech] request failed: ${err.message}`);
        return { sent: false, error: err.message };
    }
}
