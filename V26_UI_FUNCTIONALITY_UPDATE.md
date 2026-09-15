# ProcureIQ V26 : UI + Functionality Update

## Fixed
- Added `/workspace/chat` to the server's real workspace routes. This fixes the blank Guided Buying destination.
- Added legacy `/workspace/guided-recovery` redirect to `/workspace/chat` for older links/bookmarks.
- Replaced the homepage with a clean white enterprise layout rather than extending the previous dark landing page.
- Primary product actions now use one consistent blue action color (`#2563EB`). Green is not used as the brand/accent color and black is not used for primary CTAs.
- Reduced homepage copy and visual density; sections use clear hierarchy, whitespace and compact cards.
- Kept the four monetizable pillars as the main product structure.
- Preserved the evidence-first behavior of the existing product modules: financial calculations remain deterministic and unsupported vendor/risk claims are not fabricated.

## Validation performed
- `node --check server.js`
- `node --check public/core-features.js`
- `node --check public/script.js`
- `node --check public/auth.js`
- Confirmed every workspace HTML target referenced in the navigation exists.
- Confirmed the Guided Buying page exists at `public/workspace/chat.html` and is now included in the Express workspace route list.
- Confirmed the homepage inquiry form IDs remain compatible with the existing inquiry handler.
