# ProcureIQ V32 Functionality Fix

Built from the last stable V30 codebase to avoid regressions.

## Fixed
- Restored the complete opportunity investigation drawer implementation.
- Investigate buttons use a single direct `onclick` path to avoid duplicate/conflicting delegated handlers.
- Preserved PostgreSQL transaction loading and authentication API wrapper.
- Rebuilt the PDF report renderer with wrapped cells, consistent columns, row heights, page breaks, repeated table headers, executive metrics and footer.
- Added script cache-busting query strings so browsers do not keep stale JavaScript after updates.

## Testing
- `node --check public/script.js`
- `node --check public/core-features.js`
- `node --check server.js`
