# V123 Authentication / Reset / Contact Fixes

- Password sign-in now maps Clerk identifier/password errors to clear user-facing messages.
- Google sign-in is restored as a dedicated OAuth button using Clerk's `oauth_google` redirect flow and a dedicated `/sso-callback` handler.
- Clerk's native reset-password task route is no longer used by the custom password-reset experience.
- Password reset remains an email-link flow using the application token + Resend integration.
- Reset email delivery rolls back the newly created reset token when email delivery fails, so retrying does not leave a stale active token.
- Added `RESEND_FROM_EMAIL` override and `PUBLIC_APP_URL` configuration examples.
- Added a visible `Resend reset link` action after a reset request succeeds.
- Auth/reset email input typography explicitly uses normal 400 weight; existing product typography is otherwise untouched.
- Homepage contact section keeps its original vertical padding and centered contact copy/link spacing.
