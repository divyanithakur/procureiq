# V140 Authentication Fix Notes

## Scope
Only the two requested authentication issues were addressed:

1. Password policy is now consistently 8 characters in ProcureIQ's custom reset-password flow.
2. Password-reset email delivery now preserves the provider's safe error message in local/development mode so a Resend configuration failure is diagnosable instead of being hidden behind a generic message.

## Important external configuration
The sign-up modal is rendered by Clerk. Clerk's supported password minimum is 8 characters. If the Clerk instance is configured for 15 characters, that hosted UI will continue to display 15 until the Clerk Dashboard password policy is changed to 8.

Current Clerk documentation confirms passwords must be at least 8 characters.

For clickable reset emails, the application requires:
- CLERK_SECRET_KEY
- RESEND_API_KEY
- RESEND_FROM_EMAIL (or INQUIRY_FROM_EMAIL)
- PUBLIC_APP_URL
- working PostgreSQL connection

The ZIP intentionally does not contain secrets.

## Email behavior
The reset endpoint:
- finds the Clerk user by email;
- creates a one-time SHA-256 token record in PostgreSQL;
- creates `/reset-password?token=...`;
- sends the link through Resend;
- deletes the token if email delivery fails;
- accepts the reset only once and within 30 minutes.

In development, a Resend provider error is returned to the browser to make configuration failures actionable. Production keeps a generic user-safe error.
