# V125 Auth + Google + Password Reset Fixes

- Password reset email configuration accepts `RESEND_FROM_EMAIL` as the primary sender and falls back to `INQUIRY_FROM_EMAIL`.
- Google sign-in uses Clerk OAuth redirect with `oidcPrompt: select_account` so Google shows account selection before completion.
- Existing password sign-in, Show/Hide password, and user-facing credential errors are preserved.
- Reset link remains a single-use application email link.
