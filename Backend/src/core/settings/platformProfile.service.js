/**
 * Master settings: one brand, one set of contact details, one set of legal
 * pages and one set of integration credentials for the whole platform.
 *
 * THE RULE: a value saved here wins everywhere; an empty value means "not
 * managed here" and every reader keeps what it used before -- each service's
 * own record for brand/contact/legal, .env for integrations. So the day this
 * ships nothing changes, and each field moves over the moment an admin saves
 * it.
 *
 * Integration getters are SYNCHRONOUS on purpose. Payment and SMS code reads
 * credentials in many places, several at module scope; a sync getter backed by
 * an in-memory copy lets each site switch with a one-line change. The copy is
 * loaded at boot, refreshed every 30s (so the workers process follows too),
 * and reloaded immediately in the process that saves.
 */
import { PlatformProfile } from './platformProfile.model.js';
import { logger } from '../../utils/logger.js';

const REFRESH_MS = 30_000;
const SECRET_PATHS = [
  'integrations.razorpay.keySecret',
  'integrations.razorpay.webhookSecret',
  'integrations.sms.apiKey',
  'integrations.email.pass',
];

let cached = null;
let loadedAt = 0;
let loading = null;

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

const load = async () => {
  const doc = await PlatformProfile.findById('platform')
    .select(SECRET_PATHS.map((p) => `+${p}`).join(' '))
    .lean();
  cached = doc || {};
  loadedAt = Date.now();
  return cached;
};

/** Reload now (called after a save, and on a timer). Never throws. */
export const refreshPlatformProfile = async () => {
  if (!loading) {
    loading = load()
      .catch((err) => {
        logger.warn(`platformProfile: load failed, keeping previous values: ${err.message}`);
        return cached || {};
      })
      .finally(() => { loading = null; });
  }
  return loading;
};

/** The whole profile, secrets included. Server-side only. */
export const getPlatformProfile = async () => {
  if (cached && Date.now() - loadedAt < REFRESH_MS) return cached;
  return refreshPlatformProfile();
};

const snapshot = () => cached || {};

// Warm at import and keep fresh; unref so tests and scripts can exit.
refreshPlatformProfile();
const timer = setInterval(refreshPlatformProfile, REFRESH_MS);
timer.unref?.();

/* ------------------------------------------------------------------------ */
/* Integrations: master if set, else .env                                   */
/* ------------------------------------------------------------------------ */

/**
 * Razorpay keys. The key pair moves as one: both id and secret must be saved
 * here before either is used, so a half-entered pair can never mix accounts.
 */
export const razorpayCredentials = () => {
  const r = snapshot().integrations?.razorpay || {};
  const master = str(r.keyId) && str(r.keySecret);
  return {
    keyId: master ? str(r.keyId) : str(process.env.RAZORPAY_KEY_ID),
    keySecret: master ? str(r.keySecret) : str(process.env.RAZORPAY_KEY_SECRET),
    webhookSecret: str(r.webhookSecret) || str(process.env.RAZORPAY_WEBHOOK_SECRET),
    source: master ? 'master' : 'env',
  };
};
export const razorpayKeyId = () => razorpayCredentials().keyId;
export const razorpayKeySecret = () => razorpayCredentials().keySecret;
export const razorpayWebhookSecret = () => razorpayCredentials().webhookSecret;

/** SMS India Hub. The API key decides: once saved here, this block is used. */
export const smsCredentials = () => {
  const s = snapshot().integrations?.sms || {};
  const master = Boolean(str(s.apiKey));
  const pick = (m, e) => (master && str(m) ? str(m) : str(e));
  return {
    apiKey: master ? str(s.apiKey) : str(process.env.SMS_INDIA_HUB_API_KEY_OVERRIDE) || str(process.env.SMS_INDIA_HUB_API_KEY),
    senderId: pick(s.senderId, process.env.SMS_INDIA_HUB_SENDER_ID),
    templateId: pick(s.templateId, process.env.SMS_INDIA_HUB_DLT_TEMPLATE_ID),
    templateText: pick(s.templateText, process.env.SMS_INDIA_HUB_TEMPLATE_TEXT),
    source: master ? 'master' : 'env',
  };
};

/** SMTP. The host decides: once saved here, this block is used. */
export const emailCredentials = () => {
  const e = snapshot().integrations?.email || {};
  const master = Boolean(str(e.host));
  if (master) {
    const port = Number(e.port) || 587;
    return {
      host: str(e.host),
      port,
      secure: typeof e.secure === 'boolean' ? e.secure : port === 465,
      user: str(e.user),
      pass: str(e.pass).replace(/\s/g, ''),
      from: str(e.from) || str(e.user),
      source: 'master',
    };
  }
  const port = Number(process.env.EMAIL_PORT) || 587;
  return {
    host: str(process.env.EMAIL_HOST),
    port,
    secure: port === 465,
    user: str(process.env.EMAIL_USER),
    pass: str(process.env.EMAIL_PASS).replace(/\s/g, ''),
    from: str(process.env.EMAIL_FROM) || str(process.env.EMAIL_USER) || 'noreply@example.com',
    source: 'env',
  };
};

// For CommonJS code (service provider), which cannot import this module
// synchronously: see platformCredentials.cjs.
globalThis.__qdPlatformCredentials = { razorpayCredentials, smsCredentials, emailCredentials };

/* ------------------------------------------------------------------------ */
/* Brand, contact, legal: only the fields an admin has set                  */
/* ------------------------------------------------------------------------ */

export const LEGAL_KEYS = Object.freeze(['terms', 'privacy', 'refund', 'cancellation', 'shipping']);

/** The managed brand/contact/business values; unset fields are absent. */
export const managedBrand = async () => {
  const p = await getPlatformProfile();
  const out = {};
  const put = (key, value) => { if (str(value)) out[key] = str(value); };
  put('name', p.brand?.name);
  put('logoUrl', p.brand?.logoUrl);
  put('faviconUrl', p.brand?.faviconUrl);
  for (const k of ['email', 'phoneCountryCode', 'phone', 'whatsapp', 'address', 'city', 'state', 'pincode']) put(k, p.contact?.[k]);
  for (const k of ['legalName', 'gstin', 'pan', 'currencyCode', 'currencySymbol']) put(k, p.business?.[k]);
  return out;
};

/** The managed legal page for this key, or null to keep the service's own. */
export const managedLegalPage = async (key) => {
  if (!LEGAL_KEYS.includes(key)) return null;
  const content = str((await getPlatformProfile()).legal?.[key]);
  return content || null;
};

/**
 * Food / Quick Commerce business settings, with the managed values laid over
 * them. Same shape as those documents, so the apps need no change.
 */
export const overlayBusinessSettings = async (settings) => {
  if (!settings) return settings;
  const b = await managedBrand();
  if (!Object.keys(b).length) return settings;
  if (typeof settings.toObject === 'function') settings = settings.toObject();
  const out = { ...settings };
  if (b.name) out.companyName = b.name;
  if (b.email) out.email = b.email;
  if (b.phone) out.phone = { ...(settings.phone || {}), number: b.phone, ...(b.phoneCountryCode ? { countryCode: b.phoneCountryCode } : {}) };
  if (b.address) out.address = b.address;
  if (b.state) out.state = b.state;
  if (b.pincode) out.pincode = b.pincode;
  if (b.logoUrl) out.logo = { ...(settings.logo || {}), url: b.logoUrl };
  if (b.faviconUrl) out.favicon = { ...(settings.favicon || {}), url: b.faviconUrl };
  return out;
};

/* ------------------------------------------------------------------------ */
/* Admin read / write                                                       */
/* ------------------------------------------------------------------------ */

const mask = (v) => {
  const s = str(v);
  if (!s) return '';
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
};

/** For the admin screen: everything, secrets reduced to their last four characters. */
export const getPlatformProfileForAdmin = async () => {
  const p = await refreshPlatformProfile();
  const i = p.integrations || {};
  const rz = razorpayCredentials();
  const sms = smsCredentials();
  const mail = emailCredentials();
  return {
    brand: { name: '', logoUrl: '', faviconUrl: '', ...(p.brand || {}) },
    contact: { email: '', phoneCountryCode: '', phone: '', whatsapp: '', address: '', city: '', state: '', pincode: '', ...(p.contact || {}) },
    business: { legalName: '', gstin: '', pan: '', currencyCode: '', currencySymbol: '', ...(p.business || {}) },
    legal: Object.fromEntries(LEGAL_KEYS.map((k) => [k, p.legal?.[k] || ''])),
    integrations: {
      razorpay: {
        keyId: str(i.razorpay?.keyId),
        keySecret: mask(i.razorpay?.keySecret),
        webhookSecret: mask(i.razorpay?.webhookSecret),
        inUse: { source: rz.source, keyId: rz.keyId, mode: rz.keyId.startsWith('rzp_live') ? 'live' : rz.keyId ? 'test' : 'none' },
      },
      sms: {
        apiKey: mask(i.sms?.apiKey),
        senderId: str(i.sms?.senderId),
        templateId: str(i.sms?.templateId),
        templateText: i.sms?.templateText || '',
        inUse: { source: sms.source, configured: Boolean(sms.apiKey), senderId: sms.senderId },
      },
      email: {
        host: str(i.email?.host),
        port: i.email?.port ?? null,
        user: str(i.email?.user),
        pass: mask(i.email?.pass),
        from: str(i.email?.from),
        inUse: { source: mail.source, configured: Boolean(mail.host && mail.user && mail.pass), host: mail.host, from: mail.from },
      },
    },
    updatedAt: p.updatedAt || null,
  };
};

const ALLOWED = {
  brand: ['name', 'logoUrl', 'faviconUrl'],
  contact: ['email', 'phoneCountryCode', 'phone', 'whatsapp', 'address', 'city', 'state', 'pincode'],
  business: ['legalName', 'gstin', 'pan', 'currencyCode', 'currencySymbol'],
  legal: LEGAL_KEYS,
  'integrations.razorpay': ['keyId', 'keySecret', 'webhookSecret'],
  'integrations.sms': ['apiKey', 'senderId', 'templateId', 'templateText'],
  'integrations.email': ['host', 'port', 'secure', 'user', 'pass', 'from'],
};
const SECRET_FIELDS = new Set(['keySecret', 'webhookSecret', 'apiKey', 'pass']);

const validate = (section, field, value) => {
  const bad = (m) => { const e = new Error(m); e.statusCode = 400; throw e; };
  if (value === '' || value === null) return value;
  if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) bad('Enter a valid email address');
  if ((field === 'phone' || field === 'whatsapp') && !/^\d{7,15}$/.test(value)) bad('Phone numbers must be 7 to 15 digits');
  if (field === 'pincode' && !/^\d{4,10}$/.test(value)) bad('Pincode must be 4 to 10 digits');
  if (field === 'name' && (value.length < 2 || value.length > 60)) bad('App name must be 2 to 60 characters');
  if (field === 'keyId' && !/^rzp_(live|test)_\w+$/.test(value)) bad('Razorpay key id starts with rzp_live_ or rzp_test_');
  if (field === 'port' && !(Number(value) > 0 && Number(value) < 65536)) bad('Port must be a number like 587 or 465');
  if (field === 'templateText' && !String(value).includes('{{OTP}}')) bad('The SMS template must contain {{OTP}} where the code goes');
  if ((field === 'logoUrl' || field === 'faviconUrl') && !/^https?:\/\//.test(value)) bad('Upload an image or paste an https:// link');
  return value;
};

/**
 * Save a partial profile: `{ brand: { name }, integrations: { razorpay: {...} } }`.
 * A secret sent as '' or still masked (starts with •) is left as it is; send
 * `null` to clear any field (back to "not managed here").
 */
export const updatePlatformProfile = async (payload = {}, updatedBy = '') => {
  const $set = {};
  for (const [section, fields] of Object.entries(ALLOWED)) {
    const incoming = section.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), payload);
    if (!incoming || typeof incoming !== 'object') continue;
    for (const field of fields) {
      if (!(field in incoming)) continue;
      let value = incoming[field];
      if (SECRET_FIELDS.has(field) && typeof value === 'string' && (value === '' || value.startsWith('•'))) continue;
      if (value === null || ((field === 'port' || field === 'secure') && value === '')) value = field === 'port' || field === 'secure' ? null : '';
      else if (field === 'port') value = Number(value);
      else if (field === 'secure') value = Boolean(value);
      else value = section === 'legal' || field === 'templateText' ? String(value) : str(value);
      $set[`${section}.${field}`] = validate(section, field, value);
    }
  }
  // Razorpay id and secret move together (see razorpayCredentials).
  if ('integrations.razorpay.keyId' in $set && $set['integrations.razorpay.keyId'] === '') {
    $set['integrations.razorpay.keySecret'] = '';
  }
  if (!Object.keys($set).length) return getPlatformProfileForAdmin();
  $set.updatedBy = str(updatedBy);
  await PlatformProfile.updateOne({ _id: 'platform' }, { $set }, { upsert: true });
  await refreshPlatformProfile();
  return getPlatformProfileForAdmin();
};

/**
 * Keep an older per-service screen and the master in step: when one of those
 * screens saves a field that is managed here, the master takes the new value,
 * so whichever screen an admin uses, every app shows the same thing.
 */
export const syncManagedFromLegacy = async (fields = {}) => {
  try {
    const managed = await managedBrand();
    const map = { name: 'brand.name', email: 'contact.email', phone: 'contact.phone', address: 'contact.address', state: 'contact.state', pincode: 'contact.pincode', logoUrl: 'brand.logoUrl', faviconUrl: 'brand.faviconUrl' };
    const $set = {};
    for (const [k, path] of Object.entries(map)) {
      if (managed[k] && str(fields[k]) && str(fields[k]) !== managed[k]) $set[path] = str(fields[k]);
    }
    if (Object.keys($set).length) {
      await PlatformProfile.updateOne({ _id: 'platform' }, { $set }, { upsert: true });
      await refreshPlatformProfile();
    }
  } catch (err) {
    logger.warn(`platformProfile: legacy sync skipped: ${err.message}`);
  }
};

export const syncManagedLegalFromLegacy = async (key, content) => {
  try {
    if (!(await managedLegalPage(key)) || !str(content)) return;
    await PlatformProfile.updateOne({ _id: 'platform' }, { $set: { [`legal.${key}`]: String(content) } });
    await refreshPlatformProfile();
  } catch (err) {
    logger.warn(`platformProfile: legal sync skipped: ${err.message}`);
  }
};
