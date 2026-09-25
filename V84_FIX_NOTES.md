
---

# V84 — Currency formatting and orphaned PDF heading

Found from a screen recording of the live workspace and a fresh PDF export
against a realistic 117-transaction / 87-opportunity dataset.

## Website: stray decimal in currency display (`public/script.js`)

The Reports page showed **₹20,55,009.4** instead of a clean whole-rupee
figure. Root cause: `formatCurrency()` used
`toLocaleString("en-IN", { maximumFractionDigits: 2 })` with no
`minimumFractionDigits`. `toLocaleString` only pads/truncates *up to* the
maximum — it renders whatever fractional digits the raw float actually
carries. Since `totalSavings` is a summed float (e.g. `2055009.4`), the
output kept that stray `.4` instead of showing whole rupees or a consistent
two decimals.

Fixed by rounding to whole rupees before formatting, matching the PDF's
`money()` convention:

```js
return `₹${Math.round(number).toLocaleString("en-IN", {
    maximumFractionDigits: 0
})}`;
```

This function is used in ~15 places across the app (opportunity cards,
tooltips, modals, the reports summary), so the fix applies everywhere at
once.

## PDF: orphaned section heading (`public/script.js` → `drawReport`)

On datasets with a longer executive summary (more key findings, as with
real procurement data), the "01 • Opportunity landscape" heading was
printed at the very bottom of page 1 with just enough room for the heading
itself — but not enough for the bars/table that belonged under it. Those
spilled onto page 2, leaving the heading stranded alone with no visible
content, and page 2 opening with data but no section title.

Root cause: `section()` reserved a flat `90pt` for whatever content follows
a heading, regardless of how tall that content actually is. A bars block
with up to 8 rows needs ~284pt — nearly 3x what was reserved.

Fixed with a `barsReserve(items, limit)` helper that predicts the real
height of the following bars block (mirroring `horizontalBars()`'s own
layout math), passed as `reserve` to the four sections that lead with a
bars chart (Opportunity landscape, Savings & exceptions, Supplier
intelligence, Material intelligence). Now `section()`'s existing `ensure()`
check correctly pushes the *entire* heading+content block to a fresh page
together when it won't jointly fit, instead of only checking the heading.

Verified by reconstructing a matching 117-row / 87-opportunity dataset and
rendering before/after: before, "What deserves attention first" sat alone
at the bottom of page 1; after, page 1 ends cleanly after "Key findings"
and page 2 opens with the full heading + bars + table together. Re-ran the
original four test scenarios (5-row, 1-row, empty, plus this new 117-row
case) — page counts unchanged, all 36 smoke tests still pass.

## Cache-busting

Bumped all `?v=` query strings to `84` across every HTML page so browsers
don't serve last round's cached `script.js`/`workspace.css` over the top of
these fixes.
