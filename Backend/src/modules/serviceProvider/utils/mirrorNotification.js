/**
 * Copies a service-provider notification into the shared platform inbox.
 *
 * SPNotification stays the source of truth for this module: it carries four distinct
 * recipient columns (userId/vendorId/workerId/adminId), and its controller drives
 * sockets, FCM push and SPNotificationLog off the document it creates. Rewriting that
 * to the shared shape is a cutover, not a unification, so this mirrors instead --
 * the same call the payments unification makes from confirmGatewayPayment.
 *
 * The mirror is what lets one customer's notifications be read across verticals from
 * a single collection. It must never be able to break the notification that already
 * succeeded, so every failure here is logged and swallowed.
 */

// SP addresses four kinds of recipient in four separate fields; the shared inbox is
// polymorphic. First non-empty wins -- SP only ever populates one.
const RECIPIENTS = [
  ['userId', 'USER'],
  ['vendorId', 'VENDOR'],
  ['workerId', 'WORKER'],
  ['adminId', 'ADMIN'],
];

const mirrorNotification = async (doc) => {
  try {
    if (!doc) return;

    const hit = RECIPIENTS.find(([field]) => doc[field]);
    if (!hit) {
      console.warn(`[Notifications] SP notification ${doc._id} has no recipient; not mirrored`);
      return;
    }
    const [field, ownerType] = hit;

    // Customers go through the shared recorder, which files them under their
    // platform account -- the id the app's inbox reads. Filed under the
    // Services user id, as before, they were stored and never shown.
    if (ownerType === 'USER') {
      const { recordCustomerNotification } = await import('../../../core/notifications/customerInbox.js');
      const filed = await recordCustomerNotification({
        vertical: 'serviceProvider',
        userId: doc[field],
        title: doc.title,
        message: doc.message,
        data: { type: doc.type || 'general', spNotificationId: String(doc._id), relatedType: doc.relatedType || null, relatedId: doc.relatedId ? String(doc.relatedId) : null },
        source: 'BOOKING',
      });
      if (filed) return;
      // No platform account to file it under: keep the old copy, as before.
    }

    // CommonJS module reaching the ESM core.
    const { FoodNotification } = await import('../../../core/notifications/models/notification.model.js');

    await FoodNotification.create({
      vertical: 'serviceProvider',
      ownerType,
      ownerId: doc[field],
      title: doc.title,
      message: doc.message,
      // SP's own `type` is a free-form string; the shared `category` is too, so it
      // lands there rather than being forced into the shared `source` enum.
      category: doc.type || 'general',
      source: 'BOOKING',
      isRead: Boolean(doc.isRead),
      readAt: doc.readAt || null,
      metadata: {
        spNotificationId: doc._id,
        relatedType: doc.relatedType || null,
        relatedId: doc.relatedId || null,
        ...(doc.data && typeof doc.data === 'object' ? { data: doc.data } : {}),
      },
    });
  } catch (err) {
    console.warn(`[Notifications] SP mirror failed for ${doc?._id}: ${err.message}`);
  }
};

module.exports = { mirrorNotification };
