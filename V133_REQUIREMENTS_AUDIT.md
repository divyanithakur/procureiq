# ProcureIQ V134 — Requirements Audit

## Baseline
- Source inspected: ProcureIQ V132 AUTH/LOADING build, then V135 local runtime correction.
- Acceptance baseline: `ProcureIQ-Complete-Website-Requirements-Specification.pdf` (26 pages).
- Scope: authentication, every workspace page, upload/control validation, reports/PDF behavior, billing/security controls, responsive/motion requirements, and release-gate checks.

## Critical authentication fix
The screenshot error was traced to the browser Clerk integration in `public/auth.js`.

V132 loaded Clerk through the documented browser `<script>` integration, then incorrectly required `window.Clerk` to be a constructor and called `new window.Clerk(...)`. In the browser-script integration, `window.Clerk` is the initialized Clerk instance. V134 now supports the browser instance shape and only uses constructor instantiation for a constructor-shaped global. It then calls `clerk.load()` and mounts Clerk's real SignIn/SignUp components.

The authentication layer still uses Clerk as the session source of truth. It does not introduce localStorage/fake sessions.

## Authentication requirements covered in code
- Email/password Sign In through Clerk components.
- Required email/password validation through the real Clerk authentication UI.
- Google OAuth through Clerk's standard OAuth component flow.
- Clerk-managed verification/session tasks; no custom bypass of provider security challenges.
- Forgot-password page with validated email, provider-backed user lookup, secure random single-use token, 30-minute expiry, Resend delivery, cooldown/rate limit and generic account-existence response.
- Reset-password page with password confirmation, expiry/single-use token enforcement and sign-out of other Clerk sessions after reset.
- SSO callback page and safe internal workspace redirect.
- Server-side protection for every workspace route.
- Authenticated API identity and user-scoped database access.
- Real Clerk sign-out and session persistence.

## Functional hardening completed
- Upload size limit: 20 MB client-side and 10,000 transaction rows server-side.
- Upload MIME/extension validation.
- Transaction object shape validation and string/numeric bounds.
- Control-pack row-count and object-shape safeguards.
- Reset confirmation text now explicitly covers procurement, control-pack, report and opportunity data.
- Existing rate limiting, signed Razorpay webhook verification, payment verification, admin allowlist, user-scoped queries and safe production errors preserved.

## Motion / visual updates
- Repaired `procureiq-animations.js`: V132 contained CSS content under the `.js` filename, so the motion controller could not execute as JavaScript. V134 restores an executable motion controller.
- Added restrained signal-sweep motion for the hero/product visual.
- Preserved IntersectionObserver reveals, consistent dashboard hover depth, stepper focus, AI processing trace, heading reveal/glow, page transitions and magnetic cursor behavior.
- Removed the fake `LIVE WORKFLOW`/illustrative status-label injection.
- Preserved reduced-motion handling.
- Token donut now follows the master PDF direction: blue = actual used tokens; pale = remaining capacity.
- Product demo remains the actual ProcureIQ recording.

## Automated verification
- Node syntax checks passed for `server.js`, `public/auth.js`, `public/script.js`, `public/procureiq-animations.js` and tests.
- **55/55 automated smoke/regression tests passed.**
- No `.env`, private key files, merge conflict markers, demo/seed API endpoints or fake product labels are present in the release tree.
- `package.json` and `package-lock.json` root dependency declarations match exactly.

## Live-integration verification boundary
The supplied ZIP contains `environment/.env.example`, not the user's live Clerk/Resend/PostgreSQL/Razorpay/Gemini credentials. Therefore this audit does **not** falsely claim that a real email, Google account, database, Razorpay payment or Gemini request was executed in this isolated build environment.

Those external-provider flows are implemented and statically verified, but their live execution still requires the user's configured environment. This distinction is intentional and is part of the release-gate requirement against unsupported claims.

## Official Clerk implementation reference
Clerk's current JavaScript documentation describes the browser `<script>` integration as exposing `window.Clerk` and calling `Clerk.load()`. The project implementation now follows that browser-instance model.


## V135 Authentication Flow Correction
- Replaced the prebuilt Clerk SignIn mount with an explicit email + password sign-in surface backed by Clerk.
- Normal sign-in no longer uses email OTP/code strategy.
- Google remains a separate OAuth action using account-selection prompt.
- Forgot password remains the existing secure reset-link flow.
- Sign-up/verification remains Clerk-managed separately.
