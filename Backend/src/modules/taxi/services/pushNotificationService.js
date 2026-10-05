import { getFirebaseMessaging } from '../../../config/firebase.js';
import { Driver } from '../driver/models/Driver.js';
import { User } from '../user/models/User.js';
import { listEntityPushTokens } from './pushTokenService.js';

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

const chunk = (items, size) => {
  const groups = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
};

const collectAudienceTargets = async ({ sendTo, serviceLocationId }) => {
  const includeUsers = sendTo === 'all' || sendTo === 'users';
  const includeDrivers = sendTo === 'all' || sendTo === 'drivers';
  const targets = [];

  if (includeUsers) {
    const users = await User.find({
      deletedAt: null,
      isActive: { $ne: false },
      active: { $ne: false },
    })
      .select('_id fcmTokens fcmTokenMobile')
      .lean();

    users.forEach((user) => {
      listEntityPushTokens(user, 'user').forEach((tokenEntry) => {
        targets.push({
          ...tokenEntry,
          entityId: String(user._id),
        });
      });
    });
  }

  if (includeDrivers) {
    const driverQuery = {
      deletedAt: null,
      approve: { $ne: false },
      status: { $ne: 'pending' },
    };

    if (serviceLocationId) {
      driverQuery.service_location_id = serviceLocationId;
    }

    const drivers = await Driver.find(driverQuery)
      .select('_id fcmTokenWeb fcmTokenMobile')
      .lean();

    drivers.forEach((driver) => {
      listEntityPushTokens(driver, 'driver').forEach((tokenEntry) => {
        targets.push({
          ...tokenEntry,
          entityId: String(driver._id),
        });
      });
    });
  }

  return targets;
};

const removeInvalidTokens = async (invalidTargets = []) => {
  if (invalidTargets.length === 0) {
    return 0;
  }

  const userIdsByField = { fcmTokens: new Set(), fcmTokenMobile: new Set() };
  const driverIdsByField = { fcmTokenWeb: new Set(), fcmTokenMobile: new Set() };

  invalidTargets.forEach((target) => {
    if (target.role === 'user') {
      userIdsByField[target.field]?.add(target.entityId);
    }

    if (target.role === 'driver') {
      driverIdsByField[target.field]?.add(target.entityId);
    }
  });

  const operations = [];

  Object.entries(userIdsByField).forEach(([field, ids]) => {
    if (ids.size > 0) {
      operations.push(
        User.updateMany(
          { _id: { $in: Array.from(ids) } },
          { $pull: { [field]: { $in: invalidTargets.filter((t) => t.role === 'user' && t.field === field).map((t) => t.token) } } },
        ),
      );
    }
  });

  Object.entries(driverIdsByField).forEach(([field, ids]) => {
    if (ids.size > 0) {
      operations.push(
        Driver.updateMany(
          { _id: { $in: Array.from(ids) } },
          { $set: { [field]: '' } },
        ),
      );
    }
  });

  await Promise.all(operations);
  return invalidTargets.length;
};

const sendPushToTargets = async ({
  targets = [],
  title,
  body,
  image = '',
  data = {},
  dataOnly = false,
}) => {
  const messaging = getFirebaseMessaging();

  if (!messaging) {
    return {
      attempted: false,
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
      targetCount: 0,
      reason: 'Firebase messaging is not configured on the backend',
    };
  }

  const dedupedTargets = Array.from(
    new Map((Array.isArray(targets) ? targets : []).map((target) => [target.token, target])).values(),
  );

  if (dedupedTargets.length === 0) {
    return {
      attempted: true,
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
      targetCount: 0,
      reason: 'No saved FCM tokens were found for the selected entities',
    };
  }

  let deliveredCount = 0;
  let failedCount = 0;
  const invalidTargets = [];
  const safeData = Object.fromEntries(
    Object.entries(data || {}).map(([key, value]) => [key, String(value ?? '')]),
  );

  for (const batch of chunk(dedupedTargets, 500)) {
    /*
     * dataOnly: no notification block, so Android hands the push to the app
     * instead of dropping a silent copy in the tray. A ride/parcel offer needs
     * that: the delivery app rings its full-screen alert only from a data
     * message, which is how food offers already arrive. Title and body travel
     * in the data for the app to show.
     */
    const message = dataOnly
      ? {
        tokens: batch.map((target) => target.token),
        data: { ...safeData, title: String(title || ''), body: String(body || '') },
        android: { priority: 'high', ttl: 60 * 1000 },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { alert: { title: String(title || ''), body: String(body || '') }, sound: 'default' } },
        },
      }
      : {
        tokens: batch.map((target) => target.token),
        notification: {
          title,
          body,
          ...(image ? { imageUrl: image } : {}),
        },
        data: {
          ...safeData,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
          priority: 'high',
          notification: image ? { imageUrl: image } : undefined,
        },
        webpush: {
          notification: {
            title,
            body,
            ...(image ? { image } : {}),
          },
        },
      };
    const response = await messaging.sendEachForMulticast(message);

    response.responses.forEach((item, index) => {
      if (item.success) {
        deliveredCount += 1;
        return;
      }

      failedCount += 1;
      if (INVALID_TOKEN_CODES.has(item.error?.code)) {
        invalidTargets.push(batch[index]);
      }
    });
  }

  const invalidTokenCount = await removeInvalidTokens(invalidTargets);

  return {
    attempted: true,
    deliveredCount,
    failedCount,
    invalidTokenCount,
    targetCount: dedupedTargets.length,
    reason: '',
  };
};

// Deliberately asks listEntityPushTokens rather than eyeballing the fields:
// it reads only fcmTokens and fcmTokenMobile, NOT fcmTokenWeb. Checking
// fcmTokenWeb here made a driver holding nothing but a stale web token look
// covered, so the delivery-partner fallback never ran and the push had zero
// targets — which is exactly how a driver ends up receiving no ride alerts.
const hasAnyPushToken = (doc) => listEntityPushTokens(doc, 'driver').length > 0;

const collectDirectTargets = async ({ userIds = [], driverIds = [] }) => {
  const normalizedUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  const normalizedDriverIds = [...new Set((Array.isArray(driverIds) ? driverIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  const targets = [];

  if (normalizedUserIds.length) {
    const users = await User.find({ _id: { $in: normalizedUserIds } })
      .select('_id fcmTokens fcmTokenMobile')
      .lean();

    users.forEach((user) => {
      listEntityPushTokens(user, 'user').forEach((tokenEntry) => {
        targets.push({
          ...tokenEntry,
          entityId: String(user._id),
        });
      });
    });
  }

  if (normalizedDriverIds.length) {
    const drivers = await Driver.find({ _id: { $in: normalizedDriverIds } })
      .select('_id fcmTokenWeb fcmTokenMobile legacyDeliveryPartnerId')
      .lean();

    // A driver who signed in through the delivery app registered their push
    // token against the FoodDeliveryPartner document, because that is the
    // identity their token carries. Reading only the Driver document finds
    // nothing, so the ride offer goes out over the socket alone and a
    // backgrounded driver never hears about it.
    const tokenless = drivers.filter((d) => !hasAnyPushToken(d));
    const partnerIds = tokenless
      .filter((d) => d.legacyDeliveryPartnerId)
      .map((d) => d.legacyDeliveryPartnerId);
    // Older links point only the other way (partner.driverId), with no
    // legacyDeliveryPartnerId on the driver: those drivers got no push at all.
    const unlinkedDriverIds = tokenless.filter((d) => !d.legacyDeliveryPartnerId).map((d) => d._id);

    let partnerTokens = new Map();
    if (partnerIds.length || unlinkedDriverIds.length) {
      const { FoodDeliveryPartner } = await import('../../food/delivery/models/deliveryPartner.model.js');
      const partners = await FoodDeliveryPartner.find({
        $or: [
          { _id: { $in: partnerIds } },
          ...(unlinkedDriverIds.length ? [{ driverId: { $in: unlinkedDriverIds } }] : []),
        ],
      })
        .select('_id driverId fcmTokenMobile')
        .lean();
      for (const p of partners) {
        if (!p.driverId) continue;
        const d = drivers.find((x) => String(x._id) === String(p.driverId) && !x.legacyDeliveryPartnerId);
        if (d) d.legacyDeliveryPartnerId = p._id;
      }
      // Mobile only. The partner's fcmTokens list holds *web* tokens from the
      // dashboard; a ride offer pushed to a browser tab is noise at best, and
      // those tokens outnumber the real device 5:1 on live accounts.
      partnerTokens = new Map(partners.map((p) => [String(p._id), { fcmTokenMobile: p.fcmTokenMobile }]));
    }

    drivers.forEach((driver) => {
      const source = hasAnyPushToken(driver)
        ? driver
        : partnerTokens.get(String(driver.legacyDeliveryPartnerId)) || driver;

      // entityId stays the DRIVER id wherever the token came from — delivery
      // receipts and stale-token cleanup are keyed on it.
      listEntityPushTokens(source, 'driver').forEach((tokenEntry) => {
        targets.push({
          ...tokenEntry,
          entityId: String(driver._id),
        });
      });
    });
  }

  return targets;
};

/**
 * A Taxi admin campaign, filed in the shared customer inbox.
 *
 * Taxi's own Notifications screen listed campaigns, but the app's one inbox
 * never saw them. Same customers the push targets (active, not deleted), written
 * in one batch; a resent campaign is filed once. Drivers have their own app.
 */
const fileCampaignInCustomerInboxes = async ({ notificationId, sendTo, title, body, image }) => {
  try {
    if (!(sendTo === 'all' || sendTo === 'users')) return;
    const t = String(title || '').trim();
    const m = String(body || '').trim();
    if (!t || !m) return;
    const { FoodNotification } = await import('../../../core/notifications/models/notification.model.js');
    const campaignId = String(notificationId || '');
    if (campaignId && await FoodNotification.exists({ 'metadata.taxiCampaignId': campaignId })) return;
    const users = await User.find({ deletedAt: null, isActive: { $ne: false }, active: { $ne: false } })
      .select('_id')
      .lean();
    if (!users.length) return;
    for (const batch of chunk(users, 1000)) {
      await FoodNotification.insertMany(
        batch.map((u) => ({
          vertical: 'taxi',
          ownerType: 'USER',
          ownerId: u._id,
          title: t,
          message: m,
          category: 'campaign',
          source: 'ADMIN_BROADCAST',
          metadata: { ...(campaignId ? { taxiCampaignId: campaignId } : {}), ...(image ? { image } : {}) },
        })),
        { ordered: false },
      );
    }
  } catch (err) {
    console.warn(`[inbox] taxi campaign ${notificationId} not filed: ${err.message}`);
  }
};

export const sendPushNotificationToAudience = async ({
  notificationId,
  serviceLocationId,
  sendTo,
  title,
  body,
  image,
}) => {
  // Filed in every targeted customer's inbox first -- the one inbox the app reads
  // (core/notifications/customerInbox.js) -- so a campaign reaches customers whose
  // notifications are off, and stays after the push is dismissed. Best-effort.
  await fileCampaignInCustomerInboxes({ notificationId, sendTo, title, body, image });

  const messaging = getFirebaseMessaging();

  if (!messaging) {
    return {
      attempted: false,
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
      targetCount: 0,
      reason: 'Firebase messaging is not configured on the backend',
    };
  }

  const targets = await collectAudienceTargets({ sendTo, serviceLocationId });
  const dedupedTargets = Array.from(
    new Map(targets.map((target) => [target.token, target])).values(),
  );

  if (dedupedTargets.length === 0) {
    return {
      attempted: true,
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
      targetCount: 0,
      reason: 'No saved FCM tokens were found for the selected audience',
    };
  }

  let deliveredCount = 0;
  let failedCount = 0;
  const invalidTargets = [];

  for (const batch of chunk(dedupedTargets, 500)) {
    const response = await messaging.sendEachForMulticast({
      tokens: batch.map((target) => target.token),
      notification: {
        title,
        body,
        ...(image ? { imageUrl: image } : {}),
      },
      data: {
        notificationId: String(notificationId || ''),
        serviceLocationId: String(serviceLocationId || ''),
        sendTo: String(sendTo || 'all'),
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: image ? { imageUrl: image } : undefined,
      },
      webpush: {
        notification: {
          title,
          body,
          ...(image ? { image } : {}),
        },
      },
    });

    response.responses.forEach((item, index) => {
      if (item.success) {
        deliveredCount += 1;
        return;
      }

      failedCount += 1;
      if (INVALID_TOKEN_CODES.has(item.error?.code)) {
        invalidTargets.push(batch[index]);
      }
    });
  }

  const invalidTokenCount = await removeInvalidTokens(invalidTargets);

  return {
    attempted: true,
    deliveredCount,
    failedCount,
    invalidTokenCount,
    targetCount: dedupedTargets.length,
    reason: '',
  };
};

export const sendPushNotificationToEntities = async ({
  userIds = [],
  driverIds = [],
  title,
  body,
  image = '',
  data = {},
  dataOnly = false,
}) => {
  // Ride updates to customers are filed in the one inbox the app reads
  // (core/notifications/customerInbox.js). Drivers have their own app.
  const { recordCustomerNotification } = await import('../../../core/notifications/customerInbox.js');
  for (const userId of [...new Set((userIds || []).map(String))]) {
    await recordCustomerNotification({ vertical: 'taxi', userId, title, message: body, data, image });
  }
  const targets = await collectDirectTargets({ userIds, driverIds });
  return sendPushToTargets({
    targets,
    title,
    body,
    image,
    data,
    dataOnly,
  });
};
