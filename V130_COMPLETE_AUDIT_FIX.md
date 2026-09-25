# ProcureIQ V130 — Complete audit and repair

- Preserved the existing product pages, workspace flows, billing, AI usage, reports, data isolation and procurement calculations.
- Rebuilt the sign-in/sign-up presentation as a branded in-app Clerk surface instead of an unstyled Clerk popup.
- Kept Clerk as the authentication/session authority.
- Added a real password-reset email-link flow using a short-lived, single-use server token and Clerk's backend user password update.
- Added reset-link resend protection and account-enumeration-safe responses.
- Added a dedicated reset-password page with password confirmation and show/hide controls.
- Added explicit UTF-8 response headers for static text assets and a defensive mojibake repair layer for visible legacy text such as `â‚¹`.
- Refreshed frontend cache-busting references to V130 so stale auth/UI assets are not reused.
- Preserved the existing contact layout and fixed the Overview workbook help text punctuation.
- Added the reset-token table to account deletion cleanup.

## Email requirement
Password-reset links require Resend configuration:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (or `INQUIRY_FROM_EMAIL`)
- `PUBLIC_APP_URL`

No secret values are included in this package.

## Verification performed
- `node --check server.js` — passed
- `node --check public/auth.js` — passed
- `npm test` — 49/49 tests passed

## Not fully testable in this environment
- Live Clerk sign-in/Google OAuth requires real Clerk credentials and browser interaction.
- Live reset email delivery requires a configured Resend account/domain and real credentials.
- PostgreSQL/Razorpay/Gemini production flows require the user's real environment configuration.
