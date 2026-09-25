# ProcureIQ V127 — Authentication & Functionality Fixes

## Authentication
- Real Google OAuth remains enabled through Clerk.
- Email/password sign-in uses Clerk's real password factor.
- Email field is validated as an email address.
- Password visibility toggle is functional.
- Credential errors are converted to user-facing messages.
- First successful email/password sign-in checks the primary email verification state.
- If the email is not verified, ProcureIQ sends a real Clerk email verification code and asks for it once.
- Once the email is verified, Clerk persists that verification at account level; later devices use normal email/password sign-in without another OTP.
- Verification code can be resent with a cooldown.
- Forgot-password remains a real Resend email-link flow with a single-use, expiring token.

## Security / reliability
- Password-reset requests have a dedicated IP rate limit and per-account resend cooldown.
- Password-reset tokens are removed when an account is deleted.
- The distributable ZIP does not contain the real `environment/.env` file.
- `environment/.env.example` contains the required configuration names.
- Existing server-side authentication, plan enforcement, user isolation, upload persistence, report history, AI quota handling, billing verification and webhook handling were preserved.

## Verification performed
- `npm test` — 50/50 tests passing.
- `node --check server.js` — passed.
- `node --check public/auth.js` — passed.

## Required production configuration
1. Copy `environment/.env.example` to `environment/.env`.
2. Fill in the real Clerk, PostgreSQL, Resend, Gemini and Razorpay values.
3. In Clerk, keep email verification enabled for email/password accounts. The frontend now uses Clerk's email-code verification state and does not implement a separate per-device OTP challenge.
4. Configure Google OAuth in Clerk and the matching Google credentials/redirect settings.
5. Set `PUBLIC_APP_URL` to the deployed ProcureIQ URL before sending password-reset emails.
6. Configure the Resend sending domain/from address so reset and verification emails can actually reach users.
