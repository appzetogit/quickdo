const { emailCredentials } = require('../../../core/settings/platformCredentials.cjs');
const nodemailer = require('nodemailer');

const COLORS = {
  primary: '#00a6a6',
  secondary: '#115e59',
  accent: '#f59e0b',
  success: '#10b981',
  bg: '#f1f5f9',
  white: '#ffffff',
  text: '#0f172a',
  lightText: '#64748b',
  border: '#e2e8f0'
};

const emailWrapper = (content, title, preheader = '') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: ${COLORS.bg}; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
    .preheader { display: none; max-width: 0; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0; }
    .wrapper { width: 100%; table-layout: fixed; background-color: ${COLORS.bg}; padding-bottom: 60px; }
    .main { max-width: 600px; margin: 0 auto; background-color: ${COLORS.white}; border-radius: 24px; overflow: hidden; margin-top: 40px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); }
    
    .header { background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.secondary} 100%); padding: 48px 40px; text-align: center; position: relative; }
    .logo-circle { width: 64px; height: 64px; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); color: white; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 800; border: 1px solid rgba(255,255,255,0.3); margin-bottom: 16px; }
    .header h1 { margin: 0; font-size: 24px; color: ${COLORS.white}; font-weight: 800; letter-spacing: -0.5px; }
    
    .content { padding: 48px 40px; color: ${COLORS.text}; }
    .badge { display: inline-block; padding: 8px 16px; border-radius: 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 24px; }
    .badge-primary { background-color: ${COLORS.primary}15; color: ${COLORS.primary}; }
    .badge-success { background-color: ${COLORS.success}15; color: ${COLORS.success}; }
    
    h2 { font-size: 28px; font-weight: 800; line-height: 1.2; margin: 0 0 16px 0; color: ${COLORS.text}; letter-spacing: -0.5px; }
    p { font-size: 16px; line-height: 1.6; color: ${COLORS.lightText}; margin: 0 0 24px 0; }
    
    .card { background-color: #f8fafc; border: 1px solid ${COLORS.border}; border-radius: 20px; padding: 32px; margin: 32px 0; }
    .card-title { font-size: 14px; font-weight: 700; text-transform: uppercase; color: ${COLORS.lightText}; letter-spacing: 1px; margin-bottom: 20px; border-bottom: 1px solid ${COLORS.border}; padding-bottom: 12px; }
    
    .data-row { display: flex; justify-content: space-between; padding: 12px 0; }
    .data-label { font-size: 14px; font-weight: 600; color: ${COLORS.lightText}; }
    .data-value { font-size: 14px; font-weight: 700; color: ${COLORS.text}; text-align: right; }
    
    .total-row { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 20px; border-top: 2px dashed ${COLORS.border}; }
    .total-label { font-size: 18px; font-weight: 800; color: ${COLORS.text}; }
    .total-value { font-size: 22px; font-weight: 900; color: ${COLORS.primary}; }
    
    .btn-container { text-align: center; margin-top: 40px; }
    .btn { display: inline-block; background-color: ${COLORS.primary}; color: ${COLORS.white} !important; padding: 18px 36px; border-radius: 16px; font-weight: 700; font-size: 16px; text-decoration: none; box-shadow: 0 10px 15px -3px rgba(0, 166, 166, 0.3); transition: all 0.2s; }
    
    .footer { text-align: center; padding: 40px; }
    .footer p { font-size: 13px; color: ${COLORS.lightText}; margin-bottom: 8px; }
    .social-links { margin-top: 20px; }
    .social-links a { color: ${COLORS.primary}; text-decoration: none; font-weight: 600; font-size: 13px; margin: 0 10px; }
    
    @media only screen and (max-width: 600px) {
      .main { margin-top: 0; border-radius: 0; }
      .content { padding: 32px 24px; }
      .card { padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="preheader">${preheader}</div>
  <div class="wrapper">
    <div class="main">
      <div class="header">
        <div class="logo-circle">H</div>
        <h1>Homster</h1>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>Premium Home Services • Delivered with Care</p>
        <p>&copy; ${new Date().getFullYear()} Homster India. All rights reserved.</p>
        <div class="social-links">
          <a href="#">Help Center</a>
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

// Memoised. This used to build a fresh nodemailer transport on every send, and
// there are six send sites -- each call opened its own SMTP connection pool that
// was never closed, so a burst of mail exhausted connections against the provider.
// nodemailer transports are designed to be long-lived and reused.
// Matches how master's src/services/email.service.js does it.
let transporter = null;
let transporterKey = '';

// SMTP from Master settings if saved there, else .env; rebuilt when it changes.
const createTransporter = () => {
  const mail = emailCredentials();
  const key = `${mail.host}|${mail.port}|${mail.user}|${mail.pass}|${mail.secure}`;
  if (transporter && key === transporterKey) return transporter;
  transporter = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: mail.secure,
    auth: {
      user: mail.user,
      pass: mail.pass
    }
  });
  transporterKey = key;
  return transporter;
};

/**
 * Send OTP Email - Professional Style
 */
const sendOTPEmail = async (email, otp, purpose = 'verification') => {
  try {
    if (!emailCredentials().user || !emailCredentials().pass) {
      console.log(`[EMAIL SERVICE] OTP for ${email}: ${otp}`);
      return { success: true };
    }

    const transporter = createTransporter();
    const subjectPrefix = purpose === 'password_reset' ? 'Reset Password' : 'Verify Email';

    const content = `
      <div style="text-align: center;">
        <div class="badge badge-primary">Security</div>
        <h2>Verify your identity</h2>
        <p>Your one-time password (OTP) for Homster is ready. Use this code to complete your ${purpose.replace('_', ' ')}.</p>
        
        <div style="background: ${COLORS.bg}; border-radius: 20px; padding: 40px; margin: 40px 0; border: 2px dashed ${COLORS.primary};">
          <div style="font-size: 48px; font-weight: 900; letter-spacing: 12px; color: ${COLORS.primary}; margin-bottom: 8px;">${otp}</div>
          <div style="font-size: 13px; color: ${COLORS.lightText}; font-weight: 600; text-transform: uppercase;">Valid for 10 minutes only</div>
        </div>
        
        <p style="font-size: 14px;">If you didn't request this code, you can safely ignore this email. Someone else might have typed your email address by mistake.</p>
      </div>
    `;

    await transporter.sendMail({
      from: emailCredentials().from || 'Quick Drop <noreply@quickdropsindia.com>',
      to: email,
      subject: `${subjectPrefix} - Homster`,
      html: emailWrapper(content, subjectPrefix, `Your verification code is ${otp}`)
    });
    return { success: true };
  } catch (error) {
    console.error('OTP email error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send Welcome Email - Professional App Style
 */
const sendWelcomeEmail = async (email, name) => {
  try {
    if (!emailCredentials().user || !emailCredentials().pass) return { success: true };
    const transporter = createTransporter();

    const content = `
      <div style="text-align: center;">
        <div class="badge badge-success">Welcome</div>
        <h2>Hello ${name}! 👋</h2>
        <p>Welcome to the Homster family. We're excited to help you take care of your home with our premium services.</p>
        
        <div style="display: flex; justify-content: space-around; margin: 40px 0; flex-wrap: wrap;">
          <div style="width: 140px; margin: 10px;">
             <div style="font-size: 32px; margin-bottom: 10px;">🛡️</div>
             <div style="font-size: 14px; font-weight: 700;">Verified Pros</div>
          </div>
          <div style="width: 140px; margin: 10px;">
             <div style="font-size: 32px; margin-bottom: 10px;">⚡</div>
             <div style="font-size: 14px; font-weight: 700;">Fast Booking</div>
          </div>
          <div style="width: 140px; margin: 10px;">
             <div style="font-size: 32px; margin-bottom: 10px;">💎</div>
             <div style="font-size: 14px; font-weight: 700;">Secure Pay</div>
          </div>
        </div>

        <div class="btn-container">
          <a href="#" class="btn">Book Your First Service</a>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: emailCredentials().from || 'Quick Drop <noreply@quickdropsindia.com>',
      to: email,
      subject: 'Welcome to Homster!',
      html: emailWrapper(content, 'Welcome', 'Welcome to the future of home services')
    });
    return { success: true };
  } catch (error) {
    console.error('Welcome email error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send Booking Email - Detailed App Style
 */
const sendBookingEmails = async (booking, user, vendor, service) => {
  try {
    if (!emailCredentials().user || !emailCredentials().pass) return;
    const transporter = createTransporter();
    const bookingId = booking.bookingNumber || booking._id;

    if (user && user.email) {
      const content = `
        <div class="badge badge-success">Confirmed</div>
        <h2>Booking Scheduled</h2>
        <p>Great news! Your booking for <strong>${service.title || service.name}</strong> has been confirmed. A professional will be at your door as per the schedule below.</p>
        
        <div class="card">
          <div class="card-title">Order Summary</div>
          <div class="data-row"><span class="data-label">Booking ID</span><span class="data-value">#${bookingId}</span></div>
          <div class="data-row"><span class="data-label">Date</span><span class="data-value">${new Date(booking.scheduledDate).toLocaleDateString('en-IN', { dateStyle: 'full' })}</span></div>
          <div class="data-row"><span class="data-label">Time Slot</span><span class="data-value">${booking.scheduledTime}</span></div>
          <div class="data-row"><span class="data-label">Address</span><span class="data-value">${booking.address.city}, ${booking.address.pincode}</span></div>
          
          <div class="total-row">
            <span class="total-label">Total Amount</span>
            <span class="total-value">₹${booking.finalAmount}</span>
          </div>
        </div>

        <div class="btn-container">
          <a href="#" class="btn">Track Order in App</a>
        </div>
      `;

      await transporter.sendMail({
        from: emailCredentials().from || 'Quick Drop <noreply@quickdropsindia.com>',
        to: user.email,
        subject: `Booking Confirmed #${bookingId} - Homster`,
        html: emailWrapper(content, 'Confirmed', 'Your booking is scheduled successfully')
      });
    }

    if (vendor && vendor.email) {
      const vContent = `
        <div class="badge badge-primary">New Job</div>
        <h2>Incoming Order</h2>
        <p>Hello ${vendor.name}, a new booking has been assigned to you. Plan your resources accordingly.</p>
        
        <div class="card">
          <div class="card-title">Job Details</div>
          <div class="data-row"><span class="data-label">Order</span><span class="data-value">#${bookingId}</span></div>
          <div class="data-row"><span class="data-label">Service</span><span class="data-value">${service.title}</span></div>
          <div class="data-row"><span class="data-label">Customer</span><span class="data-value">${user.name}</span></div>
          <div class="data-row"><span class="data-label">Schedule</span><span class="data-value">${new Date(booking.scheduledDate).toLocaleDateString()} at ${booking.scheduledTime}</span></div>
          <div class="data-row"><span class="data-label">Amount</span><span class="data-value">₹${booking.finalAmount}</span></div>
        </div>

        <div class="btn-container">
          <a href="#" class="btn" style="background-color: ${COLORS.secondary};">Accept & View Details</a>
        </div>
      `;

      await transporter.sendMail({
        from: emailCredentials().from || 'Quick Drop <noreply@quickdropsindia.com>',
        to: vendor.email,
        subject: `New Job Assigned #${bookingId} - Homster`,
        html: emailWrapper(vContent, 'New Job', 'Action Required: New job assigned')
      });
    }
  } catch (error) { console.error('Booking email error:', error); }
};

/**
 * Send Invoice Email - Professional Invoice Style
 */
const sendBookingCompletionEmails = async (booking) => {
  try {
    if (!emailCredentials().user || !emailCredentials().pass) return;
    const transporter = createTransporter();
    const user = booking.userId;
    const bookingId = booking.bookingNumber || booking._id;

    if (user && user.email) {
      const content = `
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 48px; margin-bottom: 16px;">⭐</div>
          <h2>Service Completed</h2>
          <p>Thank you for choosing Homster. We hope the service for <strong>${booking.serviceId?.title || 'Home Service'}</strong> was to your satisfaction.</p>
        </div>

        <div class="card" style="background-color: white;">
          <div class="card-title">Official Receipt</div>
          <div class="data-row"><span class="data-label">Invoice No.</span><span class="data-value">INV-${bookingId}</span></div>
          <div class="data-row"><span class="data-label">Completed On</span><span class="data-value">${new Date().toLocaleDateString('en-IN')}</span></div>
          <div class="data-row"><span class="data-label">Service Charge</span><span class="data-value">₹${booking.basePrice - booking.discount}</span></div>
          <div class="data-row"><span class="data-label">Visiting Fee</span><span class="data-value">₹${booking.visitingCharges}</span></div>
          <div class="data-row"><span class="data-label">HST (Tax)</span><span class="data-value">₹${booking.tax}</span></div>
          
          <div class="total-row">
            <span class="total-label">Amount Paid</span>
            <span class="total-value">₹${booking.finalAmount}</span>
          </div>
        </div>

        <div style="text-align: center; margin-top: 32px; border: 1px solid ${COLORS.border}; border-radius: 16px; padding: 24px;">
           <div style="font-weight: 700; font-size: 14px; color: ${COLORS.text}; margin-bottom: 8px;">RATE THE PROFESSIONAL</div>
           <p style="font-size: 13px; margin: 0;">How was your experience with us? Help others by rating the service.</p>
           <div class="btn-container" style="margin-top: 16px;">
             <a href="#" class="btn" style="background-color: #f59e0b;">Submit Rating</a>
           </div>
        </div>
      `;

      await transporter.sendMail({
        from: emailCredentials().from || 'Quick Drop <noreply@quickdropsindia.com>',
        to: user.email,
        subject: `Service Invoice #${bookingId} - Homster`,
        html: emailWrapper(content, 'Invoice', 'Your service is complete. Here is the receipt.')
      });
    }
  } catch (error) { console.error('Invoice email error:', error); }
};

/**
 * Send Withdrawal Approved Email
 */
const sendWithdrawalApprovedEmail = async (vendor, amount, transactionId) => {
  try {
    if (!emailCredentials().user || !emailCredentials().pass || !vendor.email) return;
    const transporter = createTransporter();

    const content = `
      <div style="text-align: center;">
        <div class="badge badge-success">Settlemet Done</div>
        <h2>Funds Withdrawn Successfully</h2>
        <p>Hi ${vendor.name}, your withdrawal request has been approved and successfully processed to your account.</p>
        
        <div class="card">
          <div class="data-row"><span class="data-label">Transaction Ref</span><span class="data-value">${transactionId || 'N/A'}</span></div>
          <div class="data-row"><span class="data-label">Settlemet Date</span><span class="data-value">${new Date().toLocaleDateString()}</span></div>
          <div class="total-row">
            <span class="total-label">Amount Sent</span>
            <span class="total-value" style="color: ${COLORS.success}">₹${amount}</span>
          </div>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: emailCredentials().from || 'Quick Drop <noreply@quickdropsindia.com>',
      to: vendor.email,
      subject: 'Withdrawal Success - Homster',
      html: emailWrapper(content, 'Withdrawal', 'Your funds are on the way')
    });
  } catch (error) { console.error(error); }
};

/**
 * Send Dues Payment Approved Email
 */
const sendDuesPaymentApprovedEmail = async (vendor, amount, balanceAfter) => {
  try {
    if (!emailCredentials().user || !emailCredentials().pass || !vendor.email) return;
    const transporter = createTransporter();

    const content = `
      <div style="text-align: center;">
        <div class="badge badge-success">Verified</div>
        <h2>Payment Acknowledged</h2>
        <p>Hi ${vendor.name}, we've successfully verified your dues payment. Your wallet has been updated.</p>
        
        <div class="card">
          <div class="data-row"><span class="data-label">Payment Amount</span><span class="data-value">₹${amount}</span></div>
          <div class="total-row">
            <span class="total-label">Remaining Balance</span>
            <span class="total-value">₹${balanceAfter}</span>
          </div>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: emailCredentials().from || 'Quick Drop <noreply@quickdropsindia.com>',
      to: vendor.email,
      subject: 'Dues Payment Verified - Homster',
      html: emailWrapper(content, 'Verified', 'We have received your payment')
    });
  } catch (error) { console.error(error); }
};

module.exports = {
  // exported so tests can assert the transport really is reused, not rebuilt per send
  _createTransporter: createTransporter,
  sendOTPEmail,
  sendWelcomeEmail,
  sendBookingEmails,
  sendBookingCompletionEmails,
  sendWithdrawalApprovedEmail,
  sendDuesPaymentApprovedEmail
};
