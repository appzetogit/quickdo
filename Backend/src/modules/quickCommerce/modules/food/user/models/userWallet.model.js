import mongoose from 'mongoose';
import { CustomerWallet } from '../../../../../../core/wallet/customerWallet.model.js';
import { platformUserIdFor } from '../../../../../../core/identity/platformUser.js';

/**
 * Quick & Medical's customer wallet -- now the customer's ONE wallet.
 *
 * It was its own collection (qc_user_wallets), keyed by the Quick customer id,
 * so money added in Food or Rides could not be spent on groceries or medicine,
 * and the reverse. Food and Taxi already share one wallet (food_user_wallets,
 * core/wallet/customerWallet.model.js, keyed by the platform account).
 *
 * This model is that same collection with that same schema -- cloned, so its
 * hooks keeping every transaction row readable by all three services come with
 * it -- plus one addition: every Quick customer id is translated to the
 * customer's platform account on the way in (core/identity/platformUser.js).
 * Doing it here rather than at each call site covers every Quick path that
 * touches the wallet -- the wallet service, checkout, returns, refunds, cashback
 * and the payments ledger -- including ones added later.
 *
 * A Quick customer with no platform account keeps a wallet keyed by their Quick
 * id, in the same collection. qc_user_wallets is no longer read: it held no
 * wallets on either live site when this changed (24 Sep 2026).
 */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

// Quick ids are translated on every wallet read and write, so the answer is
// kept for a few minutes; a link does not change mid-session.
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

async function walletOwner(id) {
  if (!isId(id)) return id;
  const key = String(id);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.owner;
  const resolved = await platformUserIdFor(key).catch(() => null);
  const owner = new mongoose.Types.ObjectId(resolved?.platformId || key);
  if (cache.size > 5000) cache.clear();
  cache.set(key, { owner, at: Date.now() });
  return owner;
}

/** A filter or update value for userId, translated: an id, or { $in: [...] }. */
async function translateUserId(value) {
  if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId) && Array.isArray(value.$in)) {
    return { ...value, $in: await Promise.all(value.$in.map(walletOwner)) };
  }
  return isId(value) ? walletOwner(value) : value;
}

const quickWalletSchema = CustomerWallet.schema.clone();

async function translateQuery() {
  const filter = this.getFilter();
  if (filter && filter.userId !== undefined) {
    this.setQuery({ ...filter, userId: await translateUserId(filter.userId) });
  }
  const update = this.getUpdate?.();
  if (update) {
    for (const op of ['$set', '$setOnInsert']) {
      if (update[op]?.userId !== undefined) update[op].userId = await translateUserId(update[op].userId);
    }
    if (update.userId !== undefined) update.userId = await translateUserId(update.userId);
  }
}

for (const op of ['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany', 'countDocuments', 'deleteOne', 'deleteMany']) {
  quickWalletSchema.pre(op, translateQuery);
}

// Documents created through this model (FoodUserWallet.create / new / save).
quickWalletSchema.pre('validate', async function translateNewWallet() {
  if (this.isNew && this.userId) this.userId = await walletOwner(this.userId);
});

export const FoodUserWallet =
  mongoose.models.QCUserWallet || mongoose.model('QCUserWallet', quickWalletSchema, 'food_user_wallets');

export const __testables = { walletOwner, clearCache: () => cache.clear() };
