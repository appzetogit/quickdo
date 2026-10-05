const Settings = require('../../models/Settings');
const Vendor = require('../../models/Vendor');

/*
 * Master settings (core/settings/platformProfile.service.js) win where set:
 * one brand, contact and set of legal pages for the whole platform.
 */
const overlayMaster = async (settings, app = null) => {
  try {
    const { managedBrand, managedLegalPage } = await import('../../../../core/settings/platformProfile.service.js');
    const b = await managedBrand();
    const out = settings && typeof settings.toObject === 'function' ? settings.toObject() : { ...(settings || {}) };
    const set = (field, value) => { if (value) out[field] = value; };
    set('companyName', b.legalName || b.name);
    set('companyEmail', b.email);
    set('supportEmail', b.email);
    set('companyPhone', b.phone);
    set('supportPhone', b.phone);
    set('supportWhatsapp', b.whatsapp);
    set('companyAddress', b.address);
    set('companyCity', b.city);
    set('companyState', b.state);
    set('companyPincode', b.pincode);
    set('companyGSTIN', b.gstin);
    set('companyPAN', b.pan);
    set('currency', b.currencyCode);
    set('termsAndConditions', await managedLegalPage('terms'));
    set('privacyPolicy', await managedLegalPage('privacy'));
    // The services app's own pages (Master settings, App terms) win over both.
    if (app) {
      const { appLegalPage } = await import('../../../../core/settings/appLegal.js');
      set('termsAndConditions', (await appLegalPage(app, 'terms'))?.content);
      set('privacyPolicy', (await appLegalPage(app, 'privacy'))?.content);
    }
    return out;
  } catch (error) {
    console.error('Master settings overlay skipped:', error.message);
    return settings;
  }
};

// Get Global Settings
exports.getSettings = async (req, res, next) => {
  try {
    let settings = await Settings.findOne({ type: 'global' });

    // If no settings exist yet, create default
    if (!settings) {
      settings = await Settings.create({ type: 'global' });
    }

    res.status(200).json({
      success: true,
      settings: await overlayMaster(settings)
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
};

// Update Global Settings
exports.updateSettings = async (req, res, next) => {
  try {
    const {
      visitedCharges,
      serviceGstPercentage,
      partsGstPercentage,
      servicePayoutPercentage,
      partsPayoutPercentage,
      tdsPercentage,
      platformFeePercentage,
      vendorCashLimit, // Add this
      cancellationPenalty,
      razorpayKeyId,
      razorpayKeySecret,
      razorpayWebhookSecret,
      cloudinaryCloudName,
      cloudinaryApiKey,
      cloudinaryApiSecret,
      // Billing Settings
      companyName, companyGSTIN, companyPAN, companyAddress, companyCity, companyState, companyPincode, companyPhone, companyEmail, invoicePrefix, sacCode,
      // Support Settings
      supportEmail, supportPhone, supportWhatsapp,
      // Booking Timing
      maxSearchTime, waveDuration, searchRadius,
      // Payment Control
      isOnlinePaymentEnabled,
      // Legal
      termsAndConditions,
      privacyPolicy,
      supportPageContent
    } = req.body;

    let settings = await Settings.findOne({ type: 'global' });

    if (!settings) {
      settings = await Settings.create({
        type: 'global',
        visitedCharges,
        serviceGstPercentage,
        partsGstPercentage,
        servicePayoutPercentage,
        partsPayoutPercentage,
        tdsPercentage,
        platformFeePercentage,
        vendorCashLimit, // Add this
        cancellationPenalty,
        razorpayKeyId,
        razorpayKeySecret,
        razorpayWebhookSecret,
        cloudinaryCloudName,
        cloudinaryApiKey,
        cloudinaryApiSecret,
        termsAndConditions,
        privacyPolicy,
        supportPageContent
      });
    } else {
      // Update fields if provided
      if (visitedCharges !== undefined) settings.visitedCharges = visitedCharges;
      if (serviceGstPercentage !== undefined) settings.serviceGstPercentage = serviceGstPercentage;
      if (partsGstPercentage !== undefined) settings.partsGstPercentage = partsGstPercentage;
      if (servicePayoutPercentage !== undefined) settings.servicePayoutPercentage = servicePayoutPercentage;
      if (partsPayoutPercentage !== undefined) settings.partsPayoutPercentage = partsPayoutPercentage;
      if (tdsPercentage !== undefined) settings.tdsPercentage = tdsPercentage;
      if (platformFeePercentage !== undefined) settings.platformFeePercentage = platformFeePercentage;
      if (vendorCashLimit !== undefined) settings.vendorCashLimit = vendorCashLimit; // Add this
      if (cancellationPenalty !== undefined) settings.cancellationPenalty = cancellationPenalty;
      if (razorpayKeyId !== undefined) settings.razorpayKeyId = razorpayKeyId;
      if (razorpayKeySecret !== undefined) settings.razorpayKeySecret = razorpayKeySecret;
      if (razorpayWebhookSecret !== undefined) settings.razorpayWebhookSecret = razorpayWebhookSecret;
      if (cloudinaryCloudName !== undefined) settings.cloudinaryCloudName = cloudinaryCloudName;
      if (cloudinaryApiKey !== undefined) settings.cloudinaryApiKey = cloudinaryApiKey;
      if (cloudinaryApiSecret !== undefined) settings.cloudinaryApiSecret = cloudinaryApiSecret;

      if (cloudinaryApiSecret !== undefined) settings.cloudinaryApiSecret = cloudinaryApiSecret;

      // Billing update
      if (companyName !== undefined) settings.companyName = companyName;
      if (companyGSTIN !== undefined) settings.companyGSTIN = companyGSTIN;
      if (companyPAN !== undefined) settings.companyPAN = companyPAN;
      if (companyAddress !== undefined) settings.companyAddress = companyAddress;
      if (companyCity !== undefined) settings.companyCity = companyCity;
      if (companyState !== undefined) settings.companyState = companyState;
      if (companyPincode !== undefined) settings.companyPincode = companyPincode;
      if (companyPhone !== undefined) settings.companyPhone = companyPhone;
      if (companyEmail !== undefined) settings.companyEmail = companyEmail;
      if (invoicePrefix !== undefined) settings.invoicePrefix = invoicePrefix;
      if (sacCode !== undefined) settings.sacCode = sacCode;

      // Support update
      if (supportEmail !== undefined) settings.supportEmail = supportEmail;
      if (supportPhone !== undefined) settings.supportPhone = supportPhone;
      if (supportWhatsapp !== undefined) settings.supportWhatsapp = supportWhatsapp;

      // Booking Timing update
      if (maxSearchTime !== undefined) settings.maxSearchTime = maxSearchTime;
      if (waveDuration !== undefined) settings.waveDuration = waveDuration;
      if (searchRadius !== undefined) settings.searchRadius = searchRadius;
      if (isOnlinePaymentEnabled !== undefined) settings.isOnlinePaymentEnabled = isOnlinePaymentEnabled;
      if (termsAndConditions !== undefined) settings.termsAndConditions = termsAndConditions;
      if (privacyPolicy !== undefined) settings.privacyPolicy = privacyPolicy;
      if (supportPageContent !== undefined) settings.supportPageContent = supportPageContent;

      await settings.save();
    }

    // Propagate vendorCashLimit to all existing vendors AND workers if it was changed
    if (vendorCashLimit !== undefined) {
      // And record it as the service-provider value in Platform settings, which is
      // what cash limits are now read from (see utils/cashLimit.js). The per-document
      // push below is kept as the fallback copy.
      const { recordCashLimit } = require('../../utils/cashLimit');
      await recordCashLimit({
        level: 'vertical', scopeId: 'serviceProvider', value: Number(vendorCashLimit),
        updatedBy: req.user?.id, reason: 'Set from SP settings screen',
      });
      console.log(`Updating all providers with new cash limit: ${vendorCashLimit}`);
      await Vendor.updateMany(
        {}, // Filter: all vendors
        { $set: { 'wallet.cashLimit': vendorCashLimit } }
      );
      const Worker = require('../../models/Worker');
      await Worker.updateMany(
        {}, // Filter: all workers
        { $set: { 'wallet.cashLimit': vendorCashLimit } }
      );
    }

    // Propagate searchRadius to all existing vendors if it was changed
    if (searchRadius !== undefined) {
      console.log(`Updating all vendors with new service range: ${searchRadius}`);
      await Vendor.updateMany(
        {},
        { $set: { 'settings.serviceRange': searchRadius } }
      );
    }

    res.status(200).json({
      success: true,
      message: 'System settings updated successfully',
      settings
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
};
// Get Public Settings (Visited Charges, GST, Legal)
exports.getPublicSettings = async (req, res, next) => {
  try {
    let settings = await Settings.findOne({ type: 'global' }).select('visitedCharges serviceGstPercentage partsGstPercentage supportEmail supportPhone supportWhatsapp cancellationPenalty companyName companyAddress companyCity companyState companyPincode companyPhone companyEmail isOnlinePaymentEnabled termsAndConditions privacyPolicy supportPageContent');

    // Default if not found (fallback values)
    if (!settings) {
      settings = { visitedCharges: 29, serviceGstPercentage: 18, partsGstPercentage: 18 };
    }

    res.status(200).json({
      success: true,
      // ?app=provider for the provider/worker app; the customer app by default.
      settings: await overlayMaster(settings, ['provider', 'vendor', 'worker'].includes(String(req.query?.app || '').toLowerCase()) ? 'services_provider' : 'services_user')
    });
  } catch (error) {
    console.error('Error fetching public settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
};
