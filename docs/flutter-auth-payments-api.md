# Customer sign-in and refunds: API for the Flutter apps (SOW plan §2.3–2.5)

This document lists the customer endpoints that are new or have changed for email sign-in, password recovery, Google and Apple sign-in, and refunds.

- **Base URL:** `https://<host>/api/v1/auth`. The same routes also answer under `/api/v1/food/auth`.
- **Auth:** endpoints marked *signed in* need `Authorization: Bearer <accessToken>` from a customer (`role: USER`) session.
- **Response envelope:** `{ success, message, data }`. Errors return `success: false` with an HTTP 4xx or 5xx status and a `message` you can show to the user. Some errors also carry a machine-readable `code`; see [Error codes](#error-codes).
- **Phone OTP sign-in is unchanged.** `POST /user/request-otp` and `POST /user/verify-otp` work exactly as before.

Every way of signing in returns the same session as the phone OTP login:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "isNewUser": false,
    "user": {
      "_id": "6702f0c1e4b0a1b2c3d4e5f6",
      "name": "Alice",
      "phone": "9876543210",
      "email": "alice@example.com",
      "loginEmail": "alice@example.com",
      "emailVerified": true,
      "authProviders": [{ "provider": "google", "email": "alice@example.com", "linkedAt": "2026-10-07T10:00:00.000Z" }],
      "needsPhone": false,
      "role": "USER"
    }
  }
}
```

- Use `accessToken` and `refreshToken` exactly as you do after an OTP login. `POST /refresh-token` and `POST /logout` are unchanged.
- `user.needsPhone` is `true` when the account has no phone number. This happens with email and Google/Apple sign-ups. Ask the customer for a phone number before their first order, using [Add a phone](#add-a-phone-number-signed-in).
- `user.hasPassword` appears only on some responses. Use `GET /user/account` when you need to know it.

---

## 1. Email and password

Passwords must be 8 to 128 characters long and contain at least one letter and one number. Email addresses are not case-sensitive.

### POST `/user/email/register`

Creates the account and emails a 6-digit verification code. The account cannot sign in until the email is verified.

```json
{ "email": "alice@example.com", "password": "secret123", "name": "Alice" }
```

`201`:

```json
{
  "success": true,
  "message": "Account created. Enter the code we emailed you.",
  "data": { "email": "alice@example.com", "verificationRequired": true, "codeSent": true }
}
```

| Status | When |
|---|---|
| 400 | Invalid email, weak password, or missing name. |
| 409 | An account with this email already exists and is verified. Offer sign-in or password reset. |
| 429 | Too many codes were requested for this email. Wait and try again. |
| 503 | Email sign-up is not available yet on this server (a database migration is pending). Offer phone sign-in. |

Registering again with an email that was **never verified** is allowed. It replaces the pending password and sends a new code.

### POST `/user/email/verify`

Checks the emailed code, marks the email as verified, and signs the customer in.

```json
{ "email": "alice@example.com", "otp": "482913" }
```

`200`: the session shown at the top, with `message: "Email verified"`.

| Status | When |
|---|---|
| 401 | `Invalid code`, `The code has expired. Request a new one.`, or `Too many attempts. Request a new code.` (each code allows 5 tries). |

### POST `/user/email/resend-otp`

```json
{ "email": "alice@example.com" }
```

`200`. The response is the same whether or not the email has an account.

```json
{ "success": true, "message": "If this email needs verifying, a new code is on its way.", "data": { "email": "alice@example.com", "message": "..." } }
```

### POST `/user/email/login`

```json
{ "email": "alice@example.com", "password": "secret123", "fcmToken": "<optional FCM token>", "platform": "mobile" }
```

`200`: the session.

| Status | `code` | When |
|---|---|---|
| 401 | | `Invalid email or password`. The same message is returned for an unknown email. |
| 403 | `EMAIL_NOT_VERIFIED` | Show the code screen and call `/user/email/resend-otp`. |
| 423 | `ACCOUNT_LOCKED` | 5 wrong passwords in a row lock the account for 15 minutes. The body has `retryAfterSeconds` and the response has a `Retry-After` header. A password reset unlocks it. |
| 429 | | Too many attempts from this device for this email (rate limit). |

```json
{ "success": false, "code": "ACCOUNT_LOCKED", "retryAfterSeconds": 893, "message": "Too many wrong passwords. Try again in 15 minutes, or reset your password." }
```

### POST `/user/password/forgot`

Emails a 6-digit reset code. The response is the same whether or not the email has an account.

```json
{ "email": "alice@example.com" }
```

`200`:

```json
{ "success": true, "message": "If an account uses this email, a reset code is on its way.", "data": { "email": "alice@example.com", "message": "..." } }
```

`429` when too many codes were requested for this email.

### POST `/user/password/reset`

```json
{ "email": "alice@example.com", "otp": "731905", "newPassword": "brandnew99" }
```

`200`:

```json
{ "success": true, "message": "Password updated", "data": { "email": "alice@example.com", "message": "Password updated. Sign in with your new password." } }
```

- The reset signs the customer out on every device (all refresh tokens are revoked). Send them to the sign-in screen.
- The reset also verifies the email and clears any lockout.
- Errors: `400` for a weak password, `401` for a wrong, expired or exhausted code.

---

## 2. Signed-in account changes

### GET `/user/account` *(signed in)*

How the customer can sign in. Use it for the profile or security screen.

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "phone": "9876543210",
    "loginEmail": "alice@example.com",
    "emailVerified": true,
    "hasPassword": true,
    "providers": [{ "provider": "google", "email": "alice@example.com", "linkedAt": "2026-10-07T10:00:00.000Z" }],
    "lockedUntil": null,
    "needsPhone": false
  }
}
```

### POST `/user/email/add` *(signed in)*

A customer who signed up by phone adds email and password sign-in. A code is emailed. Finish with `POST /user/email/verify`, which also returns a fresh session.

```json
{ "email": "pat@example.com", "password": "patpass123" }
```

`200`:

```json
{ "success": true, "message": "Email added. Enter the code we emailed you.", "data": { "email": "pat@example.com", "verificationRequired": true, "user": { "...": "..." } } }
```

`409` when the email belongs to another account, or when this account already signs in with a different verified email.

### POST `/user/password/change` *(signed in)*

```json
{ "currentPassword": "patpass123", "newPassword": "evenbetter1" }
```

`200` `{ "message": "Password changed" }`. `401` when the current password is wrong. `400` when the account has no password yet (use `/user/email/add`).

### Add a phone number *(signed in)*

For accounts created with email or Google/Apple. The SMS code works the same way as the phone login code.

`POST /user/phone/request-otp`

```json
{ "phone": "9876543210" }
```

`200` `{ "data": { "phone": "9876543210", "message": "OTP sent" } }`. `409` when the number already belongs to another account. Tell the customer to sign in with that number instead. Merging two accounts is not supported.

`POST /user/phone/verify`

```json
{ "phone": "9876543210", "otp": "1234" }
```

`200` `{ "data": { "user": { "phone": "9876543210", "needsPhone": false, "...": "..." } } }`.

---

## 3. Google and Apple sign-in

The app runs the provider's own sign-in and sends the **ID token** to the server. The server checks the token's signature, issuer, expiry and audience, then finds or creates the customer:

1. If an account is already linked to this Google or Apple account, it signs in to that account.
2. If not, and the token carries a **verified** email that an account already signs in with, the provider is linked to that account. `linked: true` is returned.
3. Otherwise a new account is created (`isNewUser: true`). Its sign-in email is the provider's verified email.

If the existing account's email was registered but never verified, the unverified password is discarded when the provider is linked, because the provider has proven who owns the address.

### POST `/user/social/google`

```json
{ "idToken": "<Google ID token>", "fcmToken": "<optional>", "platform": "mobile" }
```

Flutter (`google_sign_in`): set `serverClientId` to the **web** OAuth client id, then send `googleSignInAccount.authentication.idToken`. Every client id that can issue tokens (web, Android, iOS) must be listed in Master settings > Payments & Messages > Google and Apple sign-in, or in `GOOGLE_CLIENT_IDS` on the server.

### POST `/user/social/apple`

```json
{ "idToken": "<Apple identityToken>", "nonce": "<the raw nonce you generated>", "name": "Alice Smith" }
```

Flutter (`sign_in_with_apple`):

- Generate a random `rawNonce`. Pass `sha256(rawNonce)` as `nonce` to `getAppleIDCredential`, and send `rawNonce` here. The server accepts the raw nonce or its SHA-256.
- Apple gives the customer's name **only on the first sign-in**, and never in the token. Send `givenName` and `familyName` joined as `name` on that first call.
- The app's bundle id (and the web Services ID, if the website uses Apple sign-in) must be listed in Master settings or in `APPLE_CLIENT_IDS`.

Response for both: the session, plus `linked` and `provider`:

```json
{ "success": true, "message": "Login successful", "data": { "accessToken": "...", "refreshToken": "...", "isNewUser": true, "linked": false, "provider": "apple", "user": { "...": "..." } } }
```

| Status | When |
|---|---|
| 400 | `idToken` is missing. |
| 401 | `Google sign-in could not be verified` or `Apple sign-in could not be verified`. The token is forged, expired, for another app, or the nonce does not match. |
| 403 | The account is deactivated. |
| 503 | That provider is not configured on the server (no client ids saved). Hide the button. |

### Link or unlink a provider *(signed in)*

`POST /user/social/google/link` or `POST /user/social/apple/link`, with the same body as sign-in.

```json
{ "success": true, "message": "Account linked", "data": { "linked": true, "user": { "...": "..." } } }
```

`409` when that Google or Apple account already signs in to another account, or a different one is already linked.

`DELETE /user/social/google` or `DELETE /user/social/apple`. Returns `400` when it would leave the customer with no way to sign in (no phone, no verified password and no other provider).

---

## Error codes

| `code` | Status | Meaning |
|---|---|---|
| `EMAIL_NOT_VERIFIED` | 403 | Show the code screen. Offer "resend code". |
| `ACCOUNT_LOCKED` | 423 | Too many wrong passwords. `retryAfterSeconds` says how long. Offer "reset password". |
| `TOO_MANY_REQUESTS` | 429 | Too many codes were requested. Try again later. |

---

## 4. Refunds (what the apps see)

Refunds of online (Razorpay) payments now go through one platform refund service for food, quick commerce and services. Taxi takes online payment after the ride and refunds to the wallet only, so it has no card refunds. For the apps:

- **Nothing changes in the request flow.** Cancelling a paid order, an approved quick-commerce return, or an admin refund triggers the refund as before.
- A refund to the original payment method is now tracked until Razorpay confirms it. On a food or quick-commerce order, `payment.refund.status` is:
  - `pending` while the refund is being sent;
  - `processed` once Razorpay has accepted it. The money reaches the customer's bank in 5 to 7 working days for a normal refund;
  - `failed` if Razorpay could not refund it. Support can retry it from the admin panel, and the retry never refunds twice.
  `payment.refund.refundId` is Razorpay's refund id (`rfnd_...`), which you can show the customer as the refund reference.
- Wallet refunds are unchanged: the wallet is credited at once.

Server side, configure the Razorpay webhook (one URL is enough: `https://<host>/api/v1/payments/webhook/razorpay`) with the events `payment.captured`, `refund.processed` and `refund.failed`. Each event is processed once, even when Razorpay delivers it more than once.
