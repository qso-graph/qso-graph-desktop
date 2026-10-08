<!-- GENERATED from spec/QGD-SPEC-001.md at `7ac550b2b6987f5b1b19cdbb8853d5c8a20970b2` — hand edits fail `make verify` (QGD-TST-0004); the spec's Verify columns are normative, this matrix is derived. -->

# QSO Graph Desktop — Requirements Verification Matrix (QGD-RVM-001)

> **GENERATED from spec/QGD-SPEC-001.md at `7ac550b2b6987f5b1b19cdbb8853d5c8a20970b2` — hand edits fail `make verify` (QGD-TST-0004); the spec's Verify columns are normative, this matrix is derived.**
>
> 35 requirements · 12 Parts · 12 Inspection · 9 Static · 16 Test. NASA/SP-2016-6105 Rev 2, Appendix D structure — identifier → method(s). **Automatable** reflects the method the spec declares, not whether a check is implemented yet.

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
| `QGD-PRT-0004` | A Part's exit gate is met on macOS arm64 alone, except where the gate names an external application that does not run on macOS — P10's NetLogger check is the only such case. | Static | ✓ |
| `QGD-CRD-0001` | The credential core is Rust, built as a `napi-rs` native addon. | Static | ✓ |
| `QGD-CRD-0002` | The core owns the OS credential stores, X.509 and PKCS#12 handling, certificate expiry, and the grant model's enforcement point. | Inspection |  |
| `QGD-CRD-0003` | The keyring naming convention is the contract between the core and `qso-graph-auth`; entry names are set explicitly, never left to a library default. | Test | ✓ |
| `QGD-CRD-0004` | The desktop writes a credential and `qso-graph-auth` reads it back, and the reverse, on macOS. *(proof test 1)* | Test | ✓ |
| `QGD-CRD-0005` | `qso-graph-auth` remains Python; the shell and frame remain TypeScript. The convention is the contract, so the languages either side of it are free. | Inspection |  |
| `QGD-CRD-0006` | A credential never appears in a log, an error message, an IPC payload rendered to a screen, or a report. | Static | ✓ |
| `QGD-CRD-0007` | The renderer never holds a credential and never opens a network connection. | Static, Test | ✓ |
| `QGD-CRD-0008` | The OS credential manager is the only store in Release 1. A user's own Vault is a later Part. | Inspection |  |
| `QGD-CRD-0009` | `qso-graph-auth` is the cross-language oracle for the keyring naming convention. It is exercised **from source at build time**, never vendored, pinned, mocked or stubbed. | Test | ✓ |
| `QGD-CRD-0010` | The interop proof runs both directions in one pass: the core writes and `qso-graph-auth` reads, then `qso-graph-auth` writes and the core reads. A one-direction proof does not satisfy `QGD-CRD-0004`. | Test | ✓ |
| `QGD-CRD-0011` | `qso-graph-auth` validates the persona index format as well as the credential entries; the two sides agree on both. | Test | ✓ |
| `QGD-CRD-0012` | **If the credential path fails, verification halts.** No suite after the interop proof is run or reported, because nothing in the application is meaningful when credentials do not work. | Test | ✓ |
| `QGD-CRD-0013` | No secret appears in the persona index, in a credential status result, or in any failure message from the interop proof. | Test | ✓ |
| `QGD-PRC-0001` | Every risky job runs in its own process, so a crash in one never takes the application down. | Test | ✓ |
| `QGD-PRC-0002` | The renderer holds screens only — no credentials, no network. | Static, Test | ✓ |
| `QGD-PRC-0003` | The main process is windows and the IPC broker only. | Inspection |  |
| `QGD-PRC-0004` | The credential core, station I/O, and the engine supervisor each run as their own utility process. | Inspection |  |
| `QGD-PRC-0005` | IPC is a typed contract; malformed messages are rejected, not coerced. | Test | ✓ |
| `QGD-PRC-0006` | Context isolation and the sandbox are enabled; Node is absent from the renderer; new windows are denied; outbound fetch from the renderer is refused. | Test | ✓ |
| `QGD-TST-0001` | One command, `make verify`, runs every check and produces the report. | Test | ✓ |
| `QGD-TST-0002` | `make verify` exits non-zero on any failure. | Test | ✓ |
| `QGD-TST-0003` | The report records pending acceptance evidence honestly — a gate not yet met is reported as not met, never as passed or omitted. | Inspection |  |
| `QGD-TST-0004` | `QGD-RVM-001.md` is generated from this document's Verify columns. A hand-edited RVM fails `make verify`. | Test | ✓ |
| `QGD-TST-0005` | Every requirement in this document carries at least one Verify method. `make verify` fails if one does not. | Static | ✓ |
| `QGD-TST-0006` | Security tests pass before any artifact is published outside this machine. | Test | ✓ |

## Parts

| Part | `QGD-*` | What | Exit gate |
|------|---------|------|-----------|
| P0 | `QGD-PRT-0100` | Rust persona core (`napi-rs`), OS credential manager only, keyring naming convention | The core loads in Node and round-trips a credential through the macOS Keychain; interop test passes both directions |
| P1 | `QGD-PRT-0101` | A window that calls the core and shows a persona on screen | `npm start` opens a window on the M3 showing persona metadata and **credential status** (stored / present, never the value) obtained through the Rust core. The secret round-trip is proven in the core's interop test under `QGD-CRD-0004`, never on screen — see `QGD-CRD-0006`, `QGD-CRD-0007` |
| P2 | `QGD-PRT-0102` | Process map: main as IPC broker, utility processes, typed IPC contract | Killing a utility process leaves the window running and the process recovers; malformed IPC is rejected |
| P3 | `QGD-PRT-0103` | Shell: rail, pages, Settings, status bar, themes | e2e navigation; screenshot baselines approved by KI7MT; axe clean |
| P4 | `QGD-PRT-0104` | Engine: bundled PostgreSQL, lifecycle, data directory, free port, roles per app, backup and restore, migrations | Engine starts on a free port; restore works; migrations apply |
| P5 | `QGD-PRT-0105` | QG Personas: personas, service profiles, guided setup and a test per credential, expiry warnings, encrypted export and import | KI7MT walks setup on a clean machine; export round-trips |
| P6 | `QGD-PRT-0106` | App runtime, official tier, grant model, over the message API | An app without a grant is refused; proven by a no-credential app (solar) and a granted one (QRZ lookup) |
| P7 | `QGD-PRT-0107` | Logbook store: QSO schema in ADIF fields, stable unique ID and last-changed time from the first row written | Rows carry ID and last-changed from the first write; 49,233 synthetic QSOs load within budget |
| P8 | `QGD-PRT-0108` | QG ADIF: `all.json` load, validation, import and export | ADIF's test QSOs pass; an anonymized copy of KI7MT's log round-trips, equal except documented fields |
| P9 | `QGD-PRT-0109` | QG Club: club definition and roster | The field canvas's cases load |
| P10 | `QGD-PRT-0110` | QG Editor: open, edit and save a club's NetLogger `.cli` and `.prf` files in NetLogger's own format | Synthetic fixtures round-trip byte for byte when unchanged; an edited file loads in NetLogger |
| P11 | `QGD-PRT-0111` | Updates and onboarding | An update installs on a clean machine |
