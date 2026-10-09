# AI Agent Guide for QSO Graph Desktop Development

This guide is for AI coding assistants (Claude, Codex, Copilot and the like) helping develop
**QSO Graph Desktop**: writing code and tests, reviewing changes, and triaging issues in this
repository. Human contributors are welcome to read it too.

`spec/QGD-SPEC-001.md` is the **only normative document**. This guide orients you and points at
requirement IDs; it never restates them. A second copy of a requirement is a defect, because the
two copies will eventually disagree (`QGD-SPEC-001` §0.1). Rationale lives in
`hdbk/QGD-HDBK-001.md`. When this guide and the spec seem to differ, the spec wins and this guide
has a bug.

## Who you are helping

- **Audience:** contributors building the product, not end users. Be direct and technical.
- **The users of the product** are amateur radio operators, most of them not developers. Screens,
  messages and onboarding are written for them: plain words, no jargon, no developer workflows.
- **Authority:** KI7MT decides scope, order and product questions, signs off each Part, and
  approves screenshot baselines. An agent never records a sign-off or approves a baseline.

## The product, in one paragraph

QSO Graph Desktop is an Electron desktop application for hams, built as a **frame plus apps**,
modelled on Podman Desktop. The **frame** (Parts P0–P7) holds only what every app needs and what
protects the user: the Rust credential core, the process map, the shell, the bundled PostgreSQL
engine, reference data, personas, and the app API with its grants. **Apps** (P8 onward) do the
ham work and reach the frame only through the app API, exactly as a contributed app would
(`QGD-PRT-0005`, `QGD-REP-0003`). The build order is the catalogue in spec §2.1 and nowhere else.

## Mental model for any change

Know which layer a change belongs to, then read that layer's requirements before writing code.
This section is navigation; the requirements themselves are in the spec.

| If the change touches… | It belongs in… | Read first |
|---|---|---|
| Credentials, outbound network, cryptography | `persona-core` (Rust) | `QGD-CRD-*`, `QGD-SEC-0020`, §4.3.1 |
| Windows, IPC brokering, process supervision | `main` | `QGD-PRC-*`, `QGD-SEC-*` |
| Screens and components | `renderer`, `ui` | `QGD-FRM-*`, `QGD-CRD-0007`, `QGD-PRC-0006` |
| Data, schema, backups | `engine` | `QGD-ENG-*` |
| Reference data (ADIF, POTA…) | `reference` | `QGD-REF-*` |
| Personas and services | `personas` | `QGD-PSN-*` |
| Anything a ham *does* | an app in `apps/`, through `app-api` only | `QGD-APP-*`, `QGD-REP-0003` |

Four things are easy to get wrong, so check them on every change:

- **Whose data is it?** This product's own names, directories and files only. See `QGD-CRD-0003`
  and `QGD-CRD-0004` before touching storage or the credential store.
- **Who connects out?** See `QGD-SEC-0020` before adding anything that talks to a network.
- **Whose identity?** See `QGD-PSN-0012` before integrating any outside service.
- **What can't it do?** See `QGD-PSN-0013` before writing setup or error text for a service that
  can't be reached.

## Quick start

```bash
make setup      # npm ci, plus the pinned PostgreSQL build, ADIF release and POTA data (verified)
make verify     # every check; writes report/. Must be green before a commit
make start      # build and run the app
make package    # a packaged .app in build output (no installer)
make installer  # the installer
```

macOS on Apple silicon is the only platform before Release 1 (`QGD-SCP-0002`).

## Codebase structure

```text
qso-graph-desktop/
├── packages/            the frame (P0–P7); apps may depend only on app-api and ui
│   ├── persona-core/    Rust (napi-rs): OS credential store, outbound HTTPS, crypto
│   ├── main/            Electron main: windows, IPC brokers, process supervision
│   ├── preload/         the only bridge to the renderer: named, typed functions
│   ├── renderer/        the Svelte shell and pages
│   ├── ui/              shared Svelte components and patterns
│   ├── engine/          bundled PostgreSQL: supervisor, Drizzle schema, migrations, backup
│   ├── reference/       reference data: ADIF definitions, POTA parks, loaders
│   ├── personas/        personas and the service register
│   ├── logging/         the structured, redacted log stream
│   └── app-api/         the public contract for apps: manifest, grants, messages
├── apps/                built-in apps (P8 onward), each self-contained
├── storybook/           the component and pattern gallery (dev only, never shipped)
├── spec/ hdbk/ rvm/     specification, handbook, generated verification matrix
├── docs/                per-Part acceptance registrations (P0.md …) and design notes
├── data/                registers: sign-offs, baseline approvals, sources, story patterns
├── scripts/             the suites and build steps that make verify runs
└── tests/               unit tests
```

## Development patterns

- **A Part starts with its tests.** Register its acceptance tests in `docs/Pn.md` before writing
  its code (`QGD-PRT-0003`).
- **Changing a requirement:** edit `spec/QGD-SPEC-001.md`, then regenerate the RVM with
  `node scripts/gen-rvm.mjs`. Never hand-edit `rvm/` (`QGD-TST-0004`). Every requirement carries a
  Verify method (`QGD-TST-0005`).
- **IPC:** every message is typed, validated against its contract, and rejected rather than
  coerced. Every handler checks its sender (`QGD-SEC-*`, `QGD-PRC-*`).
- **Database:** Drizzle schema and migrations live with the engine. Apps get their own role and
  schema. `sql.raw()` is not used except on a fixed literal (`QGD-SEC-0005`).
- **A new service** for personas is a data change in the service register, not new code paths.
- **A new UI component** arrives with its Storybook story, in both themes (`QGD-FRM-0006`/`0007`).
  Reuse an existing pattern before inventing one.
- **Secrets:** a secret is read only on an explicit user action that needs it, never at startup,
  on navigation or for status (`QGD-CRD-0009`). Intent comes from the user's own input events, not
  from whatever a field happens to hold (`QGD-CRD-0012`).

## Testing

- `make verify` is the gate: unit tests, Rust tests, lint and security checks, Electron smoke
  tests, the packaged app, accessibility (axe), screenshots, Storybook, and more. A green run is
  **evidence, not sign-off.**
- **Prove the check can fail.** Every gate needs a control: a planted defect that makes it fail.
  Several gates in this repository have reported PASS while checking nothing, usually because
  they looked in the wrong place. A gate that finds nothing to check must fail, not pass.
- **Test fixtures stay in their own namespace:** the test Keychain service and the reserved
  test prefix. Fixtures are swept on exit, on interrupt, and at the start of the next run. Never
  use realistic names (such as a field's placeholder text) for fixtures.
- **Screenshot baselines** are compared pixel for pixel. A changed baseline waits for KI7MT's
  approval in `data/baseline-approval.json`; an agent never approves one.
- **Don't loosen an exact assertion** to make an intermittent failure go away. Instrument it and
  find the cause.

## How work is reviewed: three roles, different models

Every change passes through three separate roles before it reaches `develop`. Using **different
models** for them is deliberate: a model is poorest at catching its own blind spots.

| Role | Who (typically) | Job |
|---|---|---|
| **Coder** | The agent doing the Part (for example Claude, as Watson) | Writes the change and its tests, proves each check can fail, gets `make verify` green |
| **Checker** | A second agent, ideally a different model (for example Bob) | Checks the change against the spec and the code: cited IDs exist and say what's claimed, the layer is right, nothing restates a requirement, nothing touches another product's data |
| **Reviewer** | An independent frontier model at high reasoning effort, from a different vendor than the coder (for example `codex review` with Hopper) | An adversarial review of the diff: real defects, gates that check nothing, security and edge cases |

Use **current frontier models at high effort** for the checker and reviewer. As of October 2026
that means models such as GPT-6.1-astra (high), Claude Fable 5.1 (high) or Google's current Gemini.
Versions change, so pick the current ones rather than the names here.

- **Findings are adjudicated against the code,** not accepted on authority. A reviewer can be
  wrong too; say why when a finding is rejected.
- **Stop at the first clean review** that follows real fixes. Don't polish wording in loops.
- **Sign-off is still a person's** (`data/part-signoff.json`), whatever the reviews say.

## Code standards

- **Language:** TypeScript (pinned at 6.0.3 until typescript-eslint supports 7; see
  `QGD-HDBK-001`), Svelte for screens, Rust only in `persona-core` (D-17). No Python anywhere
  (`QGD-CRD-0004`).
- **Dependencies:** runtime dependencies are deliberately few. Each new one is a reviewed
  decision, pinned exactly, installed with `npm ci` (`QGD-SEC-0012`).
- **Security rules:** `QGD-SEC-0001` onward, with `QGD-PRC-0006`, `QGD-CRD-0006` and `QGD-LOG-*`.
  Cryptographic claims use the exact wording in spec §4.3.1, never paraphrased.
- **Review before commit:** run a local `codex review` (or an equivalent independent review)
  before committing. Before Release 1 there are no GitHub pull requests; reviewed work commits
  to `develop`. This changes after a release.
- **Commits:** one logical change each, with a message that says why.

## Key libraries

- **[Electron](https://www.electronjs.org/):** the application runtime
- **[Svelte](https://svelte.dev/)** with **[@podman-desktop/ui-svelte](https://www.npmjs.com/package/@podman-desktop/ui-svelte):** screens and components
- **[Drizzle ORM](https://orm.drizzle.team/)** and **[node-postgres](https://node-postgres.com/):** the database layer
- **[PostgreSQL](https://www.postgresql.org/):** the bundled engine, trimmed
- **[pino](https://getpino.io/):** structured logging
- **[napi-rs](https://napi.rs/):** the Rust native addon bridge
- **[rustls](https://github.com/rustls/rustls)** on **[aws-lc-rs](https://github.com/aws/aws-lc-rs)** (FIPS feature): TLS and cryptography in the core
- **[keyring](https://crates.io/crates/keyring):** the OS credential store
- **[Playwright](https://playwright.dev/), [Vitest](https://vitest.dev/), [axe-core](https://github.com/dequelabs/axe-core), [Storybook](https://storybook.js.org/), [Electronegativity](https://github.com/doyensec/electronegativity):** verification

## Common pitfalls for AI agents

1. **Restating the spec.** Cite the ID; don't copy the text. Verify every citation by grepping
   the spec, never from memory.
2. **Code that drifts from a changed requirement.** When a requirement changes, find and change
   the code, and add a test that would fail if they disagreed.
3. **Gates that look in the wrong place.** Derive scope from the tree, not from a hand-written
   list, and give every gate a control.
4. **Touching another product's data.** Keychain services, directories and files that aren't
   this product's are off limits, in code and in tests.
5. **Printing secrets while debugging.** Use an allowlist of what to print. Redacting by field
   name misses fields you didn't know about.
6. **Approving your own work.** Part sign-offs and screenshot baselines are KI7MT's.
7. **Inventing facts about outside services.** Check the service's own documentation or the live
   endpoint. If something is unknown, say so.
8. **Platform blind spots.** Behaviour can differ under load, on a clean account, or in the
   packaged app versus `npm start`. Test where the user will be.

## Essential commands

```bash
make verify                          # the full gate
node scripts/gen-rvm.mjs             # regenerate the RVM after a spec change
node scripts/gen-rvm.mjs --check     # confirm the RVM matches the spec
grep -n "QGD-CRD-0009" spec/QGD-SPEC-001.md   # read a requirement by ID
```
