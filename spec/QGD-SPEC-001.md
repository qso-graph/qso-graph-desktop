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
| `QGD-PII` | Personal data — club rosters and anything carrying a third party's details |
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
| `QGD-SCP-0003` | **Signing and notarization are deferred, not cancelled.** D-27 stands as the Release 1 intent — SignPath (Windows), Apple Developer ID and notarization (macOS), QSO Graph's own key (Linux). **No Part before Release 1 is gated on a signing identity, a signing pipeline, or a notarized artifact.** | Static |
| `QGD-SCP-0004` | **macOS arm64 is the only platform required before Release 1.** Windows and Linux remain Release 1 targets under D-27. No Part's exit gate before Release 1 requires a second operating system, a CI matrix, or a clean VM of another OS. | Static |
| `QGD-SCP-0005` | The sequencing in `QGD-SCP-0003` and `QGD-SCP-0004` changes only by KI7MT's direction, recorded here. **An agent may not pull signing or a second platform forward into an earlier Part.** | Inspection |
| `QGD-SCP-0006` | Linux distribution through COPR and Launchpad is an **open question**, not a commitment: a bundled Electron runtime, a native addon and a managed PostgreSQL may exceed what those services will build or carry. Resolved before Release 1 packaging, tracked in an issue. | Inspection |

> These are **sequencing requirements, not prohibitions.** D-27 (*Code signing and the public
> repo — decided KI7MT, 2026-10-07*) is the long-term path and is not reversed; KI7MT's
> direction of the same date is that it waits until there is a useful product. The earlier
> draft of this section claimed signing had never been requested. That was wrong, it
> contradicted the record, and it is corrected here. Rationale: `QGD-HDBK-001` §2.

## 2. Part catalogue

**This table is the build order. It is the only build order.** No other document states,
summarizes, or re-sequences it. A document that needs to refer to the order cites
`QGD-PRT-NNNN`.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PRT-0001` | Operating-system-level components are built before the screens wired to them. | Inspection |
| `QGD-PRT-0002` | One Part is in flight at a time. | Inspection |
| `QGD-PRT-0003` | Each Part registers its acceptance tests before any of its code is written. | Inspection |
| `QGD-PRT-0004` | A Part's exit gate is met on macOS arm64 alone. No gate before Release 1 requires a second operating system or a third-party application. | Static |

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
| **P10** | `QGD-PRT-0110` | QG Editor: **generate, validate and maintain** a club's `.cli` (club information) and `.prf` (roster) files in NetLogger's own format — the authoring tool clubs currently do not have | P9 | A club with no file generates a valid one; a file carrying headers copied from another club's file is detected and reported; synthetic fixtures round-trip byte for byte where the user did not edit |
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

## 3.1 Club rosters — personal data

Carried forward from the superseded spec's `QGD-5-10`–`5-12`. A `.prf` roster carries members'
names, email addresses and telephone numbers, so the Editor (P10) handles personal data that is
not the operator's own.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PII-0001` | Club rosters are personal data. A real roster never enters this repository, its history, or CI output. Test fixtures are synthetic or anonymized. | Static |
| `QGD-PII-0002` | Round-trip and comparison tests report positions and lengths, never field values, so a failing diff cannot leak a member's details. | Test |
| `QGD-PII-0003` | Roster field values are never written to logs, `report.md`, telemetry, or error messages. | Static, Test |
| `QGD-PII-0004` | Sharing or exporting a roster is an explicit user action, never a side effect of opening, validating or saving a file. | Test |

> How roster handling squares with the project's never-a-PII-source rule is **open for KI7MT**
> (D-30). `QGD-PII-0001`–`0004` hold whatever that answer is.

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
