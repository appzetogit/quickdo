import mongoose from 'mongoose';
import { FoodNotification } from './models/notification.model.js';

/**
 * One customer inbox across every service.
 *
 * The app reads ONE inbox (GET /food/notifications/inbox: food_notifications,
 * ownerType USER, ownerId = the customer's platform account in `users`). The
 * collection was built for all four services -- it carries `vertical`, and
 * sources like RIDE and BOOKING -- but only Services wrote to it, and under its
 * own user id, so nothing it wrote was ever shown. Food, Quick and Taxi sent
 * their order and ride updates as pushes only: once a push was dismissed, or
 * never arrived because notifications were off, it was gone.
 *
 * Every customer push now also lands here, via recordCustomerNotification,
 * under the customer's PLATFORM id:
 *   food, taxi       already are platform ids (`users`)
 *   quickCommerce    qc_users -> platformUserId, else the same phone in `users`
 *   serviceProvider  sp_users -> platformUserId, else the same phone
 * (worked out from the id itself -- see OWN_USERS)
 * A customer with no platform account is left out rather than filed somewhere
 * the app cannot read.
 *
 * Recording is best-effort and never throws: an inbox write must not stop the
 * push, the order update, or the request that triggered it.
 */

const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

import { platformUserIdFor } from '../identity/platformUser.js';

// Re-exported for scripts/backfill-customer-inbox.mjs, which imports it from here.
export { platformUserIdFor };

const plain = (v) => String(v ?? '').trim();

/** What kind of update this is, for the inbox's `source`. */
function sourceFor(vertical, data = {}) {
  const type = plain(data.type).toLowerCase();
  if (type.includes('payment') || type.includes('refund') || type.includes('wallet')) return 'PAYMENT';
  if (vertical === 'taxi') return 'RIDE';
  if (vertical === 'serviceProvider') return 'BOOKING';
  if (data.orderId || data.orderMongoId || type.includes('order')) return 'ORDER';
  return 'SYSTEM';
}

/**
 * File one customer notification in the shared inbox.
 *
 * @param {object} n
 * @param {'food'|'quickCommerce'|'taxi'|'serviceProvider'} n.vertical  label when the id is a platform id
 * @param {string} n.userId   the service's own customer id (translated here)
 * @param {string} n.title
 * @param {string} n.message
 * @param {object} [n.data]   the push's data payload, kept for deep links
 * @param {string} [n.source] override the inferred inbox source
 * @returns {Promise<object|null>} the stored notification, or null if skipped
 */
export async function recordCustomerNotification({ vertical, userId, title, message, data = {}, source, image = '', link = '' } = {}) {
  try {
    const t = plain(title);
    const m = plain(message);
    if (!t || !m) return null;

    const resolved = await platformUserIdFor(userId);
    if (!resolved) return null;
    const ownerId = resolved.platformId;
    // The id says which service it came from when it is not a platform id.
    const service = resolved.vertical || vertical || 'food';

    // The same update arriving twice -- a broadcast that files its own copy and
    // then pushes, or a retried send -- is filed once.
    const recent = await FoodNotification.exists({
      ownerType: 'USER',
      ownerId: new mongoose.Types.ObjectId(ownerId),
      title: t,
      message: m,
      createdAt: { $gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    });
    if (recent) return null;

    const doc = await FoodNotification.create({
      vertical: service,
      ownerType: 'USER',
      ownerId,
      title: t,
      message: m,
      link: plain(link) || undefined,
      category: plain(data?.type) || 'general',
      source: source || sourceFor(service, data || {}),
      metadata: {
        ...(data && typeof data === 'object' ? { data } : {}),
        ...(image ? { image } : {}),
        ...(String(userId) !== ownerId ? { serviceUserId: String(userId) } : {}),
      },
    });
    return doc.toObject();
  } catch (err) {
    console.warn(`[inbox] could not file a ${vertical} notification for ${userId}: ${err.message}`);
    return null;
  }
}
