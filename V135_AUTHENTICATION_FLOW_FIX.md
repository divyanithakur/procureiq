# ProcureIQ V135 — Authentication Flow Fix

## What changed
- Replaced the prebuilt Clerk Sign In component on the normal login action with an explicit ProcureIQ email + password flow backed by Clerk.
- Normal email sign-in no longer invokes Clerk email-code/OTP verification.
- Wrong credentials resolve to a safe `Incorrect email or password.` message.
- Added a visible `Forgot password?` action that opens the existing secure reset-link flow.
- Google remains a separate OAuth action and requests `select_account` so the Google account chooser is shown instead of silently reusing the last account.
- Sign-up remains Clerk-managed separately.
- Preserved the existing Clerk UI bundle initialization fix, protected workspace routes, API authentication, database isolation, legal pages, payments, procurement features and existing UI.

## Verification
- `node --check public/auth.js` — passed
- `node --check server.js` — passed
- `npm test` — 57/57 passed
- Final ZIP was re-extracted and verified after packaging.

## Live-provider note
Google OAuth and real password-reset email delivery require the project's live Clerk/Google and Resend configuration. Static tests do not claim those external-provider actions were executed here.
