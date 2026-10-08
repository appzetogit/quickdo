/**
 * Server-side booking prices that do not come from the app (plan §3.4).
 *
 * Two sources besides the app's own breakdown:
 *
 *  1. Service packages (models/ServicePackage.js). A booking with packageId is
 *     priced at the package price + GST, and the package items are expanded
 *     into bookedItems for the provider.
 *
 *  2. Vendor custom prices (VendorService.customPrice). The rule for what the
 *     customer sees:
 *       - preferredProviderId given, bookingModel 'vendor', and
 *         Settings.allowVendorCustomPricing on: the price is that vendor's
 *         custom price (catalogue price where they have none), clamped to
 *         Settings.vendorCustomPriceMinPct/MaxPct of the catalogue price, and
 *         LOCKED on the booking. If the preferred vendor lets the offer lapse
 *         and another vendor accepts, the customer still pays the locked price.
 *       - otherwise: the catalogue price. Acceptance never reprices a booking,
 *         so the price shown before booking is the price charged (until the
 *         provider adds work on the bill, as before).
 *     GET /users/providers?serviceId= shows each vendor's price the same way.
 */
const mongoose = require('mongoose');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nonNegative = (v) => Math.max(0, Number(v) || 0);
const isId = (v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(String(v));

/**
 * Load a package that can be booked now. Returns { pkg } or { status, error }.
 */
const loadBookablePackage = async (packageId, now = new Date()) => {
  const ServicePackage = require('../models/ServicePackage');
  if (!isId(packageId)) return { status: 400, error: 'packageId is not valid' };
  const pkg = await ServicePackage.findById(packageId).lean();
  if (!pkg) return { status: 404, error: 'Package not found' };
  if (!ServicePackage.isOnSale(pkg, now)) return { status: 400, error: 'This package is not available right now' };
  if (!pkg.items?.length) return { status: 400, error: 'This package has no items' };
  return { pkg };
};

/**
 * Price a package booking. Pure.
 * @returns {{ basePrice, tax, gstPercentage, bookedItems }}
 *   bookedItems split the package price across the items in proportion to
 *   their catalogue value, so the lines the provider sees add up to the price.
 */
const packagePricing = (pkg, defaultGstPct = 18) => {
  const basePrice = round2(nonNegative(pkg.price));
  const gstPercentage = pkg.gstPercentage ?? defaultGstPct ?? 0;
  const tax = round2((basePrice * nonNegative(gstPercentage)) / 100);

  const items = pkg.items || [];
  const weights = items.map((i) => nonNegative(i.unitPrice) * Math.max(1, Number(i.quantity) || 1));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  let allocated = 0;
  const bookedItems = items.map((item, idx) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    let lineTotal;
    if (idx === items.length - 1) {
      lineTotal = round2(basePrice - allocated);
    } else {
      const share = totalWeight > 0 ? weights[idx] / totalWeight : 1 / items.length;
      lineTotal = round2(basePrice * share);
      allocated = round2(allocated + lineTotal);
    }
    return {
      brandName: pkg.title,
      brandIcon: pkg.imageUrl || null,
      serviceName: item.name || '',
      card: {
        title: item.name || 'Package item',
        subtitle: `Part of ${pkg.title}`,
        price: round2(lineTotal / qty),
        originalPrice: nonNegative(item.unitPrice)
      },
      quantity: qty
    };
  });
  return { basePrice, tax, gstPercentage, bookedItems };
};

/**
 * Clamp a vendor's custom price to the admin's bounds. Pure.
 * minPct / maxPct are % of the catalogue price; null = no bound.
 */
const clampCustomPrice = (custom, catalog, minPct = null, maxPct = null) => {
  let price = nonNegative(custom);
  const base = nonNegative(catalog);
  if (minPct !== null && minPct !== undefined && Number.isFinite(Number(minPct))) {
    price = Math.max(price, (base * Number(minPct)) / 100);
  }
  if (maxPct !== null && maxPct !== undefined && Number.isFinite(Number(maxPct))) {
    price = Math.min(price, (base * Number(maxPct)) / 100);
  }
  return round2(price);
};

/**
 * Custom-pricing settings, or null when custom pricing is off.
 */
const customPricingConfig = (settings) => (settings?.allowVendorCustomPricing
  ? { minPct: settings.vendorCustomPriceMinPct ?? null, maxPct: settings.vendorCustomPriceMaxPct ?? null }
  : null);

/**
 * A vendor's price per service. Returns Map(serviceId -> { price, custom }) for
 * the serviceIds given; services without a usable custom price are absent.
 */
const vendorCustomPrices = async ({ vendorIds, serviceIds, catalogById, config }) => {
  if (!config || !vendorIds?.length || !serviceIds?.length) return new Map();
  const VendorService = require('../models/VendorService');
  const rows = await VendorService.find({
    vendorId: { $in: vendorIds },
    serviceId: { $in: serviceIds },
    isAvailable: { $ne: false },
    customPrice: { $ne: null }
  }).select('vendorId serviceId customPrice').lean();
  const out = new Map();
  for (const r of rows) {
    const catalog = catalogById.get(String(r.serviceId));
    if (!catalog) continue;
    const price = clampCustomPrice(r.customPrice, catalog.basePrice, config.minPct, config.maxPct);
    out.set(`${r.vendorId}:${r.serviceId}`, { price, custom: Number(r.customPrice) });
  }
  return out;
};

/**
 * Price booking lines with one vendor's custom prices.
 *
 * @param {object} p
 * @param {Array<{id, qty}>} p.lines          service id + quantity per line
 * @param {Map} p.catalogById                  serviceId -> { basePrice, gstPercentage }
 * @param {string} p.vendorId
 * @param {object} p.config                    customPricingConfig(settings)
 * @returns {Promise<null | { basePrice, tax, lines }>} null when the vendor has
 *   no custom price on any line (the booking keeps the catalogue path).
 */
const priceLinesForVendor = async ({ lines, catalogById, vendorId, config }) => {
  if (!config || !vendorId) return null;
  const serviceIds = [...new Set(lines.map((l) => l.id))].filter(isId);
  const prices = await vendorCustomPrices({ vendorIds: [vendorId], serviceIds, catalogById, config });
  if (!prices.size) return null;
  let basePrice = 0;
  let tax = 0;
  const priced = lines.map((l) => {
    const catalog = catalogById.get(l.id) || { basePrice: 0, gstPercentage: 0 };
    const custom = prices.get(`${vendorId}:${l.id}`);
    const unit = custom ? custom.price : nonNegative(catalog.basePrice);
    const lineBase = round2(unit * l.qty);
    basePrice += lineBase;
    tax += (lineBase * nonNegative(catalog.gstPercentage ?? 0)) / 100;
    return {
      serviceId: l.id,
      quantity: l.qty,
      catalogPrice: nonNegative(catalog.basePrice),
      price: unit,
      source: custom ? 'vendor_custom' : 'catalog'
    };
  });
  return { basePrice: round2(basePrice), tax: round2(tax), lines: priced };
};

module.exports = {
  round2,
  loadBookablePackage,
  packagePricing,
  clampCustomPrice,
  customPricingConfig,
  vendorCustomPrices,
  priceLinesForVendor
};
