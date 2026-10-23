# extensions

Everything a ham *does* is an extension (D-21, KI7MT 2026-10-07: the core holds
only what every extension needs and what protects the user). The extensions this
repository builds live here: **built-in** ones, which ship with the application
and are on by default, and **official** ones, which an operator installs by
choice (`QGD-HDBK-001` §14, `qso-graph-desktop#34`). Each one carries its own `package.json`, `src/`, `tests/`, README and icon
(`QGD-REP-0001`), and reaches the core only through `packages/extension-api`
with the grants it has been given (`QGD-REP-0003`), exactly as a third-party
extension would.

Every extension holds to the spec's invariants and conventions (`QGD-SPEC-001` §0.2 and §0.3):
for example, no connection of its own, no credential, and every value written the way the core
writes it.

None of them is here yet, and that is the build order rather than an omission:

| Extension | Part | What |
|---|---|---|
| `conditions` | `QGD-PRT-0108` | Conditions — solar flux, the K and A indices, NOAA's scales and the band outlook (built-in) |
| `pota` | `QGD-PRT-0108` | Parks On the Air — Near Me, Spots and Most Wanted (built-in); split from On the Air with Conditions on 2026-10-23 so each switch turns off one destination |
| `club` | `QGD-PRT-0110` | QG Club — club definition and roster |
| `editor` | `QGD-PRT-0111` | QG Editor — generate, validate and maintain a club's `.cli` and `.prf` files in NetLogger's own format |

The directory exists ahead of them so that the first one added is added to a
layout that is already decided, and so the boundary gate has somewhere to point
when it says an extension may depend on `extension-api` and `ui` and nothing else.
