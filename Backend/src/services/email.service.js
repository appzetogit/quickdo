import { sendEmail } from '../queues/email.queue.js';
import { isMailConfigured } from './mailTransport.js';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { emailCredentials } from '../core/settings/platformProfile.service.js';

/*
 * Mail goes out through the email queue (queues/email.queue.js): queued when
 * BullMQ is on, sent directly otherwise. SMTP comes from Master settings if saved
 * there, else .env (services/mailTransport.js).
 */
const getTransporter = () => (isMailConfigured() ? true : null);

/**
 * Normalizes user details to retrieve name and email.
 */
async function resolveUserDetails(user) {
  let userEmail = '';
  let userName = '';

  if (user && typeof user === 'object') {
    userEmail = user.email;
    userName = user.name || 'Valued Customer';
  } else if (user) {
    try {
      const userDoc = await mongoose.model('TaxiUser').findById(user).select('email name').lean();
      if (userDoc) {
        userEmail = userDoc.email;
        userName = userDoc.name || 'Valued Customer';
      }
    } catch (err) {
      logger.error('Failed to look up user for invoice email:', err);
    }
  }

  return { email: userEmail, name: userName };
}

/**
 * Sends a premium invoice email for a Food Order.
 * @param {Object} order - The food order document
 * @param {Object|string} user - The user object or user ID
 */
export async function sendFoodInvoiceEmail(order, user) {
  const trans = getTransporter();
  if (!trans) {
    logger.warn('Food invoice email skipped: SMTP not configured');
    return false;
  }

  const { email, name } = await resolveUserDetails(user);
  if (!email) {
    logger.warn('Food invoice email skipped: User email not found');
    return false;
  }

  const orderId = order.order_id || order.orderId || order._id || 'N/A';
  const orderDate = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Normalize items
  const items = (order.items || []).map(item => {
    const itemName = item.name || item.menuItem?.name || 'Item';
    const quantity = item.quantity || 1;
    const price = item.price || item.menuItem?.price || 0;
    return { name: itemName, quantity, price, total: quantity * price };
  });

  const subtotal = order.pricing?.subtotal || order.subtotal || items.reduce((sum, i) => sum + i.total, 0);
  const tax = order.pricing?.tax || 0;
  const packagingFee = order.pricing?.packagingFee || 0;
  // The surge is part of what the customer paid for delivery.
  const deliveryFee = (order.pricing?.deliveryFee || 0) + (order.pricing?.surgeAmount || 0);
  const platformFee = order.pricing?.platformFee || 0;
  const invoiceBill = order.pricing?.bill || {};
  const platformFeeGst = Number(invoiceBill.platformFeeGst ?? order.pricing?.platformFeeGst) || 0;
  const roundOff = Number(invoiceBill.roundOff) || 0;
  const gstRate = Number(invoiceBill.gstRate) || 0;
  const taxBase = Number(invoiceBill.taxableAmount) || 0;
  // GST is charged on the price before any coupon; say so on the invoice.
  const gstLabel = gstRate > 0
    ? `GST @ ${gstRate}%${taxBase > 0 ? ` on ₹${taxBase.toFixed(2)}` : ''}`
    : 'GST';
  const discount = order.pricing?.discount || 0;
  const total = order.pricing?.total || order.totalAmount || order.total || (subtotal + tax + packagingFee + deliveryFee + platformFee - discount);
  const paymentMethod = String(order.payment?.method || order.paymentMethod || 'Paid').toUpperCase();

  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0; color: #333333; font-size: 15px;">${item.name} <span style="color: #888888; font-size: 13px;">x ${item.quantity}</span></td>
      <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0; text-align: right; color: #333333; font-size: 15px; font-weight: 500;">₹${item.total.toFixed(2)}</td>
    </tr>
  `).join('');

  const subject = `Your Quick Drop Food Invoice [Order #${orderId}]`;
  const from = emailCredentials().from;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quick Drop Invoice</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 32px 0;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02);
    }
    .header {
      background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%);
      padding: 40px 32px;
      color: #ffffff;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header p {
      margin: 8px 0 0 0;
      font-size: 15px;
      opacity: 0.9;
    }
    .content {
      padding: 32px;
    }
    .welcome-text {
      font-size: 18px;
      color: #1e293b;
      margin-top: 0;
      margin-bottom: 24px;
      font-weight: 500;
    }
    .metadata-box {
      background-color: #f1f5f9;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 32px;
    }
    .metadata-table {
      width: 100%;
      border-collapse: collapse;
    }
    .metadata-table td {
      padding: 4px 0;
      font-size: 14px;
    }
    .metadata-label {
      color: #64748b;
      font-weight: 500;
      width: 35%;
    }
    .metadata-value {
      color: #334155;
      font-weight: 600;
    }
    .invoice-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 32px;
    }
    .invoice-table th {
      text-align: left;
      padding-bottom: 12px;
      border-bottom: 2px solid #e2e8f0;
      color: #475569;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .summary-box {
      border-top: 2px solid #e2e8f0;
      padding-top: 16px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 15px;
      color: #475569;
    }
    .summary-row.total {
      font-size: 20px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px dashed #cbd5e1;
    }
    .footer {
      background-color: #f8fafc;
      padding: 32px;
      text-align: center;
      border-top: 1px solid #f1f5f9;
    }
    .footer p {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: #64748b;
      line-height: 1.5;
    }
    .footer a {
      color: #4f46e5;
      text-decoration: none;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>QUICK DROP</h1>
        <p>Your Food Delivery Invoice</p>
      </div>
      <div class="content">
        <h2 class="welcome-text">Hi ${name},</h2>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
          Thanks for ordering through Quick Drop. Here is the detailed summary of your food delivery order invoice.
        </p>
        
        <div class="metadata-box">
          <table class="metadata-table">
            <tr>
              <td class="metadata-label">Order ID</td>
              <td class="metadata-value">${orderId}</td>
            </tr>
            <tr>
              <td class="metadata-label">Date</td>
              <td class="metadata-value">${orderDate}</td>
            </tr>
            <tr>
              <td class="metadata-label">Payment Method</td>
              <td class="metadata-value">${paymentMethod}</td>
            </tr>
          </table>
        </div>

        <table class="invoice-table">
          <thead>
            <tr>
              <th style="width: 70%;">Items Ordered</th>
              <th style="text-align: right; width: 30%;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="summary-box">
          <div class="summary-row">
            <span>Item Subtotal</span>
            <span>₹${subtotal.toFixed(2)}</span>
          </div>
          ${tax > 0 ? `<div class="summary-row"><span>${gstLabel}</span><span>₹${tax.toFixed(2)}</span></div>` : ''}
          ${packagingFee > 0 ? `<div class="summary-row"><span>Restaurant Packaging Fee</span><span>₹${packagingFee.toFixed(2)}</span></div>` : ''}
          ${deliveryFee > 0 ? `<div class="summary-row"><span>Delivery Partner Fee</span><span>₹${deliveryFee.toFixed(2)}</span></div>` : ''}
          ${platformFee > 0 ? `<div class="summary-row"><span>Platform Fee</span><span>₹${platformFee.toFixed(2)}</span></div>` : ''}
          ${platformFeeGst > 0 ? `<div class="summary-row"><span>GST on Platform Fee</span><span>₹${platformFeeGst.toFixed(2)}</span></div>` : ''}
          ${roundOff !== 0 ? `<div class="summary-row"><span>Round Off</span><span>₹${roundOff.toFixed(2)}</span></div>` : ''}
          ${discount > 0 ? `<div class="summary-row" style="color: #10b981; font-weight: 500;"><span>Discounts Applied</span><span>-₹${discount.toFixed(2)}</span></div>` : ''}
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px; border-top: 1px dashed #cbd5e1; padding-top: 16px;">
            <tr>
              <td style="padding: 16px 0 0 0; font-size: 20px; font-weight: 700; color: #1e293b;">Total Paid</td>
              <td style="padding: 16px 0 0 0; text-align: right; font-size: 20px; font-weight: 700; color: #1e293b;">₹${total.toFixed(2)}</td>
            </tr>
          </table>
        </div>
      </div>
      <div class="footer">
        <p>If you have any questions or feedback, please reach out to our customer support team.</p>
        <p>&copy; ${new Date().getFullYear()} Quick Drop. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  try {
    await sendEmail({
      kind: 'invoice',
      from: typeof from === 'string' && from.includes('<') ? from : `Quick Drop <${from}>`,
      to: email,
      subject,
      html
    });
    logger.info(`Food invoice email sent (or queued) to ${email} for order ${orderId}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send food invoice email to ${email} for order ${orderId}:`, err);
    return false;
  }
}

/**
 * Sends a premium invoice email for a Taxi Ride.
 * @param {Object} ride - The ride document
 * @param {Object|string} user - The user object or user ID
 */
export async function sendTaxiInvoiceEmail(ride, user) {
  const trans = getTransporter();
  if (!trans) {
    logger.warn('Taxi invoice email skipped: SMTP not configured');
    return false;
  }

  const { email, name } = await resolveUserDetails(user);
  if (!email) {
    logger.warn('Taxi invoice email skipped: User email not found');
    return false;
  }

  const rideId = ride.rideId || ride._id || 'N/A';
  const serviceType = String(ride.serviceType || 'ride').toUpperCase();
  const tripDate = new Date(ride.completedAt || ride.createdAt || Date.now()).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const pickup = ride.pickupAddress || 'Pickup Location';
  const drop = ride.dropAddress || 'Dropoff Location';
  const paymentMethod = String(ride.paymentMethod || 'cash').toUpperCase();
  
  // Calculate breakdown
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

  const subject = `Your Quick Drop Trip Invoice [Trip #${rideId}]`;
  const from = emailCredentials().from;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quick Drop Trip Invoice</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 32px 0;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02);
    }
    .header {
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      padding: 40px 32px;
      color: #ffffff;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header p {
      margin: 8px 0 0 0;
      font-size: 15px;
      opacity: 0.9;
    }
    .content {
      padding: 32px;
    }
    .welcome-text {
      font-size: 18px;
      color: #1e293b;
      margin-top: 0;
      margin-bottom: 24px;
      font-weight: 500;
    }
    .metadata-box {
      background-color: #f1f5f9;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 32px;
    }
    .metadata-table {
      width: 100%;
      border-collapse: collapse;
    }
    .metadata-table td {
      padding: 4px 0;
      font-size: 14px;
    }
    .metadata-label {
      color: #64748b;
      font-weight: 500;
      width: 35%;
    }
    .metadata-value {
      color: #334155;
      font-weight: 600;
    }
    .route-box {
      border-left: 3px solid #6366f1;
      padding-left: 16px;
      margin-bottom: 32px;
    }
    .route-step {
      margin-bottom: 16px;
    }
    .route-step:last-child {
      margin-bottom: 0;
    }
    .route-label {
      font-size: 12px;
      font-weight: 600;
      color: #6366f1;
      text-transform: uppercase;
      margin: 0 0 4px 0;
    }
    .route-value {
      font-size: 15px;
      color: #334155;
      margin: 0;
    }
    .summary-box {
      border-top: 2px solid #e2e8f0;
      padding-top: 16px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 15px;
      color: #475569;
    }
    .summary-row.total {
      font-size: 20px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px dashed #cbd5e1;
    }
    .footer {
      background-color: #f8fafc;
      padding: 32px;
      text-align: center;
      border-top: 1px solid #f1f5f9;
    }
    .footer p {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: #64748b;
      line-height: 1.5;
    }
    .footer a {
      color: #6366f1;
      text-decoration: none;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>QUICK DROP</h1>
        <p>Your Trip Invoice [${serviceType}]</p>
      </div>
      <div class="content">
        <h2 class="welcome-text">Hi ${name},</h2>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
          Thanks for riding with Quick Drop. Here is your trip summary and receipt.
        </p>
        
        <div class="metadata-box">
          <table class="metadata-table">
            <tr>
              <td class="metadata-label">Trip ID</td>
              <td class="metadata-value">${rideId}</td>
            </tr>
            <tr>
              <td class="metadata-label">Date</td>
              <td class="metadata-value">${tripDate}</td>
            </tr>
            <tr>
              <td class="metadata-label">Payment Method</td>
              <td class="metadata-value">${paymentMethod}</td>
            </tr>
            <tr>
              <td class="metadata-label">Distance</td>
              <td class="metadata-value">${formattedDistance}</td>
            </tr>
            <tr>
              <td class="metadata-label">Duration</td>
              <td class="metadata-value">${formattedDuration}</td>
            </tr>
          </table>
        </div>

        <div class="route-box">
          <div class="route-step">
            <h4 class="route-label">Pickup</h4>
            <p class="route-value">${pickup}</p>
          </div>
          <div class="route-step">
            <h4 class="route-label">Dropoff</h4>
            <p class="route-value">${drop}</p>
          </div>
        </div>

        <div class="summary-box">
          <div class="summary-row">
            <span>Base Fare</span>
            <span>₹${baseFare.toFixed(2)}</span>
          </div>
          ${distanceCharge > 0 ? `<div class="summary-row"><span>Distance Fare</span><span>₹${distanceCharge.toFixed(2)}</span></div>` : ''}
          ${timeCharge > 0 ? `<div class="summary-row"><span>Time Fare</span><span>₹${timeCharge.toFixed(2)}</span></div>` : ''}
          ${waitingCharge > 0 ? `<div class="summary-row"><span>Waiting Charges</span><span>₹${waitingCharge.toFixed(2)}</span></div>` : ''}
          ${additionalCharge > 0 ? `<div class="summary-row"><span>Additional Tolls/Fees</span><span>₹${additionalCharge.toFixed(2)}</span></div>` : ''}
          ${adminExtraCharge > 0 ? `<div class="summary-row"><span>Surcharges</span><span>₹${adminExtraCharge.toFixed(2)}</span></div>` : ''}
          ${discount > 0 ? `<div class="summary-row" style="color: #10b981; font-weight: 500;"><span>Promo Discount</span><span>-₹${discount.toFixed(2)}</span></div>` : ''}
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px; border-top: 1px dashed #cbd5e1; padding-top: 16px;">
            <tr>
              <td style="padding: 16px 0 0 0; font-size: 20px; font-weight: 700; color: #1e293b;">Total Fare Paid</td>
              <td style="padding: 16px 0 0 0; text-align: right; font-size: 20px; font-weight: 700; color: #1e293b;">₹${total.toFixed(2)}</td>
            </tr>
          </table>
        </div>
      </div>
      <div class="footer">
        <p>If you have any questions or feedback, please reach out to our customer support team.</p>
        <p>&copy; ${new Date().getFullYear()} Quick Drop. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  try {
    await sendEmail({
      kind: 'invoice',
      from: typeof from === 'string' && from.includes('<') ? from : `Quick Drop <${from}>`,
      to: email,
      subject,
      html
    });
    logger.info(`Taxi invoice email sent (or queued) to ${email} for trip ${rideId}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send taxi invoice email to ${email} for trip ${rideId}:`, err);
    return false;
  }
}
