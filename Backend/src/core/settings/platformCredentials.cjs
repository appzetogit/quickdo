/**
 * Integration credentials for CommonJS code (the service-provider module).
 *
 * Same answer as platformProfile.service.js -- Master settings if saved there,
 * else .env -- read from the getters that module publishes on globalThis. That
 * module is loaded at startup by the rest of the API; the import below makes
 * sure of it. Until it has loaded (the first moments of boot), .env is used,
 * which is exactly what was used before Master settings existed.
 */
import('./platformProfile.service.js').catch(() => {});

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

const razorpayCredentials = () => {
  const shared = globalThis.__qdPlatformCredentials;
  if (shared) return shared.razorpayCredentials();
  return {
    keyId: str(process.env.RAZORPAY_KEY_ID),
    keySecret: str(process.env.RAZORPAY_KEY_SECRET),
    webhookSecret: str(process.env.RAZORPAY_WEBHOOK_SECRET),
    source: 'env',
  };
};

const emailCredentials = () => {
  const shared = globalThis.__qdPlatformCredentials;
  if (shared) return shared.emailCredentials();
  const port = parseInt(process.env.EMAIL_PORT, 10) || 587;
  return {
    host: str(process.env.EMAIL_HOST),
    port,
    secure: port === 465,
    user: str(process.env.EMAIL_USER),
    pass: str(process.env.EMAIL_PASS),
    from: str(process.env.EMAIL_FROM) || str(process.env.EMAIL_USER),
    source: 'env',
  };
};

const smsCredentials = () => {
  const shared = globalThis.__qdPlatformCredentials;
  if (shared) return shared.smsCredentials();
  return {
    apiKey: str(process.env.SMS_INDIA_HUB_API_KEY_OVERRIDE) || str(process.env.SMS_INDIA_HUB_API_KEY),
    senderId: str(process.env.SMS_INDIA_HUB_SENDER_ID),
    templateId: str(process.env.SMS_INDIA_HUB_DLT_TEMPLATE_ID),
    templateText: str(process.env.SMS_INDIA_HUB_TEMPLATE_TEXT),
    source: 'env',
  };
};

module.exports = {
  smsCredentials,
  emailCredentials,
  razorpayCredentials,
  razorpayKeyId: () => razorpayCredentials().keyId,
  razorpayKeySecret: () => razorpayCredentials().keySecret,
};
