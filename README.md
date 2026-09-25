# ProcureIQ : focused procurement intelligence

## Product focus
ProcureIQ is intentionally narrow: it finds the few procurement transactions worth investigating, ranks them by potential financial impact and evidence quality, and shows the evidence needed for human validation.

Primary workflow:
1. Upload purchasing data.
2. See potential savings and the highest-priority opportunities.
3. Open an opportunity to inspect the price comparison and evidence.
4. Move from finding → validation → realized value.

The workspace keeps the primary product navigation focused on **Overview**, **Exception Resolver**, **Contract Recovery**, **Guided Buying**, **Supplier Risk** and **Reports**. Plans & Billing and Help & Support remain in the account/support area.

## Local setup

1. Open this folder in VS Code.
2. Create `environment/.env`.
3. Copy your keys into that file. Never commit the real `.env`.
4. In PowerShell, from the folder containing `package.json`:

```powershell
npm install
npm start
```

The server automatically loads `environment/.env` first and falls back to a root `.env` only for compatibility.

Open: `http://localhost:3000`

## Expected environment variables

```env
PORT=3000
DATABASE_URL=
DB_USER=postgres
DB_HOST=localhost
DB_NAME=procureiq
DB_PASSWORD=
DB_PORT=5432
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
GEMINI_API_KEY=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

Authentication and payments are optional for the server to start, but protected workspace actions require Clerk and database configuration.


## V47 product foundation
- Opportunity Memory: Detect → Investigate → Decide → Outcome.
- Outcome Ledger: tracked, validated, negotiated and realized savings.
- Evidence-first opportunity drawer with priority score and comparable-purchase context.
- Centralized launch pricing: Starter ₹1,499, Business ₹4,999, Pro ₹11,999/month, plus localized checkout prices.
- Server-side plan entitlements, transaction limits and premium route protection.
- Refund & Cancellation policy route and international checkout foundation.
- PDF report refined for hierarchy, whitespace, readable tables, outcome history and complete transaction appendix.
- UI kept within the existing navigation; no new sidebar page was added for memory/outcomes.


## V63 persistence
- Procurement transactions are stored in PostgreSQL per Clerk user.
- Each upload is tagged with an upload batch and source filename.
- Report/analysis history is stored in PostgreSQL per Clerk user rather than only browser localStorage.
- A persistent database (`DATABASE_URL`) is required in production; an ephemeral/local database cannot provide durable production history.


## V109 — Procurement Intelligence Control Layer

This build adds a test-ready intelligence layer without turning ProcureIQ into a full procurement/payment suite.

### Included
- Contract → PO → Goods Receipt → Invoice data model.
- Deterministic 3-way match and exception audit.
- Contract price leakage and rebate-candidate calculations.
- Supplier concentration signal based only on uploaded invoice evidence.
- Authenticated APIs for future ERP/API connectors: `/api/control-pack` and `/api/control-audit`.
### Intentionally not included
Payments, supplier marketplace/network, autonomous sourcing, or a replacement ERP. Those remain outside the intelligence-layer core until real customer requirements justify them.

### Demo flow
1. Sign in and open Overview.
2. Import your control workbook from the Overview workspace.
3. Review the resulting evidence and exceptions.


## V110 — Control workflow + UI quality pass
- Human-approved control actions are persisted in `control_actions`.
- Supplier scorecards are derived from observed control evidence.
- Overview accepts JSON/XLSX/XLS/CSV control-pack imports.
- Control-pack output was re-spaced into separate status, KPI and supplier-signal layers for a cleaner professional layout.


## Production billing and inquiry configuration

Paid plans use Razorpay recurring subscriptions. Set `RAZORPAY_PLAN_STARTER_ID`, `RAZORPAY_PLAN_BUSINESS_ID`, and `RAZORPAY_PLAN_PRO_ID` to the recurring plan IDs created in Razorpay. Public inquiries use Resend when `RESEND_API_KEY` and `INQUIRY_FROM_EMAIL` are configured. Keep real credentials in `environment/.env`, never in source control.


## Production configuration notes
- Recurring billing uses Razorpay subscription plan IDs configured per currency. If a currency has no plan IDs, checkout is disabled for that currency rather than charging a different currency.
- Set `ADMIN_CLERK_USER_IDS` (comma-separated Clerk user IDs) for review moderation.
- Set `DB_SSL_CA` when your hosted PostgreSQL provider supplies a CA certificate and you want certificate verification enabled.

### Authentication — V130 final flow
Authentication uses Clerk for account/session management and a branded in-app sign-in/sign-up surface. Email/password sign-in, Google OAuth, email verification and normal sessions remain Clerk-managed. Forgot Password uses a real, single-use, expiring email reset link generated by ProcureIQ and delivered through Resend, then updates the Clerk password securely. Set `PUBLIC_APP_URL`, `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (or `INQUIRY_FROM_EMAIL`) for production password-reset email delivery.
