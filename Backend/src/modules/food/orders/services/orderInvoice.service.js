import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { buildOrderIdentityFilter } from './order.helpers.js';
import { ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import {
    renderPdf,
    drawHeader,
    drawSectionTitle,
    drawKeyValues,
    drawTable,
    money,
    amount,
    formatDate,
    round2,
    PDF_CONTENT_TYPE,
} from '../../../../core/documents/pdf.js';
import { assignDocumentNumber, DEFAULT_DOCUMENT_NUMBER_FORMAT } from '../../../../core/documents/invoiceSeries.js';
import { getMany as getSettings } from '../../../../core/config/resolver.service.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Customer invoice PDF for a food order (SOW plan 6.7).
 *
 *   GET /food/orders/:orderId/invoice  -> application/pdf
 *
 * Built from what the order stored when it was placed -- pricing.bill, the
 * customer's bill line by line, which shared/billing.js guarantees adds up to
 * the grand total -- and never re-priced against today's GST rate, fees or
 * menu. Orders placed before the bill was stored fall back to the flat pricing
 * fields.
 *
 * GST: the food line's tax is split CGST/SGST (a delivery from a restaurant to
 * a customer in the same city is intra-state). The platform fee carries its
 * own GST line at its stored rate.
 *
 * The PDF drawing is the shared core/documents/pdf.js helper, the same one the
 * restaurant reports and settlement statements use.
 */

const INVOICEABLE = ['delivered'];

/**
 * The restaurant's GST invoice number for a delivered order.
 *
 * Sequential per restaurant per financial year (April-March, IST), e.g.
 * R7F3A/2627/00045 (GST-compliant: <= 16 chars). The format and prefix are admin settings
 * (`invoice.numberFormat`, `invoice.prefix`; the prefix can be set per
 * restaurant at partner level). Given once: calling it again returns the
 * number already stored. Never throws into the delivery flow -- returns null
 * on failure, and the invoice download retries it.
 */
export async function assignFoodInvoiceNumber(orderLike, { at } = {}) {
    try {
        const order = orderLike?.toObject ? orderLike.toObject() : orderLike;
        if (!order?._id || !order.restaurantId) return null;
        if (order.invoice?.number) return { number: order.invoice.number, assigned: false };
        const restaurantId = String(order.restaurantId?._id || order.restaurantId);
        const settings = await getSettings(['invoice.numberFormat', 'invoice.prefix'], { vertical: 'food', partnerId: restaurantId });
        const code = restaurantId.slice(-4).toUpperCase();
        const defaultPrefix = `R${code}`;
        const prefix = String(settings['invoice.prefix']?.value || 'R{code}').replace(/\{code\}/g, code);
        const issuedAt = at || order.deliveryState?.deliveredAt || new Date();
        return await assignDocumentNumber({
            Model: FoodOrder,
            id: order._id,
            series: `food:${restaurantId}`,
            prefix,
            format: settings['invoice.numberFormat']?.value,
            at: new Date(issuedAt),
            field: 'invoice',
            // A configured format/prefix that renders a non-GST-compliant number
            // falls back to the compliant default (R<id4>/<fyShort>/<seq:5>).
            gstFallback: { prefix: defaultPrefix, format: DEFAULT_DOCUMENT_NUMBER_FORMAT },
        });
    } catch (err) {
        logger.error(`Invoice number not assigned for food order ${orderLike?._id}: ${err?.message || err}`);
        return null;
    }
}

/** The number printed: the series number, or FD-<order id> for orders delivered before numbering. */
export function invoiceNumberOf(order) {
    if (order?.invoice?.number) return order.invoice.number;
    const orderNo = order?.order_id || order?.orderId || String(order?._id || '');
    return `FD-${orderNo}`;
}

class NotInvoiceableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotInvoiceableError';
        this.statusCode = 409;
    }
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

function lineDescription(item) {
    const parts = [item.name + (item.variantName ? ` (${item.variantName})` : '')];
    const addons = (item.addons || []).map((a) => `${a.name}${(a.quantity || 1) > 1 ? ` x${a.quantity}` : ''}`);
    if (addons.length) parts.push(`+ ${addons.join(', ')}`);
    if (item.isCombo && item.comboComponents?.length) {
        parts.push(`Combo: ${item.comboComponents.map((c) => `${c.name}${c.quantity > 1 ? ` x${c.quantity}` : ''}`).join(', ')}`);
    }
    if (item.isFreebie) parts.push('Free item (offer)');
    if (item.isBogoFree) parts.push('Free (buy one get one)');
    return parts.join('\n');
}

/** Everything printed on the invoice, as data. Exported for tests and other renderers. */
export function buildFoodInvoiceData(order, restaurant = {}, brand = {}) {
    const p = order.pricing || {};
    const bill = p.bill && typeof p.bill === 'object' ? p.bill : null;

    const lines = (order.items || []).map((it) => {
        const unit = round2(num(it.price) + num(it.addonsTotal));
        const qty = num(it.quantity) || 1;
        return { description: lineDescription(it), quantity: qty, unitPrice: unit, amount: round2(unit * qty) };
    });

    const gstRate = num(bill?.gstRate ?? p.gstRate);
    const gstOnFood = round2(bill ? bill.gstOnItems : p.tax);
    const cgst = round2(gstOnFood / 2);
    const sgst = round2(gstOnFood - cgst);
    const halfRate = round2(gstRate / 2);
    const summary = bill
        ? {
            itemAmount: round2(bill.netItemAmount ?? bill.taxableAmount),
            packaging: round2(bill.netPackagingFee),
            discount: round2(bill.discountOnNet ?? bill.discount),
            taxableAmount: round2(bill.taxableAmount),
            deliveryFee: round2(num(bill.deliveryFee) + num(bill.surgeAmount)),
            platformFee: round2(bill.platformFee),
            platformFeeGst: round2(bill.platformFeeGst),
            platformFeeGstRate: num(bill.platformFeeGstRate),
            tip: round2(bill.tip),
            loyaltyDiscount: round2(p.loyaltyDiscount ?? bill.loyaltyDiscount),
            roundOff: round2(p.roundOff ?? bill.roundOff),
        }
        : {
            itemAmount: round2(num(p.subtotal) - num(p.discount)),
            packaging: round2(p.netPackagingFee ?? p.packagingFee),
            discount: round2(p.discount),
            taxableAmount: round2(num(p.commissionableAmount ?? p.subtotal) + num(p.netPackagingFee ?? p.packagingFee)),
            deliveryFee: round2(num(p.deliveryFee) + num(p.surgeAmount)),
            platformFee: round2(p.platformFee),
            platformFeeGst: round2(p.platformFeeGst),
            platformFeeGstRate: num(p.platformFeeGstRate),
            tip: round2(p.tip),
            loyaltyDiscount: round2(p.loyaltyDiscount),
            roundOff: round2(p.roundOff),
        };

    const deliveredAt = [...(order.statusHistory || [])].reverse().find((h) => h.to === 'delivered')?.at
        || order.deliveryState?.deliveredAt
        || order.updatedAt
        || order.createdAt;
    const orderNo = order.order_id || order.orderId || String(order._id);
    const addr = order.deliveryAddress || {};
    const restLoc = restaurant.location || {};

    return {
        invoiceNumber: invoiceNumberOf(order),
        orderId: orderNo,
        orderDate: order.createdAt,
        invoiceDate: order.invoice?.issuedAt || deliveredAt,
        paymentMethod: order.payment?.method || '',
        paymentStatus: order.payment?.status || '',
        restaurant: {
            name: restaurant.gstLegalName || restaurant.restaurantName || '',
            tradeName: restaurant.restaurantName || '',
            address: restLoc.formattedAddress || [restLoc.addressLine1, restLoc.area, restLoc.city, restLoc.state, restLoc.pincode].filter(Boolean).join(', '),
            gstin: restaurant.gstNumber || '',
            fssai: restaurant.fssaiNumber || '',
        },
        platform: {
            name: brand.legalName || brand.name || '',
            gstin: brand.gstin || '',
            address: [brand.address, brand.city, brand.state, brand.pincode].filter(Boolean).join(', '),
        },
        customer: {
            name: order.customerName || addr.fullName || addr.name || '',
            phone: order.customerPhone || addr.phone || '',
            address: [addr.street, addr.additionalDetails, addr.city, addr.state, addr.zipCode || addr.pincode].filter(Boolean).join(', '),
        },
        lines,
        gst: { rate: gstRate, cgstRate: halfRate, sgstRate: round2(gstRate - halfRate), cgst, sgst, total: gstOnFood },
        summary,
        couponCode: p.couponCode || '',
        loyaltyPoints: Number(p.loyaltyPoints) || 0,
        pricesIncludeGst: Boolean(bill?.pricesIncludeGst ?? p.pricesIncludeGst),
        grandTotal: round2(p.total),
    };
}

export function renderFoodInvoicePdf(data) {
    const s = data.summary;
    return renderPdf((doc) => {
        drawHeader(doc, {
            title: 'Tax Invoice',
            subtitle: [
                data.restaurant.name,
                data.restaurant.tradeName && data.restaurant.tradeName !== data.restaurant.name ? `(${data.restaurant.tradeName})` : '',
                data.restaurant.address,
                data.restaurant.gstin ? `GSTIN: ${data.restaurant.gstin}` : 'GSTIN: not registered',
                data.restaurant.fssai ? `FSSAI: ${data.restaurant.fssai}` : '',
            ],
            right: [
                `Invoice no: ${data.invoiceNumber}`,
                `Invoice date: ${formatDate(data.invoiceDate)}`,
                `Order: ${data.orderId}`,
                `Ordered: ${formatDate(data.orderDate, { time: true })}`,
                data.paymentMethod ? `Payment: ${data.paymentMethod}` : '',
            ],
        });

        drawSectionTitle(doc, 'Billed to');
        doc.fontSize(9).text(data.customer.name || 'Customer');
        if (data.customer.phone) doc.text(data.customer.phone);
        if (data.customer.address) doc.text(data.customer.address);

        drawSectionTitle(doc, 'Items');
        drawTable(doc, {
            columns: [
                { header: 'Description', key: 'description', width: 290 },
                { header: 'Qty', key: 'quantity', width: 45, align: 'right' },
                { header: 'Unit price', value: (r) => amount(r.unitPrice), width: 85, align: 'right' },
                { header: 'Amount', value: (r) => amount(r.amount), width: 95, align: 'right' },
            ],
            rows: data.lines,
            fontSize: 9,
        });

        drawSectionTitle(doc, 'Bill');
        const rows = [
            { label: data.pricesIncludeGst ? 'Item amount (net of GST included in menu prices)' : 'Item amount', value: money(s.itemAmount) },
            s.packaging ? { label: 'Packaging charges', value: money(s.packaging) } : null,
            s.discount ? { label: `Discount${data.couponCode ? ` (${data.couponCode})` : ''}, already applied above`, value: `- ${money(s.discount)}`, muted: true } : null,
            { label: 'Taxable value', value: money(s.taxableAmount), muted: true },
            { label: `CGST @ ${data.gst.cgstRate}%`, value: money(data.gst.cgst) },
            { label: `SGST @ ${data.gst.sgstRate}%`, value: money(data.gst.sgst) },
            { label: 'Delivery fee', value: s.deliveryFee ? money(s.deliveryFee) : 'FREE' },
            s.platformFee ? { label: 'Platform fee', value: money(s.platformFee) } : null,
            s.platformFeeGst ? { label: `GST on platform fee @ ${s.platformFeeGstRate}%`, value: money(s.platformFeeGst) } : null,
            s.tip ? { label: 'Rider tip', value: money(s.tip) } : null,
            s.loyaltyDiscount ? { label: `Loyalty points redeemed${data.loyaltyPoints ? ` (${data.loyaltyPoints})` : ''}`, value: `- ${money(s.loyaltyDiscount)}` } : null,
            s.roundOff ? { label: 'Round off', value: money(s.roundOff) } : null,
            { label: 'Total paid', value: money(data.grandTotal), bold: true },
        ];
        drawKeyValues(doc, rows, { x: 255, width: 300, valueWidth: 95 });

        doc.moveDown(1);
        doc.fontSize(7.5).fillColor('#555').text(
            'GST on restaurant services supplied through an e-commerce operator is paid by the operator under section 9(5) of the CGST Act.'
            + (data.platform.name ? ` Platform fee and delivery are supplied by ${data.platform.name}${data.platform.gstin ? ` (GSTIN ${data.platform.gstin})` : ''}.` : ''),
            40, doc.y, { width: 515 },
        );
        doc.moveDown(0.5).text('This is a computer-generated invoice and needs no signature.', { width: 515 });
        doc.fillColor('#000');
    }, { info: { Title: `Invoice ${data.invoiceNumber}` } });
}

/**
 * The signed-in customer's invoice for one of their delivered orders.
 * Returns { filename, contentType, body }.
 */
export async function getCustomerOrderInvoice(orderId, userId) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new NotFoundError('Order not found');
    // Not populated: a populate of a deleted user would null the id the
    // ownership check below depends on.
    let order = await FoodOrder.findOne(identity).lean();
    if (!order) throw new NotFoundError('Order not found');
    const owner = String(order.userId || '');
    if (!userId || owner !== String(userId)) throw new ForbiddenError('Not your order');
    if (!INVOICEABLE.includes(order.orderStatus)) {
        throw new NotInvoiceableError('The invoice is available once the order has been delivered');
    }
    // Due a series number (delivered after numbering began) but the assignment
    // at delivery did not finish: give it now. Older orders keep FD-<order id>.
    if (order.invoice?.due && !order.invoice?.number) {
        const got = await assignFoodInvoiceNumber(order);
        if (got?.number) order = { ...order, invoice: { ...order.invoice, number: got.number } };
    }
    const restaurant = await FoodRestaurant.findById(order.restaurantId)
        .select('restaurantName gstLegalName gstNumber fssaiNumber location')
        .lean() || {};
    let brand = {};
    try {
        const { managedBrand } = await import('../../../../core/settings/platformProfile.service.js');
        brand = await managedBrand();
    } catch { /* brand settings unavailable: invoice without the platform line */ }
    const data = buildFoodInvoiceData(order, restaurant, brand);
    const body = await renderFoodInvoicePdf(data);
    return { filename: `invoice-${data.orderId}.pdf`, contentType: PDF_CONTENT_TYPE, body, data };
}
