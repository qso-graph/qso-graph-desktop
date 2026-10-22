# AI Agent Guide for QSO Graph Desktop Development

This guide is for AI coding assistants (Claude, Codex, Copilot and the like) helping develop
**QSO Graph Desktop**: writing code and tests, reviewing changes, and triaging issues in this
repository. Human contributors are welcome to read it too.

`spec/QGD-SPEC-001.md` is the **only normative document**. This guide orients you and points at
requirement IDs; it never restates them. A second copy of a requirement is a defect, because the
two copies will eventually disagree (`QGD-SPEC-001` §0.1). Rationale lives in
`hdbk/QGD-HDBK-001.md`. When this guide and the spec seem to differ, the spec wins and this guide
has a bug.

**Read the spec's §0.2 Invariants and §0.3 Conventions before anything else.** They are what is
always true of this product (`QGD-INV-*`) and how every value is written (`QGD-CNV-*`): a callsign
uppercase throughout, a zone with no leading zero, a county as `ID,Ada`. Check new code, an app or
an extension against both; they exist so nobody has to rediscover them.

## Who you are helping

- **Audience:** contributors building the product, not end users. Be direct and technical.
- **The users of the product** are amateur radio operators, most of them not developers. Screens,
  messages and onboarding are written for them: plain words, no jargon, no developer workflows.
- **Authority:** KI7MT decides scope, order and product questions, signs off each Part, and
  approves screenshot baselines. An agent never records a sign-off or approves a baseline.

## The product, in one paragraph

QSO Graph Desktop is an extensible Electron desktop platform for hams: a **core** that
**extensions** build on, layered and named the way Podman Desktop and VS Code are. The **core**
(Parts P0–P7) holds only what every extension needs and what protects the user: the Rust
**credential core**, the process map, the shell, storage (SQLite files the core opens in one utility
process), reference data, personas, and the **extension API** with its grants. **Extensions** (P8
onward) do the ham work and reach the core only through the extension API, exactly as a third-party
extension would (`QGD-PRT-0005`, `QGD-REP-0003`). They come as **built-in**, **official** (ours,
installed by choice) or **third-party**: spec §4.5 has the table, `QGD-HDBK-001` §14 the reasons.
The build order is the catalogue in spec §2.1 and nowhere else.

Two words to keep apart: **the core** is the platform; **the credential core** is the Rust addon
in `packages/persona-core`. Never call the second one "the core".

The code uses the same words (`packages/extension-api`, `extensions/`, the extension broker), renamed
in one pass in `qso-graph-desktop#34`. Requirement IDs keep the `QGD-APP` prefix and registered test
IDs keep their names: an identifier that changes breaks every reference to it.

## Mental model for any change

Know which layer a change belongs to, then read that layer's requirements before writing code.
This section is navigation; the requirements themselves are in the spec.

| If the change touches… | It belongs in… | Read first |
|---|---|---|
| Credentials, outbound network, cryptography | `persona-core` (Rust) | `QGD-CRD-*`, `QGD-SEC-0020`, §4.3.1 |
| Windows, IPC brokering, process supervision | `main` | `QGD-PRC-*`, `QGD-SEC-*` |
| Screens and components | `renderer`, `ui` | `QGD-FRM-*`, `QGD-CRD-0007`, `QGD-PRC-0006` |
| Storage, schema, migrations, reference data files | `storage` | `QGD-ENG-*` |
| Reference data (ADIF, POTA…) | `reference` | `QGD-REF-*` |
| Personas and services | `personas` | `QGD-PSN-*` |
| Anything a ham *does* | an extension in `extensions/`, through `extension-api` only | `QGD-APP-*`, `QGD-REP-0003` |

Four things are easy to get wrong, so check them on every change:

- **Whose data is it?** This product's own names, directories and files only. See `QGD-CRD-0003`
  and `QGD-CRD-0004` before touching storage or the credential store.
- **Who connects out?** See `QGD-SEC-0020` before adding anything that talks to a network.
- **Whose identity?** See `QGD-PSN-0012` before integrating any outside service.
- **What can't it do?** See `QGD-PSN-0013` before writing setup or error text for a service that
  can't be reached.

## Quick start

```bash
make setup      # npm ci, plus the pinned ADIF release (verified) and POTA's lists
make verify     # every check; writes report/. Must be green before a commit
make start      # build and run the app
make package    # a packaged .app in build output (no installer)
make installer  # the installer
```

macOS on Apple silicon is the primary platform, and CI builds and tests Windows and Linux (x64 and
arm64) on every push (`QGD-SCP-0002`). Code that touches the system goes through each platform's
own tool: `scripts/platform-process.mjs` for processes, `credential-store.ts` for the store's name.
The floor is a Raspberry Pi 5 (`QGD-SCP-0009`); Linux packages target glibc 2.28 (`QGD-SCP-0008`).

## Codebase structure

```text
qso-graph-desktop/
├── packages/            the core (P0–P7); extensions may depend only on extension-api and ui
│   ├── persona-core/    Rust (napi-rs): OS credential store, outbound HTTPS, crypto
│   ├── main/            Electron main: windows, IPC brokers, process supervision
│   ├── preload/         the only bridge to the renderer: named, typed functions
│   ├── renderer/        the Svelte shell and pages
│   ├── ui/              shared Svelte components and patterns
│   ├── storage/         SQLite through node:sqlite: QG Storage, the adapter, migrations, reference.sqlite
│   ├── reference/       reference data: ADIF definitions, POTA parks, loaders
│   ├── personas/        personas and the service register
│   ├── logging/         the structured, redacted log stream
│   └── extension-api/   the extension API: manifest, grants, messages
├── extensions/          built-in extensions (P8 onward), each self-contained
├── storybook/           the component and pattern gallery (dev only, never shipped)
├── spec/ hdbk/ rvm/     specification, handbook, generated verification matrix
├── docs/                per-Part acceptance registrations (P0.md …) and design notes
├── data/                registers: sign-offs, baseline approvals, sources, story patterns
├── scripts/             the suites and build steps that make verify runs
└── tests/               unit tests
```

## Development patterns

### Reference check first

**Before designing any extension or core feature, read how Podman Desktop, VS Code
and Bitwarden desktop do something similar, and design from that evidence** (KI7MT, 2026-10-10).
Open-source references only — a closed-source product's behaviour cannot be read, only guessed at.

- **Read their code or their CI, and cite file paths.** Not a marketing page, not a blog post, not
  a recollection. `gh api repos/<owner>/<repo>/contents/<path>` and a fetch of the file are enough.
  A docs page is acceptable for a thing their docs are the authority on — where a button is in
  their own UI — and says so when cited.
- **Record the findings where the work is**, in the issue or the spec, so the next person reads the
  evidence rather than repeating the search.
- **Where the three disagree, say so and let KI7MT decide.** Do not average them.
- **A pattern none of them uses is labelled novel, with the reason** it is novel here. Novel is
  allowed; unexamined is not.

What each is a reference for:

| Reference | What to read it for |
|---|---|
| Podman Desktop | the shell, extensions and their API, providers, the status bar, troubleshooting |
| VS Code | the extension model, commands and keybindings, settings, trust |
| Bitwarden desktop | Electron with a Rust `napi` security core — the same shape as this product |

Worked example, from the 2026-10-10 cleanup: the per-grant permission list in Settings was deleted
because VS Code has no per-permission screen for extensions at all and asks once whether a
publisher is trusted; the logs and storage's detail moved behind a status-bar affordance because that
is where Podman Desktop keeps Troubleshooting, with its Logs tab and "collect logs as .zip"; and
export of personas moved out of preferences because Bitwarden keeps vault export under the
application's own menu. Podman Desktop's `extensions/` directory holds nine real shipped features
and no demonstration extension, which is why this repository now has none either.

- **A Part starts with its tests.** Register its acceptance tests in `docs/Pn.md` before writing
  its code (`QGD-PRT-0003`).
- **Changing a requirement:** edit `spec/QGD-SPEC-001.md`, then regenerate the RVM with
  `node scripts/gen-rvm.mjs`. Never hand-edit `rvm/` (`QGD-TST-0004`). Every requirement carries a
  Verify method (`QGD-TST-0005`).
- **IPC:** every message is typed, validated against its contract, and rejected rather than
  coerced. Every handler checks its sender (`QGD-SEC-*`, `QGD-PRC-*`).
- **Storage:** SQLite, opened only by QG Storage (`QGD-ENG-0006`), through Drizzle and one
  adapter (`packages/storage/sqlite.ts`). SQL text reaches SQLite only there and in
  `migrate.ts`; everywhere else `prepare()`/`exec()` take a fixed literal and `sql.raw()` is not
  used (`QGD-SEC-0005`). A caught error goes through `reduce()` before it is used anywhere, and
  `.message` is never read in storage code (`QGD-ENG-0016`). Extensions get their own folder and
  database, reached only through the API (`QGD-ENG-0018`, `QGD-APP-0009`). `reference.sqlite` is
  derived, never migrated: change its schema and raise `REFERENCE_SCHEMA_VERSION`
  (`QGD-ENG-0015`).
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
- **Screenshot baselines** are compared within two shades per colour (KI7MT, 2026-10-22: rendering noise is not the product; `baselines/README.md`). A changed baseline waits for KI7MT's
  approval in `data/baseline-approval.json`; an agent never approves one.
- **Don't loosen an exact assertion** to make an intermittent failure go away. Instrument it and
  find the cause.

## How work is reviewed: three roles, different models

Every change passes through three separate roles before it reaches `develop`. Using **different
models** for them is deliberate: a model is poorest at catching its own blind spots.

| Role | Who (typically) | Job |
|---|---|---|
| **Coder** | The agent doing the Part (for example Claude) | Writes the change and its tests, proves each check can fail, gets `make verify` green |
| **Checker** | A second agent, ideally a different model | Checks the change against the spec and the code: cited IDs exist and say what's claimed, the layer is right, nothing restates a requirement, nothing touches another product's data |
| **Reviewer** | An independent frontier model at high reasoning effort, from a different vendor than the coder (for example `codex review`) | An adversarial review of the diff: real defects, gates that check nothing, security and edge cases |

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
- **[Drizzle ORM](https://orm.drizzle.team/)** (its SQLite dialect, through `sqlite-proxy`): the database layer
- **[SQLite](https://sqlite.org/)** through Node's **`node:sqlite`**, as Electron carries it: storage, with no server
- **[pino](https://getpino.io/):** structured logging
- **[napi-rs](https://napi.rs/):** the Rust native addon bridge
- **[rustls](https://github.com/rustls/rustls)** on **[aws-lc-rs](https://github.com/aws/aws-lc-rs)** (FIPS feature): TLS and cryptography in the credential core
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
make check                           # the development pass: 9 suites, ~10 seconds
make verify                          # the full gate: every suite, and the only thing that reports
node scripts/gen-rvm.mjs             # regenerate the RVM after a spec change
node scripts/gen-rvm.mjs --check     # confirm the RVM matches the spec — the whole gate for a prose spec edit
grep -n "QGD-CRD-0009" spec/QGD-SPEC-001.md   # read a requirement by ID
```

**Use `make check` while working and `make verify` before a sign-off.** The split
follows Podman Desktop and VS Code, which run lint, typecheck and unit tests on every
change and push the expensive end-to-end set to `main` or a nightly schedule
(`podman-desktop/.github/workflows/pr-check.yaml` against `e2e-main.yaml`;
`microsoft/vscode/.github/workflows/pr.yml` against the per-platform `pr-*-test.yml`).
Nothing was removed — `make verify` still runs every check (`QGD-TST-0001`), and it is
still the only command that writes `report/`, so a development pass cannot be mistaken
for a verification.

Which half a suite falls in is derived from its own script, never listed: a suite is
slow if it drives a window, builds or audits a package, reads the operator's credential
store, or builds the gallery. `tests/suite-speed.test.mjs` holds the derivation to known
cases, because the way two sets fail is by quietly stopping adding up.

And match the gate to the change. A prose edit to the spec needs
`node scripts/gen-rvm.mjs --check` and nothing else — nothing in `tests/` reads the
spec. Running thirty-one suites to check a paragraph is how an afternoon disappears.
