/**
 * Customer identity bridge: master `users` -> SP `sp_users`.
 *
 * The super app logs a customer in ONCE, through master's
 * `POST /api/v1/food/auth/user/verify-otp`. That mints
 * `{ userId: <users._id>, role: 'USER' }` signed with `JWT_ACCESS_SECRET` --
 * the same secret SP's tokenService resolves (see tokenService.js). So the
 * token VERIFIES here; it just points at a document in the shared `users`
 * collection, while SP reads `sp_users`. Without a bridge every SP call from
 * the super app 401s with "User not found", and the socket joins
 * `user_<masterId>` while the server emits to `user_<spUserId>` -- so the
 * customer silently never receives booking updates.
 *
 * Plan SERVICE_PROVIDER_INTEGRATION_PLAN.md §4.2 fixes this properly by moving
 * SPUser onto `collection: 'users'` behind a data migration. That is Phase 2
 * and has a schema-shape trap (`addresses[]` differs between the two, and SP's
 * `name` is required where master's is optional), so it is deliberately not
 * done here.
 *
 * This is the same shape as the driver identity bridge that already shipped on
 * k9 (docs/superapp/13-driver-identity-bridge.md): resolve in the middleware,
 * keep ONE login, ONE token, ONE socket. The alternative -- minting a second
 * SP-issued token and having the app hold both -- was considered and rejected
 * there for forcing two sockets and two sessions that expire out of step.
 *
 * Properties:
 *  - Additive. An SP-native token still resolves through the normal
 *    `SPUser.findById` path and never reaches this file.
 *  - Matched on the last 10 digits of the phone, so `+91XXXXXXXXXX`,
 *    `91XXXXXXXXXX` and `XXXXXXXXXX` are one account.
 *  - Auto-provisions on first use, so an existing food/taxi customer can open
 *    the Services tab and book without a second registration.
 */

const SPUser = require('../models/User');

/** Last 10 digits, or null when there aren't 10. Mirrors master's utils/phone.util.js. */
const toTenDigits = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Resolve a master-issued customer token to its SP user, creating the SP user
 * on first contact.
 *
 * @param {string} masterUserId `decoded.userId` from a master-issued token.
 * @returns {Promise<object|null>} A lean SPUser, or null when the id belongs to
 *   neither collection (a genuinely dead token) or the account has no usable
 *   phone to key on.
 */
const resolveSharedCustomer = async (masterUserId) => {
  if (!masterUserId) return null;

  // Master's model is ESM and this module is CommonJS, so the crossing has to
  // be a dynamic import. Cheap after the first call -- Node caches the module.
  let FoodUser;
  try {
    ({ FoodUser } = await import('../../../core/users/user.model.js'));
  } catch (error) {
    console.error('[SP identity bridge] could not load master user model:', error.message);
    return null;
  }

  const shared = await FoodUser.findById(masterUserId)
    .select('name phone email')
    .lean()
    .catch(() => null);
  if (!shared) return null;

  const phone = toTenDigits(shared.phone);
  if (!phone) {
    console.warn(`[SP identity bridge] master user ${masterUserId} has no usable phone; not bridging`);
    return null;
  }

  // Match on the normalised number, but also accept whatever raw form an
  // SP-native signup stored, so we link rather than duplicate.
  const existing = await SPUser.findOne({
    $or: [{ phone }, { phone: `+91${phone}` }, { phone: `91${phone}` }],
  })
    .select('-password')
    .lean();
  if (existing) return existing;

  // First time this customer has touched Services. `name` is required on the
  // SP schema and optional on master's, hence the fallback.
  try {
    const created = await SPUser.create({
      name: (shared.name && shared.name.trim()) || 'Customer',
      phone,
      email: shared.email || undefined,
      isPhoneVerified: true,
    });
    console.log(`[SP identity bridge] provisioned sp_user ${created._id} for master user ${masterUserId}`);
    const { password, ...rest } = created.toObject();
    return rest;
  } catch (error) {
    // A concurrent first request can lose the unique-index race. The other one
    // won and the document now exists, so just read it back.
    if (error && error.code === 11000) {
      return SPUser.findOne({ phone }).select('-password').lean();
    }
    console.error('[SP identity bridge] provisioning failed:', error.message);
    return null;
  }
};

module.exports = { resolveSharedCustomer, toTenDigits };
