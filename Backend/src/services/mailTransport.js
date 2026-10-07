import nodemailer from 'nodemailer';
import { emailCredentials } from '../core/settings/platformProfile.service.js';
import { logger } from '../utils/logger.js';

/**
 * The one SMTP transport every email goes out through (queues/email.queue.js).
 *
 * SMTP comes from Master settings if saved there, else .env
 * (core/settings/platformProfile.service.js). The transport is reused across sends
 * -- rebuilding it per send opens a new connection pool each time -- and rebuilt
 * only when the settings change, so saving new mail settings needs no restart.
 */
let transporter = null;
let transporterKey = '';
let testTransport = null;

export const isMailConfigured = () => {
    if (testTransport) return true;
    const mail = emailCredentials();
    return Boolean(mail.host && mail.user && mail.pass);
};

/** @returns {import('nodemailer').Transporter | null} null when SMTP is not configured */
export const getMailTransporter = () => {
    if (testTransport) return testTransport;
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
        auth: { user: mail.user, pass: mail.pass },
    });
    transporterKey = key;
    return transporter;
};

/** The From header: the configured sender, wrapped in the brand name when it is a bare address. */
export const defaultMailFrom = (brand = 'Quick Drop') => {
    const from = emailCredentials().from;
    if (!from) return `${brand} <noreply@example.com>`;
    return String(from).includes('<') ? from : `${brand} <${from}>`;
};

/** Tests only: route every send to this object ({ sendMail }). Pass nothing to restore SMTP. */
export const __setMailTransportForTests = (transport) => {
    testTransport = transport || null;
};
