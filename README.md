# ProcureIQ : focused procurement intelligence

## Product focus
ProcureIQ is intentionally narrow: it finds the few procurement transactions worth investigating, ranks them by potential financial impact and evidence quality, and shows the evidence needed for human validation.

Primary workflow:
1. Upload purchasing data.
2. See potential savings and the highest-priority opportunities.
3. Open an opportunity to inspect the price comparison and evidence.
4. Move from finding → validation → realized value.

The workspace intentionally keeps the primary navigation to **Overview** and **Opportunities**. Account, Settings, Billing and Help stay available from the account menu.

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
