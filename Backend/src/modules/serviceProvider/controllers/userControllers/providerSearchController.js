/**
 * GET /users/providers?categoryId=&lat=&lng=&date=YYYY-MM-DD&time=HH:mm  (plan §3.4)
 *
 * Providers the customer can pick for a booking, ranked by rating and distance.
 * Uses the same eligibility as automatic assignment (locationService): approved,
 * active, subscribed (vendors only when the vendor gate is on), within range,
 * and available at the slot (no date = now). Vendors or workers depending on
 * Settings.bookingModel. Pass the chosen _id to createBooking as
 * preferredProviderId.
 *
 * With &serviceId=, each provider also carries `price` (before GST) and
 * `priceSource`: the vendor's custom price when Settings.allowVendorCustomPricing
 * is on (clamped to the admin's bounds), else the catalogue price. That is the
 * price a booking made with this provider as preferredProviderId is locked at
 * (services/bookingPricing.js).
 */
const mongoose = require('mongoose');
const Category = require('../../models/Category');
const Settings = require('../../models/Settings');

const rank = (providers, radiusKm) => {
  const scored = providers.map((p) => {
    const rating = Math.max(0, Math.min(5, Number(p.rating) || 0));
    const d = typeof p.distance === 'number' ? p.distance : null;
    const closeness = d === null ? 0 : Math.max(0, 1 - d / Math.max(radiusKm, 1));
    // 60% rating, 40% closeness; both on 0..1.
    return { p, score: Math.round(((rating / 5) * 0.6 + closeness * 0.4) * 1000) / 1000 };
  });
  return scored.sort((a, b) => b.score - a.score || (a.p.distance ?? Infinity) - (b.p.distance ?? Infinity));
};

const listProviders = async (req, res) => {
  try {
    const { categoryId, date, time } = req.query;
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!mongoose.isValidObjectId(categoryId)) return res.status(400).json({ success: false, message: 'categoryId is required' });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ success: false, message: 'lat and lng are required' });
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });

    const category = await Category.findById(categoryId).select('title').lean();
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

    const settings = (await Settings.findOne({ type: 'global' }).select('bookingModel searchRadius allowVendorCustomPricing vendorCustomPriceMinPct vendorCustomPriceMaxPct').lean()) || {};
    const bookingModel = settings.bookingModel || 'worker';
    const radiusKm = settings.searchRadius || 10;
    const { bookingSlot } = require('../../services/providerEligibility');
    const slot = bookingSlot(date ? { date: String(date), time } : { bookingType: 'instant' });
    const { findNearbyVendors, findNearbyWorkers } = require('../../services/locationService');
    const filters = { service: category.title, categoryId: category._id, slot };
    const found = bookingModel === 'vendor'
      ? await findNearbyVendors({ lat, lng }, radiusKm, filters)
      : await findNearbyWorkers({ lat, lng }, radiusKm, filters);

    const Model = bookingModel === 'vendor' ? require('../../models/Vendor') : require('../../models/Worker');
    const extra = await Model.find({ _id: { $in: found.map((p) => p._id) } })
      .select('experienceYears completedJobs totalReviews certifications.name').lean();
    const extraById = new Map(extra.map((e) => [String(e._id), e]));

    // Price per provider for one service (optional).
    let service = null;
    let customPrices = new Map();
    if (req.query.serviceId !== undefined) {
      if (!mongoose.isValidObjectId(req.query.serviceId)) return res.status(400).json({ success: false, message: 'serviceId is not valid' });
      const UserService = require('../../models/UserService');
      service = await UserService.findById(req.query.serviceId).select('basePrice gstPercentage').lean();
      if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
      if (bookingModel === 'vendor') {
        const { customPricingConfig, vendorCustomPrices } = require('../../services/bookingPricing');
        customPrices = await vendorCustomPrices({
          vendorIds: found.map((p) => p._id),
          serviceIds: [service._id],
          catalogById: new Map([[String(service._id), service]]),
          config: customPricingConfig(settings)
        });
      }
    }
    const priceOf = (providerId) => {
      if (!service) return {};
      const custom = customPrices.get(`${providerId}:${service._id}`);
      return {
        price: custom ? custom.price : (Number(service.basePrice) || 0),
        catalogPrice: Number(service.basePrice) || 0,
        priceSource: custom ? 'vendor_custom' : 'catalog'
      };
    };

    const data = rank(found, radiusKm).slice(0, 30).map(({ p, score }) => {
      const e = extraById.get(String(p._id)) || {};
      return {
        _id: p._id,
        providerType: bookingModel,
        name: p.businessName || p.name,
        profilePhoto: p.profilePhoto || null,
        rating: p.rating || 0,
        totalReviews: e.totalReviews || 0,
        completedJobs: e.completedJobs ?? p.totalJobs ?? 0,
        experienceYears: e.experienceYears ?? null,
        certifications: (e.certifications || []).map((c) => c.name),
        distanceKm: typeof p.distance === 'number' ? Math.round(p.distance * 10) / 10 : null,
        score,
        ...priceOf(p._id)
      };
    });
    return res.json({ success: true, data, meta: { providerType: bookingModel, slot } });
  } catch (error) {
    console.error('List providers error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load providers' });
  }
};

const buildRouter = () => {
  const router = require('express').Router();
  const { authenticate } = require('../../middleware/authMiddleware');
  const { isUser } = require('../../middleware/roleMiddleware');
  router.get('/', authenticate, isUser, listProviders);
  return router;
};

module.exports = { listProviders, rank, buildRouter };
