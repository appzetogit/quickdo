/**
 * Service packages (plan §3.4): admin CRUD and the customer listing.
 *
 * Admin:    /admin/service-packages            GET (list), POST
 *           /admin/service-packages/:id        GET, PUT, DELETE
 *           /admin/service-packages/:id/toggle PATCH { active }
 * Customer: GET /users/packages?categoryId=     packages on sale, by category
 *           GET /public/packages?categoryId=    same, no sign-in
 *
 * Booking a package: POST /users/bookings with packageId (userBookingController).
 */
const mongoose = require('mongoose');
const ServicePackage = require('../../models/ServicePackage');
const Category = require('../../models/Category');
const Service = require('../../models/UserService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isId = (v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(String(v));

const toDateOrNull = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
};

/**
 * Validate a create/update body and resolve item names and catalogue prices.
 * `partial` allows leaving fields out (update). Returns { error } or { doc }.
 */
const buildPackage = async (body = {}, { partial = false } = {}) => {
  const doc = {};

  if (body.title !== undefined || !partial) {
    const title = String(body.title || '').trim();
    if (!title) return { error: 'title is required' };
    doc.title = title;
  }
  if (body.description !== undefined) doc.description = String(body.description || '');
  if (body.imageUrl !== undefined) doc.imageUrl = body.imageUrl || null;
  if (body.sortOrder !== undefined) doc.sortOrder = Number(body.sortOrder) || 0;
  if (body.active !== undefined) doc.active = body.active === true || body.active === 'true';

  if (body.price !== undefined || !partial) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return { error: 'price must be a number of 0 or more' };
    doc.price = round2(price);
  }
  if (body.gstPercentage !== undefined) {
    if (body.gstPercentage === null || body.gstPercentage === '') {
      doc.gstPercentage = null;
    } else {
      const g = Number(body.gstPercentage);
      if (!Number.isFinite(g) || g < 0 || g > 100) return { error: 'gstPercentage must be between 0 and 100' };
      doc.gstPercentage = g;
    }
  }

  for (const key of ['validFrom', 'validTo']) {
    const d = toDateOrNull(body[key]);
    if (d === 'invalid') return { error: `${key} must be a date` };
    if (d !== undefined) doc[key] = d;
  }
  if (doc.validFrom && doc.validTo && doc.validTo <= doc.validFrom) {
    return { error: 'validTo must be after validFrom' };
  }

  if (body.categoryId !== undefined || !partial) {
    if (!isId(body.categoryId)) return { error: 'categoryId is required' };
    if (!(await Category.exists({ _id: body.categoryId }))) return { error: 'Category not found' };
    doc.categoryId = body.categoryId;
  }

  if (body.items !== undefined || !partial) {
    if (!Array.isArray(body.items) || !body.items.length) return { error: 'items must list at least one service or add-on' };
    const serviceIds = [...new Set(body.items.map((i) => String(i?.serviceId || '')))];
    if (serviceIds.some((id) => !isId(id))) return { error: 'every item needs a valid serviceId' };
    const services = await Service.find({ _id: { $in: serviceIds } }).select('title basePrice addOns').lean();
    const byId = new Map(services.map((s) => [String(s._id), s]));
    const items = [];
    for (const raw of body.items) {
      const service = byId.get(String(raw.serviceId));
      if (!service) return { error: `Service ${raw.serviceId} not found` };
      const quantity = Math.max(1, Math.floor(Number(raw.quantity) || 1));
      if (raw.addOnId) {
        const addOn = (service.addOns || []).find((a) => String(a._id) === String(raw.addOnId));
        if (!addOn) return { error: `Add-on ${raw.addOnId} is not an add-on of ${service.title}` };
        items.push({ serviceId: service._id, addOnId: addOn._id, name: addOn.name, quantity, unitPrice: Number(addOn.price) || 0 });
      } else {
        items.push({ serviceId: service._id, addOnId: null, name: service.title, quantity, unitPrice: Number(service.basePrice) || 0 });
      }
    }
    // The first item's service becomes the booking's serviceId (invoice title,
    // provider app); dispatch uses the package's categoryId.
    doc.items = items;
  }
  return { doc };
};

const shape = (pkg) => {
  const o = typeof pkg.toObject === 'function' ? pkg.toObject() : pkg;
  const catalogValue = round2((o.items || []).reduce((s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 1), 0));
  return {
    ...o,
    catalogValue,
    savings: round2(Math.max(0, catalogValue - (Number(o.price) || 0)))
  };
};

// ── Admin ──────────────────────────────────────────────────────────────────

const listPackages = async (req, res) => {
  try {
    const filter = {};
    if (isId(req.query.categoryId)) filter.categoryId = req.query.categoryId;
    if (req.query.active === 'true') filter.active = true;
    if (req.query.active === 'false') filter.active = false;
    const rows = await ServicePackage.find(filter)
      .populate('categoryId', 'title')
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
    return res.json({ success: true, data: rows.map(shape) });
  } catch (error) {
    console.error('List packages error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load packages' });
  }
};

const getPackage = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ success: false, message: 'Package not found' });
    const pkg = await ServicePackage.findById(req.params.id).populate('categoryId', 'title').lean();
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
    return res.json({ success: true, data: shape(pkg) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load package' });
  }
};

const createPackage = async (req, res) => {
  try {
    const built = await buildPackage(req.body);
    if (built.error) return res.status(400).json({ success: false, message: built.error });
    const pkg = await ServicePackage.create(built.doc);
    return res.status(201).json({ success: true, data: shape(pkg) });
  } catch (error) {
    console.error('Create package error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to create package' });
  }
};

const updatePackage = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ success: false, message: 'Package not found' });
    const pkg = await ServicePackage.findById(req.params.id);
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
    const built = await buildPackage(req.body, { partial: true });
    if (built.error) return res.status(400).json({ success: false, message: built.error });
    pkg.set(built.doc);
    if (pkg.validFrom && pkg.validTo && pkg.validTo <= pkg.validFrom) {
      return res.status(400).json({ success: false, message: 'validTo must be after validFrom' });
    }
    await pkg.save();
    return res.json({ success: true, data: shape(pkg) });
  } catch (error) {
    console.error('Update package error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to update package' });
  }
};

const togglePackage = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ success: false, message: 'Package not found' });
    const pkg = await ServicePackage.findById(req.params.id);
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
    pkg.active = req.body?.active !== undefined ? (req.body.active === true || req.body.active === 'true') : !pkg.active;
    await pkg.save();
    return res.json({ success: true, data: shape(pkg) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update package' });
  }
};

const deletePackage = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ success: false, message: 'Package not found' });
    // Bookings keep packageId and their bookedItems/pricing snapshot, so deleting
    // the package never changes a booking already made.
    const out = await ServicePackage.deleteOne({ _id: req.params.id });
    if (!out.deletedCount) return res.status(404).json({ success: false, message: 'Package not found' });
    return res.json({ success: true, message: 'Package deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete package' });
  }
};

// ── Customer ───────────────────────────────────────────────────────────────

/**
 * Packages on sale now, optionally for one category, cheapest first within sortOrder.
 */
const listPackagesForCustomer = async (req, res) => {
  try {
    const now = new Date();
    const filter = {
      active: true,
      $and: [
        { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
        { $or: [{ validTo: null }, { validTo: { $gte: now } }] }
      ]
    };
    if (req.query.categoryId !== undefined) {
      if (!isId(req.query.categoryId)) return res.status(400).json({ success: false, message: 'categoryId is not valid' });
      filter.categoryId = req.query.categoryId;
    }
    const Settings = require('../../models/Settings');
    const settings = await Settings.findOne({ type: 'global' }).select('serviceGstPercentage').lean();
    const defaultGst = settings?.serviceGstPercentage ?? 18;
    const rows = await ServicePackage.find(filter)
      .select('title description imageUrl categoryId items price gstPercentage validFrom validTo sortOrder')
      .sort({ sortOrder: 1, price: 1 })
      .lean();
    const data = rows.map((r) => {
      const s = shape(r);
      const gstPercentage = r.gstPercentage ?? defaultGst;
      const tax = round2((Number(r.price) || 0) * gstPercentage / 100);
      return {
        _id: s._id,
        title: s.title,
        description: s.description,
        imageUrl: s.imageUrl,
        categoryId: s.categoryId,
        items: (s.items || []).map((i) => ({ serviceId: i.serviceId, addOnId: i.addOnId || null, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
        price: s.price,
        gstPercentage,
        tax,
        totalWithGst: round2((Number(s.price) || 0) + tax),
        catalogValue: s.catalogValue,
        savings: s.savings,
        validFrom: s.validFrom || null,
        validTo: s.validTo || null
      };
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('List customer packages error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load packages' });
  }
};

const buildAdminRouter = () => {
  const router = require('express').Router();
  const { authenticate } = require('../../middleware/authMiddleware');
  const { isAdmin } = require('../../middleware/roleMiddleware');
  router.use(authenticate, isAdmin);
  router.route('/').get(listPackages).post(createPackage);
  router.route('/:id').get(getPackage).put(updatePackage).delete(deletePackage);
  router.patch('/:id/toggle', togglePackage);
  return router;
};

const buildUserRouter = () => {
  const router = require('express').Router();
  const { authenticate } = require('../../middleware/authMiddleware');
  const { isUser } = require('../../middleware/roleMiddleware');
  router.get('/', authenticate, isUser, listPackagesForCustomer);
  return router;
};

const buildPublicRouter = () => {
  const router = require('express').Router();
  router.get('/', listPackagesForCustomer);
  return router;
};

module.exports = {
  buildPackage,
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  togglePackage,
  deletePackage,
  listPackagesForCustomer,
  buildAdminRouter,
  buildUserRouter,
  buildPublicRouter
};
