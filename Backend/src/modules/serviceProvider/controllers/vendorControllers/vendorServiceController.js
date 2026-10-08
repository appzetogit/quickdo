const Service = require('../../models/UserService');
const VendorService = require('../../models/VendorService');
const { validationResult } = require('express-validator');
const { SERVICE_STATUS } = require('../../utils/constants');

/**
 * Get vendor's services
 */
const getVendorServices = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    // Build query - services are linked to vendors through bookings
    // For now, we'll get all services and filter by vendor bookings
    // TODO: Add vendorId field to Service model if vendors can own services

    const query = {};
    if (status) {
      query.status = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get services (for now, return all active services)
    // In production, services should be linked to vendors
    const services = await Service.find({
      ...query,
      status: SERVICE_STATUS.ACTIVE
    })
      .populate('categoryId', 'title slug')
      // (populating 'categoryIds', a path UserService does not have, made this
      // endpoint fail with StrictPopulateError on every call)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Service.countDocuments({
      ...query,
      status: SERVICE_STATUS.ACTIVE
    });

    const rows = await VendorService.find({ vendorId, serviceId: { $in: services.map((x) => x._id) } }).lean();
    const rowById = new Map(rows.map((r) => [String(r.serviceId), r]));
    const cfg = await customPricingSettings();

    res.status(200).json({
      success: true,
      data: services.map((svc) => withVendorFields(svc, rowById.get(String(svc._id)), cfg)),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch services. Please try again.'
    });
  }
};

/**
 * The vendor's own row for a service (VendorService). Vendors used to edit the
 * shared catalogue here: PUT /services/:id/pricing rewrote Service.basePrice
 * and /availability flipped Service.status, for every customer and every
 * vendor. Both now write the vendor's own VendorService row instead.
 */

const customPricingSettings = async () => {
  const Settings = require('../../models/Settings');
  const s = await Settings.findOne({ type: 'global' })
    .select('allowVendorCustomPricing vendorCustomPriceMinPct vendorCustomPriceMaxPct')
    .lean();
  return {
    enabled: Boolean(s?.allowVendorCustomPricing),
    minPct: s?.vendorCustomPriceMinPct ?? null,
    maxPct: s?.vendorCustomPriceMaxPct ?? null
  };
};

const withVendorFields = (service, row, cfg) => {
  const { clampCustomPrice } = require('../../services/bookingPricing');
  const out = typeof service.toObject === 'function' ? service.toObject() : { ...service };
  const customPrice = row?.customPrice ?? null;
  out.customPrice = customPrice;
  out.isAvailableForVendor = row ? row.isAvailable !== false : true;
  // What a customer who picks this vendor pays (before GST) under the current settings.
  out.effectivePrice = cfg.enabled && customPrice !== null && out.isAvailableForVendor
    ? clampCustomPrice(customPrice, out.basePrice, cfg.minPct, cfg.maxPct)
    : (Number(out.basePrice) || 0);
  out.customPricingEnabled = cfg.enabled;
  return out;
};

/**
 * Update service availability for this vendor (enable/disable)
 */
const updateServiceAvailability = async (req, res) => {
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
    const { serviceId } = req.params;
    const { isAvailable } = req.body;

    const service = await Service.findById(serviceId).lean();
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    const row = await VendorService.findOneAndUpdate(
      { vendorId, serviceId },
      { $set: { isAvailable: Boolean(isAvailable) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.status(200).json({
      success: true,
      message: 'Service availability updated successfully',
      data: withVendorFields(service, row, await customPricingSettings())
    });
  } catch (error) {
    console.error('Update service availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service availability. Please try again.'
    });
  }
};

/**
 * Set this vendor's own price for a service (VendorService.customPrice).
 * Body: { customPrice } (number, or null to go back to the catalogue price).
 * `basePrice` is accepted as an alias from older builds. Used for bookings
 * only while Settings.allowVendorCustomPricing is on (services/bookingPricing.js).
 */
const setServicePricing = async (req, res) => {
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
    const { serviceId } = req.params;
    const raw = req.body.customPrice !== undefined ? req.body.customPrice : req.body.basePrice;
    if (raw === undefined) {
      return res.status(400).json({ success: false, message: 'customPrice is required (null clears it)' });
    }
    let customPrice = null;
    if (raw !== null && raw !== '') {
      customPrice = Number(raw);
      if (!Number.isFinite(customPrice) || customPrice < 0) {
        return res.status(400).json({ success: false, message: 'customPrice must be a number of 0 or more' });
      }
      customPrice = Math.round(customPrice * 100) / 100;
    }

    const service = await Service.findById(serviceId).lean();
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    const row = await VendorService.findOneAndUpdate(
      { vendorId, serviceId },
      { $set: { customPrice } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    const cfg = await customPricingSettings();

    res.status(200).json({
      success: true,
      message: cfg.enabled
        ? 'Your price for this service is saved'
        : 'Your price is saved. It applies once the platform enables vendor pricing.',
      data: withVendorFields(service, row, cfg)
    });
  } catch (error) {
    console.error('Set service pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service pricing. Please try again.'
    });
  }
};

module.exports = {
  getVendorServices,
  updateServiceAvailability,
  setServicePricing
};

