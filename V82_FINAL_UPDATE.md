# ProcureIQ V82 — PDF + Account Alignment Final Fix

- PDF transaction appendix now paginates from the actual transaction count; no forced empty continuation pages.
- Transaction table columns use the full printable width without pushing TOTAL outside the right margin.
- Savings/exception state bars keep labels, bars, and counts in separate columns so zero counts never render as `0Investigated`, `0Decision`, etc.
- Decision-flow connector uses a PDF-safe ASCII marker instead of a potentially unsupported arrow glyph.
- Account identity and current plan are now one compact vertical stack; the Upgrade control sits immediately beside the plan below the account name.
- Workspace cache/build markers updated to V82.
- No database schema, authentication, API, pricing, or analysis logic was changed.
