import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { adminVerticals, VERTICAL_LABELS } from '../admin/adminVerticals.js';
import { coll, aggregateFacts } from '../analytics/facts.js';
import { BroadcastNotification } from './models/notificationBroadcast.model.js';
import { createInboxNotifications } from './notification.service.js';

/**
 * Master > Broadcasts: one message to any role on the platform, by push (with the
 * in-app inbox), SMS and email.
 *
 * Roles: customers of each service, restaurants, stores, food and quick riders,
 * taxi drivers, Services vendors and workers. A segment narrows them:
 *   zoneId            partners whose own zone is that zone; customers who have
 *                     ordered there (Services: a city name)
 *   verticals         every role of those services when no roles are named
 *   activeWithinDays  only people with an order / ride / booking in the last N days
 *
 * Channels never fail the broadcast: push needs Firebase, SMS needs SMS India Hub
 * credentials, email needs SMTP. A channel that is not configured is logged and
 * skipped, and the broadcast records why (stats.<channel>.skipped / reason). Email
 * goes through queues/email.queue.js, so it is queued when BullMQ is on.
 *
 * An admin may address only the services they hold `cms.write` for.
 */

export const ROLES = {
    food_customers: { label: 'Food customers', vertical: 'food', collection: 'users', ownerType: 'USER', base: { isActive: { $ne: false }, role: { $nin: ['ADMIN', 'admin'] } }, activityField: 'userId' },
    quick_customers: { label: 'Quick customers', vertical: 'quickCommerce', collection: 'qc_users', ownerType: 'USER', base: { isActive: { $ne: false } }, activityField: 'userId' },
    taxi_customers: { label: 'Taxi customers', vertical: 'taxi', collection: 'users', ownerType: 'USER', base: { isActive: { $ne: false }, role: { $nin: ['ADMIN', 'admin'] } }, activityField: 'userId' },
    services_customers: { label: 'Services customers', vertical: 'serviceProvider', collection: 'sp_users', ownerType: 'USER', base: {}, activityField: 'userId' },
    restaurants: { label: 'Restaurants', vertical: 'food', collection: 'food_restaurants', ownerType: 'RESTAURANT', base: { status: 'approved' }, zoneField: 'zoneId', activityField: 'partnerId', phoneField: 'ownerPhone', emailField: 'ownerEmail', nameField: 'restaurantName' },
    stores: { label: 'Quick stores', vertical: 'quickCommerce', collection: 'qc_restaurants', ownerType: 'RESTAURANT', base: { status: 'approved' }, zoneField: 'zoneId', activityField: 'partnerId', phoneField: 'ownerPhone', emailField: 'ownerEmail', nameField: 'restaurantName' },
    food_riders: { label: 'Food delivery partners', vertical: 'food', collection: 'food_delivery_partners', ownerType: 'DELIVERY_PARTNER', base: { status: 'approved' }, zoneField: 'zoneIds', activityField: 'driverId' },
    quick_riders: { label: 'Quick delivery partners', vertical: 'quickCommerce', collection: 'qc_delivery_partners', ownerType: 'DELIVERY_PARTNER', base: { status: 'approved' }, zoneField: 'zoneIds', activityField: 'driverId' },
    taxi_drivers: { label: 'Taxi drivers', vertical: 'taxi', collection: 'taxidrivers', ownerType: 'DRIVER', base: { approve: true }, zoneField: 'zoneId', activityField: 'driverId' },
    sp_vendors: { label: 'Services vendors', vertical: 'serviceProvider', collection: 'sp_vendors', ownerType: 'VENDOR', base: { approvalStatus: 'approved' }, zoneField: 'address.city', activityField: 'partnerId', nameField: 'businessName' },
    sp_workers: { label: 'Services workers', vertical: 'serviceProvider', collection: 'sp_workers', ownerType: 'WORKER', base: { approvalStatus: 'approved' }, zoneField: 'address.city', activityField: 'driverId' },
};
export const CHANNELS = ['push', 'sms', 'email'];
const MAX_RECIPIENTS = 50000;
const SYNC_LIMIT = 200;

/* ------------------------------------------------------------ transports */

const defaultTransports = {
    async push(tokens, payload) {
        const { sendPushNotification } = await import('./firebase.service.js');
        return sendPushNotification(tokens, payload);
    },
    async sms(phone, text) {
        const { sendPlainSms } = await import('./smsSender.js');
        return sendPlainSms(phone, text);
    },
    async smsConfigured() {
        const { smsConfigured } = await import('./smsSender.js');
        return smsConfigured();
    },
    async email(mail) {
        const { sendEmail } = await import('../../queues/email.queue.js');
        return sendEmail(mail);
    },
    async emailConfigured() {
        const { isMailConfigured } = await import('../../services/mailTransport.js');
        return isMailConfigured();
    },
};
let transports = defaultTransports;
/** Tests only: replace channel transports. `null` restores the real ones. */
export const __setBroadcastTransportsForTests = (t) => {
    transports = t ? { ...defaultTransports, ...t } : defaultTransports;
};

/* -------------------------------------------------------------- audience */

const asIdValues = (id) => {
    const s = String(id);
    return /^[0-9a-f]{24}$/i.test(s) ? [new mongoose.Types.ObjectId(s), s] : [s];
};

function normaliseSegment(body = {}) {
    const seg = body.segment && typeof body.segment === 'object' ? body.segment : body;
    const roles = (Array.isArray(seg.roles) ? seg.roles : String(seg.roles || '').split(','))
        .map((r) => String(r).trim()).filter((r) => ROLES[r]);
    const verticals = (Array.isArray(seg.verticals) ? seg.verticals : String(seg.verticals || '').split(','))
        .map((v) => String(v).trim()).filter(Boolean);
    const days = parseInt(seg.activeWithinDays, 10);
    return {
        roles: [...new Set(roles)],
        verticals: [...new Set(verticals)],
        zoneId: String(seg.zoneId || '').trim().slice(0, 64) || null,
        activeWithinDays: Number.isFinite(days) && days > 0 ? Math.min(days, 365) : null,
    };
}

/** Roles the segment names, limited to what the admin may address. */
function rolesFor(segment, allowedVerticals) {
    let roles = segment.roles.length
        ? segment.roles
        : Object.keys(ROLES).filter((r) => segment.verticals.includes(ROLES[r].vertical));
    roles = roles.filter((r) => allowedVerticals.includes(ROLES[r].vertical));
    return roles;
}

async function activeIds(role, { zoneId, activeWithinDays, now }) {
    const def = ROLES[role];
    const start = activeWithinDays ? new Date(now.getTime() - activeWithinDays * 864e5) : undefined;
    const rows = await aggregateFacts(def.vertical, { start, zoneId }, [
        { $match: { [def.activityField]: { $ne: null } } },
        { $group: { _id: `$${def.activityField}` } },
    ]);
    return rows.map((r) => r._id);
}

async function resolveRole(role, segment, now) {
    const def = ROLES[role];
    const query = { ...def.base };
    // Partners with their own zone are matched on it; customers by where they ordered.
    const zoneOnDoc = segment.zoneId && def.zoneField;
    if (zoneOnDoc) query[def.zoneField] = { $in: asIdValues(segment.zoneId) };
    const needActivity = segment.activeWithinDays || (segment.zoneId && !def.zoneField);
    if (needActivity) {
        const ids = await activeIds(role, { zoneId: zoneOnDoc ? null : segment.zoneId, activeWithinDays: segment.activeWithinDays, now });
        query._id = { $in: ids };
    }
    const phone = def.phoneField || 'phone';
    const email = def.emailField || 'email';
    const name = def.nameField || 'name';
    const projection = { [phone]: 1, [email]: 1, [name]: 1, name: 1, fcmTokens: 1, fcmTokenMobile: 1, fcmTokenWeb: 1 };
    const docs = await coll(def.collection).find(query, { projection }).limit(MAX_RECIPIENTS).toArray();
    const pick = (doc, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);
    return docs.map((d) => ({
        role,
        vertical: def.vertical,
        ownerType: def.ownerType,
        ownerId: String(d._id),
        label: String(pick(d, name) || d.name || '').trim(),
        phone: String(pick(d, phone) || '').trim(),
        email: String(pick(d, email) || '').trim().toLowerCase(),
        tokens: [d.fcmTokens, d.fcmTokenMobile, d.fcmTokenWeb].flat().filter((t) => typeof t === 'string' && t.trim()),
    }));
}

export async function resolveAudience(admin, body = {}, { now = new Date() } = {}) {
    const allowed = adminVerticals(admin, { resource: 'cms', write: true });
    if (!allowed.length) throw new ApiError(403, 'You do not have access to broadcasts');
    const segment = normaliseSegment(body);
    const roles = rolesFor(segment, allowed);
    if (!roles.length) throw new ApiError(400, 'Choose at least one audience you have access to');
    const lists = await Promise.all(roles.map((r) => resolveRole(r, segment, now)));
    return { segment: { ...segment, roles }, recipients: lists.flat().slice(0, MAX_RECIPIENTS) };
}

export async function previewAudience(admin, body = {}) {
    const { segment, recipients } = await resolveAudience(admin, body);
    const byRole = {};
    for (const r of recipients) {
        const b = (byRole[r.role] ||= { role: r.role, label: ROLES[r.role].label, vertical: r.vertical, recipients: 0, withPush: 0, withPhone: 0, withEmail: 0 });
        b.recipients += 1;
        if (r.tokens.length) b.withPush += 1;
        if (r.phone) b.withPhone += 1;
        if (r.email) b.withEmail += 1;
    }
    return {
        segment,
        total: recipients.length,
        roles: segment.roles.map((role) => byRole[role] || { role, label: ROLES[role].label, vertical: ROLES[role].vertical, recipients: 0, withPush: 0, withPhone: 0, withEmail: 0 }),
        channels: {
            sms: await transports.smsConfigured(),
            email: await transports.emailConfigured(),
        },
    };
}

/* -------------------------------------------------------------- delivery */

async function inBatches(list, size, fn) {
    for (let i = 0; i < list.length; i += size) {
        await Promise.all(list.slice(i, i + size).map(fn));
    }
}

async function deliver(broadcast, recipients, channels) {
    const stats = {
        inbox: 0,
        push: channels.includes('push') ? { sent: 0, failed: 0, noDevice: 0 } : undefined,
        sms: channels.includes('sms') ? { sent: 0, failed: 0, noPhone: 0 } : undefined,
        email: channels.includes('email') ? { sent: 0, queued: 0, failed: 0, noEmail: 0 } : undefined,
    };
    const { title, message, link } = broadcast;

    if (channels.includes('push')) {
        // The in-app inbox is the record every app reads; push only rings the device.
        for (let i = 0; i < recipients.length; i += 1000) {
            await createInboxNotifications({
                notifications: recipients.slice(i, i + 1000).map((r) => ({
                    ownerType: r.ownerType,
                    ownerId: r.ownerId,
                    vertical: r.vertical,
                    title,
                    message,
                    link,
                    category: 'broadcast',
                    broadcastId: broadcast._id,
                    metadata: { broadcastId: String(broadcast._id), role: r.role },
                })),
            });
            stats.inbox += Math.min(1000, recipients.length - i);
        }
        let configured = true;
        await inBatches(recipients, 20, async (r) => {
            if (!configured) return;
            if (!r.tokens.length) { stats.push.noDevice += 1; return; }
            try {
                const res = await transports.push(r.tokens, { title, body: message, data: { type: 'admin_broadcast', broadcastId: String(broadcast._id), link: link || '' } });
                if (res?.successCount > 0) stats.push.sent += 1; else stats.push.failed += 1;
            } catch (err) {
                // Firebase not set up: no point trying the next 10,000.
                if (/firebase|credential|project|service account/i.test(String(err?.message))) {
                    configured = false;
                    stats.push.skipped = true;
                    stats.push.reason = 'Push is not configured';
                    logger.warn(`[Broadcast ${broadcast._id}] push skipped: ${err.message}`);
                } else {
                    stats.push.failed += 1;
                }
            }
        });
    }

    if (channels.includes('sms')) {
        if (!(await transports.smsConfigured())) {
            stats.sms.skipped = true;
            stats.sms.reason = 'SMS is not configured';
            logger.warn(`[Broadcast ${broadcast._id}] SMS skipped: SMS India Hub is not configured`);
        } else {
            const text = `${title}: ${message}`.slice(0, 900);
            const seen = new Set();
            await inBatches(recipients, 10, async (r) => {
                const key = r.phone.replace(/\D/g, '').slice(-10);
                if (!key) { stats.sms.noPhone += 1; return; }
                if (seen.has(key)) return;
                seen.add(key);
                const res = await transports.sms(r.phone, text).catch((e) => ({ sent: false, error: e.message }));
                if (res?.sent) stats.sms.sent += 1; else stats.sms.failed += 1;
            });
        }
    }

    if (channels.includes('email')) {
        if (!(await transports.emailConfigured())) {
            stats.email.skipped = true;
            stats.email.reason = 'Email is not configured';
            logger.warn(`[Broadcast ${broadcast._id}] email skipped: SMTP is not configured`);
        } else {
            const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            const html = `<h2>${esc(title)}</h2><p>${esc(message).replace(/\n/g, '<br>')}</p>${link ? `<p><a href="${esc(link)}">${esc(link)}</a></p>` : ''}`;
            const seen = new Set();
            await inBatches(recipients, 10, async (r) => {
                if (!r.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) { stats.email.noEmail += 1; return; }
                if (seen.has(r.email)) return;
                seen.add(r.email);
                const res = await transports.email({ to: r.email, subject: title, text: `${message}${link ? `\n\n${link}` : ''}`, html, kind: 'broadcast' })
                    .catch((e) => ({ sent: false, error: e.message }));
                if (res?.queued) stats.email.queued += 1;
                else if (res?.sent) stats.email.sent += 1;
                else stats.email.failed += 1;
            });
        }
    }
    return stats;
}

/**
 * @param {object} admin
 * @param {{title, message, link?, channels?, segment|roles...}} body
 * @param {{wait?: boolean}} opts  wait for delivery even for a large audience (tests)
 */
export async function createPlatformBroadcast(admin, body = {}, { wait = false } = {}) {
    const title = String(body.title || '').trim().slice(0, 120);
    const message = String(body.message || '').trim().slice(0, 1000);
    const link = String(body.link || '').trim().slice(0, 500);
    if (!title) throw new ApiError(400, 'title is required');
    if (!message) throw new ApiError(400, 'message is required');
    const channels = [...new Set((Array.isArray(body.channels) ? body.channels : ['push']).map(String))].filter((c) => CHANNELS.includes(c));
    if (!channels.length) throw new ApiError(400, 'Choose at least one channel: push, sms or email');

    const { segment, recipients } = await resolveAudience(admin, body);
    if (!recipients.length) throw new ApiError(400, 'Nobody matches this audience');

    const roleTypes = [...new Set(segment.roles)];
    const broadcast = await BroadcastNotification.create({
        title,
        message,
        link,
        targetType: roleTypes.length === 1 && { taxi_drivers: 'TAXI_DRIVER', sp_workers: 'SP_WORKER', sp_vendors: 'SP_VENDOR' }[roleTypes[0]]
            ? { taxi_drivers: 'TAXI_DRIVER', sp_workers: 'SP_WORKER', sp_vendors: 'SP_VENDOR' }[roleTypes[0]]
            : 'SEGMENT',
        // A preview of who it went to; the full list would not fit a document.
        targets: recipients.slice(0, 50).map((r) => ({ ownerType: r.ownerType, ownerId: new mongoose.Types.ObjectId(r.ownerId), label: r.label, vertical: r.vertical })),
        createdBy: admin._id,
        targetCount: recipients.length,
        scope: 'platform',
        channels,
        segment,
        status: 'sending',
    });

    const run = async () => {
        try {
            const stats = await deliver(broadcast, recipients, channels);
            await BroadcastNotification.updateOne({ _id: broadcast._id }, { $set: { status: 'sent', stats } });
            return stats;
        } catch (err) {
            logger.error(`[Broadcast ${broadcast._id}] failed: ${err.message}`);
            await BroadcastNotification.updateOne({ _id: broadcast._id }, { $set: { status: 'failed', stats: { error: err.message } } });
            return { error: err.message };
        }
    };

    if (wait || recipients.length <= SYNC_LIMIT) {
        const stats = await run();
        return { id: String(broadcast._id), status: stats.error ? 'failed' : 'sent', targetCount: recipients.length, stats };
    }
    run();
    return { id: String(broadcast._id), status: 'sending', targetCount: recipients.length };
}

export async function listPlatformBroadcasts(admin, { page = 1, limit = 20 } = {}) {
    if (!adminVerticals(admin, { resource: 'cms' }).length) throw new ApiError(403, 'You do not have access to broadcasts');
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const [items, total] = await Promise.all([
        BroadcastNotification.find({ scope: 'platform' }).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l)
            .select('-targets').lean(),
        BroadcastNotification.countDocuments({ scope: 'platform' }),
    ]);
    return {
        items: items.map((b) => ({
            ...b,
            audience: (b.segment?.roles || []).map((r) => ROLES[r]?.label || r).join(', '),
        })),
        total,
        page: p,
        limit: l,
    };
}

export const roleCatalogue = (admin) => {
    const allowed = adminVerticals(admin, { resource: 'cms', write: true });
    return Object.entries(ROLES)
        .filter(([, d]) => allowed.includes(d.vertical))
        .map(([key, d]) => ({ key, label: d.label, vertical: d.vertical, verticalLabel: VERTICAL_LABELS[d.vertical], zoned: Boolean(d.zoneField) }));
};
