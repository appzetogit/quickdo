/**
 * Web Google / Apple sign-in, redirect flow.
 *
 * startSocialSignIn() sends the browser to the provider asking for an ID token in
 * the URL fragment (never a query string, so it is not logged by servers or
 * proxies). The provider returns to /food/user/auth/callback, where AuthCallback
 * checks the `state` it left here, then posts the token to the backend, which
 * verifies it (core/auth/socialAuth.service.js).
 *
 * Client ids come from VITE_GOOGLE_CLIENT_ID and VITE_APPLE_SERVICES_ID. They
 * must also be listed in Master settings > Payments & Messages > Google and Apple
 * sign-in (or the server's GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS), or the server
 * refuses the token. The redirect URL must be registered with each provider.
 */

const STORAGE_KEY = "social_signin_pending"

const randomToken = () => {
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export const socialClientIds = () => ({
  google: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
  apple: import.meta.env.VITE_APPLE_SERVICES_ID || "",
})

export const isSocialSignInAvailable = (provider) => Boolean(socialClientIds()[provider])

export const callbackUrl = () => `${window.location.origin}/food/user/auth/callback`

export function startSocialSignIn(provider, { redirectTo = "/food/user" } = {}) {
  const clientId = socialClientIds()[provider]
  if (!clientId) throw new Error(`${provider === "apple" ? "Apple" : "Google"} sign-in is not set up for the website`)
  const state = randomToken()
  const nonce = randomToken()
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, state, nonce, redirectTo, at: Date.now() }))
  } catch {
    throw new Error("Sign-in needs browser storage. Please allow it and try again.")
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(),
    response_type: provider === "apple" ? "code id_token" : "id_token",
    response_mode: "fragment",
    state,
    nonce,
    ...(provider === "google" ? { scope: "openid email profile", prompt: "select_account" } : {}),
  })
  const base = provider === "apple" ? "https://appleid.apple.com/auth/authorize" : "https://accounts.google.com/o/oauth2/v2/auth"
  window.location.assign(`${base}?${params.toString()}`)
}

/** The pending sign-in this browser started, consumed once. Expires after 10 minutes. */
export function takePendingSocialSignIn() {
  let pending = null
  try {
    pending = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null")
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    pending = null
  }
  if (!pending || Date.now() - Number(pending.at || 0) > 10 * 60 * 1000) return null
  return pending
}
