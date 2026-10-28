/**
 * True inside the seller (restaurant / store) app, which is this same site in a
 * Flutter WebView. The app signs sellers in with phone + OTP; a normal browser
 * uses owner email + password, then an OTP to the phone on file.
 *
 * The bridge can also appear just after first paint, so screens that branch on
 * this should listen for "flutterInAppWebViewPlatformReady" too.
 */
export const isSellerApp = () =>
  typeof window !== "undefined" &&
  Boolean(window.flutter_inappwebview) &&
  typeof window.flutter_inappwebview.callHandler === "function"

export const SELLER_APP_READY_EVENT = "flutterInAppWebViewPlatformReady"

/** Shown when a registered seller tries the phone path on the web. */
export const WEB_USE_PASSWORD_MESSAGE =
  "This number is already registered. On the website, sign in with your email and password."
