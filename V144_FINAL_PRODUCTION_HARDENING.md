# ProcureIQ V144 — Production Hardening

## Code fixes
- Server-side quota gate added to procurement uploads so an exhausted account cannot bypass the token limit by re-uploading.
- Server-side report-generation access check added; new reports are blocked when the account has no remaining tokens.
- Saved historical report downloads remain available after exhaustion because they use existing immutable report snapshots.
- Report-history creation is quota-gated on the backend.
- Token-limit responses now use a structured `TOKEN_LIMIT_REACHED` code and explicit `tokens_remaining: 0`.
- Razorpay recurring checkout now reports missing currency/plan configuration as a clear server configuration error instead of a generic failure.
- Duplicate verified Razorpay subscription callbacks are handled idempotently.
- Existing Clerk, Razorpay recurring subscription, PostgreSQL, Gemini, procurement, report, and UI architecture was preserved.

## Verification
- Node syntax checks passed for server.js, script.js, auth.js and core-features.js.
- Existing test suite passed: 63/63.
- Added V144 static hardening tests; final suite passed: 66/66.
- Conflict-marker scan performed before packaging.

## External configuration
Real Razorpay checkout still requires valid production/test credentials and matching Razorpay Plan IDs in the deployment environment. The code cannot manufacture those credentials or prove a live payment without access to the configured Razorpay account.
