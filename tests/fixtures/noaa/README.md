# NOAA SWPC responses, recorded

Recorded from `https://services.swpc.noaa.gov` on 2026-10-11 for P8-conditions
(`QGD-HOM-0008`). NOAA's data is a work of the US government and in the public
domain.

- `quiet/`: the three responses as NOAA sent them: `products/summary/10cm-flux.json`,
  `products/noaa-planetary-k-index.json` and `products/noaa-scales.json`.
- `storm/`: the same three, edited to exercise the storm paths: the last Kp raised
  to 5.67, the flux to 168, and the G scale to 2 (moderate). Edited, not recorded.

`expected.json` in each is what `solar-mcp` 0.3.0's `SolarClient.conditions()`
reports for those exact files, produced by running it over them. On the Air's
Conditions card is tested against it, so solar-mcp stays the specification for
the card's behaviour. The two agree exactly: until 0.3.0 solar-mcp left a
non-zero scale as a bare digit (`"2"`), and now prefixes every level (`G2`), as
the card always did.

The six response files are pinned by SHA-256 on both sides: in
`extensions/on-the-air/tests/conditions.test.ts` here and in solar-mcp's
`tests/test_fixtures_noaa.py`. Re-recording them means changing both.
