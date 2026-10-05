import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/env.js';

/**
 * Identity documents (PAN, GST, FSSAI, Aadhaar, licences, drug licences,
 * pharmacist and registration papers, prescriptions, driver selfies) were
 * served at permanent public URLs under /uploads with a one-year cache: anyone
 * who ever saw a link -- a log, a forwarded screenshot -- kept the document.
 *
 * Now:
 *   - direct /uploads access to these folders is refused (here and in nginx);
 *   - new ones are written to a private root nothing serves directly;
 *   - every API response to a signed-in caller carries a SIGNED link that
 *     expires (the admin panel and the apps show documents exactly as before);
 *     a response to an anonymous caller carries an unsigned link, which can be
 *     stored (the signup forms post it back) but not opened.
 *
 * Stored values are left as they are: old /uploads URLs and new
 * /api/v1/files/p/... URLs are both recognised and re-signed on the way out.
 */

const PRIVATE_SEGMENTS = [
  'pan', 'gst', 'fssai', 'aadhar', 'aadhaar', 'license', 'licence', 'drug-licence', 'drug-license',
  'documents', 'driver-documents', 'panImage', 'fssaiImage', 'gstImage', 'aadharPhoto', 'panPhoto',
  'drivingLicensePhoto', 'pharmacist', 'registration', 'upi', 'prescriptions', 'driver-selfies',
];
const SEGMENT_RE = new RegExp(`(^|/)(${PRIVATE_SEGMENTS.map((s) => s.replace(/[-]/g, '\\-')).join('|')})(/|$)`);

export const SIGNED_LINK_TTL_SEC = 2 * 60 * 60;

export const isPrivatePath = (relativePath) => SEGMENT_RE.test(String(relativePath || '').replace(/^\/+/, ''));

export const privateRoot = () => path.resolve(
  process.env.PRIVATE_UPLOAD_ROOT || path.join(path.dirname(path.resolve(config.uploadStorageRoot)), 'private-uploads'),
);
export const publicRoot = () => path.resolve(config.uploadStorageRoot);

const secret = () => `${config.jwtAccessSecret}:private-files`;
const signature = (rel, exp) => crypto.createHmac('sha256', secret()).update(`${rel}|${exp}`).digest('base64url').slice(0, 32);

/** Origin the links are built on: the upload base URL without its /uploads. */
const origin = () => {
  const base = String(config.uploadBaseUrl || '').replace(/\/+$/, '');
  return /^https?:\/\//i.test(base) ? base.replace(/\/uploads$/i, '') : '';
};

export const privateUrl = (rel) => `${origin()}/api/v1/files/p/${String(rel).replace(/^\/+/, '')}`;

export const signedUrl = (rel, ttlSec = SIGNED_LINK_TTL_SEC) => {
  const clean = String(rel).replace(/^\/+/, '');
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${privateUrl(clean)}?e=${exp}&s=${signature(clean, exp)}`;
};

export const verifySignature = (rel, exp, sig) => {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Math.floor(Date.now() / 1000)) return false;
  const expected = signature(String(rel).replace(/^\/+/, ''), e);
  const a = Buffer.from(String(sig || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/*
 * A private-file URL inside a JSON string: either the old public form
 * (.../uploads/<rel>) or the new one (.../api/v1/files/p/<rel>, possibly with
 * an old signature). Group 2 is the relative path. Stops at a quote, space,
 * '?' or '#' so it never runs past the JSON value.
 */
const URL_IN_JSON = /((?:https?:\/\/[^"'\s/]+)?\/(?:uploads|api\/v1\/files\/p)\/)([^"'\s?#\\]+)(\?e=\d+(?:&|\\u0026)s=[A-Za-z0-9_-]+)?/g;

export function rewritePrivateUrls(text, { signed }) {
  if (typeof text !== 'string' || !(text.includes('/uploads/') || text.includes('/files/p/'))) return text;
  return text.replace(URL_IN_JSON, (whole, _prefix, rel) => {
    if (!isPrivatePath(rel)) return whole;
    return signed ? signedUrl(rel) : privateUrl(rel);
  });
}

/** Signed-in callers (core sets req.user, taxi sets req.auth, SP sets req.userId). */
const isSignedIn = (req) => Boolean(req.user?.userId || req.user?.id || req.user?._id || req.auth?.sub || req.userId);

/**
 * Wraps res.json for every API response. Cheap when there is nothing to do:
 * one substring check on the serialised body.
 */
export function privateFileLinks(req, res, next) {
  // Incoming: a form that posts back a signed link (an admin editing a store)
  // must not store the signature. Stored values stay unsigned.
  if (req.body && typeof req.body === 'object') {
    try {
      const raw = JSON.stringify(req.body);
      if (raw.includes('/files/p/')) req.body = JSON.parse(rewritePrivateUrls(raw, { signed: false }));
    } catch { /* leave the body as it was */ }
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    let text;
    try {
      text = JSON.stringify(body);
    } catch {
      return originalJson(body);
    }
    if (text === undefined || !(text.includes('/uploads/') || text.includes('/files/p/'))) return originalJson(body);
    const out = rewritePrivateUrls(text, { signed: isSignedIn(req) });
    if (out === text) return originalJson(body);
    if (!res.get('Content-Type')) res.type('application/json');
    return res.send(out);
  };
  next();
}

/** Refuses direct /uploads access to private folders (express static; nginx has the same rule). */
export function blockPrivateStatic(req, res, next) {
  if (isPrivatePath(decodeURIComponent(req.path || ''))) return res.status(404).end();
  next();
}

const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.pdf': 'application/pdf', '.heic': 'image/heic' };

/** GET /api/v1/files/p/<rel>?e=&s= -- the one way to open a private file. */
export function servePrivateFile(req, res) {
  const rel = String(req.params[0] || '').replace(/^\/+/, '');
  if (!rel || rel.includes('..') || !isPrivatePath(rel)) return res.status(404).end();
  if (!verifySignature(rel, req.query.e, req.query.s)) {
    return res.status(403).json({ success: false, message: 'This link has expired. Reopen the page to see the document.' });
  }
  for (const root of [privateRoot(), publicRoot()]) {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) continue;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Type', TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream');
      return fs.createReadStream(abs).pipe(res);
    }
  }
  return res.status(404).end();
}
