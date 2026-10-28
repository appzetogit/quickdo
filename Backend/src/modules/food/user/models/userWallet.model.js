/**
 * The customer wallet, shared with taxi (core/wallet/customerWallet.model.js).
 *
 * This file used to declare its own schema on `food_user_wallets`, and taxi kept
 * a separate one in `taxiuserwallets` -- two balances for one person, since food
 * and taxi customers are the same `users` documents. Re-exported under the old
 * name so the fifteen files that import `FoodUserWallet` need no change.
 */
export { CustomerWallet as FoodUserWallet } from '../../../../core/wallet/customerWallet.model.js';
