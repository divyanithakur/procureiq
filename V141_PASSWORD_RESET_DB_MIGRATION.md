# V141 Password Reset Database Migration

## Fix

The existing `password_reset_tokens` table can come from an older ProcureIQ version that does not contain the `email` column. `CREATE TABLE IF NOT EXISTS` does not modify an existing table, so the reset request was failing with:

`column "email" of relation "password_reset_tokens" does not exist`

V141 updates `ensurePasswordResetTable()` to run:

`ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS email TEXT;`

This is safe for existing installations and allows the current reset-token INSERT to work.

## Password length

The application reset-password flow enforces a minimum of 8 characters. The 15-character sign-up message shown by Clerk is controlled by the Clerk Dashboard password policy and must be changed there to 8; repository code cannot override a hosted Clerk policy.

## Resend

For local testing without a verified custom domain, use the existing Resend development sender if supported by the account:

`RESEND_FROM_EMAIL=ProcureIQ <onboarding@resend.dev>`

Do not commit API keys or other secrets.
