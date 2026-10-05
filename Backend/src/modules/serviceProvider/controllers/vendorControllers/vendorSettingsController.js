const Vendor = require('../../models/Vendor');
const { validationResult } = require('express-validator');
const { DEFAULT_SERVICE_PAYOUT_PCT } = require('../../utils/commission');

/**
 * Get vendor settings
 */
const Settings = require('../../models/Settings');

/**
 * Get vendor settings
 */
const getSettings = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const vendor = await Vendor.findById(vendorId).select('settings businessHours');
    const globalSettings = await Settings.findOne({ type: 'global' });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        settings: vendor.settings || {},
        businessHours: vendor.businessHours || {},
        global: {
          serviceGstPercentage: globalSettings?.serviceGstPercentage ?? 18,
          partsGstPercentage: globalSettings?.partsGstPercentage ?? 18,
          servicePayoutPercentage: globalSettings?.servicePayoutPercentage ?? DEFAULT_SERVICE_PAYOUT_PCT,
          partsPayoutPercentage: globalSettings?.partsPayoutPercentage ?? 10
        }
      }
    });
  } catch (error) {
    console.error('Get vendor settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
};

/**
 * Update vendor settings
 */
const updateSettings = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const { notifications, soundAlerts, language } = req.body;

    const vendor = await Vendor.findById(vendorId);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Update settings
    if (!vendor.settings) vendor.settings = {};
    if (notifications !== undefined) vendor.settings.notifications = notifications;
    if (soundAlerts !== undefined) vendor.settings.soundAlerts = soundAlerts;
    if (language !== undefined) vendor.settings.language = language;

    await vendor.save();

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: vendor.settings
    });
  } catch (error) {
    console.error('Update vendor settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
};

/**
 * Update business hours
 */
const updateBusinessHours = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { businessHours } = req.body;

    const vendor = await Vendor.findById(vendorId);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    vendor.businessHours = businessHours;
    await vendor.save();

    res.status(200).json({
      success: true,
      message: 'Business hours updated successfully',
      data: vendor.businessHours
    });
  } catch (error) {
    console.error('Update business hours error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update business hours'
    });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  updateBusinessHours
};
