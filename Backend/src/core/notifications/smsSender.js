import { smsCredentials } from '../settings/platformProfile.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Plain (non-OTP) SMS through SMS India Hub -- the gateway the OTP flow already
 * uses (core/otp/otp.service.js), with the same credentials (Master settings,
 * else .env).
 *
 * India requires every commercial SMS to match a registered DLT template. The OTP
 * template does not fit a broadcast, so a broadcast uses
 * SMS_INDIA_HUB_BROADCAST_TEMPLATE_ID when it is set; without it the message is
 * sent with no template id and the operator may reject it (logged).
 */

export const smsConfigured = () => {
    const s = smsCredentials();
    return Boolean(s.apiKey && s.senderId);
};

const msisdnOf = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 10) return null;
    return digits.length === 10 ? `91${digits}` : digits;
};

/** @returns {Promise<{sent: boolean, skipped?: boolean, error?: string}>} */
export async function sendPlainSms(phone, message, { templateId } = {}) {
    const sms = smsCredentials();
    if (!sms.apiKey || !sms.senderId) {
        logger.warn('[SMS] not configured; message skipped');
        return { sent: false, skipped: true, error: 'SMS is not configured' };
    }
    const msisdn = msisdnOf(phone);
    if (!msisdn) return { sent: false, skipped: true, error: 'no valid phone number' };
    try {
        const url = new URL(String(process.env.SMS_INDIA_HUB_URL || '').trim() || 'http://cloud.smsindiahub.in/vendorsms/pushsms.aspx');
        url.searchParams.append('APIKey', sms.apiKey);
        url.searchParams.append('sid', sms.senderId);
        url.searchParams.append('msisdn', msisdn);
        url.searchParams.append('msg', String(message || '').slice(0, 900));
        url.searchParams.append('gwid', String(process.env.SMS_INDIA_HUB_GWID || '2').trim() || '2');
        url.searchParams.append('fl', '0');
        const dlt = templateId || process.env.SMS_INDIA_HUB_BROADCAST_TEMPLATE_ID;
        if (dlt) url.searchParams.append('DLT_TE_ID', String(dlt));
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const text = (await response.text()).slice(0, 300);
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* plain text */ }
        if (parsed?.ErrorCode && parsed.ErrorCode !== '000') return { sent: false, error: `provider ErrorCode ${parsed.ErrorCode}` };
        if (!response.ok) return { sent: false, error: `HTTP ${response.status}` };
        return { sent: true };
    } catch (err) {
        return { sent: false, error: err.message };
    }
}
