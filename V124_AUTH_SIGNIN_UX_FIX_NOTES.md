# V124 Auth Sign-in UX Fix

- Reset any stale Clerk sign-in attempt before starting a fresh password sign-in.
- Use Clerk's explicit password first-factor flow after creating the sign-in attempt.
- Do not expose Clerk low-level `verification_strategy_invalid` text to users.
- Added password Show/Hide control while preserving the existing Inter typography and font weights.
- Google sign-in uses the Google account chooser (`select_account`) and popup flow where supported, so the user can choose an account and continue instead of being silently redirected.
- Google remains available as an authentication option.
- Password/email errors are presented as user-facing authentication messages rather than raw Clerk errors.
