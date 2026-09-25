# V109 — Procurement Intelligence Control Layer

Implemented on top of the approved V108 product without replacing the existing UI.

- Contract → PO → Goods Receipt → Invoice data model in PostgreSQL.
- Authenticated control-pack ingestion API for future ERP/API connectors.
- Deterministic 3-way match audit with quantity/price exceptions.
- Contract price leakage and rebate-candidate calculations.
- Supplier concentration signal using only supplied invoice evidence.
- Overview “Load demo control pack” test surface.
- Existing Contract Recovery and Exception Resolver can inspect the same control evidence.
- Bundled deterministic demo data: `demo-data/procureiq-control-pack.json`.
- Reset-data now clears control-pack records as well.
- Browser cache versions bumped to V109.
- No payment processing, supplier marketplace, autonomous sourcing, or ERP replacement was added.
