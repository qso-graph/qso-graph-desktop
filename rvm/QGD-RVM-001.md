<!-- GENERATED from spec/QGD-SPEC-001.md at `71e9187fa64e90598122b7306967f80eb7c097d6` — hand edits fail `make verify` (QGD-TST-0004); the spec's Verify columns are normative, this matrix is derived. -->

# QSO Graph Desktop — Requirements Verification Matrix (QGD-RVM-001)

> **GENERATED from spec/QGD-SPEC-001.md at `71e9187fa64e90598122b7306967f80eb7c097d6` — hand edits fail `make verify` (QGD-TST-0004); the spec's Verify columns are normative, this matrix is derived.**
>
> 76 requirements · 12 Parts · 1 Demo · 24 Inspection · 26 Static · 37 Test. NASA/SP-2016-6105 Rev 2, Appendix D structure — identifier → method(s). **Automatable** reflects the method the spec declares, not whether a check is implemented yet.

## Requirements

| `QGD-*` | Requirement | Verification method(s) | Automatable |
|---------|-------------|------------------------|:-----------:|
| `QGD-SCP-0001` | The target is a single operator on a single computer. | Inspection |  |
| `QGD-SCP-0002` | The current build platform is **macOS on arm64**, on the M3, and nothing else. | Static | ✓ |
| `QGD-SCP-0003` | **Signing and notarization are deferred, not cancelled.** D-27 stands as the Release 1 intent — SignPath (Windows), Apple Developer ID and notarization (macOS), QSO Graph's own key (Linux). **No Part before Release 1 is gated on a signing identity, a signing pipeline, or a notarized artifact.** | Static | ✓ |
| `QGD-SCP-0004` | **macOS arm64 is the only platform required before Release 1.** Windows and Linux remain Release 1 targets under D-27. No Part's exit gate before Release 1 requires a second operating system, a CI matrix, or a clean VM of another OS. | Static | ✓ |
| `QGD-SCP-0005` | The sequencing in `QGD-SCP-0003` and `QGD-SCP-0004` changes only by KI7MT's direction, recorded here. **An agent may not pull signing or a second platform forward into an earlier Part.** | Inspection |  |
| `QGD-SCP-0006` | Linux distribution through COPR and Launchpad is an **open question**, not a commitment: a bundled Electron runtime, a native addon and a managed PostgreSQL may exceed what those services will build or carry. Resolved before Release 1 packaging, tracked in an issue. | Inspection |  |
| `QGD-PRT-0001` | Operating-system-level components are built before the screens wired to them. | Inspection |  |
| `QGD-PRT-0002` | One Part is in flight at a time. | Inspection |  |
| `QGD-PRT-0003` | Each Part registers its acceptance tests before any of its code is written. | Inspection |  |
| `QGD-PRT-0004` | A Part's exit gate is met on macOS arm64 alone. No gate before Release 1 requires a second operating system or a third-party application. | Static | ✓ |
| `QGD-PRT-0005` | **P0 to P7 are the frame; P8 onward are applications built on the API the frame provides.** A Part in the second group uses the app API and the grant model, never a private route into the frame. | Inspection |  |
| `QGD-REP-0001` | The repository is laid out as `packages/` — `persona-core`, `main`, `preload`, `renderer`, `ui`, `engine`, `reference`, `personas`, `app-api` — and `apps/` — `adif`, `club`, `editor` — each application carrying its own `package.json`, `src/`, `tests/`, README and icon. | Inspection |  |
| `QGD-REP-0002` | The move to that layout happens at `QGD-PRT-0107` and not before. Recording it here is not permission to begin it. | Inspection |  |
| `QGD-REP-0003` | A built-in application uses only the app API and its grants, exactly as a contributed application would. Personas, the engine and the reference data are frame, not applications, because the frame enforces the grants. | Inspection |  |
| `QGD-REP-0004` | `app-api` and `ui` are separate packages: what an application may call and what it may look like are different contracts. | Inspection |  |
| `QGD-CRD-0001` | The credential core is Rust, built as a `napi-rs` native addon. | Static | ✓ |
| `QGD-CRD-0002` | The core owns the OS credential stores, X.509 and PKCS#12 handling, certificate expiry, and the grant model's enforcement point. | Inspection |  |
| `QGD-CRD-0003` | The credential core owns its OS credential-store entry names and sets them explicitly, never leaving them to a library default. | Test | ✓ |
| `QGD-CRD-0004` | **QG Desktop has no Python and no MCP-server interoperability, in any Part, now or later** (KI7MT, 2026-10-08). No requirement, suite, gate or shipped artifact depends on a Python runtime or on `qso-graph-auth`. | Static | ✓ |
| `QGD-CRD-0005` | The credential core is Rust and the shell and frame are TypeScript. | Inspection |  |
| `QGD-CRD-0006` | A credential never appears in a log, an error message, an IPC payload rendered to a screen, or a report. | Static | ✓ |
| `QGD-CRD-0007` | The renderer never holds a credential and never opens a network connection. | Static, Test | ✓ |
| `QGD-CRD-0008` | The OS credential manager is the only store in Release 1. A user's own Vault is a later Part. | Inspection |  |
| `QGD-PII-0001` | Club rosters are personal data. A real roster never enters this repository, its history, or CI output. Test fixtures are synthetic or anonymized. | Static | ✓ |
| `QGD-PII-0002` | Round-trip and comparison tests report positions and lengths, never field values, so a failing diff cannot leak a member's details. | Test | ✓ |
| `QGD-PII-0003` | Roster field values are never written to logs, `report.md`, telemetry, or error messages. | Static, Test | ✓ |
| `QGD-PII-0004` | Sharing or exporting a roster is an explicit user action, never a side effect of opening, validating or saving a file. | Test | ✓ |
| `QGD-PII-0005` | A club customises by **defining lists** — offices, membership classes, net roles, award categories — and by assigning members to them with dates, so history is kept. A club never adds fields: the schema is the same for every club. | Inspection, Test | ✓ |
| `QGD-PII-0006` | Club data on a user's machine is theirs. Nothing is collected, no telemetry is sent, and no feature pushes another person's details to a shared or public service. | Static, Inspection | ✓ |
| `QGD-PRC-0001` | Every risky job runs in its own process, so a crash in one never takes the application down. | Test | ✓ |
| `QGD-PRC-0002` | The renderer holds screens only — no credentials, no network. | Static, Test | ✓ |
| `QGD-PRC-0003` | The main process is windows and the IPC broker only. | Inspection |  |
| `QGD-PRC-0004` | The credential core, station I/O, and the engine supervisor each run as their own utility process. | Inspection |  |
| `QGD-PRC-0005` | IPC is a typed contract; malformed messages are rejected, not coerced. | Test | ✓ |
| `QGD-PRC-0006` | Context isolation and the sandbox are enabled; Node is absent from the renderer; new windows are denied; outbound fetch from the renderer is refused. | Test | ✓ |
| `QGD-LOG-0001` | Every process logs as structured JSON lines into one stream: the TypeScript side through `pino`, the Rust core's `tracing` output forwarded into the same stream, and the engine's own log carried under the same controls. | Test | ✓ |
| `QGD-LOG-0002` | Logs stay on the machine, in the operating system's standard log folder. Nothing is transmitted; there is no telemetry. | Static, Test | ✓ |
| `QGD-LOG-0003` | Redaction happens in the logger, by field name, so a caller cannot forget it. | Test | ✓ |
| `QGD-LOG-0004` | The credential core never hands a secret to a logger. | Static, Test | ✓ |
| `QGD-LOG-0005` | The log folder is inside the sentinel scan's coverage, under `QGD-CRD-0006`. | Test | ✓ |
| `QGD-LOG-0006` | Log files rotate by size. | Test | ✓ |
| `QGD-LOG-0007` | The log folder has a hard total cap; when it is exceeded the oldest file is removed first. | Test | ✓ |
| `QGD-LOG-0008` | Logs are retained by age, and older ones are removed. | Test | ✓ |
| `QGD-LOG-0009` | The default level is `info`. | Test | ✓ |
| `QGD-LOG-0010` | A raised debug level reverts on its own, both after a set time and at restart, so it cannot be left on. | Test | ✓ |
| `QGD-LOG-0011` | The engine's log is held inside the same size, total and retention caps. | Test | ✓ |
| `QGD-LOG-0012` | Exporting diagnostics produces one redacted archive for the user to send. Nothing leaves the machine unless the user sends it. | Test | ✓ |
| `QGD-LOG-0013` | Settings carries a Logs page with a level switch and the export action. Its surface lands with the shell in `QGD-PRT-0103`; the behaviour it drives is `QGD-LOG-0009`–`QGD-LOG-0012`. | Demo |  |
| `QGD-ENG-0001` | PostgreSQL is the database, provided by the frame as a substrate service rather than by an application. Per-application roles are how the grant model reaches the data, and several processes connect at once. | Inspection |  |
| `QGD-ENG-0002` | Drizzle is the database layer: a TypeScript schema, SQL-like queries and generated migrations. | Inspection |  |
| `QGD-ENG-0003` | Simple settings — theme, window size and the like — live in a settings file rather than the database, so the application starts before the engine is up. | Test | ✓ |
| `QGD-SEC-0001` | No `eval`, no `new Function`, and no string-form timer. | Static | ✓ |
| `QGD-SEC-0002` | No `child_process.exec` and no `shell: true`. A child process is started with `spawn` or `execFile` and an argument array. | Static | ✓ |
| `QGD-SEC-0003` | No dynamic `require` or `import` of a path built from input. | Static | ✓ |
| `QGD-SEC-0004` | A file path derived from input is checked against traversal before it is used. | Test | ✓ |
| `QGD-SEC-0005` | Drizzle's `sql.raw()` is not used, except on a fixed literal that carries no input. | Static | ✓ |
| `QGD-SEC-0006` | Every IPC message, file input and API response is validated against a schema and **rejected, never coerced**, including keys that would pollute a prototype. | Test | ✓ |
| `QGD-SEC-0007` | The preload exposes named functions only. It never exposes `ipcRenderer`, a generic send, or anything that forwards an arbitrary channel. | Static, Test | ✓ |
| `QGD-SEC-0008` | The content security policy forbids `unsafe-eval`, inline scripts and remote script sources. | Static, Test | ✓ |
| `QGD-SEC-0009` | `shell.openExternal` is called only with an allowlisted `https://` URL. | Static, Test | ✓ |
| `QGD-SEC-0010` | The Electron fuses stay set in a packaged build. | Test | ✓ |
| `QGD-SEC-0011` | No `{@html}` with content that did not come from this application. | Static | ✓ |
| `QGD-SEC-0012` | The lockfile is committed and installs use `npm ci`. Dependencies on the credential, crypto, IPC and packaging paths are pinned exactly, a new dependency is a decision someone reviewed, and an audit finding is fixed rather than carried. | Static, Inspection | ✓ |
| `QGD-SEC-0013` | `make verify` runs the ESLint security rules, `svelte/no-at-html-tags`, and the `sql.raw` ban. | Test | ✓ |
| `QGD-SEC-0014` | `make verify` runs Electronegativity against the packaged application. | Test | ✓ |
| `QGD-SEC-0015` | A cryptographic claim uses the wording in this section exactly, and the wording that applies to the platform the artifact runs on. | Static, Inspection | ✓ |
| `QGD-SEC-0016` | **Never** "FIPS compliant", "FIPS certified", "FIPS approved application", or "validated" for any module version or platform that is not on a CMVP certificate. | Static | ✓ |
| `QGD-SEC-0017` | Release evidence records the built module version, the crate version, the platform, and the CMVP validated and submitted lists with the date they were checked. | Test | ✓ |
| `QGD-SEC-0018` | When a 4.x module version is CMVP-validated, `aws-lc-rs` is pinned to exactly that version and the wording steps up to "validated". An older validated version is not pinned in the meantime. | Inspection |  |
| `QGD-TST-0001` | One command, `make verify`, runs every check and produces the report. | Test | ✓ |
| `QGD-TST-0002` | `make verify` exits non-zero on any failure. | Test | ✓ |
| `QGD-TST-0003` | The report records pending acceptance evidence honestly — a gate not yet met is reported as not met, never as passed or omitted. | Inspection |  |
| `QGD-TST-0004` | `QGD-RVM-001.md` is generated from this document's Verify columns. A hand-edited RVM fails `make verify`. | Test | ✓ |
| `QGD-TST-0005` | Every requirement in this document carries at least one Verify method. `make verify` fails if one does not. | Static | ✓ |
| `QGD-TST-0006` | Security tests pass before any artifact is published outside this machine. | Test | ✓ |
| `QGD-TST-0007` | A failure of the credential round-trip in `QGD-PRT-0100` stops only the suites that use the OS credential store; `make verify` reports those as not run, and still runs and reports every suite that does not use it, including the build and the packaging step. | Test | ✓ |

## Parts

| Part | `QGD-*` | What | Exit gate |
|------|---------|------|-----------|
| P0 | `QGD-PRT-0100` | Rust persona core (`napi-rs`), OS credential manager only, keyring naming convention | The core loads in Node and round-trips a credential through the macOS Keychain, unattended: write, read back, replace, select, delete, and the entry named by the convention |
| P1 | `QGD-PRT-0101` | A window that calls the core and shows a persona on screen | `npm start` opens a window on the M3 showing persona metadata and **credential status** (stored / present, never the value) obtained through the Rust core. The secret round-trip is proven in the core's Keychain round-trip under `QGD-PRT-0100`, never on screen — see `QGD-CRD-0006`, `QGD-CRD-0007` |
| P2 | `QGD-PRT-0102` | Process map: main as IPC broker, utility processes, typed IPC contract; application logging | Killing a utility process leaves the window running and the process recovers; malformed IPC is rejected. Every process logs into one redacted JSON-lines stream held inside the size, total and retention caps, and a raised level reverts on its own |
| P3 | `QGD-PRT-0103` | Shell: rail, pages, Settings, status bar, themes | e2e navigation; screenshot baselines approved by KI7MT; axe clean |
| P4 | `QGD-PRT-0104` | Engine: bundled PostgreSQL, lifecycle, data directory, free port, roles per app, backup and restore, migrations | Engine starts on a free port; restore works; migrations apply |
| P5 | `QGD-PRT-0105` | Reference data: ADIF definitions (`all.json`), CQ and ITU zones, DOKs, and the validation built from them | The reference data loads into the engine and the validation built from it answers ADIF's own cases |
| P6 | `QGD-PRT-0106` | QG Personas: personas, service profiles, guided setup and a test per credential, expiry warnings, encrypted export and import | KI7MT walks setup on a clean machine; export round-trips |
| P7 | `QGD-PRT-0107` | App runtime, official tier, grant model, over the message API — the app API | An app without a grant is refused; proven by a no-credential app (solar) and a granted one (QRZ lookup); and by a test application that uses the API and nothing else |
| P8 | `QGD-PRT-0108` | QG ADIF: `all.json` load, validation, import and export of `.adi` files. **Files only; no QSO storage** | ADIF's test QSOs pass; an anonymized copy of KI7MT's log round-trips, equal except documented fields |
| P9 | `QGD-PRT-0109` | QG Club: club definition and roster | The field canvas's cases load |
| P10 | `QGD-PRT-0110` | QG Editor: **generate, validate and maintain** a club's `.cli` (club information) and `.prf` (roster) files in NetLogger's own format — the authoring tool clubs currently do not have | A club with no file generates a valid one; a file carrying headers copied from another club's file is detected and reported; synthetic fixtures round-trip byte for byte where the user did not edit |
| P11 | `QGD-PRT-0111` | Updates and onboarding | An update installs on a clean machine |
