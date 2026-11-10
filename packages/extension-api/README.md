# extension-api

What an extension may call (`QGD-APP-0003`):

| File | What |
|---|---|
| `manifest.ts` | the manifest an extension ships, read and checked before any of its code runs |
| `grants.ts` | the closed grant register, from `data/extension-grants.json` |
| `api-contract.ts` | the request kinds and their replies, validated at the boundary |
| `context.ts` | what an extension is given: `activate(context)`, with `context.request` and `context.pages`; it runs in the extension host (`QGD-APP-0015`) |
| `pages.ts` | the page data shapes and their check (`QGD-HOM-0002`) |
| `plain.ts` | a request rebuilt as a plain value before it is sent |

It is a separate package from `ui` on purpose (`QGD-REP-0004`): what an
extension may **call** and what it may **look like** are different contracts,
and a component library that could also reach the core would collapse the two.

- **One path, no private shortcut.** A built-in extension uses this API and its
  grants exactly as a third-party one would (D-33, `QGD-APP-0002`,
  `QGD-REP-0003`). That is why callsigns, storage and reference data are part of
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

`lotw:manage` requires the operator's grant and serves these requests:

| Request | Fields | Reply |
|---|---|---|
| `lotw.import` | `kind` | Load a `.tq6` or `.p12` chosen by the operator |
| `lotw.restore` | `kind` | Restore a `.tbk` chosen by the operator |
| `lotw.delete` | `kind`, `certificate` | Delete the opaque `cert:<uuid>` id returned by `lotw.certificates` |

Each success reply is `{ ok: true, kind, result }`. `result.status` is `completed` or
`cancelled`; cancellation changes no certificates, keys or Locations. Completed results include
`certificates` (call, serial, disposition and reason), `roots`, `signedQsos`, `deleted`, `locations`
and `skippedLocations` (name and reason). Certificate dispositions are `new`, `present`, `refused`
and `delete`. A refused certificate stays unchanged. Counts describe completed changes.

Main chooses the file, obtains any passwords and confirms the inspected plan. An extension supplies
no file path, bytes, password or confirmation answer. A backup offers Desktop Location creation in
that confirmation; resulting names include any ` (TQSL)` collision suffix. A Location storage failure
can leave LoTW work completed with Locations skipped; the result says which Locations were skipped.
An extension must not automatically retry a write whose outcome is unknown after a deadline or crash.

A page can declare `actions` and `rowActions` in its manifest, each `{ id, label, hint? }`.
See `QGD-HOM-0018` through `QGD-HOM-0020` for the bounds and lifecycle. The core draws
the buttons and delivers an operator press to `context.pages.onAction(pageId, handler)`
as a `page.action` event: `{ page, action, row? }`. The handler returns nothing or a
short status string. Every completion refreshes the page. An action is neither a
grant nor a confirmation; requests made by a handler use the normal grant checks
and dialogs. An action whose outcome is unknown must never be retried automatically.

Page data version 8 adds `{ cells: string[], key?: string }` table rows alongside
the existing array rows. Only keyed rows have row buttons; the key is opaque and
never displayed. Main accepts only keys from the answer currently shown. For example:

```ts
context.subscriptions.push(context.pages.onAction('certificates', async event => {
  if (event.action === 'delete' && event.row !== undefined) {
    await context.request({ kind: 'lotw.delete', certificate: event.row });
  }
}));
```

The event and status validators are in `actions.ts`. Action declarations add no
new request kind to `api-contract.ts`: `page.action` flows from the operator to the
extension, while that contract describes the extension's requests to the core.

`lotw.sign` requires `lotw:sign`; `lotw.upload` requires `lotw:upload`.
Both requests contain only `kind`. Extra fields, including paths, bytes, tokens
and confirmation answers, are refused. The Certificates page declares **Sign
log…** and **Upload signed log…** as page actions. An extension sends the request
only after its action event; main owns every file and confirmation dialog.

Success replies are `{ ok: true, kind, result }`. `result` contains `status`
(`completed` or `cancelled`), `signed`, `alreadySigned`, `signAgainCount`, `outsideDates`, `refused`
(record number, optional physical line, field and reason), and `upload` (plain
outcome text or `null`). It contains no path or file contents. Main shows the full
signing result and can offer **Upload to LoTW…** when the upload grant is held.
That button starts a separately confirmed upload; the grant is checked again
before sending. See `QGD-LTW-0015` through `QGD-LTW-0019`.
