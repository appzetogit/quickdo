/**
 * Provider verification checklist (plan §3.3).
 *
 *   PUT /admin/vendors/:id/verification/:item   { status: verified|rejected|pending, note }
 *   PUT /admin/workers/:id/verification/:item
 *
 * Items: aadhaar, pan, gst, address, background. Approval is blocked until every
 * item in Settings.vendorRequiredVerifications / workerRequiredVerifications is
 * 'verified' (approvalGate, used by approveVendor / approveWorker).
 */
const mongoose = require('mongoose');
const Settings = require('../../models/Settings');
const {
  VERIFICATION_ITEMS,
  VERIFICATION_STATUS,
  requiredVerifications,
  missingVerifications,
  verificationSummary,
  maskedBankDetails
} = require('../../utils/providerOnboarding');

const modelFor = (role) => (role === 'vendor' ? require('../../models/Vendor') : require('../../models/Worker'));

/** null when the provider may be approved, else the 400 body to send. */
const approvalGate = async (provider, role) => {
  const settings = await Settings.findOne({ type: 'global' }).lean();
  const required = requiredVerifications(settings, role);
  const missing = missingVerifications(provider, required);
  if (!missing.length) return null;
  return {
    success: false,
    code: 'VERIFICATION_INCOMPLETE',
    message: `Verify these items before approving: ${missing.join(', ')}`,
    missing,
    required
  };
};

/** Extra block for the admin detail endpoints: documents, bank (masked), checklist. */
const onboardingDetails = async (provider, role) => {
  const settings = await Settings.findOne({ type: 'global' }).lean();
  const o = typeof provider.toObject === 'function' ? provider.toObject() : provider;
  return {
    gst: o.gst || null,
    pan: o.pan || null,
    aadhar: o.aadhar || null,
    experienceYears: o.experienceYears ?? null,
    certifications: o.certifications || [],
    serviceRadiusKm: role === 'worker' ? (o.serviceRadiusKm ?? null) : (o.settings?.serviceRange ?? null),
    categoryIds: o.categoryIds || [],
    isEmailVerified: !!o.isEmailVerified,
    bankDetails: maskedBankDetails(o.bankDetails),
    verification: verificationSummary(o, requiredVerifications(settings, role))
  };
};

const setVerification = (role) => async (req, res) => {
  try {
    const { id, item } = req.params;
    const { status, note } = req.body || {};
    if (!VERIFICATION_ITEMS.includes(item)) {
      return res.status(400).json({ success: false, message: `Unknown item. Use one of: ${VERIFICATION_ITEMS.join(', ')}` });
    }
    if (!VERIFICATION_STATUS.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${VERIFICATION_STATUS.join(', ')}` });
    }
    if (status === 'rejected' && !String(note || '').trim()) {
      return res.status(400).json({ success: false, message: 'A note is required when rejecting' });
    }
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const Model = modelFor(role);
    const adminId = req.user?.id || req.user?._id || null;
    const $set = {
      [`verification.${item}`]: {
        status,
        verifiedBy: status === 'pending' ? null : adminId,
        verifiedAt: status === 'pending' ? null : new Date(),
        note: note ? String(note).trim() : null,
        source: 'manual'
      }
    };
    if (item === 'gst') $set['gst.verified'] = status === 'verified';
    const doc = await Model.findByIdAndUpdate(id, { $set }, { new: true }).select('-password');
    if (!doc) return res.status(404).json({ success: false, message: `${role === 'vendor' ? 'Vendor' : 'Worker'} not found` });
    return res.json({ success: true, message: `${item} marked ${status}`, data: await onboardingDetails(doc, role) });
  } catch (error) {
    console.error(`Set ${role} verification error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to update verification' });
  }
};

module.exports = {
  approvalGate,
  onboardingDetails,
  setVendorVerification: setVerification('vendor'),
  setWorkerVerification: setVerification('worker')
};
