---
title: "QGD-SPEC-001 — QSO Graph Desktop Specification"
doc_type: specification
status: draft
version: v0.1.0
date: 2026-10-07
license: GPL-3.0-only
copyright: "Copyright (c) 2026 Agentics Labs LLC"
authors:
  - "Gregory A. Beam (KI7MT)"
companion_to: ../hdbk/QGD-HDBK-001.md
---

# QGD-SPEC-001 — QSO Graph Desktop Specification

> **This is the only normative document for QSO Graph Desktop.** It is what gets built and
> audited against. `QGD-HDBK-001` carries the rationale and **cites these IDs by number; it
> never restates them.** `QGD-RVM-001` is **generated** from the Verify column below —
> hand edits to it fail `make verify`.
>
> Structure follows `FIDUCIAL-MESH-SPEC-001`, which carries 157 requirements across 395K
> characters without self-contradiction. Length is not the constraint; **addressability is.**
> Requirements are reached by grepping an ID, never by reading this file end to end.

## 0.1 How this document works

**One fact, one place.** Every normative statement lives here exactly once, with an ID. No
other document — handbook, decision log, build-order note, brief, README, or issue — may
restate a requirement. They cite the ID. A second copy of a fact is a defect, because the
two copies will eventually disagree and nothing mechanical will notice.

> This rule exists because its absence has already cost this project a build. A build-order
> decision and the Part catalogue that encoded it were written into two documents in a single
> commit, contradicting each other on arrival. Four review passes by three agents did not see
> it, because each pass reviewed one file's diff. See `QGD-HDBK-001` §1 for the full account.

**ID shape:** `QGD-<AREA>-NNNN`, with sub-IDs as `NNNN.N` for requirements that refine a parent.

| Area | Covers |
|---|---|
| `QGD-SCP` | Scope, platform, what is and is not being built |
| `QGD-PRT` | Part catalogue — build order and per-Part exit gates |
| `QGD-CRD` | Credential core, persona storage, grants |
| `QGD-PRC` | Process map and IPC |
| `QGD-FRM` | Frame, shell, apps |
| `QGD-ENG` | Database engine |
| `QGD-TST` | Test, verification, release |

**Verify methods**, per NASA/SP-2016-6105 Rev 2 App. D, same as FM's RVM:

| Method | Meaning |
|---|---|
| `Test` | An automated test asserts it; `make verify` runs it |
| `Static` | A script or linter checks it mechanically without running the app |
| `Demo` | Observable by running the app and looking at it |
| `Inspection` | A human reads the artifact and judges |

Every requirement carries one or more. A requirement with no verification method is not a
requirement — it is an opinion, and it does not belong here.

## 1. Scope

| ID | Requirement | Verify |
|---|---|---|
| `QGD-SCP-0001` | The target is a single operator on a single computer. | Inspection |
| `QGD-SCP-0002` | The current build platform is **macOS on arm64**, on the M3, and nothing else. | Static |
| `QGD-SCP-0003` | **Code signing and notarization are out of scope.** No Part depends on a signing identity, a signing pipeline, or a notarized artifact. | Static |
| `QGD-SCP-0004` | **Windows and Linux are out of scope.** No Part's exit gate requires a second operating system, a CI matrix, or a clean VM of another OS. | Static |
| `QGD-SCP-0005` | A platform or signing requirement re-enters scope only when KI7MT asks for it, by an edit to this section. An agent may not reintroduce one. | Inspection |

> `QGD-SCP-0003` and `QGD-SCP-0004` are stated as prohibitions because both were introduced
> by agents and reached a locked specification without ever being requested. Rationale:
> `QGD-HDBK-001` §2.

## 2. Part catalogue

**This table is the build order. It is the only build order.** No other document states,
summarizes, or re-sequences it. A document that needs to refer to the order cites
`QGD-PRT-NNNN`.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PRT-0001` | Operating-system-level components are built before the screens wired to them. | Inspection |
| `QGD-PRT-0002` | One Part is in flight at a time. | Inspection |
| `QGD-PRT-0003` | Each Part registers its acceptance tests before any of its code is written. | Inspection |
| `QGD-PRT-0004` | A Part's exit gate is met on macOS arm64 alone. | Static |

### 2.1 Parts

| Part | ID | What | Depends on | Exit gate |
|---|---|---|---|---|
| **P0** | `QGD-PRT-0100` | Rust persona core (`napi-rs`), OS credential manager only, keyring naming convention | — | The core loads in Node and round-trips a credential through the macOS Keychain; interop test passes both directions |
| **P1** | `QGD-PRT-0101` | A window that calls the core and shows a persona on screen | P0 | `npm start` opens a window on the M3 showing persona metadata and **credential status** (stored / present, never the value) obtained through the Rust core. The secret round-trip is proven in the core's interop test under `QGD-CRD-0004`, never on screen — see `QGD-CRD-0006`, `QGD-CRD-0007` |
| **P2** | `QGD-PRT-0102` | Process map: main as IPC broker, utility processes, typed IPC contract | P1 | Killing a utility process leaves the window running and the process recovers; malformed IPC is rejected |
| **P3** | `QGD-PRT-0103` | Shell: rail, pages, Settings, status bar, themes | P2 | e2e navigation; screenshot baselines approved by KI7MT; axe clean |
| **P4** | `QGD-PRT-0104` | Engine: bundled PostgreSQL, lifecycle, data directory, free port, roles per app, backup and restore, migrations | P2 | Engine starts on a free port; restore works; migrations apply |
| **P5** | `QGD-PRT-0105` | QG Personas: personas, service profiles, guided setup and a test per credential, expiry warnings, encrypted export and import | P0, P4 | KI7MT walks setup on a clean machine; export round-trips |
| **P6** | `QGD-PRT-0106` | App runtime, official tier, grant model, over the message API | P5 | An app without a grant is refused; proven by a no-credential app (solar) and a granted one (QRZ lookup) |
| **P7** | `QGD-PRT-0107` | Logbook store: QSO schema in ADIF fields, stable unique ID and last-changed time from the first row written | P4, P6 | Rows carry ID and last-changed from the first write; 49,233 synthetic QSOs load within budget |
| **P8** | `QGD-PRT-0108` | QG ADIF: `all.json` load, validation, import and export | P7 | ADIF's test QSOs pass; an anonymized copy of KI7MT's log round-trips, equal except documented fields |
| **P9** | `QGD-PRT-0109` | QG Club: club definition and roster | P8 | The field canvas's cases load |
| **P10** | `QGD-PRT-0110` | QG Editor: open, edit and save a club's NetLogger `.cli` and `.prf` files in NetLogger's own format | P9 | Synthetic fixtures round-trip byte for byte when unchanged; an edited file loads in NetLogger |
| **P11** | `QGD-PRT-0111` | Updates and onboarding | P5–P10 | An update installs on a clean machine |

**Release 1 = P0–P11.**

**After Release 1**, each its own Part in an order KI7MT sets: QG Reference, QG Log, QG Net,
the representative spike, QG NCS, LoTW signing, the contributed tier and sandbox, QG Spots,
QG Rig, the Vault store, QG Sync, QG Atlas, QG Predict, QG Chat, and QG Awards once "awards"
is defined.

> The persona core is P0 and the shell is P3 because `QGD-PRT-0001` says operating-system-level
> components come first. Rationale: `QGD-HDBK-001` §2. Any document placing the shell ahead of
> the core contradicts `QGD-PRT-0001` and is wrong by this specification.

## 3. Credential core

| ID | Requirement | Verify |
|---|---|---|
| `QGD-CRD-0001` | The credential core is Rust, built as a `napi-rs` native addon. | Static |
| `QGD-CRD-0002` | The core owns the OS credential stores, X.509 and PKCS#12 handling, certificate expiry, and the grant model's enforcement point. | Inspection |
| `QGD-CRD-0003` | The keyring naming convention is the contract between the core and `qso-graph-auth`; entry names are set explicitly, never left to a library default. | Test |
| `QGD-CRD-0004` | The desktop writes a credential and `qso-graph-auth` reads it back, and the reverse, on macOS. *(proof test 1)* | Test |
| `QGD-CRD-0005` | `qso-graph-auth` remains Python; the shell and frame remain TypeScript. The convention is the contract, so the languages either side of it are free. | Inspection |
| `QGD-CRD-0006` | A credential never appears in a log, an error message, an IPC payload rendered to a screen, or a report. | Static |
| `QGD-CRD-0007` | The renderer never holds a credential and never opens a network connection. | Static, Test |
| `QGD-CRD-0008` | The OS credential manager is the only store in Release 1. A user's own Vault is a later Part. | Inspection |
| `QGD-CRD-0009` | `qso-graph-auth` is the cross-language oracle for the keyring naming convention. It is exercised **from source at build time**, never vendored, pinned, mocked or stubbed. | Test |
| `QGD-CRD-0010` | The interop proof runs both directions in one pass: the core writes and `qso-graph-auth` reads, then `qso-graph-auth` writes and the core reads. A one-direction proof does not satisfy `QGD-CRD-0004`. | Test |
| `QGD-CRD-0011` | `qso-graph-auth` validates the persona index format as well as the credential entries; the two sides agree on both. | Test |
| `QGD-CRD-0012` | **If the credential path fails, verification halts.** No suite after the interop proof is run or reported, because nothing in the application is meaningful when credentials do not work. | Test |
| `QGD-CRD-0013` | No secret appears in the persona index, in a credential status result, or in any failure message from the interop proof. | Test |

## 4. Process map

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PRC-0001` | Every risky job runs in its own process, so a crash in one never takes the application down. | Test |
| `QGD-PRC-0002` | The renderer holds screens only — no credentials, no network. | Static, Test |
| `QGD-PRC-0003` | The main process is windows and the IPC broker only. | Inspection |
| `QGD-PRC-0004` | The credential core, station I/O, and the engine supervisor each run as their own utility process. | Inspection |
| `QGD-PRC-0005` | IPC is a typed contract; malformed messages are rejected, not coerced. | Test |
| `QGD-PRC-0006` | Context isolation and the sandbox are enabled; Node is absent from the renderer; new windows are denied; outbound fetch from the renderer is refused. | Test |

## 5. Test, verification and release

| ID | Requirement | Verify |
|---|---|---|
| `QGD-TST-0001` | One command, `make verify`, runs every check and produces the report. | Test |
| `QGD-TST-0002` | `make verify` exits non-zero on any failure. | Test |
| `QGD-TST-0003` | The report records pending acceptance evidence honestly — a gate not yet met is reported as not met, never as passed or omitted. | Inspection |
| `QGD-TST-0004` | `QGD-RVM-001.md` is generated from this document's Verify columns. A hand-edited RVM fails `make verify`. | Test |
| `QGD-TST-0005` | Every requirement in this document carries at least one Verify method. `make verify` fails if one does not. | Static |
| `QGD-TST-0006` | Security tests pass before any artifact is published outside this machine. | Test |

## 6. What this document does not contain

Deliberately absent, with where each lives instead:

| Not here | Where |
|---|---|
| Rationale, history, worked examples, the dialectical record | `QGD-HDBK-001` |
| Review findings and open questions | GitHub issues on `qso-graph/qso-graph-desktop` |
| The verification matrix | `QGD-RVM-001` — generated, never hand-written |
| Review process, gates, panel composition, merge authority | Nowhere in this repo; it is not product |
| Registers of transports and critical services | Data files beside the code, not prose |
