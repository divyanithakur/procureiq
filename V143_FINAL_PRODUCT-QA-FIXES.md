# ProcureIQ V143 — Final Product QA Fixes

- Overview upload feedback now reports inserted, duplicate and invalid row counts.
- Fixed an undefined `pct` runtime bug in the AI usage progress update.
- Contract Recovery now captures supplier from uploaded commercial terms and uses supplier + material for recovery calculations when supplier is available.
- Added supplier field to Contract Recovery for auditable supplier-specific calculations.
- Contract Recovery now warns when supplier is omitted and the material exists across multiple suppliers.
- Control-pack import validates/stages records before deleting existing control data, preventing an invalid upload from wiping the previous pack.
- Control-pack import returns loaded counts and invalid-row counts.
- Control audit now flags missing GRNs and PO supplier/material mismatches.
- Removed misleading “AI tokens/day” wording; token allowance is account-persistent.
- Refreshed workspace script/auth/core-feature cache versions to V143.
