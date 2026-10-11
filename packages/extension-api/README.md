# extension-api

What an extension may call (`QGD-APP-0003`):

| File | What |
|---|---|
| `manifest.ts` | the manifest an extension ships, read and checked before any of its code runs |
| `grants.ts` | the closed grant register, from `data/extension-grants.json` |
| `api-contract.ts` | the request kinds and their replies, validated at the boundary |
| `context.ts` | what an extension is given: `activate(context)`, with `context.request` and `context.cards`; it runs in the extension host (`QGD-APP-0015`) |
| `cards.ts` | the card data shapes and their check (`QGD-HOM-0002`) |
| `plain.ts` | a request rebuilt as a plain value before it is sent |

It is a separate package from `ui` on purpose (`QGD-REP-0004`): what an
extension may **call** and what it may **look like** are different contracts,
and a component library that could also reach the core would collapse the two.

- **One path, no private shortcut.** A built-in extension uses this API and its
  grants exactly as a third-party one would (D-33, `QGD-APP-0002`,
  `QGD-REP-0003`). That is why personas, storage and reference data are part of
  the core and not extensions: the core is what enforces the grants.
- **Built-in, official and third-party** (`QGD-HDBK-001` §14). Built-in
  extensions ship on by default; official ones are installed by choice and
  maintained by this project; third-party ones are published by others and
  come later.
- **An extension without a grant is refused.** The decision is in
  `packages/main/extension-runtime.ts`, the serving in `extension-serve.ts`,
  and `tests/extension-serve.test.ts` proves a refused call reaches nothing.

`scripts/package-boundaries.mjs` holds the direction: an extension depends on
`extension-api` and `ui`, and on nothing else.
