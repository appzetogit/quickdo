import { getQueue } from './index.js';
import { EMAIL_QUEUE } from './queue.constants.js';
import { getMailTransporter, defaultMailFrom, isMailConfigured } from '../services/mailTransport.js';
import { logger } from '../utils/logger.js';

/**
 * Every email the platform sends goes through here (SOW plan 2.6): invoices,
 * booking confirmations, onboarding status, password reset and verification codes.
 *
 *   sendEmail(mail)
 *     BULLMQ_ENABLED + Redis up  -> queued on the 'email' queue; the worker
 *                                    (queues/workers/email.worker.js) sends it, with
 *                                    retries and backoff, so a slow or flaky SMTP
 *                                    server never holds up an API request.
 *     otherwise (the default)    -> sent directly, exactly as before the queue.
 *     queue add fails            -> sent directly too: an email is never dropped
 *                                    because Redis is down.
 *
 * `mail` is nodemailer's message shape ({ to, subject, html, text, from,
 * attachments }) plus:
 *   kind       a label for logs and the job name ('invoice', 'password_reset', ...)
 *   sensitive  true for messages carrying a one-time code: the job is deleted as soon
 *              as it completes (or fails for good), so the code does not sit in
 *              Redis afterwards. Logs never include the body.
 *
 * Attachments must survive JSON (BullMQ stores job data as JSON), so Buffer
 * contents are carried as base64 and restored by nodemailer.
 */

const JOB_OPTIONS = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { age: 7 * 24 * 3600 },
};
const SENSITIVE_JOB_OPTIONS = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: true,
    removeOnFail: true,
};

let queueOverride;
/** Tests only: stand in for the BullMQ queue ({ add }). `null` means no queue; `undefined` restores the real one. */
export const __setEmailQueueForTests = (queue) => {
    queueOverride = queue;
};

const toPortableAttachment = (a) => {
    if (!a) return a;
    if (Buffer.isBuffer(a.content)) {
        return { ...a, content: a.content.toString('base64'), encoding: 'base64' };
    }
    return a;
};

/** The message as stored in a job: plain JSON, nothing a worker cannot rebuild. */
export const toJobPayload = (mail = {}) => ({
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    replyTo: mail.replyTo,
    from: mail.from,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: Array.isArray(mail.attachments) ? mail.attachments.map(toPortableAttachment) : undefined,
    kind: mail.kind || 'email',
    sensitive: Boolean(mail.sensitive),
});

/**
 * Send one message through SMTP now. Used by the worker, and by sendEmail when
 * there is no queue.
 *
 * @returns {Promise<{sent: boolean, skipped?: boolean, messageId?: string}>}
 * @throws when SMTP rejects the message -- the worker relies on that to retry.
 */
export const deliverEmailNow = async (mail = {}) => {
    const kind = mail.kind || 'email';
    if (!mail.to) {
        logger.warn(`Email [${kind}] skipped: no recipient`);
        return { sent: false, skipped: true };
    }
    const transport = getMailTransporter();
    if (!transport) {
        // Not an error to retry: nothing will change until an admin configures SMTP.
        logger.warn(`Email [${kind}] to ${mail.to} skipped: SMTP not configured`);
        return { sent: false, skipped: true };
    }
    const { kind: _k, sensitive: _s, ...message } = mail;
    const info = await transport.sendMail({ ...message, from: message.from || defaultMailFrom() });
    logger.info(`Email [${kind}] sent to ${mail.to}${info?.messageId ? ` (${info.messageId})` : ''}`);
    return { sent: true, messageId: info?.messageId };
};

/**
 * Queue an email, or send it now when there is no queue.
 *
 * @returns {Promise<{queued: boolean, sent: boolean, skipped?: boolean, jobId?: string}>}
 * @throws only when sent directly and SMTP rejects it (callers already handle that,
 *         as they did when they called nodemailer themselves).
 */
export const sendEmail = async (mail = {}) => {
    const payload = toJobPayload(mail);
    const queue = queueOverride !== undefined ? queueOverride : getQueue(EMAIL_QUEUE);
    if (queue) {
        try {
            const job = await queue.add(payload.kind, payload, payload.sensitive ? SENSITIVE_JOB_OPTIONS : JOB_OPTIONS);
            return { queued: true, sent: false, jobId: String(job?.id || '') };
        } catch (err) {
            logger.error(`Email [${payload.kind}] could not be queued (${err.message}); sending directly`);
        }
    }
    if (!isMailConfigured()) {
        logger.warn(`Email [${payload.kind}] to ${payload.to} skipped: SMTP not configured`);
        return { queued: false, sent: false, skipped: true };
    }
    const result = await deliverEmailNow(payload);
    return { queued: false, ...result };
};

export { EMAIL_QUEUE };
