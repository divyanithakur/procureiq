# ProcureIQ V129 — Auth Runtime Fix

This build contains the actual runtime changes for the Clerk initialization issue found in local browser testing.

Changes:
- ClerkJS receives the publishable key using an explicit `data-clerk-publishable-key` attribute.
- Clerk UI and ClerkJS dynamic loading are sequenced synchronously.
- Frontend script cache versions were bumped to v129.
- The animation file cache version was also bumped so an older cached V120 copy cannot be reused.
- No `.env` file or secrets are included.

Copy the existing local environment/.env into the extracted environment folder before starting the app.
