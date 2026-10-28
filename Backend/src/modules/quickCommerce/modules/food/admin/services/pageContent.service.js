import { FoodPageContent } from '../models/pageContent.model.js';
import { managedLegalPage, syncManagedLegalFromLegacy } from '../../../../../../core/settings/platformProfile.service.js';
import { appLegalPage } from '../../../../../../core/settings/appLegal.js';

// Module -> the per-app page (Master settings) it reads first.
const APP_OF_MODULE = { USER: 'qc_user', ALL: 'qc_user', RESTAURANT: 'qc_seller', DELIVERY: 'qc_rider', MEDICAL: 'medical_user' };
import { ValidationError } from '../../../../core/auth/errors.js';

const normalizeKey = (key) => String(key || '').trim().toLowerCase();

const decodeHtmlEntities = (value) => {
    if (value === null || value === undefined) return value;
    let s = String(value);
    if (!s.includes('&')) return s;
    return s
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
};

const normalizeLegalForResponse = (legal) => {
    if (!legal || typeof legal !== 'object') return legal;
    const title = legal.title ?? '';
    const content = decodeHtmlEntities(legal.content ?? '');
    const email = legal.email ?? '';
    const mobile = legal.mobile ?? '';
    return { ...legal, title, content, email, mobile };
};

const normalizeAboutForResponse = (about) => {
    if (!about || typeof about !== 'object') return about;
    return {
        ...about,
        appName: decodeHtmlEntities(about.appName ?? ''),
        version: decodeHtmlEntities(about.version ?? ''),
        description: decodeHtmlEntities(about.description ?? ''),
        logo: decodeHtmlEntities(about.logo ?? '')
    };
};

export const getPublicPageByKey = async (key, module = 'ALL') => {
    const k = normalizeKey(key);
    const m = String(module || 'ALL').toUpperCase();
    if ((k === 'terms' || k === 'privacy') && APP_OF_MODULE[m]) {
        const own = await appLegalPage(APP_OF_MODULE[m], k);
        if (own) return { key: k, module: m, data: normalizeLegalForResponse(own) };
    }
    
    // Try to find the module-specific document first
    let doc = await FoodPageContent.findOne({ key: k, module: m }).lean();
    
    // Fallback to 'ALL' if specific module is not found and we're not already looking for 'ALL'
    if (!doc && m !== 'ALL') {
        doc = await FoodPageContent.findOne({ key: k, module: 'ALL' }).lean();
    }
    
    // The platform's own page, when Master settings has one -- unless this
    // module (e.g. MEDICAL) wrote a page of its own, which stays.
    const managed = await managedLegalPage(k);
    if (managed && !(doc && m !== 'ALL' && doc.module === m)) {
        return { key: k, module: m, data: normalizeLegalForResponse({ title: doc?.legal?.title || '', content: managed }) };
    }
    if (!doc) return { key: k, module: m, data: null };
    if (k === 'about') return { key: k, module: m, data: normalizeAboutForResponse(doc.about || null) };
    return { key: k, module: m, data: normalizeLegalForResponse(doc.legal || null) };
};

export const getAdminPageByKey = async (key, module = 'ALL') => getPublicPageByKey(key, module);

export const upsertLegalPage = async (key, payload, updatedBy, module = 'ALL') => {
    const k = normalizeKey(key);
    const m = String(module || 'ALL').toUpperCase();
    if (!['terms', 'privacy', 'refund', 'shipping', 'cancellation', 'support'].includes(k)) {
        throw new ValidationError('Invalid page key');
    }
    const title = String(payload?.title || '').trim();
    const content = decodeHtmlEntities(String(payload?.content || '')).trim();
    const email = String(payload?.email || '').trim();
    const mobile = String(payload?.mobile || '').trim();

    const doc = await FoodPageContent.findOneAndUpdate(
        { key: k, module: m },
        {
            $set: {
                key: k,
                module: m,
                legal: { title, content, email, mobile },
                about: undefined,
                updatedBy: updatedBy || null,
                updatedByRole: 'ADMIN'
            }
        },
        { upsert: true, new: true }
    ).lean();

    if (m === 'ALL') await syncManagedLegalFromLegacy(k, content);
    return { key: k, module: m, data: normalizeLegalForResponse(doc?.legal || null) };
};

export const upsertAboutPage = async (payload, updatedBy, module = 'ALL') => {
    const m = String(module || 'ALL').toUpperCase();
    const appName = decodeHtmlEntities(String(payload?.appName || '')).trim() || 'Switcheats';
    const version = decodeHtmlEntities(String(payload?.version || '')).trim() || '1.0.0';
    const description = decodeHtmlEntities(String(payload?.description || '')).trim();
    const logo = decodeHtmlEntities(String(payload?.logo || '')).trim();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const stats = Array.isArray(payload?.stats) ? payload.stats : [];

    const normalizedFeatures = features.map((f, idx) => ({
        icon: String(f?.icon || 'Heart'),
        title: String(f?.title || ''),
        description: String(f?.description || ''),
        color: String(f?.color || ''),
        bgColor: String(f?.bgColor || ''),
        order: Number.isFinite(Number(f?.order)) ? Number(f.order) : idx
    }));

    const doc = await FoodPageContent.findOneAndUpdate(
        { key: 'about', module: m },
        {
            $set: {
                key: 'about',
                module: m,
                about: { appName, version, description, logo, features: normalizedFeatures, stats },
                legal: undefined,
                updatedBy: updatedBy || null,
                updatedByRole: 'ADMIN'
            }
        },
        { upsert: true, new: true }
    ).lean();

    return { key: 'about', module: m, data: normalizeAboutForResponse(doc?.about || null) };
};

