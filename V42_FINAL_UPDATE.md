# ProcureIQ V42 — Audit Fixes + Trust/Accuracy Foundation

This release applies the confirmed V41 audit fixes and the code-level portions of the saved Trust, Security & Startup Readiness roadmap.

## Confirmed audit fixes
- Fixed workspace horizontal overflow/scrollbar at the shell level.
- Added a visible Reports loading state instead of a blank transition.
- Replaced Supplier Risk and Contract Recovery punctuation placeholders with a proper em dash empty state.
- Reduced opportunity-row density on desktop and kept responsive breakpoints intact.
- Changed the redundant Overview "View all" CTA to "Open resolver" while keeping the dedicated "View all opportunities" modal CTA.
- Removed the oversized Help/Feedback minimum-height rules that created excessive whitespace.
- Unified first-party frontend cache-busting to V42.

## Trust/security work executed in code
- Workspace routes now require an authenticated Clerk session before the HTML is served.
- Added a small dependency-free deterministic procurement-metrics module for server-side variance/savings calculations.
- Added Node's built-in test runner with calculation, security/isolation, release-cache, secret-exclusion and UX smoke tests.
- Existing API authorization, parameterized SQL, security headers, payment verification and server-derived AI facts remain intact.

## Still manual / external
- Production domain/DNS, provider account configuration, HTTPS certificate/provider settings.
- Production-grade shared/WAF rate limiting and monitoring provider setup.
- Database backup/restore execution and retention configuration at the hosting provider.
- Legal/compliance approval, formal audits or certifications.
- Real payment gateway end-to-end testing with controlled live/test credentials.
- Business validation, customer pilots and real-world false-positive/false-negative labeling.

## Verification
Run:

```bash
npm install
npm test
npm start
```

The automated suite is intentionally dependency-free beyond Node itself and does not claim a full browser, payment, infrastructure or compliance audit.
