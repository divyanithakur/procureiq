# ProcureIQ V27 Functionality & PDF Update

- Fixed the opportunity drawer AI action: the AI button and result container are now rendered correctly and the previous undefined focus reference was removed.
- Added deterministic fallback handling already present in the server; the UI now correctly exposes the AI result/retry flow.
- Rebuilt the client-generated PDF report layout with a ProcureIQ logo, navigation-style header, consistent margins, executive metric cards, structured tables, page headers and verification note.
- Standardized workspace action buttons to the ProcureIQ blue action system.
- Simplified the homepage further: one Open Workspace action in the top navigation, one dedicated advertisement/demo video section, no duplicate bottom workspace CTA, and tighter copy with more whitespace.
- Added a graceful video placeholder. Add `public/procureiq-ad.mp4` to use the advertisement slot.
