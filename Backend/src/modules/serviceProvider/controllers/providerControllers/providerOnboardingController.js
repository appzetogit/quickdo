/**
 * Vendor / worker onboarding endpoints (plan §3.3). One implementation, mounted
 * for both roles: forRole('vendor') and forRole('worker') return the handlers.
 *
 *   GET  /onboarding              profile fields + verification checklist
 *   PUT  /onboarding              gst, pan (worker), experienceYears, certifications,
 *                                 serviceRadiusKm (worker), categories (names or ids)
 *   PUT  /bank-details            save payout details (IFSC validated)
 *   POST /email/send-otp          email a verification code
 *   POST /email/verify            check it and set isEmailVerified
 *   GET  /availability            weekly hours + overrides
 *   PUT  /availability            replace weekly hours (and optionally overrides)
 *   POST /availability/overrides  add/replace one date override (leave or custom hours)
 *   DELETE /availability/overrides/:date
 */
const mongoose = require('mongoose');
const Settings = require('../../models/Settings');
const Availability = require('../../models/Availability');
const {
  normalizeBankDetails,
  maskedBankDetails,
  requiredVerifications,
  verificationSummary,
  applyOnboardingFields
} = require('../../utils/providerOnboarding');
const { resolveCategoryRefs } = require('../../utils/categoryRefs');

const modelFor = (role) => (role === 'vendor' ? require('../../models/Vendor') : require('../../models/Worker'));

const PROFILE_FIELDS = 'name email phone isEmailVerified gst pan bankDetails experienceYears certifications serviceRadiusKm categoryIds categories service serviceCategories verification approvalStatus';

const onboardingView = (doc, role, settings) => {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    _id: o._id,
    email: o.email || null,
    isEmailVerified: !!o.isEmailVerified,
    approvalStatus: o.approvalStatus,
    gst: o.gst || { number: null, document: null, verified: false },
    ...(role === 'worker' ? { pan: o.pan || { number: null, document: null }, serviceRadiusKm: o.serviceRadiusKm ?? null } : {}),
    experienceYears: o.experienceYears ?? null,
    certifications: o.certifications || [],
    categoryIds: o.categoryIds || [],
    categories: role === 'vendor' ? (o.categories?.length ? o.categories : (o.service || [])) : (o.serviceCategories || []),
    bankDetails: maskedBankDetails(o.bankDetails),
    verification: verificationSummary(o, requiredVerifications(settings, role))
  };
};

const SLOT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const validSlots = (slots) => Array.isArray(slots) && slots.every((s) =>
  s && SLOT_RE.test(s.start) && (SLOT_RE.test(s.end) || s.end === '24:00') && s.start < (s.end === '24:00' ? '24:00' : s.end));

const validateWeekly = (weekly) => {
  if (!Array.isArray(weekly)) return 'weekly must be an array';
  const seen = new Set();
  for (const d of weekly) {
    if (!d || !Number.isInteger(d.day) || d.day < 0 || d.day > 6) return 'weekly[].day must be 0 (Sunday) to 6';
    if (seen.has(d.day)) return `day ${d.day} appears twice`;
    seen.add(d.day);
    if (!d.off && !validSlots(d.slots || [])) return `day ${d.day}: slots must be [{start:'HH:mm', end:'HH:mm'}] with start before end`;
  }
  return null;
};

const validateOverride = (o) => {
  if (!o || !/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) return 'override date must be YYYY-MM-DD';
  const type = o.type || 'leave';
  if (!['leave', 'custom'].includes(type)) return "override type must be 'leave' or 'custom'";
  if (type === 'custom' && (!validSlots(o.slots || []) || !(o.slots || []).length)) return 'custom override needs slots';
  return null;
};

const cleanOverride = (o) => ({
  date: o.date,
  type: o.type || 'leave',
  slots: o.type === 'custom' ? o.slots.map((s) => ({ start: s.start, end: s.end })) : [],
  note: o.note ? String(o.note).trim() : null
});

const forRole = (role) => {
  const Model = modelFor(role);
  const fail = (res, err, label) => {
    console.error(`[${role} onboarding] ${label}:`, err);
    return res.status(500).json({ success: false, message: `Failed to ${label}` });
  };

  const getOnboarding = async (req, res) => {
    try {
      const [doc, settings] = await Promise.all([
        Model.findById(req.user.id).select(PROFILE_FIELDS),
        Settings.findOne({ type: 'global' }).lean()
      ]);
      if (!doc) return res.status(404).json({ success: false, message: 'Profile not found' });
      return res.json({ success: true, data: onboardingView(doc, role, settings) });
    } catch (err) {
      return fail(res, err, 'load onboarding profile');
    }
  };

  const updateOnboarding = async (req, res) => {
    try {
      const doc = await Model.findById(req.user.id).select(PROFILE_FIELDS);
      if (!doc) return res.status(404).json({ success: false, message: 'Profile not found' });
      const out = applyOnboardingFields(doc, req.body || {}, role);
      if (out.error) return res.status(400).json({ success: false, message: out.error });

      const cats = req.body?.categoryIds ?? req.body?.categories;
      if (cats !== undefined) {
        const refs = await resolveCategoryRefs(cats);
        if (refs.unknownIds.length) {
          return res.status(400).json({ success: false, message: `Unknown category id(s): ${refs.unknownIds.join(', ')}` });
        }
        doc.categoryIds = refs.ids;
        if (role === 'vendor') {
          doc.categories = refs.names;
          doc.service = refs.names;
        } else {
          doc.serviceCategories = refs.names;
        }
      }
      // Only what changed is validated: legacy profiles may predate fields that
      // are required on new registrations.
      await doc.save({ validateModifiedOnly: true });
      const settings = await Settings.findOne({ type: 'global' }).lean();
      return res.json({ success: true, message: 'Profile updated', data: onboardingView(doc, role, settings) });
    } catch (err) {
      return fail(res, err, 'update onboarding profile');
    }
  };

  const updateBankDetails = async (req, res) => {
    try {
      const { value, error } = normalizeBankDetails(req.body?.bankDetails || req.body);
      if (error) return res.status(400).json({ success: false, message: error });
      const doc = await Model.findByIdAndUpdate(req.user.id, { $set: { bankDetails: value } }, { new: true }).select('bankDetails');
      if (!doc) return res.status(404).json({ success: false, message: 'Profile not found' });
      return res.json({ success: true, message: 'Bank details saved', data: { bankDetails: maskedBankDetails(doc.bankDetails) } });
    } catch (err) {
      return fail(res, err, 'save bank details');
    }
  };

  // Email verification reuses the platform OTP store (utils/redisOtp.util.js)
  // under its own key, and the existing OTP email template.
  const emailKey = (id) => `email-verify:${role}:${id}`;

  const sendEmailOtp = async (req, res) => {
    try {
      const doc = await Model.findById(req.user.id).select('email phone isEmailVerified');
      if (!doc) return res.status(404).json({ success: false, message: 'Profile not found' });
      const requested = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
      if (requested && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requested)) {
        return res.status(400).json({ success: false, message: 'Invalid email address' });
      }
      if (requested && requested !== doc.email) {
        const taken = await Model.exists({ email: requested, _id: { $ne: doc._id } });
        if (taken) return res.status(409).json({ success: false, message: 'That email is already in use' });
        doc.email = requested;
        doc.isEmailVerified = false;
        await doc.save({ validateModifiedOnly: true });
      }
      if (!doc.email) return res.status(400).json({ success: false, message: 'Add an email address first' });
      if (doc.isEmailVerified && !requested) {
        return res.json({ success: true, message: 'Email already verified', data: { email: doc.email, isEmailVerified: true } });
      }

      const { checkRateLimit, generateOTP, hashOTP, storeOTP } = require('../../utils/redisOtp.util');
      if (!(await checkRateLimit(doc.phone))) {
        return res.status(429).json({ success: false, message: 'Too many OTP requests. Please try again after 10 minutes.' });
      }
      const otp = generateOTP(doc.phone);
      await storeOTP(emailKey(doc._id), hashOTP(otp));
      const { sendOTPEmail } = require('../../services/emailService');
      await sendOTPEmail(doc.email, otp, 'email_verification');
      return res.json({ success: true, message: `Verification code sent to ${doc.email}`, data: { email: doc.email } });
    } catch (err) {
      return fail(res, err, 'send email verification code');
    }
  };

  const verifyEmailOtp = async (req, res) => {
    try {
      const otp = String(req.body?.otp || '').trim();
      if (!/^\d{6}$/.test(otp)) return res.status(400).json({ success: false, message: 'OTP must be 6 digits' });
      const { verifyOTP } = require('../../utils/redisOtp.util');
      const result = await verifyOTP(emailKey(req.user.id), otp);
      if (!result.success) return res.status(400).json({ success: false, message: result.message || 'Invalid OTP' });
      const doc = await Model.findByIdAndUpdate(req.user.id, { $set: { isEmailVerified: true } }, { new: true }).select('email isEmailVerified');
      return res.json({ success: true, message: 'Email verified', data: { email: doc?.email, isEmailVerified: true } });
    } catch (err) {
      return fail(res, err, 'verify email');
    }
  };

  const availabilityFilter = (req) => ({ providerType: role, providerId: new mongoose.Types.ObjectId(String(req.user.id)) });
  const availabilityView = (doc) => doc
    ? { timezone: doc.timezone, weekly: doc.weekly, overrides: doc.overrides, configured: true }
    : { timezone: 'Asia/Kolkata', weekly: [], overrides: [], configured: false };

  const getAvailability = async (req, res) => {
    try {
      const doc = await Availability.findOne(availabilityFilter(req)).lean();
      return res.json({ success: true, data: availabilityView(doc) });
    } catch (err) {
      return fail(res, err, 'load availability');
    }
  };

  const putAvailability = async (req, res) => {
    try {
      const { weekly, overrides, timezone } = req.body || {};
      const wErr = weekly !== undefined ? validateWeekly(weekly) : null;
      if (wErr) return res.status(400).json({ success: false, message: wErr });
      if (overrides !== undefined) {
        if (!Array.isArray(overrides)) return res.status(400).json({ success: false, message: 'overrides must be an array' });
        for (const o of overrides) {
          const e = validateOverride(o);
          if (e) return res.status(400).json({ success: false, message: e });
        }
      }
      const $set = {};
      if (weekly !== undefined) $set.weekly = weekly.map((d) => ({ day: d.day, off: !!d.off, slots: d.off ? [] : d.slots.map((s) => ({ start: s.start, end: s.end })) }));
      if (overrides !== undefined) $set.overrides = overrides.map(cleanOverride);
      if (timezone) $set.timezone = String(timezone);
      const doc = await Availability.findOneAndUpdate(availabilityFilter(req), { $set }, { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }).lean();
      return res.json({ success: true, message: 'Availability saved', data: availabilityView(doc) });
    } catch (err) {
      return fail(res, err, 'save availability');
    }
  };

  const addOverride = async (req, res) => {
    try {
      const e = validateOverride(req.body);
      if (e) return res.status(400).json({ success: false, message: e });
      const o = cleanOverride(req.body);
      const filter = availabilityFilter(req);
      await Availability.updateOne(filter, { $pull: { overrides: { date: o.date } } }, { upsert: true });
      const doc = await Availability.findOneAndUpdate(filter, { $push: { overrides: o } }, { new: true }).lean();
      return res.json({ success: true, message: 'Override saved', data: availabilityView(doc) });
    } catch (err) {
      return fail(res, err, 'save override');
    }
  };

  const removeOverride = async (req, res) => {
    try {
      const doc = await Availability.findOneAndUpdate(availabilityFilter(req), { $pull: { overrides: { date: req.params.date } } }, { new: true }).lean();
      return res.json({ success: true, message: 'Override removed', data: availabilityView(doc) });
    } catch (err) {
      return fail(res, err, 'remove override');
    }
  };

  return { getOnboarding, updateOnboarding, updateBankDetails, sendEmailOtp, verifyEmailOtp, getAvailability, putAvailability, addOverride, removeOverride };
};

/** Express router with the onboarding endpoints for one role. */
const buildRouter = (role) => {
  const express = require('express');
  const { authenticate } = require('../../middleware/authMiddleware');
  const { isVendor, isWorker } = require('../../middleware/roleMiddleware');
  const guard = role === 'vendor' ? isVendor : isWorker;
  const h = forRole(role);
  const router = express.Router();
  router.get('/onboarding', authenticate, guard, h.getOnboarding);
  router.put('/onboarding', authenticate, guard, h.updateOnboarding);
  router.put('/bank-details', authenticate, guard, h.updateBankDetails);
  router.post('/email/send-otp', authenticate, guard, h.sendEmailOtp);
  router.post('/email/verify', authenticate, guard, h.verifyEmailOtp);
  router.get('/availability', authenticate, guard, h.getAvailability);
  router.put('/availability', authenticate, guard, h.putAvailability);
  router.post('/availability/overrides', authenticate, guard, h.addOverride);
  router.delete('/availability/overrides/:date', authenticate, guard, h.removeOverride);
  return router;
};

module.exports = { forRole, buildRouter, onboardingView };
