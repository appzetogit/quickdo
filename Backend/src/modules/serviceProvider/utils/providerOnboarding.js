/**
 * Onboarding helpers shared by the vendor and worker endpoints (plan §3.3).
 */
const { VERIFICATION_ITEMS, VERIFICATION_STATUS } = require('../models/providerProfileFields');

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;
const UPI_RE = /^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

const DEFAULT_REQUIRED = {
  vendor: ['aadhaar', 'pan', 'address'],
  worker: ['aadhaar', 'address']
};

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * Validate bank details. Either a bank account (number + IFSC + holder name) or a
 * UPI id is required. Returns { value } or { error }.
 */
const normalizeBankDetails = (input) => {
  if (!input || typeof input !== 'object') return { error: 'bankDetails must be an object' };
  const value = {
    accountNumber: clean(input.accountNumber).replace(/\s+/g, ''),
    ifscCode: clean(input.ifscCode || input.ifsc).toUpperCase(),
    accountHolderName: clean(input.accountHolderName),
    bankName: clean(input.bankName),
    upiId: clean(input.upiId)
  };
  const hasAccount = value.accountNumber || value.ifscCode;
  if (!hasAccount && !value.upiId) return { error: 'Provide a bank account (accountNumber + ifscCode) or a upiId' };
  if (hasAccount) {
    if (!ACCOUNT_RE.test(value.accountNumber)) return { error: 'accountNumber must be 9 to 18 digits' };
    if (!IFSC_RE.test(value.ifscCode)) return { error: 'ifscCode is not a valid IFSC (e.g. SBIN0001234)' };
    if (!value.accountHolderName) return { error: 'accountHolderName is required with a bank account' };
  }
  if (value.upiId && !UPI_RE.test(value.upiId)) return { error: 'upiId is not a valid UPI id' };
  return { value };
};

/** True when saved/given details are enough to pay out to. */
const hasPayoutDetails = (b) => !!(b && ((b.accountNumber && b.ifscCode) || b.upiId));

/**
 * Bank details for a withdrawal: the request's own (validated) or, when none are
 * given, the provider's saved profile details. Returns { value } or { error }.
 */
const withdrawalBankDetails = (given, saved) => {
  const provided = given && typeof given === 'object' && Object.values(given).some((v) => clean(v));
  if (provided) return normalizeBankDetails(given);
  const plain = saved && typeof saved.toObject === 'function' ? saved.toObject() : saved;
  if (!hasPayoutDetails(plain)) {
    return { error: 'No bank details on your profile. Save them with PUT /bank-details or send bankDetails.' };
  }
  return normalizeBankDetails(plain);
};

const maskAccountNumber = (n) => {
  const s = clean(n);
  if (!s) return '';
  return s.length <= 4 ? s : `${'X'.repeat(s.length - 4)}${s.slice(-4)}`;
};

const maskedBankDetails = (b) => {
  if (!b) return null;
  const plain = typeof b.toObject === 'function' ? b.toObject() : b;
  if (!Object.values(plain).some(Boolean)) return null;
  return { ...plain, accountNumber: maskAccountNumber(plain.accountNumber) };
};

const requiredVerifications = (settings, providerType) => {
  const key = providerType === 'vendor' ? 'vendorRequiredVerifications' : 'workerRequiredVerifications';
  const list = Array.isArray(settings?.[key]) ? settings[key] : DEFAULT_REQUIRED[providerType];
  return list.filter((i) => VERIFICATION_ITEMS.includes(i));
};

/** Required checklist items that are not 'verified' yet. */
const missingVerifications = (provider, required) =>
  required.filter((item) => provider?.verification?.[item]?.status !== 'verified');

const verificationSummary = (provider, required) => ({
  required,
  missing: missingVerifications(provider, required),
  items: Object.fromEntries(VERIFICATION_ITEMS.map((k) => {
    const v = provider?.verification?.[k] || {};
    return [k, {
      status: v.status || 'pending',
      verifiedBy: v.verifiedBy || null,
      verifiedAt: v.verifiedAt || null,
      note: v.note || null,
      required: required.includes(k)
    }];
  }))
});

/**
 * Apply the onboarding fields from a request body to a provider document.
 * Returns { error } or { changed: [fieldNames] }. Category handling is async and
 * done by the caller (utils/categoryRefs.js).
 */
const applyOnboardingFields = (doc, body, providerType) => {
  const changed = [];
  if (body.gst !== undefined) {
    const g = body.gst || {};
    const number = clean(g.number).toUpperCase();
    if (number && !GSTIN_RE.test(number)) return { error: 'gst.number is not a valid GSTIN' };
    const prev = doc.gst || {};
    const numberChanged = number !== (prev.number || '');
    doc.gst = {
      number: number || null,
      document: g.document !== undefined ? (clean(g.document) || null) : (prev.document || null),
      // A provider can never mark their own GST verified; a new number un-verifies it.
      verified: numberChanged ? false : !!prev.verified
    };
    if (numberChanged && doc.verification?.gst) {
      doc.verification.gst = { status: 'pending', verifiedBy: null, verifiedAt: null, note: null, source: 'manual' };
    }
    changed.push('gst');
  }
  if (body.pan !== undefined && providerType === 'worker') {
    const p = body.pan || {};
    const number = clean(p.number).toUpperCase();
    if (number && !PAN_RE.test(number)) return { error: 'pan.number is not a valid PAN' };
    doc.pan = {
      number: number || null,
      document: p.document !== undefined ? (clean(p.document) || null) : (doc.pan?.document || null)
    };
    changed.push('pan');
  }
  if (body.experienceYears !== undefined) {
    const n = body.experienceYears === null || body.experienceYears === '' ? null : Number(body.experienceYears);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 80)) return { error: 'experienceYears must be between 0 and 80' };
    doc.experienceYears = n;
    changed.push('experienceYears');
  }
  if (body.certifications !== undefined) {
    if (!Array.isArray(body.certifications)) return { error: 'certifications must be an array' };
    const list = [];
    for (const c of body.certifications) {
      if (!c || !clean(c.name)) return { error: 'every certification needs a name' };
      const expiresAt = c.expiresAt ? new Date(c.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) return { error: 'certification expiresAt must be a date' };
      list.push({ name: clean(c.name), issuer: clean(c.issuer) || null, document: clean(c.document) || null, expiresAt });
    }
    doc.certifications = list;
    changed.push('certifications');
  }
  if (body.serviceRadiusKm !== undefined && providerType === 'worker') {
    const n = body.serviceRadiusKm === null || body.serviceRadiusKm === '' ? null : Number(body.serviceRadiusKm);
    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 200)) return { error: 'serviceRadiusKm must be between 1 and 200' };
    doc.serviceRadiusKm = n;
    changed.push('serviceRadiusKm');
  }
  return { changed };
};

module.exports = {
  IFSC_RE,
  GSTIN_RE,
  PAN_RE,
  VERIFICATION_ITEMS,
  VERIFICATION_STATUS,
  normalizeBankDetails,
  hasPayoutDetails,
  withdrawalBankDetails,
  maskAccountNumber,
  maskedBankDetails,
  requiredVerifications,
  missingVerifications,
  verificationSummary,
  applyOnboardingFields
};
