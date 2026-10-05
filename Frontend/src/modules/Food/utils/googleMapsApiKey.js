/**
 * Google Maps API Key Utility
 *
 * Resolved at RUNTIME from /api/v1/env/public, which serves the key the admin
 * panel stores (Integration settings -> Map). Build-time VITE_GOOGLE_MAPS_API_KEY
 * remains the fallback, so a deployment with no key configured in the panel
 * behaves exactly as before.
 *
 * Changing the key in the admin panel therefore takes effect on the next page
 * load, with no frontend rebuild.
 */
import { env, loadRuntimeEnv } from "@/config/runtimeEnv";

function sanitizeApiKey(value) {
  if (!value) return "";
  return String(value).trim().replace(/^['"]|['"]$/g, "");
}

/**
 * Get the Google Maps API key, preferring the admin-managed value.
 * @returns {Promise<string>}
 */
export async function getGoogleMapsApiKey() {
  try {
    await loadRuntimeEnv();
  } catch {
    // loadRuntimeEnv never rejects, but never let a maps key take a page down.
  }
  return sanitizeApiKey(env("VITE_GOOGLE_MAPS_API_KEY"));
}

/**
 * Synchronous read, for callers that must pass a key straight into a hook
 * (useJsApiLoader and friends). Returns the runtime value once loadRuntimeEnv has
 * resolved, and the build-time value before that.
 */
export function getGoogleMapsApiKeySync() {
  return sanitizeApiKey(env("VITE_GOOGLE_MAPS_API_KEY"));
}

/** Kept for callers that clear the cache after an admin update. */
export function clearGoogleMapsApiKeyCache() {
  // Runtime config is fetched once per page load and owns its own cache; there is
  // no separate copy here to clear any more.
}
