# ProcureIQ V140 — Final Authentication Setup Checklist

## 1. Clerk password minimum
Open the Clerk Dashboard for the ProcureIQ instance:
User & authentication → Password → password requirements.

Set the minimum password length to **8**.

Do not use 7: Clerk's current password API requires at least 8 characters.

## 2. Local environment
Create `environment/.env` from `.env.example` and provide real values for:

- CLERK_PUBLISHABLE_KEY
- CLERK_SECRET_KEY
- DATABASE_URL (or DB_* values)
- RESEND_API_KEY
- RESEND_FROM_EMAIL (or INQUIRY_FROM_EMAIL)
- PUBLIC_APP_URL=http://localhost:3000

Never commit `environment/.env`.

## 3. Run
```powershell
npm install
npm test
npm start
```

Open `http://localhost:3000`.

## 4. Test reset email
1. Open Sign in.
2. Click Forgot password.
3. Enter an existing Clerk account email.
4. Click Send reset link.
5. Check the terminal running `npm start` if delivery fails.
6. In local development, the page now displays the Resend provider error instead of only the generic message.
7. If Resend succeeds, open the clickable link in the email.
8. Set an 8+ character password.
9. Sign in with the new password.

## 5. What the ZIP cannot fix by itself
The Clerk Dashboard password policy and Resend account/domain/API-key configuration are external to the repository. The repository cannot safely contain those secrets or change a hosted Clerk instance setting by itself.
