/**
 * The "Video Demo" section of the website home page (quickdropsindia.com):
 * which video plays and what its three tabs say.
 *
 * Stored on the landing-page settings record the home page already loads
 * (LandingPageSetting.demo_video), so the page needs no extra request. Nothing
 * set = the video built into the site (/food/delivery1.mp4) and the original
 * tab text, exactly as before.
 *
 * Kept apart from the record's old `video_url`: that still holds a placeholder
 * YouTube link written by the defaults, and wiring the section to it would
 * have put a random video on the home page.
 */
import { ValidationError } from '../../../../core/auth/errors.js';
import { saveMediaBuffer } from '../../../../services/storage.service.js';
import { LandingPageSetting } from '../../../taxi/admin/models/LandingPageSetting.js';

const MAX_TABS = 3;
const text = (v, max) => String(v ?? '').trim().slice(0, max);

const normalizeTabs = (raw) => {
    let tabs = raw;
    if (typeof raw === 'string') {
        try { tabs = JSON.parse(raw); } catch { throw new ValidationError('Tabs could not be read'); }
    }
    if (tabs == null) return undefined;
    if (!Array.isArray(tabs)) throw new ValidationError('Tabs must be a list');
    return tabs.slice(0, MAX_TABS).map((t, i) => {
        const label = text(t?.label, 40);
        if (!label) throw new ValidationError(`Tab ${i + 1} needs a title`);
        const start = Number(t?.start_percent);
        return {
            label,
            description: text(t?.description, 160),
            // Where in the video this tab jumps to, as a share of its length.
            start_percent: Number.isFinite(start) ? Math.min(100, Math.max(0, Math.round(start))) : Math.round((i / MAX_TABS) * 100),
        };
    });
};

const isHttpsUrl = (v) => /^https:\/\/[^\s]+$/i.test(v);

const viewOf = (doc) => {
    const v = doc?.demo_video || {};
    return {
        url: v.url || '',
        source: v.source || '',
        tabs: Array.isArray(v.tabs) ? v.tabs : [],
        updatedAt: v.updated_at || null,
        usingBuiltIn: !v.url,
    };
};

export async function getHomepageVideo() {
    return viewOf(await LandingPageSetting.findOne({ scope: 'default' }).select('demo_video').lean());
}

/**
 * file: an uploaded video (mp4/webm/mov), stored under /uploads/landing.
 * body.url: a link instead (an https video file or a YouTube link).
 * body.reset: back to the built-in video and tab text.
 */
export async function saveHomepageVideo(body = {}, file = null) {
    if (body.reset === true || body.reset === 'true') {
        await LandingPageSetting.updateOne({ scope: 'default' }, { $unset: { demo_video: 1 } }, { upsert: true });
        return getHomepageVideo();
    }

    const current = (await LandingPageSetting.findOne({ scope: 'default' }).select('demo_video').lean())?.demo_video || {};
    const next = { url: current.url || '', source: current.source || '', tabs: current.tabs || [] };

    if (file?.buffer?.length) {
        const stored = await saveMediaBuffer(file.buffer, 'landing', { mimeType: file.mimetype });
        if (stored.resourceType !== 'video') throw new ValidationError('Upload a video file (MP4, WebM or MOV).');
        next.url = stored.url;
        next.source = 'upload';
    } else if (body.url !== undefined) {
        const url = text(body.url, 500);
        if (url && !isHttpsUrl(url)) throw new ValidationError('The video link must start with https://');
        // The section is a video player with its own controls and tab jumps; a
        // YouTube page cannot play in it.
        if (/youtube\.com|youtu\.be/i.test(url)) {
            throw new ValidationError('YouTube links cannot play in this section. Upload the video, or use a direct link to a video file (.mp4).');
        }
        next.url = url;
        next.source = url ? 'link' : '';
    }

    const tabs = normalizeTabs(body.tabs);
    if (tabs !== undefined) next.tabs = tabs;

    next.updated_at = new Date();
    await LandingPageSetting.updateOne({ scope: 'default' }, { $set: { demo_video: next } }, { upsert: true });
    return getHomepageVideo();
}
