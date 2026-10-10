# proofs — the applications that exist to show the grant model refusing

`QGD-APP-0014`. Three applications, **none of them shipped**:

| | Grants | What it proves |
|---|---|---|
| `solar` | `source:solar` | An application works with only the grants it asked for, and a fetch leaves through the Rust credential core from a URL in the register — the application never names a destination and never opens a connection (`QGD-APP-0008`, D-18, D-31) |
| `qrz-lookup` | `service:qrz`, `persona:list` | A granted application works; the credential's secret never crosses the API (`QGD-APP-0007`); and the same call is refused the moment the grant is withdrawn, with no restart (`QGD-APP-0012`) |
| `harness` | none | An application that declared nothing can draw its page and read its own standing, and is refused every capability (`QGD-APP-0005`). It exercises the surface |

A shipped application alone would show the grant model **allowing** and never
refusing, which is the half that matters.

## Why they are not shipped, and how that is enforced

`QGD-APP-0014.1`: "not shipped" is a check on the built artifact, never a
statement of intent. A demonstration that reached an operator would be a
feature nobody wrote.

Two independent things keep them out:

1. **The manifests are not packaged.** `electron-builder` is given an explicit
   `files` list — `dist/**`, `package.json`, `LICENSE`, the registers in
   `data/`, `drizzle/**`. This directory is not in it, so there is nothing for
   the app runtime to load in a packaged application. `readManifests` treats a
   missing directory as "no applications", which is the ordinary case on a
   release rather than an error.
2. **The pages are not in the bundle.** They are Svelte components, so Vite
   would compile them into `dist/renderer/app.js` if anything imported them.
   `__QG_PROOFS__` is a build-time constant — false unless
   `QG_DESKTOP_PROOFS=1` — so the registration is dead code in a release build
   and Rollup drops the components with it.

The second is the one that needed care: `packages/main/policy.ts` serves
exactly three resources over `qg:` (`QGD-SEC-0008`), so loading a page from
disk at run time would mean widening that to a pattern. Dynamic loading is what
a contributed application needs and it arrives with the sandbox (`QGD-APP-0004`
defers it); for the official tier, bundling and tree-shaking is the honest
mechanism.

A suite asserts both: the packaged archive holds no manifest and no page, and
the packaged `app.js` holds none of their markers.
