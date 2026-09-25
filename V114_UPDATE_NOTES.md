# V114 Update Notes

## Homepage
- Kept the existing hero section and moved the “From evidence to action” card slightly left for better balance.
- Added a restrained ambient glow to the large homepage headings while preserving the existing typography and palette.
- Kept “Find the procurement exception that deserves attention.” section content unchanged.

## Real product-demo video
- Replaced the previous illustrative product-flow MP4 with a loopable sequence generated directly from the provided ProcureIQ screen recording `Screen Recording 2026-09-20 151610.mp4`.
- No synthetic dashboard, fake metrics, replacement UI, or generated imagery is used in the video asset.
- The video is muted, autoplaying, looping, and uses the supplied recording frames.
- Removed the previous “LIVE PRODUCT DEMO / ILLUSTRATIVE WORKFLOW” overlay from the visible UI so the recording itself is the product visual.

## Dashboard hover consistency
- Added one consistent hover interaction to the major workspace cards/boxes, including work cards, KPI cards, feature cards, pricing cards, evidence/result cards, supplier/control cards and help cards.
- Hover behavior is a restrained lift/depth effect and does not alter functional controls.

## Token animation
- Kept the live API-driven token usage percentage (`--token-used`).
- Added a compact circular token indicator: used percentage is blue, remaining capacity is unfilled/pale.
- The token indicator subtly pulses when live token usage changes.
- Label remains simply “Tokens”.

## Verification
- `npm test`: 38/38 passed.
- `node --check public/procureiq-animations.js`: passed.
- `node --check public/script.js`: passed.
- `node --check server.js`: passed.
