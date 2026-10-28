import { FoodPageContent } from '../models/pageContent.model.js';
import { managedLegalPage, syncManagedLegalFromLegacy } from '../../../../core/settings/platformProfile.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { appLegalPage } from '../../../../core/settings/appLegal.js';

// The food apps' page keys, and the per-app page (Master settings) each one reads first.
const APP_LEGAL = {
    terms: ['food_user', 'terms'], privacy: ['food_user', 'privacy'],
    terms_restaurant: ['food_restaurant', 'terms'], privacy_restaurant: ['food_restaurant', 'privacy'],
    terms_delivery: ['food_delivery', 'terms'], privacy_delivery: ['food_delivery', 'privacy'],
};

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
    return { ...legal, title, content };
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

export const getPublicPageByKey = async (key) => {
    const k = normalizeKey(key);
    if (APP_LEGAL[k]) {
        const own = await appLegalPage(...APP_LEGAL[k]);
        if (own) return { key: k, data: normalizeLegalForResponse(own) };
    }
    // The platform's own page, when Master settings has one.
    const managed = await managedLegalPage(k);
    if (managed) {
        const doc = await FoodPageContent.findOne({ key: k }).select('legal.title').lean();
        return { key: k, data: normalizeLegalForResponse({ title: doc?.legal?.title || '', content: managed }) };
    }
    const doc = await FoodPageContent.findOne({ key: k }).lean();
    if (!doc) {
        if (k === 'about') return { key: k, data: { appName: 'Quick Drop', version: '1.0.0', description: '', logo: '', features: [], stats: [] } };
        if (k === 'help_support') return { key: k, data: null };
        const titles = {
            terms: 'Terms and Conditions',
            privacy: 'Privacy Policy',
            refund: 'Refund Policy',
            shipping: 'Shipping Policy',
            cancellation: 'Cancellation Policy'
        };
        return { key: k, data: { title: titles[k] || k, content: '' } };
    }
    if (k === 'about') return { key: k, data: normalizeAboutForResponse(doc.about || null) };
    if (k === 'help_support') return { key: k, data: doc.help_support || null };
    return { key: k, data: normalizeLegalForResponse(doc.legal || null) };
};

export const getAdminPageByKey = async (key) => getPublicPageByKey(key);

export const upsertLegalPage = async (key, payload, updatedBy) => {
    const k = normalizeKey(key);
    if (![
        'terms', 'privacy', 'refund', 'shipping', 'cancellation',
        'terms_restaurant', 'privacy_restaurant', 'terms_delivery', 'privacy_delivery'
    ].includes(k)) {
        throw new ValidationError('Invalid page key');
    }
    const title = String(payload?.title || '').trim();
    const content = decodeHtmlEntities(String(payload?.content || '')).trim();

    const doc = await FoodPageContent.findOneAndUpdate(
        { key: k },
        {
            $set: {
                key: k,
                legal: { title, content },
                about: undefined,
                help_support: undefined,
                updatedBy: updatedBy || null,
                updatedByRole: 'ADMIN'
            }
        },
        { upsert: true, new: true }
    ).lean();

    await syncManagedLegalFromLegacy(k, content);
    return { key: k, data: normalizeLegalForResponse(doc?.legal || null) };
};

export const upsertAboutPage = async (payload, updatedBy) => {
    const appName = decodeHtmlEntities(String(payload?.appName || '')).trim() || 'Quick Drop';
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
        { key: 'about' },
        {
            $set: {
                key: 'about',
                about: { appName, version, description, logo, features: normalizedFeatures, stats },
                legal: undefined,
                help_support: undefined,
                updatedBy: updatedBy || null,
                updatedByRole: 'ADMIN'
            }
        },
        { upsert: true, new: true }
    ).lean();

    return { key: 'about', data: normalizeAboutForResponse(doc?.about || null) };
};

export const upsertHelpSupportPage = async (payload, updatedBy) => {
    const title = decodeHtmlEntities(String(payload?.title || '')).trim() || 'Help & Support';
    const description = decodeHtmlEntities(String(payload?.description || '')).trim() || 'We are here to help you.';
    const contactEmail = decodeHtmlEntities(String(payload?.contactEmail || '')).trim();
    const contactPhone = decodeHtmlEntities(String(payload?.contactPhone || '')).trim();
    const categories = Array.isArray(payload?.categories) ? payload.categories : [];

    const normalizedCategories = categories.map((cat) => {
        const catTitle = decodeHtmlEntities(String(cat?.title || '')).trim();
        const catIcon = String(cat?.icon || 'HelpCircle');
        const faqs = Array.isArray(cat?.faqs) ? cat.faqs : [];
        const normalizedFaqs = faqs.map((faq) => ({
            question: decodeHtmlEntities(String(faq?.question || '')).trim(),
            answer: decodeHtmlEntities(String(faq?.answer || '')).trim()
        }));

        return {
            title: catTitle,
            icon: catIcon,
            faqs: normalizedFaqs
        };
    });

    const doc = await FoodPageContent.findOneAndUpdate(
        { key: 'help_support' },
        {
            $set: {
                key: 'help_support',
                help_support: {
                    title,
                    description,
                    contactEmail,
                    contactPhone,
                    categories: normalizedCategories
                },
                legal: undefined,
                about: undefined,
                updatedBy: updatedBy || null,
                updatedByRole: 'ADMIN'
            }
        },
        { upsert: true, new: true }
    ).lean();

    return { key: 'help_support', data: doc?.help_support || null };
};


