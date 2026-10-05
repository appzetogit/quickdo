import mongoose from 'mongoose';

/**
 * The customer's one platform account, for any service's own customer id.
 *
 * Food and Taxi key customers by the platform account (`users`). Quick and
 * Services keep their own customer rows (`qc_users`, `sp_users`), linked by
 * platformUserId or, failing that, the same phone. Shared features -- the
 * inbox (core/notifications/customerInbox.js) and the wallet Quick now shares
 * (modules/quickCommerce/modules/food/user/models/userWallet.model.js) -- file
 * everything under the platform account, so they translate here.
 *
 * The id is looked up rather than trusted to the caller: Quick's code also runs
 * through Food's senders with Quick ids. ObjectIds are unique across
 * collections, so the first collection that has it is the answer.
 */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const lastTen = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

/*
 * Where a service keeps its own customers, and the service each belongs to.
 * The id is looked up rather than trusted to the caller: Quick's code sends
 * through Food's push sender too, with Quick ids, so "which service called"
 * does not say whose id it is. ObjectIds are unique across collections, so the
 * first collection that has it is the answer.
 */
const OWN_USERS = [
  ['users', null],
  ['qc_users', 'quickCommerce'],
  ['sp_users', 'serviceProvider'],
];

/**
 * The customer's platform (`users`) id for any service's customer id, and which
 * service that id came from. null when there is no platform account to file it
 * under.
 */
export async function platformUserIdFor(id) {
  if (!isId(id)) return null;
  const _id = new mongoose.Types.ObjectId(String(id));
  const db = mongoose.connection;
  for (const [collection, vertical] of OWN_USERS) {
    const own = await db.collection(collection).findOne({ _id }, { projection: { platformUserId: 1, phone: 1 } });
    if (!own) continue;
    if (collection === 'users') return { platformId: String(_id), vertical: null };
    if (isId(own.platformUserId)) return { platformId: String(own.platformUserId), vertical };
    const phone = lastTen(own.phone);
    if (phone.length !== 10) return null;
    const main = await db
      .collection('users')
      .findOne({ phone: { $in: [phone, `+91${phone}`, `91${phone}`] } }, { projection: { _id: 1 } });
    return main ? { platformId: String(main._id), vertical } : null;
  }
  return null;
}

