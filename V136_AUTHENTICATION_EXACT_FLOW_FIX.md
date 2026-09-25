# V136 Authentication Exact Flow Fix

- Normal ProcureIQ email sign-in now directly attempts Clerk password authentication; it does not inspect or select an email-code/OTP factor.
- Wrong email/password credentials use the single user-facing message: `Email or password is incorrect.`
- Existing Forgot Password remains the email reset-link -> new password -> normal email/password login flow.
- Existing Google OAuth remains separate and requests `oidcPrompt: select_account`.
- No unrelated product, dashboard, database, payment, legal, or AI changes were made.
