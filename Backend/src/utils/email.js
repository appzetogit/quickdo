import nodemailer from 'nodemailer';
import { emailCredentials } from '../core/settings/platformProfile.service.js';
import { config } from '../config/env.js';
import { logger } from './logger.js';

let transporter = null;
let transporterKey = '';

// SMTP from Master settings if saved there, else .env; rebuilt when it changes.
function getTransporter() {
    const mail = emailCredentials();
    const key = `${mail.host}|${mail.port}|${mail.user}|${mail.pass}|${mail.secure}`;
    if (transporter && key === transporterKey) return transporter;
    if (!mail.host || !mail.user || !mail.pass) {
        logger.warn('Email not configured: set it in Master settings, or EMAIL_HOST, EMAIL_USER, EMAIL_PASS');
        return null;
    }
    transporter = nodemailer.createTransport({
        host: mail.host,
        port: mail.port || 587,
        secure: mail.secure,
        auth: {
            user: mail.user,
            pass: mail.pass
        }
    });
    transporterKey = key;
    return transporter;
}

/**
 * Send OTP email for admin forgot password.
 * @param {string} to - Recipient email
 * @param {string} otp - 6-digit OTP
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
export async function sendAdminResetOtpEmail(to, otp) {
    const trans = getTransporter();
    if (!trans) {
        logger.warn('Admin OTP email skipped: SMTP not configured');
        return false;
    }
    const from = emailCredentials().from;
    const subject = 'Your password reset code – Quick Drop Admin';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 480px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #111;">Password reset code</h2>
  <p>Use the code below to reset your admin password. It is valid for 10 minutes.</p>
  <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; background: #f5f5f5; padding: 12px 16px; border-radius: 8px;">${otp}</p>
  <p style="color: #666; font-size: 14px;">If you did not request this, you can ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">Quick Drop Admin</p>
</body>
</html>`;
    const text = `Your password reset code is: ${otp}. It is valid for 10 minutes. If you did not request this, ignore this email.`;

    try {
        await trans.sendMail({
            from: typeof from === 'string' && from.includes('<') ? from : `Quick Drop <${from}>`,
            to,
            subject,
            text,
            html
        });
        logger.info(`Admin reset OTP email sent to ${to}`);
        return true;
    } catch (err) {
        logger.error(`Failed to send admin OTP email to ${to}:`, err.message);
        return false;
    }
}

