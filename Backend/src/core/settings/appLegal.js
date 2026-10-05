import mongoose from 'mongoose';
import { sendResponse, sendError } from '../../utils/response.js';
import { managedLegalPage } from './platformProfile.service.js';

/**
 * Terms and privacy pages written per app: the food customer app, the
 * restaurant app and the food delivery app each get their own, and so do the
 * quick commerce, medical, taxi and services apps.
 *
 * An app with no page of its own shows the platform-wide one (Master settings,
 * Legal pages), and failing that whatever its service already had.
 */

export const LEGAL_APPS = Object.freeze([
  { key: 'food_user', label: 'Food: customer app', group: 'Food' },
  { key: 'food_restaurant', label: 'Food: restaurant app', group: 'Food' },
  { key: 'food_delivery', label: 'Food: delivery partner app', group: 'Food' },
  { key: 'qc_user', label: 'Quick commerce: customer app', group: 'Quick commerce' },
  { key: 'qc_seller', label: 'Quick commerce: seller app', group: 'Quick commerce' },
  { key: 'qc_rider', label: 'Quick commerce: rider app', group: 'Quick commerce' },
  { key: 'medical_user', label: 'Medical: customer app', group: 'Medical' },
  { key: 'medical_seller', label: 'Medical: pharmacy app', group: 'Medical' },
  { key: 'taxi_user', label: 'Taxi: rider app', group: 'Taxi' },
  { key: 'taxi_driver', label: 'Taxi: driver app', group: 'Taxi' },
  { key: 'services_user', label: 'Services: customer app', group: 'Services' },
  { key: 'services_provider', label: 'Services: provider app', group: 'Services' },
]);
export const LEGAL_KINDS = Object.freeze([
  { key: 'terms', label: 'Terms & Conditions' },
  { key: 'privacy', label: 'Privacy Policy' },
]);

const APP_KEYS = new Set(LEGAL_APPS.map((a) => a.key));
const KIND_KEYS = new Set(LEGAL_KINDS.map((k) => k.key));

const schema = new mongoose.Schema(
  {
    app: { type: String, required: true },
    kind: { type: String, required: true },
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  { collection: 'platform_app_legal', timestamps: true },
);
schema.index({ app: 1, kind: 1 }, { unique: true });
export const AppLegalPage = mongoose.models.AppLegalPage || mongoose.model('AppLegalPage', schema);

/** This app's own page, or null. */
export const appLegalPage = async (app, kind) => {
  if (!APP_KEYS.has(app) || !KIND_KEYS.has(kind)) return null;
  try {
    const doc = await AppLegalPage.findOne({ app, kind }).lean();
    return doc && String(doc.content || '').trim() ? { title: doc.title || '', content: doc.content } : null;
  } catch {
    return null;
  }
};

/**
 * THE precedence for every legal page on the platform, in one place.
 *
 *     this app's own page  >  the platform-wide page  >  the vertical's own
 *
 * Four screens used to write legal text -- Master's per-app pages, Master's
 * platform-wide pages, food's PAGES & SOCIAL MEDIA, and taxi's landing CMS --
 * and nothing said which one an app would actually show. An admin could edit
 * one, see no change, and have no way to find out why.
 *
 * Returning `source` is the other half of the fix: a screen that cannot say
 * WHICH level is in force leaves the operator guessing all over again.
 *
 * The vertical's own page is not read here -- each vertical still owns that
 * fallback and its own shape (food stores an `about` block, taxi stores HTML) --
 * so callers apply it after this returns null.
 */
export const resolveAppLegalPage = async (app, kind) => {
  const own = await appLegalPage(app, kind);
  if (own) return { ...own, source: 'app' };
  const shared = await managedLegalPage(kind);
  if (shared) return { title: '', content: shared, source: 'platform' };
  return null;
};

/* ------------------------------------------------------------ handlers -- */

const defaultTitle = (kind) => LEGAL_KINDS.find((k) => k.key === kind)?.label || kind;

// GET /v1/platform/legal/:app/:kind (public: apps show it before sign-in)
export const getPublicAppLegal = async (req, res) => {
  const { app, kind } = req.params;
  if (!APP_KEYS.has(app) || !KIND_KEYS.has(kind)) return sendError(res, 404, 'No such page');
  const page = await resolveAppLegalPage(app, kind);
  return sendResponse(res, 200, 'Page', {
    app,
    kind,
    title: page?.title || defaultTitle(kind),
    content: page?.content || '',
  });
};

// GET /v1/platform/settings/app-legal
export const listAppLegal = async (_req, res) => {
  try {
    const docs = await AppLegalPage.find({}).lean();
    const pages = {};
    for (const d of docs) pages[`${d.app}:${d.kind}`] = { title: d.title, content: d.content, updatedAt: d.updatedAt };

    /*
     * Which platform-wide pages exist, so the screen can tell an admin what an
     * app falls back to when it has no page of its own. Without this the editor
     * shows an empty box for an app that is, in fact, already serving the
     * platform's text -- and "empty" reads as "nothing is published".
     */
    const platform = {};
    for (const { key } of LEGAL_KINDS) {
      // eslint-disable-next-line no-await-in-loop
      platform[key] = Boolean(await managedLegalPage(key));
    }

    return sendResponse(res, 200, 'App legal pages', {
      apps: LEGAL_APPS, kinds: LEGAL_KINDS, pages, platform,
    });
  } catch (err) {
    return sendError(res, 500, err.message || 'Could not load pages');
  }
};

// PUT /v1/platform/settings/app-legal/:app/:kind  { title, content }  (empty content clears)
export const saveAppLegal = async (req, res) => {
  const { app, kind } = req.params;
  if (!APP_KEYS.has(app) || !KIND_KEYS.has(kind)) return sendError(res, 400, 'Unknown app or page');
  const content = String(req.body?.content ?? '');
  const title = String(req.body?.title ?? '').trim().slice(0, 200);
  if (content.length > 200_000) return sendError(res, 400, 'The page is too long');
  try {
    if (!content.trim()) {
      await AppLegalPage.deleteOne({ app, kind });
      return sendResponse(res, 200, 'Cleared', { app, kind, page: null });
    }
    const updatedBy = String(req.financeActor?.adminId || req.user?.userId || '');
    const doc = await AppLegalPage.findOneAndUpdate(
      { app, kind },
      { $set: { title, content, updatedBy } },
      { upsert: true, new: true },
    ).lean();
    return sendResponse(res, 200, 'Saved', { app, kind, page: { title: doc.title, content: doc.content, updatedAt: doc.updatedAt } });
  } catch (err) {
    return sendError(res, 500, err.message || 'Could not save');
  }
};
