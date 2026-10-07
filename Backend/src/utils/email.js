import { sendEmail } from '../queues/email.queue.js';
import { isMailConfigured } from '../services/mailTransport.js';
import { logger } from './logger.js';

/*
 * Every message here goes through the email queue (queues/email.queue.js): queued
 * when BullMQ is on, sent directly when it is not. One-time codes are marked
 * `sensitive`, so a queued job is deleted the moment it is sent.
 */

const codeEmailHtml = ({ heading, intro, code, minutes, footer }) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 480px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #111;">${heading}</h2>
  <p>${intro} It is valid for ${minutes} minutes.</p>
  <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; background: #f5f5f5; padding: 12px 16px; border-radius: 8px;">${code}</p>
  <p style="color: #666; font-size: 14px;">If you did not request this, you can ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">${footer}</p>
</body>
</html>`;

/** Queue or send; true when it was queued or sent. Never throws. */
const deliver = async (mail) => {
    if (!isMailConfigured()) {
        logger.warn(`Email [${mail.kind}] to ${mail.to} skipped: SMTP not configured`);
        return false;
    }
    try {
        const result = await sendEmail(mail);
        return Boolean(result.queued || result.sent);
    } catch (err) {
        logger.error(`Failed to send ${mail.kind} email to ${mail.to}: ${err.message}`);
        return false;
    }
};

/**
 * Send OTP email for admin forgot password.
 * @param {string} to - Recipient email
 * @param {string} otp - 6-digit OTP
 * @returns {Promise<boolean>} true if queued or sent, false if skipped/failed
 */
export async function sendAdminResetOtpEmail(to, otp) {
    return deliver({
        kind: 'admin_password_reset',
        sensitive: true,
        to,
        subject: 'Your password reset code – Quick Drop Admin',
        html: codeEmailHtml({
            heading: 'Password reset code',
            intro: 'Use the code below to reset your admin password.',
            code: otp,
            minutes: 10,
            footer: 'Quick Drop Admin',
        }),
        text: `Your password reset code is: ${otp}. It is valid for 10 minutes. If you did not request this, ignore this email.`,
    });
}

const CUSTOMER_CODE_COPY = {
    verify_email: {
        subject: 'Verify your email – Quick Drop',
        heading: 'Verify your email',
        intro: 'Use this code to verify your email address.',
    },
    password_reset: {
        subject: 'Your password reset code – Quick Drop',
        heading: 'Reset your password',
        intro: 'Use this code to reset your Quick Drop password.',
    },
    restaurant_login: {
        subject: 'Your restaurant sign-in code – Quick Drop',
        heading: 'Sign in to your restaurant',
        intro: 'Use this code to sign in to your Quick Drop restaurant dashboard.',
    },
};

/**
 * One-time code for a customer: email verification or password reset.
 * @param {string} to
 * @param {string} code
 * @param {'verify_email'|'password_reset'} purpose
 * @param {number} minutes  how long the code is valid
 * @returns {Promise<boolean>}
 */
export async function sendCustomerCodeEmail(to, code, purpose, minutes = 10) {
    const copy = CUSTOMER_CODE_COPY[purpose] || CUSTOMER_CODE_COPY.verify_email;
    return deliver({
        kind: purpose,
        sensitive: true,
        to,
        subject: copy.subject,
        html: codeEmailHtml({ heading: copy.heading, intro: copy.intro, code, minutes, footer: 'Quick Drop' }),
        text: `${copy.intro} Your code is ${code}. It is valid for ${minutes} minutes. If you did not request this, ignore this email.`,
    });
}
