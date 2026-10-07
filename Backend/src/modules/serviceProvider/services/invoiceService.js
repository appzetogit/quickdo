/**
 * Customer invoice PDF (plan §3.4).
 *
 *   GET /users/bookings/:id/invoice  -> application/pdf
 *
 * Built from what the customer was charged: the VendorBill lines when a bill
 * exists, otherwise the booking's own pricing (service, add-ons, extras,
 * visiting charges, discount, GST). Never from commissionSnapshot: the
 * platform/provider split is not the customer's business.
 *
 * Uses Settings.invoicePrefix / sacCode / company* (overlaid by master brand
 * settings where set). The invoice number is assigned once per booking from
 * Settings.currentInvoiceNumber.
 *
 * Completed bookings are emailed the PDF once (Booking.invoiceEmailedAt), from
 * the Booking model hooks via scheduleInvoiceEmail.
 */
const PDFDocument = require('pdfkit');

const INVOICEABLE = ['completed', 'work_done'];
const money = (n) => `Rs. ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const companyProfile = async () => {
  const Settings = require('../models/Settings');
  let s = (await Settings.findOne({ type: 'global' }).lean()) || {};
  try {
    const { managedBrand } = await import('../../../core/settings/platformProfile.service.js');
    const b = await managedBrand();
    const pick = (a, c) => a || c;
    s = {
      ...s,
      companyName: pick(b?.legalName || b?.name, s.companyName),
      companyGSTIN: pick(b?.gstin, s.companyGSTIN),
      companyPAN: pick(b?.pan, s.companyPAN),
      companyAddress: pick(b?.address, s.companyAddress),
      companyCity: pick(b?.city, s.companyCity),
      companyState: pick(b?.state, s.companyState),
      companyPincode: pick(b?.pincode, s.companyPincode),
      companyPhone: pick(b?.phone, s.companyPhone),
      companyEmail: pick(b?.email, s.companyEmail)
    };
  } catch (_) { /* master settings unavailable: SP settings only */ }
  return s;
};

/** Assign Booking.invoiceNumber once (atomic), returning it. */
const ensureInvoiceNumber = async (booking, settings) => {
  if (booking.invoiceNumber) return booking.invoiceNumber;
  const Settings = require('../models/Settings');
  const Booking = require('../models/Booking');
  const counter = await Settings.findOneAndUpdate({ type: 'global' }, { $inc: { currentInvoiceNumber: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true }).lean();
  const year = new Date().getFullYear();
  const number = `${settings.invoicePrefix || 'INV'}-${year}-${String(counter.currentInvoiceNumber).padStart(6, '0')}`;
  const won = await Booking.findOneAndUpdate({ _id: booking._id, invoiceNumber: null }, { $set: { invoiceNumber: number } }, { new: true }).select('invoiceNumber').lean();
  if (won) return won.invoiceNumber;
  const current = await Booking.findById(booking._id).select('invoiceNumber').lean();
  return current?.invoiceNumber || number;
};

/** Customer-facing line items and totals. */
const invoiceLines = (booking, bill) => {
  const lines = [];
  if (bill) {
    const push = (arr, kind) => (arr || []).forEach((i) => lines.push({
      kind, name: i.name || kind, quantity: i.quantity || 1, rate: round2(i.price), gstPercentage: i.gstPercentage || 0,
      gst: round2(i.gstAmount), amount: round2(i.total)
    }));
    push(bill.services, 'service');
    push(bill.parts, 'part');
    push(bill.customItems, 'item');
    if (bill.visitingCharges) lines.push({ kind: 'charge', name: 'Visiting charges', quantity: 1, rate: round2(bill.visitingCharges), gstPercentage: 0, gst: 0, amount: round2(bill.visitingCharges) });
    if (bill.transportCharges) lines.push({ kind: 'charge', name: 'Transport charges', quantity: 1, rate: round2(bill.transportCharges), gstPercentage: 0, gst: 0, amount: round2(bill.transportCharges) });
    const taxable = round2(lines.reduce((s, l) => s + l.amount - l.gst, 0));
    return { lines, taxable, gst: round2(bill.totalGST), discount: 0, total: round2(bill.grandTotal) };
  }
  const addOns = booking.addOns || [];
  const addOnBase = addOns.reduce((s, a) => s + (Number(a.total) || 0), 0);
  const serviceBase = Math.max(0, round2((Number(booking.basePrice) || 0) - addOnBase));
  lines.push({ kind: 'service', name: booking.serviceName || 'Service', quantity: 1, rate: serviceBase, gstPercentage: null, gst: 0, amount: serviceBase });
  addOns.forEach((a) => lines.push({ kind: 'addon', name: `Add-on: ${a.name}`, quantity: a.quantity || 1, rate: round2(a.price), gstPercentage: a.gstPercentage || 0, gst: 0, amount: round2(a.total) }));
  (booking.extraCharges || []).forEach((e) => lines.push({ kind: 'extra', name: e.name, quantity: e.quantity || 1, rate: round2(e.price), gstPercentage: null, gst: 0, amount: round2(e.total) }));
  if (booking.visitingCharges) lines.push({ kind: 'charge', name: 'Visiting charges', quantity: 1, rate: round2(booking.visitingCharges), gstPercentage: null, gst: 0, amount: round2(booking.visitingCharges) });
  if (booking.penalty) lines.push({ kind: 'charge', name: 'Previous cancellation fee', quantity: 1, rate: round2(booking.penalty), gstPercentage: null, gst: 0, amount: round2(booking.penalty) });
  const discount = round2((Number(booking.discount) || 0) + (Number(booking.promoDiscount) || 0));
  const taxable = round2(lines.reduce((s, l) => s + l.amount, 0));
  return { lines, taxable, gst: round2(booking.tax), discount, total: round2(booking.finalAmount) };
};

const buildInvoiceData = async (booking, { bill = null } = {}) => {
  const settings = await companyProfile();
  const invoiceNumber = await ensureInvoiceNumber(booking, settings);
  const totals = invoiceLines(booking, bill);
  let provider = null;
  if (booking.vendorId || booking.workerId) {
    const isWorker = booking.bookingModel === 'worker' && booking.workerId;
    const Model = isWorker ? require('../models/Worker') : require('../models/Vendor');
    const id = isWorker ? booking.workerId : booking.vendorId;
    const p = await Model.findById(id?._id || id).select('name businessName gst.number').lean();
    if (p) provider = { name: p.businessName || p.name, gstin: p.gst?.number || null };
  }
  const User = require('../models/User');
  const user = booking.userId && typeof booking.userId === 'object' && booking.userId.name
    ? booking.userId
    : await User.findById(booking.userId).select('name phone email').lean();
  return {
    invoiceNumber,
    invoiceDate: booking.completedAt || new Date(),
    bookingNumber: booking.bookingNumber,
    sacCode: settings.sacCode || '998599',
    company: {
      name: settings.companyName || '', gstin: settings.companyGSTIN || '', pan: settings.companyPAN || '',
      address: [settings.companyAddress, settings.companyCity, settings.companyState, settings.companyPincode].filter(Boolean).join(', '),
      phone: settings.companyPhone || '', email: settings.companyEmail || ''
    },
    customer: {
      name: user?.name || 'Customer', phone: user?.phone || '', email: user?.email || '',
      address: [booking.address?.addressLine1, booking.address?.addressLine2, booking.address?.city, booking.address?.state, booking.address?.pincode].filter(Boolean).join(', ')
    },
    provider,
    service: { name: booking.serviceName, category: booking.serviceCategory, scheduledDate: booking.scheduledDate },
    payment: { method: booking.paymentMethod || null, status: booking.paymentStatus || null, paidAmount: round2(booking.paidAmount) },
    ...totals
  };
};

/** Render invoice data to a PDF Buffer. */
const renderInvoicePdf = (data) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${data.invoiceNumber}`, Author: data.company.name || 'Invoice' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  doc.fontSize(18).text(data.company.name || 'Tax Invoice', { continued: false });
  doc.fontSize(9).fillColor('#444');
  if (data.company.address) doc.text(data.company.address);
  const ids = [data.company.gstin && `GSTIN: ${data.company.gstin}`, data.company.pan && `PAN: ${data.company.pan}`].filter(Boolean).join('   ');
  if (ids) doc.text(ids);
  const contact = [data.company.phone, data.company.email].filter(Boolean).join('   ');
  if (contact) doc.text(contact);
  doc.moveDown();

  doc.fillColor('#000').fontSize(14).text('TAX INVOICE', { align: 'right' });
  doc.fontSize(9)
    .text(`Invoice No: ${data.invoiceNumber}`, { align: 'right' })
    .text(`Invoice Date: ${new Date(data.invoiceDate).toLocaleDateString('en-IN')}`, { align: 'right' })
    .text(`Booking No: ${data.bookingNumber}`, { align: 'right' })
    .text(`SAC: ${data.sacCode}`, { align: 'right' });
  doc.moveDown();

  doc.fontSize(10).text('Bill to', { underline: true });
  doc.fontSize(9).text(data.customer.name);
  if (data.customer.phone) doc.text(data.customer.phone);
  if (data.customer.address) doc.text(data.customer.address);
  if (data.provider) {
    doc.moveDown(0.5).fontSize(10).text('Service provider', { underline: true });
    doc.fontSize(9).text(data.provider.name + (data.provider.gstin ? `   GSTIN: ${data.provider.gstin}` : ''));
  }
  doc.moveDown(0.5).fontSize(9).text(`Service: ${data.service.name}${data.service.category ? ` (${data.service.category})` : ''}`);
  doc.moveDown();

  const cols = [40, 280, 330, 410, 480];
  const header = (y) => {
    doc.fontSize(9).fillColor('#000');
    ['Description', 'Qty', 'Rate', 'GST', 'Amount'].forEach((h, i) => doc.text(h, cols[i], y, { width: i === 0 ? 230 : 70, align: i === 0 ? 'left' : 'right' }));
    doc.moveTo(40, y + 12).lineTo(555, y + 12).stroke();
  };
  let y = doc.y;
  header(y);
  y += 18;
  for (const l of data.lines) {
    if (y > 740) { doc.addPage(); y = 50; header(y); y += 18; }
    doc.text(l.name, cols[0], y, { width: 230 });
    doc.text(String(l.quantity), cols[1], y, { width: 70, align: 'right' });
    doc.text(money(l.rate), cols[2], y, { width: 70, align: 'right' });
    doc.text(l.gstPercentage === null || l.gstPercentage === undefined ? '-' : `${l.gstPercentage}%`, cols[3], y, { width: 70, align: 'right' });
    doc.text(money(l.amount), cols[4], y, { width: 75, align: 'right' });
    y = Math.max(doc.y, y + 14) + 2;
  }
  doc.moveTo(40, y).lineTo(555, y).stroke();
  y += 8;
  const row = (label, value, bold = false) => {
    doc.fontSize(bold ? 11 : 9).text(label, 330, y, { width: 140, align: 'right' }).text(value, 480, y, { width: 75, align: 'right' });
    y += bold ? 18 : 14;
  };
  row('Taxable value', money(data.taxable));
  if (data.discount) row('Discount', `- ${money(data.discount)}`);
  row('GST', money(data.gst));
  row('Total', money(data.total), true);
  if (data.payment.method) row('Payment', `${data.payment.method}${data.payment.status ? ` / ${data.payment.status}` : ''}`);

  doc.fontSize(8).fillColor('#666').text('This is a computer-generated invoice.', 40, 790, { align: 'center', width: 515 });
  doc.end();
});

const bookingInvoicePdf = async (booking) => {
  const VendorBill = require('../models/VendorBill');
  const bill = await VendorBill.findOne({ bookingId: booking._id }).lean();
  const data = await buildInvoiceData(booking, { bill });
  return { data, pdf: await renderInvoicePdf(data) };
};

/** Email the invoice for a completed booking, once. */
const emailInvoiceOnce = async (bookingId) => {
  const Booking = require('../models/Booking');
  const claimed = await Booking.findOneAndUpdate(
    { _id: bookingId, status: 'completed', invoiceEmailedAt: null },
    { $set: { invoiceEmailedAt: new Date() } },
    { new: true }
  ).populate('userId', 'name phone email');
  if (!claimed) return { sent: false, reason: 'not completed or already sent' };
  const email = claimed.userId?.email;
  if (!email) return { sent: false, reason: 'customer has no email' };
  const { data, pdf } = await bookingInvoicePdf(claimed);
  const { sendInvoiceEmail } = require('./emailService');
  const r = await sendInvoiceEmail(email, data, pdf);
  if (!r?.success) {
    await Booking.updateOne({ _id: bookingId }, { $set: { invoiceEmailedAt: null } });
    return { sent: false, reason: r?.error || 'send failed' };
  }
  return { sent: true };
};

/** Fire-and-forget, after the completing write has had time to commit. */
const scheduleInvoiceEmail = (bookingId, delayMs = 3000) => {
  if (process.env.SP_DISABLE_INVOICE_EMAIL === 'true') return;
  const t = setTimeout(() => {
    emailInvoiceOnce(bookingId).catch((err) => console.error('[invoice] email failed:', err.message));
  }, delayMs);
  if (typeof t.unref === 'function') t.unref();
};

module.exports = { INVOICEABLE, buildInvoiceData, invoiceLines, renderInvoicePdf, bookingInvoicePdf, emailInvoiceOnce, scheduleInvoiceEmail, ensureInvoiceNumber };
