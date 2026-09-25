# V142 FINAL — Token persistence + auth hardening

## Fixed
- Token enforcement limits now derive from the plan catalog so token limits cannot silently diverge.
- AI token reservations now use the account's actual remaining balance when the remaining balance is below the conservative estimate, avoiding a false "allowance reached" rejection near exhaustion.
- Token usage remains anchored to the authenticated Clerk account and does not reset on logout, login, device changes, refresh, or workspace data reset.
- Corrected Help/Assistant wording from daily token tracking to persistent account-level tracking.
- Header token donut is now authoritative: blue = remaining tokens, white = used tokens.
- Google callback now cache-busts the authentication script so updated OAuth logic is not hidden by the old callback-page cache.
- Existing `oidcPrompt: "select_account"` Google OAuth behavior is preserved; no Google One Tap was introduced.

## Preserved
- Email/password login and 8-character password validation.
- Forgot-password email reset flow.
- Clerk authentication/session handling.
- Legal/privacy pages.
- Procurement workflows, reports/PDFs, Supplier Risk, Contract Recovery, billing and existing UI.
