# ProcureIQ V106 — Upload, Refresh Audit & Logo Fix

- Reworked the ProcureIQ geometric P mark so the mark remains fully visible on light and dark surfaces.
- Tightened ProcureIQ wordmark spacing and kept the brand-blue IQ treatment.
- Overview upload now shows a short `PDF uploaded successfully` / `File uploaded successfully` confirmation only after the upload API succeeds, then clears automatically.
- Upload failures now use `PDF not uploaded — ...` / `File not uploaded — ...` and clear automatically.
- PDF parsing now reports concrete missing fields such as material/item, supplier/company, quantity, or price when the extracted document lacks them.
- Contract Recovery PDF upload uses the same temporary success/failure feedback pattern.
- Supplier Risk `Refresh audit` now performs a real page reload so the page rebuilds from the latest saved PostgreSQL data.
- After the reload, `Audit refreshed successfully` appears briefly and disappears automatically. No refresh timestamp is shown.
- Failed data reloads are surfaced as a refresh error instead of a false success.
- Existing layouts, page structure, and feature behavior remain unchanged.
