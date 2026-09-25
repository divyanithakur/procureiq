# ProcureIQ V145 — Production Runtime Fixes

This release fixes runtime and document-structure issues found during the V144 production audit without redesigning the existing ProcureIQ UI or replacing the existing authentication, database, token, or Razorpay architecture.

## Fixed

- Corrected malformed workspace HTML documents that were missing `</head>`.
- Added `lang="en"` to workspace/legal documents missing it.
- Synchronized frontend asset cache versions to `v=144` so stale authentication/workspace bundles are not mixed across pages.
- Made Clerk UI CDN loading optional so a Clerk UI bundle failure no longer prevents the custom email/password sign-in surface from initializing.
- Kept Clerk as the authentication/session source of truth.
- Improved non-credential authentication error messaging so network/service failures are not reported as incorrect passwords.
- Added account-backed billing entitlement loading on the Plans & Billing page.
- Current paid/free plan state now survives page refresh in the billing UI.
- Cancellation-at-cycle-end state is reflected after reload.
- Billing UI refreshes after verified subscription activation and cancellation.
- Billing checkout now respects an empty/missing recurring-currency configuration instead of falsely enabling INR checkout.
- Added explicit database readiness state and `/api/health` reporting.
- Database initialization failure is now represented as degraded application health instead of being confused with a healthy database state.
- Usage and entitlement endpoints return a clear database-unavailable response when initialization has not completed.
- Reduced unnecessary AI usage polling frequency from every 2 seconds to every 15 seconds while keeping focus/visibility refresh behavior.
- Updated smoke tests for the new runtime behavior and added regression coverage for HTML structure, billing state, database health, and billing configuration.

## Verification

- Node syntax checks passed for all JavaScript files.
- HTML structural audit passed for all public HTML pages.
- Git conflict-marker scan passed.
- `npm test` passed: **70/70 tests**.

## External configuration still required

The ZIP does not contain production secrets. Local/deployed environments must still provide the existing required credentials/configuration for:

- Clerk
- PostgreSQL
- Razorpay
- Gemini
- Resend
- Razorpay recurring plan IDs

A real browser sign-in and real Razorpay payment still require those external services to be configured and reachable.
