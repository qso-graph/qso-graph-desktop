# extensions

Everything a ham *does* is an extension (D-21, KI7MT 2026-10-07: the core holds
only what every extension needs and what protects the user). The extensions this
repository builds live here. Each ships with the application as an **official**
extension and, like every extension, **starts off** until the operator turns it
on in Settings → Extensions (`QGD-HDBK-001` §14, `qso-graph-desktop#34`). Each one carries its own `package.json`, `src/`, `tests/`, README and icon
(`QGD-REP-0001`), and reaches the core only through `packages/extension-api`
with the grants it has been given (`QGD-REP-0003`), exactly as a third-party
extension would.

Every extension holds to the spec's invariants and conventions (`QGD-SPEC-001` §0.2 and §0.3):
for example, no connection of its own, no credential, and every value written the way the core
writes it.

The four that ship today:

| Extension | What |
|---|---|
| [`pota`](pota/README.md) | Parks On the Air: Near Me, Spots and Most Wanted |
| [`conditions`](conditions/README.md) | Conditions: solar flux, the K and A indices, NOAA's scales and the band outlook |
| [`astro`](astro/README.md) | Astro: the grey line, the sun, the twilights and the moon at your Location |
| [`adif-lookup`](adif-lookup/README.md) | ADIF Lookup: every ADIF field and enumeration value, in ADIF's own words |

Planned next are integrations with the programs operators already run, WSJT-X
first (#125). The boundary gate holds every one to the same rule: an extension
may depend on `extension-api` and `ui` and nothing else.
