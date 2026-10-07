import { deliverEmailNow } from '../email.queue.js';

/**
 * Send one queued email. Throws when SMTP rejects it, so BullMQ retries with
 * backoff (see JOB_OPTIONS in email.queue.js). An unconfigured SMTP server is not
 * retried: nothing changes until an admin sets it up.
 *
 * @param {import('bullmq').Job} job
 */
export const processEmailJob = async (job) => {
    const result = await deliverEmailNow(job.data || {});
    return { ...result, jobId: job.id };
};
