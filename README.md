# ProcureIQ — focused procurement intelligence

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
