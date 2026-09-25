# V128 — Authentication rebuild

## What changed
- Replaced the previous hand-written password sign-in state machine with Clerk's current prebuilt authentication flow.
- Clerk now owns email/password sign-in, Google OAuth, forgot-password recovery, email verification and required post-authentication session tasks.
- Removed the duplicate application-level `password_reset_tokens` database flow and `/api/password-reset/*` endpoints.
- Kept the existing Clerk session token bridge used by ProcureIQ APIs (`procureIQApiFetch` / `procureiqApiFetch`).
- Kept the existing account menu, workspace navigation and signed-in identity UI.
- Refreshed every `auth.js` cache-busting reference to `v=128`.
- Kept Resend configuration because ProcureIQ still uses Resend for public inquiry delivery; it is no longer part of authentication.

## Verification
- `node --check server.js` — passed
- `node --check public/auth.js` — passed
- `npm test` — 49/49 tests passed

## Clerk Dashboard requirements
Enable the authentication methods you want available to users, specifically Email + Password and Google. Clerk's prebuilt SignIn component will expose the enabled methods and handle the corresponding verification/recovery screens.
