import { sendEmail as queueEmail } from '../../../queues/email.queue.js';
import { defaultMailFrom } from '../../../services/mailTransport.js';

/*
 * Through the platform email queue (queues/email.queue.js): queued when BullMQ is
 * on, sent directly otherwise, with the shared SMTP transport (Master settings,
 * else .env). Throws on an SMTP rejection, as before.
 *
 * Only the admin password reset uses this today, so every message is marked
 * sensitive: a queued job carrying a code is deleted as soon as it is sent.
 */
export const sendEmail = async ({ to, subject, text, html, kind = 'taxi_admin_password_reset', sensitive = true }) => {
  try {
    const result = await queueEmail({
      kind,
      sensitive,
      from: defaultMailFrom(),
      to,
      subject,
      text,
      html,
    });
    console.log(`Email ${result.queued ? 'queued' : result.sent ? 'sent' : 'skipped'}: ${kind} to ${to}`);
    return result;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};
