# V137 — Authentication Sign-Up UX Update

## Scope
Authentication UX only. No procurement, dashboard, database, payment, AI, legal, or unrelated UI behavior changed.

## Changes
- Added a persistent `Don't have an account? Sign up` action to the existing email/password sign-in surface.
- Sign-up action opens the existing Clerk sign-up flow; no duplicate account system was introduced.
- Existing `Forgot password?` remains a password-reset-link flow.
- Normal email/password login remains password-only; no OTP was introduced.
- For an unknown/invalid identifier, the safe generic credential error remains, with a helpful sign-up hint rather than automatically revealing account existence or forcing a redirect.
- Google OAuth remains separate and continues to request account selection.
- Bumped auth.js cache version to 137.
