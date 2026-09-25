# ProcureIQ V146 — Pitch-ready production polish

## Authentication
- Sign-in and sign-up now use Clerk prebuilt authentication UI.
- Clerk owns password visibility, verification, OAuth, forgot-password and reset-password behavior.
- Removed the second custom password-reset API/database flow from ProcureIQ.
- Existing protected API/session model remains Clerk-backed.

## Billing
- Razorpay subscription flow remains server-authoritative.
- Before checkout, the backend verifies that the configured Razorpay plan exists, is monthly, and matches the ProcureIQ expected amount.
- A mis-mapped plan ID now fails safely with a clear configuration error instead of opening checkout for the wrong amount.
- Existing subscription verification remains signature-checked and idempotent.

## AI usage
- Existing account-scoped token reservation and quota gates are preserved.
- Existing 5,000-token free allowance and paid-plan entitlements are preserved.

## UX polish
- Reduced visual copy density through restrained typography/spacing overrides.
- Preserved existing actions, navigation, product workflow and responsive structure.
- Release cache references were synchronized to v145 assets.

## Verification
- `node --check server.js` — passed
- `node --check public/auth.js` — passed
- `node --check public/script.js` — passed
- `npm test` — **70/70 passed**

## Important live setup
- Do not include `.env` in the release ZIP.
- Copy the user's existing local `.env` into the project locally before running.
- For Razorpay INR, verify that `RAZORPAY_PLAN_STARTER_ID`, `RAZORPAY_PLAN_BUSINESS_ID`, and `RAZORPAY_PLAN_PRO_ID` point to the matching monthly plans and amounts.
- The release cannot verify a live Razorpay account without the user's environment credentials and external checkout.
