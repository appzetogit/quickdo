/*
 * Quick commerce sends the same admin reset email as the rest of the platform, so
 * it uses the platform's sender -- one template, one SMTP transport, and the email
 * queue (queues/email.queue.js) -- instead of a forked copy of it.
 */
export { sendAdminResetOtpEmail } from '../../../utils/email.js';
