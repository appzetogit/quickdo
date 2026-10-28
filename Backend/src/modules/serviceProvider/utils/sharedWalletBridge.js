const mongoose = require('mongoose');

/**
 * The Services customer wallet, bridged to the customer's ONE wallet.
 *
 * Services kept a balance on each customer record (sp_users.wallet.balance), so
 * money in Food, Rides and Quick & Medical -- which share one wallet,
 * food_user_wallets -- could not pay for a home service, and a Services refund
 * could not be spent anywhere else.
 *
 * Attached to the Services User model (models/User.js) rather than to each call
 * site, so every path that moves a customer's money is covered: top-up, paying
 * for a booking, cancellation and expiry refunds, and the admin view.
 *
 *   write  An update that $inc's `wallet.balance` on a customer is applied to the
 *          shared wallet instead -- inside the same database transaction when the
 *          caller has one, so an aborted booking payment rolls both back. A
 *          balance guard in the filter ({ 'wallet.balance': { $gte: n } }) is
 *          applied to the shared balance, so the no-overdraft rule still holds;
 *          when it fails, the Services update matches nothing, exactly as before.
 *   read   Every customer document read shows the shared balance.
 *
 * Only for customers with a platform account (platformUserId, else the same
 * phone -- core/identity/platformUser.js). Anyone else keeps the balance on
 * their Services record, unchanged. `wallet.penalty` (the unpaid cancellation fee
 * bucket) stays on the Services record: it is not money the customer holds.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const ownerCache = new Map();

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

let modsPromise = null;
const mods = () => {
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('../../../core/wallet/customerWallet.model.js'),
      import('../../../core/identity/platformUser.js'),
    ]).then(([w, p]) => ({ CustomerWallet: w.CustomerWallet, platformUserIdFor: p.platformUserIdFor }));
  }
  return modsPromise;
};

/** The platform account whose wallet this Services customer uses, or null. */
async function sharedOwner(spUserId, platformUserIdHint) {
  if (isId(platformUserIdHint)) return new mongoose.Types.ObjectId(String(platformUserIdHint));
  if (!isId(spUserId)) return null;
  const key = String(spUserId);
  const hit = ownerCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.owner;
  const { platformUserIdFor } = await mods();
  const resolved = await platformUserIdFor(key).catch(() => null);
  // Only a Services id that resolves to a DIFFERENT, platform account is bridged.
  const owner = resolved?.platformId && resolved.vertical === 'serviceProvider'
    ? new mongoose.Types.ObjectId(resolved.platformId)
    : null;
  if (ownerCache.size > 5000) ownerCache.clear();
  ownerCache.set(key, { owner, at: Date.now() });
  return owner;
}

async function sharedBalance(owner, session) {
  const { CustomerWallet } = await mods();
  const w = await CustomerWallet.findOne({ userId: owner }).select('balance').session(session || null).lean();
  return Number(w?.balance) || 0;
}

/** pre findOneAndUpdate / updateOne on the Services User model. */
async function divertWalletWrite() {
  const update = this.getUpdate() || {};
  const inc = update.$inc && update.$inc['wallet.balance'];
  if (inc === undefined) return;
  const filter = this.getFilter() || {};
  if (!isId(filter._id)) return;
  const owner = await sharedOwner(filter._id);
  if (!owner) return;

  const { CustomerWallet } = await mods();
  const session = this.getOptions().session || null;
  const amount = Number(inc) || 0;
  const guard = filter['wallet.balance'];
  const minBalance = guard && typeof guard === 'object' && guard.$gte !== undefined ? Number(guard.$gte) : null;

  // The wallet must exist before a guarded update can match it.
  await CustomerWallet.updateOne(
    { userId: owner },
    { $setOnInsert: { userId: owner, balance: 0, transactions: [] } },
    { upsert: true, session },
  );
  const moved = await CustomerWallet.findOneAndUpdate(
    { userId: owner, ...(minBalance !== null ? { balance: { $gte: minBalance } } : {}) },
    {
      $inc: { balance: amount },
      $push: {
        transactions: {
          $each: [{
            type: amount >= 0 ? 'addition' : 'deduction',
            kind: amount >= 0 ? 'credit' : 'debit',
            amount: Math.abs(amount),
            status: 'Completed',
            description: amount >= 0 ? 'Services refund or top-up' : 'Services booking',
            metadata: { vertical: 'serviceProvider', spUserId: String(filter._id) },
          }],
          $position: 0,
        },
      },
    },
    { new: true, session },
  );

  // Take the money move out of the Services update either way.
  const { 'wallet.balance': _removed, ...restInc } = update.$inc;
  const nextUpdate = { ...update };
  if (Object.keys(restInc).length) nextUpdate.$inc = restInc;
  else delete nextUpdate.$inc;

  if (!moved) {
    // Guard failed on the shared balance: make the Services update match nothing,
    // which is what callers already treat as "insufficient balance".
    this.setQuery({ _id: new mongoose.Types.ObjectId() });
    this.setUpdate(Object.keys(nextUpdate).length ? nextUpdate : { $set: {} });
    return;
  }

  // Drop the guard from the Services filter: it described the shared balance.
  const { 'wallet.balance': _guard, ...restFilter } = filter;
  this.setQuery(restFilter);
  this.setUpdate(Object.keys(nextUpdate).length ? nextUpdate : { $set: { updatedAt: new Date() } });
  this._sharedWalletBalance = Number(moved.balance) || 0;
}

/** post find* on the Services User model: show the shared balance. */
async function overlaySharedBalance(result) {
  if (!result) return;
  const docs = Array.isArray(result) ? result : [result];
  const session = this.getOptions ? this.getOptions().session || null : null;
  for (const doc of docs) {
    if (!doc || !doc.wallet) continue;
    const owner = await sharedOwner(doc._id, doc.platformUserId);
    if (!owner) continue;
    const balance = this._sharedWalletBalance !== undefined && docs.length === 1
      ? this._sharedWalletBalance
      : await sharedBalance(owner, session);
    if (typeof doc.set === 'function') {
      doc.set('wallet.balance', balance);
      // A display value: a later save() must not copy it onto the Services record.
      doc.unmarkModified('wallet.balance');
    } else {
      doc.wallet.balance = balance;
    }
  }
}

function attachSharedWallet(schema) {
  for (const op of ['findOneAndUpdate', 'updateOne']) schema.pre(op, divertWalletWrite);
  for (const op of ['find', 'findOne', 'findOneAndUpdate']) schema.post(op, overlaySharedBalance);
}

module.exports = { attachSharedWallet, __testables: { sharedOwner, clearCache: () => ownerCache.clear() } };
