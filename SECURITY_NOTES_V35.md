# ProcureIQ V35 security notes

- Secrets remain server-side in environment variables; only Clerk publishable and Razorpay key ID are sent to the browser.
- API responses use generic production errors and do not expose stack traces, database names, file paths, or secret values.
- Procurement AI Insight uses an authenticated transaction ID and recalculates price/benchmark/quantity from PostgreSQL rather than trusting browser-supplied financial values.
- User records are scoped by `clerk_user_id`.
- Payment verification checks signature, order ownership, plan amount/currency, payment/order IDs, and captured payment status before activation.
- Basic API abuse rate limiting is included in-process. A production multi-instance deployment should also use an edge/WAF or shared rate limiter.
- PDF generation is client-side; downloaded reports are built from the current authenticated workspace data.
- No claim of 100% accuracy is made. Deterministic calculations are the source of truth; AI provides explanation only.
