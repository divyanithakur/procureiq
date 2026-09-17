# ProcureIQ v25 Product Update

## What changed

The current build is repositioned around four monetizable procurement workflows:

1. Contract Leakage & Rebate Recovery
2. Autonomous 3-Way Match Exception Resolver
3. Tail-Spend Micro-Tendering & Guided Buying
4. Supplier Risk & Geopolitical Auditor

## UX direction

The interface now uses a professional white / light-grey / charcoal system. Green is no longer used as the product's branding or primary action color.

## Output quality rules

The feature surfaces deliberately avoid fabricated facts:

- Financial calculations are deterministic.
- Contract PDF extraction produces candidate terms that must be confirmed.
- Recovery calculations use the entered contract terms and uploaded transaction history.
- 3-way matching reports exact variances and a clear action.
- Guided Buying creates a structured RFQ without inventing vendor quotes or market prices.
- Supplier Risk reports internal concentration/dependency signals; it does not claim live bankruptcy, sanctions or geopolitical intelligence without an external feed.

## Testing

A ready-to-use dataset is included at:

`demo-data/procureiq-demo.csv`

Upload it from Overview.

Then test:

- Contract Recovery: use `Steel Coil`, contracted price `500`, rebate threshold `3000`, rebate rate `3`.
- 3-Way Match: PO 100, GRN 98, Invoice 100, PO price 500, Invoice price 510, tolerance 2%.
- Guided Buying: try `Office Chair`, quantity 20, with a concrete specification.
- Supplier Risk: run the audit after loading the demo data.

## Important production boundary

The current frontend can calculate and structure decisions from supplied evidence. True ERP write-back, live supplier financial/sanctions feeds, supplier email dispatch, and production contract/rebate integrations require authenticated external integrations and backend workflows.
