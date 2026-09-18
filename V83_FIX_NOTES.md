# V83 — PDF report and layout fix set

This pass fixes two independent things: the PDF report generator
(`public/script.js` → `drawReport`) and four CSS layout bugs in the
workspace shell (`public/workspace.css`). No product logic, no
Postgres/Clerk/AI wiring, no copy outside the report and the touched
CSS selectors was changed. All 36 existing smoke tests still pass.

## PDF report (`public/script.js`)

**Root cause of the clipped callout text:** `note()` called
`doc.splitTextToSize()` before calling `doc.setFontSize()`, so the
wrap width was computed against whatever font size the previous draw
call had last set. Fixed by setting the font before measuring — this
alone fixed the overflowing "How to read this" / "Benchmark
discipline" boxes.

Everything else:

- **Pagination is now flow-based.** Sections used to force `newPage()`
  unconditionally; replaced with `ensure(height)`, which only breaks
  when the next block genuinely won't fit. Your 5-row sample report
  went from 8 pages to 5, and per-page trailing whitespace dropped
  from ~60% to 11–22%. Verified by rendering the 5-row sample, a
  1-row sample, a 500-row / 8-supplier sample, and an empty dataset,
  then rasterizing every page.
- **Duplicate section removed.** The old pages 6 and 8 were the same
  5-step funnel under two different headings ("Investigation flow"
  and "Decision note"). Merged into one "From signal to decision"
  section carrying live counts, with the four action steps laid out
  two-up instead of stacked, so the section fits without a trailing
  near-empty page.
- **Section numbering** is now derived from a counter (`01, 02, 03…`)
  instead of hardcoded strings that skipped `02` and ended in
  `FINAL`.
- **One currency convention throughout.** The old `compactMoney`
  mixed `INR 1.57 L`, `INR 96.0 K`, and `INR 1,57,500.00` in the same
  tables. Now everything uses Indian digit grouping with whole
  rupees: `INR 1,57,500`.
- **No hardcoded "top five".** "The top five opportunities represent…"
  is now `The top {n} opportunities represent…`, where `n` is the
  actual count shown (never more than what exists). Same fix applied
  to `TOP-FIVE SUPPLIER SHARE`, which is now suppressed entirely when
  the supplier count doesn't exceed the number of suppliers listed
  (it was printing a meaningless "100.0%" whenever there were ≤5
  suppliers total).
- **No null-result headlines.** "0 high-variance review signals" as
  the hero stat is replaced with the actual finding (e.g. "INR 7,500
  in review signals") when the headline count is zero; the zero is
  now reported as supporting context instead.
- **No false contrasts.** "0 opportunities meet the threshold, *but*
  0 investigation records are recorded" (two zeros joined by "but")
  is replaced with a single clean empty-state sentence when both
  values are zero.
- **Zero-value bars render as empty rails**, not small colored stubs
  that visually imply a non-zero quantity. Every bar chart now states
  its scale basis ("Bars are scaled against the largest value shown…").
- **Funnel layout fixed.** Labels, bars, and counts now sit in three
  non-overlapping columns; the four summary metrics (high-variance
  count, investigation count, negotiated/realized saving) moved below
  the bars instead of overlapping them.
- **Table columns clarified.** `PAID` was ambiguous against the line
  total — renamed to `UNIT PRICE PAID`, and a `BENCHMARK` column was
  added (the data already existed in `minPrice`, just wasn't shown),
  so variance can actually be checked against something.
- **Single-day periods** now render as `13 Sept 2026 (single day)`
  instead of `13 Sept 2026 – 13 Sept 2026`, with a key finding noting
  that a single day doesn't support trend claims.

## Website layout (`public/workspace.css`)

**Root cause of the sticky header not sticking:**

```css
html, body, .app-shell { overflow-x: hidden !important; }
```

`overflow-x: hidden` forces the computed `overflow-y` of an element to
`auto`, which makes it a scroll container. A `position: sticky` child
sticks to its nearest scroll-container ancestor, not the viewport — so
this one property silently broke `.app-header`'s otherwise-correct
`position: sticky; top: 0`. Changed to `overflow-x: clip`, which
suppresses the same horizontal overflow without creating a scroll
container, so sticky now resolves against the viewport.

Three more bugs, fixed in the same new CSS layer at the bottom of the
file (marked `V83 LAYOUT CORRECTIONS`):

- **Header was translucent** (`rgba(255,255,255,.96)` + `backdrop-filter:
  blur(12px)`), so page content was visible through it while scrolling.
  Now fully opaque, `backdrop-filter: none`.
- **Logo and sidebar nav didn't share a left edge.** Both now align to
  one `--ws-gutter: 24px` variable.
- **Account block spacing.** "Free plan" previously inherited
  `margin: 0 0 0 42px` from an earlier version layer, pushing it well
  below and right of the name. The account name and plan row are now
  one tight flex column with a 2px gap and a shared left edge.
- **Main content clipped on the right.** `.workspace-main` now carries
  its own right gutter and `box-sizing: border-box`, so cards no
  longer run past the viewport edge.

**Cache-busting bump:** all `<link>`/`<script>` tags across every HTML
page were bumped to `?v=83`. `style.css` in particular was being
loaded with **no version query string at all** in the uploaded build,
which is the most likely reason earlier prompts to fix this "didn't
work" — the browser was serving a stale cached copy regardless of what
the CSS file actually said.

## What to check after deploying

1. Scroll to the bottom of any workspace page — header should stay
   pinned, fully opaque, nothing scrolls under it.
2. Sidebar "Divyani Gour" / "Free plan" should read as one tight
   stacked unit, not two separated elements.
3. Logo's left edge should line up with the sidebar nav items' left
   edge.
4. No horizontal scrollbar and no clipped cards at 1440px, 1024px, and
   375px widths.
5. Download a PDF report — should be page-efficient with no dead
   whitespace, no duplicate sections, and figures in one number format
   throughout.
