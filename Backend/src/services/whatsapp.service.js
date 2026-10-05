import axios from 'axios';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Normalizes any phone number format (local, international, leading plus or zeros)
 * to the digits-only format required by Meta Cloud API (e.g. 917356789012 for India).
 */
export function normalizeWhatsAppPhone(phone) {
  if (!phone) return null;
  let clean = String(phone).replace(/\D/g, ''); // Extract digits only

  if (clean.startsWith('00')) {
    clean = clean.slice(2);
  }

  // Prepend India country code 91 if it's a local 10-digit number
  if (clean.length === 10) {
    clean = '91' + clean;
  }

  return clean;
}

/**
 * Resolves user phone number and name.
 */
async function resolveUserWhatsAppDetails(user, fallbackPhone = '') {
  let phone = fallbackPhone;
  let name = 'Valued Customer';

  if (user && typeof user === 'object') {
    phone = user.phone || phone;
    name = user.name || name;
  } else if (user) {
    try {
      const userDoc = await mongoose.model('TaxiUser').findById(user).select('phone name').lean();
      if (userDoc) {
        phone = userDoc.phone || phone;
        name = userDoc.name || name;
      }
    } catch (err) {
      logger.error('Failed to look up user for WhatsApp details:', err);
    }
  }

  return {
    phone: normalizeWhatsAppPhone(phone),
    name
  };
}

/**
 * Sends a generic message payload to WhatsApp Cloud Meta API.
 */
export async function sendWhatsAppMessage(to, payload) {
  const { whatsappAccessToken, whatsappPhoneNumberId, whatsappVersion } = config;

  if (!whatsappAccessToken || !whatsappPhoneNumberId) {
    logger.warn('[WhatsApp] API not configured: WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required.');
    return false;
  }

  const cleanPhone = normalizeWhatsAppPhone(to);
  if (!cleanPhone) {
    logger.warn('[WhatsApp] Invalid recipient phone number.');
    return false;
  }

  const url = `https://graph.facebook.com/${whatsappVersion}/${whatsappPhoneNumberId}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        ...payload
      },
      {
        headers: {
          Authorization: `Bearer ${whatsappAccessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info(`[WhatsApp] Message successfully sent to ${cleanPhone}. ID: ${response.data?.messages?.[0]?.id}`);
    return true;
  } catch (error) {
    const errData = error.response?.data || error.message;
    logger.error(`[WhatsApp] Send error to ${cleanPhone}:`, JSON.stringify(errData));
    throw new Error(error.response?.data?.error?.message || error.message);
  }
}

/**
 * Sends a WhatsApp invoice for a Food Order.
 * Supports template mode and free-form text receipt fallback.
 */
export async function sendFoodInvoiceWhatsApp(order, user) {
  const { phone: recipientPhone, name: customerName } = await resolveUserWhatsAppDetails(user, order.customerPhone);
  if (!recipientPhone) {
    logger.warn('[WhatsApp] Food invoice skipped: Recipient phone number not found.');
    return false;
  }

  const orderId = order.order_id || order.orderId || order._id || 'N/A';
  const orderDate = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Normalize items
  const items = (order.items || []).map(item => {
    const itemName = item.name || item.menuItem?.name || 'Item';
    const qty = item.quantity || 1;
    const price = item.price || item.menuItem?.price || 0;
    return { name: itemName, quantity: qty, price, total: qty * price };
  });

  const subtotal = order.pricing?.subtotal || order.subtotal || items.reduce((sum, i) => sum + i.total, 0);
  const tax = order.pricing?.tax || 0;
  const packagingFee = order.pricing?.packagingFee || 0;
  const deliveryFee = order.pricing?.deliveryFee || 0;
  const platformFee = order.pricing?.platformFee || 0;
  const discount = order.pricing?.discount || 0;
  const total = order.pricing?.total || order.totalAmount || order.total || (subtotal + tax + packagingFee + deliveryFee + platformFee - discount);
  const paymentMethod = String(order.payment?.method || order.paymentMethod || 'Paid').toUpperCase();

  const itemsSummary = items.map(item => `${item.name} x${item.quantity}`).join(', ');

  if (config.whatsappUseTemplate) {
    // Structured Template Mode
    const templatePayload = {
      type: 'template',
      template: {
        name: config.whatsappFoodTemplateName || 'food_invoice',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: customerName },
              { type: 'text', text: orderId },
              { type: 'text', text: `₹${total.toFixed(2)}` },
              { type: 'text', text: paymentMethod },
              { type: 'text', text: itemsSummary }
            ]
          }
        ]
      }
    };
    return sendWhatsAppMessage(recipientPhone, templatePayload);
  } else {
    // Free-form Receipt Fallback Mode
    const itemsListText = items.map(i => `• _${i.name}_ x${i.quantity} - *₹${i.total.toFixed(2)}*`).join('\n');
    const invoiceText = `*K9 RIDES - FOOD INVOICE* 🍔
---------------------------------------------
*Hi ${customerName},*
Thank you for your order! Here is your receipt.

*Order Details:*
• *Order ID:* ${orderId}
• *Date:* ${orderDate}
• *Payment:* ${paymentMethod}

*Items Ordered:*
${itemsListText}

*Breakdown:*
• Item Subtotal: ₹${subtotal.toFixed(2)}
${tax > 0 ? `• ${Number(order.pricing?.bill?.gstRate) > 0 ? `GST @ ${Number(order.pricing.bill.gstRate)}%${Number(order.pricing?.bill?.taxableAmount) > 0 ? ` on ₹${Number(order.pricing.bill.taxableAmount).toFixed(2)}` : ''}` : 'GST'}: ₹${tax.toFixed(2)}\n` : ''}${packagingFee > 0 ? `• Packaging Fee: ₹${packagingFee.toFixed(2)}\n` : ''}${deliveryFee > 0 ? `• Delivery Fee: ₹${deliveryFee.toFixed(2)}\n` : ''}${platformFee > 0 ? `• Platform Fee: ₹${platformFee.toFixed(2)}\n` : ''}${discount > 0 ? `• Discount: -₹${discount.toFixed(2)}\n` : ''}---------------------------------------------
*Total Paid: ₹${total.toFixed(2)}*

If you have any questions, reach out to our customer support.`;

    const textPayload = {
      type: 'text',
      text: { body: invoiceText }
    };
    return sendWhatsAppMessage(recipientPhone, textPayload);
  }
}

/**
 * Sends a WhatsApp invoice for a Taxi Ride.
 * Supports template mode and free-form text receipt fallback.
 */
export async function sendTaxiInvoiceWhatsApp(ride, user) {
  const { phone: recipientPhone, name: customerName } = await resolveUserWhatsAppDetails(user, ride.customerPhone);
  if (!recipientPhone) {
    logger.warn('[WhatsApp] Taxi invoice skipped: Recipient phone number not found.');
    return false;
  }

  const rideId = ride.rideId || ride._id || 'N/A';
  const serviceType = String(ride.serviceType || 'ride').toUpperCase();
  const tripDate = new Date(ride.completedAt || ride.createdAt || Date.now()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const pickup = ride.pickupAddress || 'Pickup Location';
  const drop = ride.dropAddress || 'Dropoff Location';
  const paymentMethod = String(ride.paymentMethod || 'cash').toUpperCase();

  // Breakdown calculations
  const baseFare = Number(ride.baseFare || 0);
  const distanceCharge = Number(ride.distanceChargeAmount || 0);
  const timeCharge = Number(ride.timeChargeAmount || 0);
  const waitingCharge = Number(ride.waitingChargeAmount || 0);
  const additionalCharge = Number(ride.additionalCharge || 0);
  const adminExtraCharge = Number(ride.adminExtraCharge?.amount || 0);
  const discount = Number(ride.promo?.discount_amount || 0);
  const total = Number(ride.fare || 0);

  const formattedDistance = ride.estimatedDistanceMeters
    ? `${(ride.estimatedDistanceMeters / 1000).toFixed(2)} km`
    : 'N/A';
  const formattedDuration = ride.estimatedDurationMinutes
    ? `${ride.estimatedDurationMinutes} mins`
    : 'N/A';

  if (config.whatsappUseTemplate) {
    // Structured Template Mode
    const templatePayload = {
      type: 'template',
      template: {
        name: config.whatsappTaxiTemplateName || 'taxi_invoice',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: customerName },
              { type: 'text', text: rideId },
              { type: 'text', text: `₹${total.toFixed(2)}` },
              { type: 'text', text: paymentMethod },
              { type: 'text', text: `${formattedDistance} (${formattedDuration})` }
            ]
          }
        ]
      }
    };
    return sendWhatsAppMessage(recipientPhone, templatePayload);
  } else {
    // Free-form Receipt Fallback Mode
    const invoiceText = `*K9 RIDES - TRIP INVOICE* 🚖
---------------------------------------------
*Hi ${customerName},*
Thanks for riding with us! Here is your trip receipt.

*Trip Details:*
• *Trip ID:* ${rideId}
• *Service Type:* ${serviceType}
• *Date:* ${tripDate}
• *Payment:* ${paymentMethod}
• *Distance:* ${formattedDistance}
• *Duration:* ${formattedDuration}

*Route Details:*
📍 *Pickup:* ${pickup}
🏁 *Dropoff:* ${drop}

*Fare Breakdown:*
• Base Fare: ₹${baseFare.toFixed(2)}
${distanceCharge > 0 ? `• Distance Fare: ₹${distanceCharge.toFixed(2)}\n` : ''}${timeCharge > 0 ? `• Time Fare: ₹${timeCharge.toFixed(2)}\n` : ''}${waitingCharge > 0 ? `• Waiting Charges: ₹${waitingCharge.toFixed(2)}\n` : ''}${additionalCharge > 0 ? `• Tolls/Additional Charges: ₹${additionalCharge.toFixed(2)}\n` : ''}${adminExtraCharge > 0 ? `• Surcharges: ₹${adminExtraCharge.toFixed(2)}\n` : ''}${discount > 0 ? `• Promo Discount: -₹${discount.toFixed(2)}\n` : ''}---------------------------------------------
*Total Fare Paid: ₹${total.toFixed(2)}*

We hope you had a pleasant trip! Support: support@k9rides.com`;

    const textPayload = {
      type: 'text',
      text: { body: invoiceText }
    };
    return sendWhatsAppMessage(recipientPhone, textPayload);
  }
}
