# apps

Everything a ham *does* is an application (D-21, KI7MT 2026-10-07: the frame
holds only what every application needs and what protects the user). Each one
carries its own `package.json`, `src/`, `tests/`, README and icon
(`QGD-REP-0001`), and reaches the frame only through `packages/app-api` with
the grants it has been given (`QGD-REP-0003`).

None of them is here yet, and that is the build order rather than an omission:

| Application | Part | What |
|---|---|---|
| `adif` | `QGD-PRT-0108` | QG ADIF — validate, check and repair `.adi` files. Files only; no QSO storage |
| `club` | `QGD-PRT-0109` | QG Club — club definition and roster |
| `editor` | `QGD-PRT-0110` | QG Editor — generate, validate and maintain a club's `.cli` and `.prf` files in NetLogger's own format |

The directory exists ahead of them so that the first one added is added to a
layout that is already decided, and so the boundary gate has somewhere to point
when it says an application may depend on `app-api` and `ui` and nothing else.
