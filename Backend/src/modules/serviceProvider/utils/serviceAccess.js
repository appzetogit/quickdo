/**
 * Service-Provider access gate.
 *
 * SPAdmin now reads the SHARED `admins` collection (same one FoodAdmin and
 * TaxiAdmin use). Without a gate, any food- or taxi-scoped admin would pass
 * SP's email+bcrypt login and reach SP admin endpoints. This closes that.
 *
 * Rule:
 *   - servicesAccess present and non-empty -> must include 'serviceProvider'
 *   - servicesAccess absent or empty       -> allow (SP-native admin created
 *     before the merge migration stamps the field; see scripts/sp-merge-admins)
 *
 * Full hierarchy handling -- adminLevel, module scoping, parent/child subsets --
 * is phase 3. This is only the containment boundary.
 */

const SERVICE_KEY = 'serviceProvider';

const hasServiceProviderAccess = (admin) => {
  if (!admin) return false;
  const access = admin.servicesAccess;
  if (!Array.isArray(access) || access.length === 0) return true; // legacy SP-native admin
  return access.includes(SERVICE_KEY);
};

module.exports = { SERVICE_KEY, hasServiceProviderAccess };
