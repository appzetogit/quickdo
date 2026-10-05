import express from 'express';
import { upload } from '../../../../../middleware/upload.js';
import { authRateLimiter } from '../../../../../middleware/rateLimit.js';
import { sendResponse, sendError } from '../../../../../utils/response.js';
import * as partner from './partner.service.js';

/**
 * Partner sign-up for stores and medical stores. Mounted at /v1/qc/partner.
 *
 *   POST /request-otp      { phone, type }        send the code
 *   POST /verify-otp       { phone, otp, type }   where this partner stands
 *   GET  /application      (onboarding token)     the saved application + checklist
 *   POST /application      (onboarding token)     submit, update or resubmit
 *   POST /upload           (onboarding token)     one document or photo -> { url }
 *
 * The onboarding token is not a seller session; see partner.service.js.
 */
const router = express.Router();

/*
 * The onboarding token, from X-Onboarding-Token or Authorization. The partner
 * app's HTTP client stamps Authorization with any stored seller session, which
 * would hide this token, so the dedicated header is read first.
 */
const bearer = (req) => {
    const dedicated = String(req.headers['x-onboarding-token'] || '').trim();
    if (dedicated) return dedicated;
    const header = String(req.headers.authorization || '');
    return header.startsWith('Bearer ') ? header.slice(7) : '';
};

const handle = (fn) => async (req, res) => {
    try {
        const { status = 200, message = 'OK', data } = await fn(req);
        return sendResponse(res, status, message, data);
    } catch (err) {
        const code = Number(err?.statusCode) || 500;
        return sendError(res, code, code < 500 ? err.message : 'Something went wrong. Please try again.');
    }
};

router.post('/request-otp', authRateLimiter, handle(async (req) => ({
    message: 'OTP sent',
    data: { phone: req.body?.phone, ...(await partner.requestPartnerOtp(req.body || {})) },
})));

router.post('/verify-otp', authRateLimiter, handle(async (req) => ({
    message: 'Verified',
    data: await partner.verifyPartnerOtp(req.body || {}),
})));

router.get('/application', handle(async (req) => ({
    message: 'Application',
    data: await partner.getMyApplication(bearer(req)),
})));

router.post('/application', handle(async (req) => ({
    message: 'Application submitted',
    data: await partner.submitApplication(bearer(req), req.body || {}),
})));

router.post('/upload', upload.single('file'), handle(async (req) => ({
    message: 'Uploaded',
    data: await partner.uploadPartnerDocument(bearer(req), req.file),
})));

export default router;
