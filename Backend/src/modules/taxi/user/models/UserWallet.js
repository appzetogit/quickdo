/**
 * The customer wallet, shared with food (core/wallet/customerWallet.model.js).
 *
 * This file used to declare its own schema, which mongoose stored in
 * `taxiuserwallets`, while food kept `food_user_wallets` -- two balances for one
 * person. A customer who topped up while booking a ride saw Rs 0 when they went
 * to order food. Re-exported under the old name so taxi's callers need no
 * change; the shared schema carries every field taxi used (`refundWallet`, and
 * `kind`, `title`, `referenceKey` and the provider references on each row).
 */
export { CustomerWallet as UserWallet } from '../../../../core/wallet/customerWallet.model.js';
