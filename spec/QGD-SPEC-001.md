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

> The account of the build this rule's absence cost is `QGD-HDBK-001` §1.

**ID shape:** `QGD-<AREA>-NNNN`, with sub-IDs as `NNNN.N` for requirements that refine a parent.

| Area | Covers |
|---|---|
| `QGD-SCP` | Scope, platform, what is and is not being built |
| `QGD-PRT` | Part catalogue — build order and per-Part exit gates |
| `QGD-CRD` | Credential core, callsign storage, grants |
| `QGD-PII` | Personal data — club rosters and anything carrying a third party's details |
| `QGD-PSN` | Callsigns, service profiles, and moving them between machines |
| `QGD-STN` | Stations: where the operator is operating from |
| `QGD-PRC` | Process map and IPC |
| `QGD-FRM` | The shell, and the component gallery |
| `QGD-APP` | Extensions: the runtime, the extension API, grants and trust tiers |
| `QGD-HOM` | Home and the cards extensions contribute to it |
| `QGD-ENG` | Local storage |
| `QGD-REF` | Reference data and the validation built from it |
| `QGD-LOG` | Application logging |
| `QGD-REP` | Repository layout |
| `QGD-SEC` | Security rules and cryptographic claims |
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

## 0.2 Invariants

What is always true of this product, whatever is being built. Each holds across every Part and every extension; the requirements and tests named are what hold it. A change that would break one is a decision for KI7MT and a change to this list, never a side effect (KI7MT, 2026-10-22: so nobody, person or AI, has to rediscover these, and a new app or extension can be checked against them at a glance).

| ID | Invariant | Verify |
|---|---|---|
| `QGD-INV-0001` | **Credentials live only in the operating system's credential store,** held by the credential core and nothing else. No credential is in a file, a log, the database, the window or an extension (`QGD-CRD-0002`, `QGD-CRD-0007`, `QGD-CRD-0008`). | Test |
| `QGD-INV-0002` | **No secret is read unless the operator acts for it.** Starting, navigating and showing status read none (`QGD-CRD-0009`). | Test |
| `QGD-INV-0003` | **Removing a callsign leaves nothing of it in the credential store.** Every service's entry for it is deleted first, every supported service included; if any cannot be, the callsign is not removed and the operator is told to try again. All of it or none of it (KI7MT, 2026-10-22: no keychain clutter; `scripts/credential-edit-smoke.mjs`). | Test |
| `QGD-INV-0004` | **Nothing of the operator's leaves the computer unless they ask.** An export or a support bundle is written where they choose and sent nowhere; a location's address and notes reach no extension and no request (`QGD-PSN-0011`, `QGD-LOG-0012`, `QGD-STN-0003`). | Test |
| `QGD-INV-0005` | **There is one way out, and it is HTTPS from the credential core.** The window and extensions open no connection, and no part of the product listens for one (`QGD-SEC-0020`, `QGD-CRD-0007`, `QGD-APP-0008`, `QGD-ENG-0017`). | Test, Static |
| `QGD-INV-0006` | **No extension code runs in the window.** Extensions run in the extension host and reach the core only by messages (`QGD-APP-0015`, `QGD-APP-0003`). | Test |
| `QGD-INV-0007` | **What crosses a boundary is checked and refused, never coerced:** every message, file and reply (`QGD-SEC-0006`). | Test |
| `QGD-INV-0008` | **ADIF is the core.** A field ADIF defines keeps ADIF's name and definition; only the label on screen is ours. A value ADIF does not allow is refused with the reason and never altered to fit, beyond the trimming and case of `QGD-CNV-0016` (`QGD-STN-0002`, `QGD-REF-0005`). | Test |
| `QGD-INV-0009` | **ARRL and LoTW first.** Where authorities disagree about a value, what is stored is what ADIF defines and LoTW accepts; any other program's view is derived from it where needed, not stored (KI7MT, 2026-10-22; `QGD-STN-0010`). | Test, Inspection |
| `QGD-INV-0010` | **Published data is stored exactly as published.** A row that is wrong is flagged, never corrected (`QGD-REF-0011`). | Test |
| `QGD-INV-0011` | **Third-party data is not redistributed.** It is fetched from its owner, checked against a pinned SHA-256 where it is fixed, and never committed. Data that ships with the product is public domain or openly licensed, and credited where its licence asks (`QGD-REF-0001`, `QGD-REF-0009`, `QGD-STN-0010`). | Inspection |
| `QGD-INV-0012` | **Nothing is fetched that the operator did not ask for:** reference data when they download or update it, and the sources their pinned cards name. A start fetches nothing (`QGD-REF-0017`, `QGD-HOM-0005`). | Test |
| `QGD-INV-0013` | **UTC is UTC.** The time is the computer's clock, never changed or corrected by this product; only how local time is written can change (KI7MT, 2026-10-22; `QGD-FRM-0014`). | Test |
| `QGD-INV-0014` | **The core never depends on an extension.** An extension can be turned off, so no core Part's requirement or exit gate may need one to be on (KI7MT, 2026-10-22, retiring P9's sunrise and sunset). | Inspection |

## 0.3 Conventions

How every value is written, everywhere: stored, shown, exported, and in every extension. These are where data integrity is lost by accident, by a lowercase callsign or a zone written `03`, so they are stated once here rather than rediscovered (KI7MT, 2026-10-22). ADIF's own definitions govern any field it defines (`QGD-INV-0008`); these say how its values are written where ADIF leaves a choice, and how this product writes values ADIF does not define.

| ID | Convention | Verify |
|---|---|---|
| `QGD-CNV-0001` | **Callsign:** **Uppercase throughout, prefixes and suffixes included**, as LoTW, ADIF logs and contest logs write them: `KI7MT`, `KI7MT/P`, `VE3/KI7MT`. No spaces. | Test |
| `QGD-CNV-0002` | **Maidenhead grid:** Field and square letters uppercase, subsquare letters lowercase, digits as digits: `DN13`, `DN13tp`, `DN13tp42`. Several grids, as a line or corner, joined by commas with no spaces: `DN13,DN14`. | Test |
| `QGD-CNV-0003` | **Time:** **UTC**, always, for anything recorded. In ADIF, `YYYYMMDD` and `HHMMSS`; on screen, `2026-10-22 09:01:41`. A local time on screen is labelled as local. | Test |
| `QGD-CNV-0004` | **Band:** ADIF's `Band` values, lowercase: `160m`, `20m`, `70cm`. | Test |
| `QGD-CNV-0005` | **Mode:** ADIF's `Mode` and `Submode` values, uppercase: `CW`, `SSB`, `FT8`; `MFSK` with submode `FT4`. | Test |
| `QGD-CNV-0006` | **DXCC entity:** ADIF's entity code, a number without leading zeros (`291`); its name is ADIF's, never typed. | Test |
| `QGD-CNV-0007` | **State, province, prefecture:** ADIF's `Primary_Administrative_Subdivision` code for the entity, uppercase: `ID`, `ON`. | Test |
| `QGD-CNV-0008` | **County:** ADIF's form, state first: `ID,Ada`; in the US the name as LoTW spells it, in Alaska as ADIF's list does (`QGD-STN-0010`). | Test |
| `QGD-CNV-0009` | **ARRL section:** ADIF's abbreviation, uppercase: `EPA`, `ID`. | Test |
| `QGD-CNV-0010` | **CQ and ITU zone:** A whole number without leading zeros: `3`, not `03`. | Test |
| `QGD-CNV-0011` | **POTA park:** Uppercase as POTA writes it: `US-2233`. Several parks, for a two-fer or three-fer, joined by commas with no spaces; a location within a park after `@` as POTA writes it: `US-2233@US-ID`. | Test |
| `QGD-CNV-0012` | **SOTA summit, WWFF, IOTA:** Uppercase as each programme writes them: `W7I/SI-001`, `KFF-0001`, `NA-001`. | Test |
| `QGD-CNV-0013` | **Latitude and longitude:** On screen, decimal degrees with south and west negative: `43.625`, `-116.2083`. In ADIF, its own form: `N043 37.500`, `W116 12.498`. | Test |
| `QGD-CNV-0014` | **Frequency:** MHz, on screen and in ADIF's `FREQ`: `14.074`. | Test |
| `QGD-CNV-0015` | **Names the operator gives:** A callsign's description, a location's name, notes: kept as typed, case and all, trimmed of spaces at either end. | Test |
| `QGD-CNV-0016` | **Anything typed:** **Trimmed, and its case set by these conventions as it is typed**: `ki7mt` becomes `KI7MT` in the box (KI7MT, 2026-10-22). Then checked, and refused with the reason if it is wrong. Nothing typed is changed beyond its spaces and its case. | Test |
| `QGD-CNV-0017` | **Internal identifiers:** Never shown and never typed: the operator sees names and callsigns, and the product keys by identifiers of its own. | Inspection |

## 1. Scope

| ID | Requirement | Verify |
|---|---|---|
| `QGD-SCP-0001` | The target is a single operator on a single computer. | Inspection |
| `QGD-SCP-0002` | **macOS on arm64** (Apple silicon) is the primary platform. CI also builds and tests **Windows x64, Linux x64 and Linux arm64** on every push, on GitHub-hosted runners: the development pass, the window and credential-store suites, and the installers (KI7MT, Mission 2, 2026-10-11). | Static, Test |
| `QGD-SCP-0003` | **Signing and notarization are deferred, not cancelled.** D-27 stands as the Release 1 intent — SignPath (Windows), Apple Developer ID and notarization (macOS), QSO Graph's own key (Linux). **No Part before Release 1 is gated on a signing identity, a signing pipeline, or a notarized artifact.** | Static |
| `QGD-SCP-0004` | **macOS arm64 is the only platform required before Release 1.** Windows and Linux remain Release 1 targets under D-27. No Part's exit gate before Release 1 requires a second operating system, a CI matrix, or a clean VM of another OS; CI covers them anyway (`QGD-SCP-0002`), and a failure there is a defect to fix, not a gate on a Part. | Static |
| `QGD-SCP-0005` | The sequencing in `QGD-SCP-0003` and `QGD-SCP-0004` changes only by KI7MT's direction, recorded here. **An agent may not pull signing or a second platform forward into an earlier Part.** Recorded: KI7MT brought Windows and Linux (x64 and arm64) into CI as Mission 2 on 2026-10-11; signing stays deferred. | Inspection |
| `QGD-SCP-0006` | Linux distribution through COPR and Launchpad is an **open question**, not a commitment: a bundled Electron runtime and a native addon may exceed what those services will build or carry. Resolved before Release 1 packaging, tracked in an issue. | Inspection |
| `QGD-SCP-0007` | **Known limitation, not a requirement met: QSO Graph does not sign in to POTA, and holds no POTA credential.** POTA's sign-in registers one client, for POTA's own web app, and `QGD-PSN-0012` forbids borrowing it. An email-and-password account could have been reached by an SRP exchange, but that serves only accounts created that way — not an Amazon, Google or Facebook account, which has no password and cannot be given one. **That path is not taken** (KI7MT, 2026-10-09). So the POTA extension is built to work with no POTA login at all — park data, spots and filters, self-spotting, logging to the neutral log, and public statistics — and submitting a log is done on POTA's own page. An in-app upload waits until POTA registers a desktop client for QSO Graph. | Inspection |
| `QGD-SCP-0008` | **Linux packages load on glibc 2.28 and newer.** The Linux credential core is built against glibc 2.28 (a `manylinux_2_28` container), and the build fails if it imports a newer symbol version (`QG_GLIBC_MAX`). Electron itself needs 2.25. That keeps one package loading on Raspberry Pi OS, Debian 10+, Ubuntu 20.04+ and RHEL 8+. (A core built on Ubuntu 24.04 needed 2.39 and would not load on Pi OS; found on a real Pi 5, 2026-10-11.) | Static, Test |
| `QGD-SCP-0009` | **The floor is a Raspberry Pi 5.** The core and its built-in extensions, Home cards included, run on a Raspberry Pi 5 (arm64, 4 GB) with Raspberry Pi OS, in memory and responsiveness, not only in that they start (KI7MT, 2026-10-11). CI proves it builds and runs on arm64; a real Pi 5 is what proves it is fast enough. | Test, Demo |

> These are **sequencing requirements, not prohibitions.** Code signing and the public
> repository (D-27) remain the long-term path and are not reversed; they wait until there is a
> useful product (KI7MT, 2026-10-07). Rationale: `QGD-HDBK-001` §2.

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
| `QGD-PRT-0005` | **P0 to P7, and P9 Stations, are the core; P8 and P10 onward are extensions built on the API the core provides.** A Part in the second group uses the extension API and the grant model, never a private route into the core. Stations are core for the reason callsigns are: nothing an operator does is without a callsign and a station (KI7MT, 2026-10-19). | Inspection |

### 2.1 Parts

| Part | ID | What | Depends on | Exit gate |
|---|---|---|---|---|
| **P0** | `QGD-PRT-0100` | Rust credential core (`napi-rs`), OS credential manager only, keyring naming convention | — | The credential core loads in Node and round-trips a credential through the macOS Keychain, unattended: write, read back, replace, select, delete, and the entry named by the convention |
| **P1** | `QGD-PRT-0101` | A window that calls the credential core and shows a callsign on screen | P0 | `npm start` opens a window on macOS showing callsign metadata and **credential status** (stored / present, never the value) obtained through the Rust credential core. The secret round-trip is proven in the credential core's Keychain round-trip under `QGD-PRT-0100`, never on screen — see `QGD-CRD-0006`, `QGD-CRD-0007` |
| **P2** | `QGD-PRT-0102` | Process map: main as IPC broker, utility processes, typed IPC contract; application logging | P1 | Killing a utility process leaves the window running and the process recovers; malformed IPC is rejected. Every process logs into one redacted JSON-lines stream held inside the size, total and retention caps, and a raised level reverts on its own |
| **P3** | `QGD-PRT-0103` | Shell: rail, pages, Settings, status bar, themes | P2 | e2e navigation; screenshot baselines approved by KI7MT **in both light and dark**; axe clean |
| **P4** | `QGD-PRT-0104` | Storage: the stores of `QGD-ENG-0001`, QG Storage, migrations, extension folders (re-planned 2026-10-10: SQLite replaces the bundled PostgreSQL) | P2 | QG Storage opens `state.sqlite` and applies its migrations whole or not at all; an extension folder outside `extensions/` is refused; no listener is opened; a storage error carries no value; QG Storage recovers when killed |
| **P5** | `QGD-PRT-0105` | Reference data: ADIF definitions (`all.json`), CQ and ITU zones, DOKs, and the validation built from them | P4 | The reference data builds into `reference.sqlite` and the validation built from it answers ADIF's own cases |
| **P6** | `QGD-PRT-0106` | QG Callsigns: callsigns, service profiles, guided setup and a test per credential, expiry warnings, encrypted export and import | P0, P4 | KI7MT walks setup on a clean machine; export round-trips |
| **P7** | `QGD-PRT-0107` | Extension runtime, official tier, grant model, over the message API — the extension API | P6 | An extension without a grant is refused, proven by unit tests over the runtime, the manifest validator and the broker; demonstrated end to end by the first real extension (KI7MT, 2026-10-10) |
| **P8** | `QGD-PRT-0108` | Home and its cards: the card contribution, pins, and the built-in **On the Air** extension with **Conditions** and **Your station** (`QGD-HOM-*`; Your station retired 2026-10-22 by KI7MT: the clock in the header and the callsign and location on the status bar, `QGD-FRM-0014`; sunrise and sunset to the Astro extension). Re-planned 2026-10-11 by KI7MT: Home is the base product, and QG ADIF left the plan (below) | P7 | On a new install Conditions and Your station are pinned and drawn by the core from the extension's data; pins hold up to six, reorder and persist; only pinned cards fetch; a failing source fails its own card and nothing else; screenshots approved by KI7MT in light and dark; it runs on a Raspberry Pi 5 (`QGD-SCP-0009`) |
| **P9** | `QGD-PRT-0109` | Stations: where the operator is operating from, beside who they are (`QGD-STN-*`). Added 2026-10-19 by KI7MT: nothing works without callsigns and stations | P6, P5 | Stations are made, edited and deleted, every field optional but the name and the grid and each one checked against ADIF's definitions, and every field of a TQSL station location held (`QGD-STN-0009`); each callsign's default station becomes active with it and the status bar names it; a station made from a POTA park takes the park's grid, coordinates and state; ~~sunrise and sunset are shown at the active station~~ (retired from this gate 2026-10-22 by KI7MT, with Home's Your station card: a core Part's gate does not depend on an extension that can be turned off; sunrise and sunset are the Astro extension's, `QGD-AST-*`); all of it survives a restart; screenshots approved by KI7MT in light and dark |
| **P10** | `QGD-PRT-0110` | QG Club: club definition and roster | P7, P9 | The field canvas's cases load |
| **P11** | `QGD-PRT-0111` | QG Editor: **generate, validate and maintain** a club's `.cli` (club information) and `.prf` (roster) files in NetLogger's own format — the authoring tool clubs currently do not have | P10 | A club with no file generates a valid one; a file carrying headers copied from another club's file is detected and reported; synthetic fixtures round-trip byte for byte where the user did not edit |
| **P12** | `QGD-PRT-0112` | Updates and onboarding | P6–P11 | An update installs on a clean machine |

**Release 1 = P0–P12.**

**The logbook store and QG Log are not in Release 1.** This replaces D-29, which placed the
logbook store inside it. Release 1 keeps no QSOs.

**QG ADIF left the plan on 2026-10-11** (it was P8). It checks and repairs `.adi` files: a tool
used on its own or inside a logger, not part of the base product, and for anyone using an AI
`adif-mcp` already validates. It stays a candidate official extension, built if hams ask for a
log checker or when QG Log needs one. The ADIF definitions themselves are core reference data
(`QGD-PRT-0105`) and are unaffected.

**After Release 1**, in order: the logbook store, then QG Log. Then, each its own Part in an
order KI7MT sets: QG Reference's browsable surface, QG Net, the representative spike, QG NCS,
LoTW signing, the contributed tier and sandbox, QG Spots, QG Rig, the Vault store, QG Sync,
QG Atlas, QG Predict, QG Chat, and QG Awards once "awards" is defined.

> Any document placing the shell ahead of the credential core contradicts `QGD-PRT-0001` and is
> wrong by this specification. Rationale: `QGD-HDBK-001` §2.

## 2.2 Repository layout

| ID | Requirement | Verify |
|---|---|---|
| `QGD-REP-0001` | The repository is laid out as `packages/` — `callsign-core`, `main`, `preload`, `renderer`, `ui`, `storage`, `reference`, `callsigns`, `logging`, `extension-api`, `extension-host` — `extensions/` — `on-the-air`, `club`, `editor` — each extension carrying its own `package.json`, `src/`, `tests/`, README and icon, and `storybook/` at the root for the component gallery. A package holds its files directly; `src/` and `tests/` are an extension's shape, not a package's. The compiled tree mirrors it, so `dist/<package>/` is where a process finds its siblings, and `dist/extensions/<id>/` holds each built extension's manifest, icon and code, which is where the extension host finds it. | Inspection |
| `QGD-REP-0002` | The move to that layout happens at `QGD-PRT-0107` and not before. Recording it here is not permission to begin it. | Inspection |
| `QGD-REP-0006` | **The dependency direction between packages is fixed, and enforced over the imports themselves.** `callsign-core`, `logging`, `reference`, `ui`, `preload` and `extension-api` depend on no other package — `extension-api` because a surface that imported the core's own contracts would hand an extension the core's internals through its own types; `callsigns` and `storage` depend only on those; `main` adds `callsigns`, `storage` and `extension-api`; `renderer` may depend on anything below it and nothing may depend on `renderer`. An extension depends on `extension-api` and `ui` and on nothing else, which is `QGD-REP-0003` made structural. A contract lives with the side that serves it and its callers depend on it, never the reverse. Checked against the imports rather than asserted, because the layout is only worth the move if a wrong-direction import cannot land. Stories are excluded and the exclusion is named: a `.stories.svelte` ships nowhere (`QGD-FRM-0009`) and the gallery is required to show a component the way the shell does (`QGD-FRM-0006`), which is why the rail's story reads the shell's own page list. | Test |
| `QGD-REP-0003` | A built-in extension uses only the extension API and its grants, exactly as a third-party extension would. Callsigns, stations, storage and the reference data are core, not extensions, because the core enforces the grants. | Inspection |
| `QGD-REP-0004` | `extension-api` and `ui` are separate packages: what an extension may call and what it may look like are different contracts. | Inspection |
| `QGD-REP-0005` | Third-party material that ships inside the application is recorded in `NOTICE`, with its licence and the version that ships. Where that licence requires attribution, the attribution also appears in a surface the user can reach — the About panel, and Help → Attributions (`QGD-FRM-0015`), which opens it — because a file in the repository is not somewhere a user can be expected to look until the application takes them there. | Test, Inspection |

## 3. Credential core

| ID | Requirement | Verify |
|---|---|---|
| `QGD-CRD-0001` | The credential core is Rust, built as a `napi-rs` native addon. | Static |
| `QGD-CRD-0002` | The credential core owns the OS credential stores, X.509 and PKCS#12 handling and certificate expiry, and it is the only holder of credentials. **The grant model's enforcement point is the extension broker** (KI7MT, 2026-10-10): it decides every extension request before anything reaches the credential core or storage. | Inspection |
| `QGD-CRD-0003` | The credential core owns its OS credential-store entry names and sets them explicitly, never leaving them to a library default. **An entry is named by the callsign's id and the service** (`<id>:<service>`), and the id is a random version 4 UUID drawn from the FIPS module's generator (KI7MT, 2026-10-22): nothing the operator typed, neither the call nor the description, is in an entry's name, so either can change without touching a credential, and no two callsigns can share an entry whatever they are called. | Test |
| `QGD-CRD-0004` | **QSO Graph Desktop has no Python and no MCP-server interoperability, in any Part, now or later** (KI7MT, 2026-10-08). No requirement, suite, gate or shipped artifact depends on a Python runtime or on `qso-graph-auth`. | Static |
| `QGD-CRD-0005` | The credential core is Rust and the shell and the rest of the core are TypeScript. | Inspection |
| `QGD-CRD-0006` | A credential never appears in a log, an error message, an IPC payload rendered to a screen, or a report. | Static |
| `QGD-CRD-0007` | The renderer never holds a credential and never opens a network connection. | Static, Test |
| `QGD-CRD-0008` | The OS credential manager is the only store in Release 1. A user's own Vault is a later Part. | Inspection |
| `QGD-CRD-0011` | A control that cannot be used says why, without being pressed, in words a screen reader reaches. Whether a service can be tested at all, and whether there is anything saved to test, are both known in advance and are reported in advance. **A disabled control is never drawn as a busy one.** (KI7MT, 2026-10-08: Club Log's Test button was disabled, unexplained, and drawing a spinning busy cursor, because the shared disabled style said `cursor: wait`.) | Test |
| `QGD-CRD-0009` | **No credential secret is read at startup, by navigation, or to display status.** A secret is read only on an explicit action of the operator's that needs it — testing a credential, or handing one to something that will use it. Reading a secret is what makes macOS ask for the login keychain password, and asking for it before the operator has done anything is both alarming and unearned. (KI7MT, 2026-10-08: opening the application prompted him, because the remembered callsign was selected and its status read.) | Test |
| `QGD-CRD-0010` | The status display answers from the index and from the existence of the credential-store entry — which each store reports without unlocking its data: from an item's attributes on macOS and Windows, and on Linux from a Secret Service search, where a locked match counts as much as an unlocked one — and never from the secret. Which kinds of secret an entry holds is not itself a secret, and is recorded when it is written. | Test |
| `QGD-CRD-0012` | **A secret is stored only if the operator entered it in that action.** Intent is read from the operator's own input, not from what the field holds when the button is pressed — so a value that reached a secret field some other way (a stale value, an autofill, a paste landing late while focus moves) is not written. A blank field still means *keep what is saved*, and `Remove` is still how a secret is deleted; what changed is that untouched now means the same as blank. (KI7MT, 2026-10-09: `packaged-launch` stored a password into an entry whose field the suite had just emptied, and he directed it be treated as a security bug rather than a record entry. It was not reproduced in twelve runs, eight under load, so this removes the product's dependence on that field being correct rather than fixing a known mechanism — which is what every candidate mechanism had in common.) | Test |
| `QGD-CRD-0013` | **The suites never write a credential beside a real one.** Fixtures go to a credential-store service of their own, selected by the presence of an environment variable and never named by one — a variable that supplied the service would be a route into another product's namespace from outside the process. Everything under the test service is swept when a suite exits, including when it throws or is signalled, and again before the next run starts, because the runs that left fixtures behind were the ones that never reached their cleanup. (KI7MT, 2026-10-09: seventeen `qg-test-…` fixtures were found in his real login keychain, in the same namespace as real credentials. Nothing under that namespace is migrated, read or deleted by this product — it may be the MCP servers' data.) | Test |
| `QGD-CRD-0013.1` | **A release's verification run happens in an account whose login keychain holds nothing of the operator's** (KI7MT, 2026-10-09). `make verify` runs from a separate, non-admin account. A separate account has its own login keychain, so the isolation is the operating system's property rather than something the suites have to keep getting right — and it needs no change to the credential core's proven paths, which a per-run temporary keychain would have, because targeting a keychain file means routing the credential path off the library the naming convention is a contract with (D-17, `QGD-CRD-0003`). The per-service scoping in `QGD-CRD-0013` stays as the net for day-to-day runs: two controls, and the one that does not depend on the suites behaving is the stronger. That account cannot read the working repository and holds no credential for the remote, both deliberately, so the commit is pushed across to a shared checkout from the developing side. Procedure: `docs/VERIFY-ACCOUNT.md`. | Demo, Inspection |
| `QGD-CRD-0014` | **Every screen and message names the store the operator has:** Keychain on macOS, Credential Manager on Windows, the keyring (the Secret Service) on Linux. The credential core and the screens were written for macOS; one module (`packages/callsigns/credential-store.ts`) words them for the platform, and macOS's wording is unchanged. No other platform is sent looking for a macOS permission dialog. | Test |

## 3.1 Club rosters — personal data

Carried forward from the superseded spec's `QGD-5-10`–`5-12`. A `.prf` roster carries members'
names, email addresses and telephone numbers, so the Editor (P11) handles personal data that is
not the operator's own.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PII-0001` | Club rosters are personal data. A real roster never enters this repository, its history, or CI output. Test fixtures are synthetic or anonymized. | Static |
| `QGD-PII-0002` | Round-trip and comparison tests report positions and lengths, never field values, so a failing diff cannot leak a member's details. | Test |
| `QGD-PII-0003` | Roster field values are never written to logs, `report.md`, telemetry, or error messages. | Static, Test |
| `QGD-PII-0004` | Sharing or exporting a roster is an explicit user action, never a side effect of opening, validating or saving a file. | Test |

| `QGD-PII-0005` | A club customises by **defining lists** — offices, membership classes, net roles, award categories — and by assigning members to them with dates, so history is kept. A club never adds fields: the schema is the same for every club. | Inspection, Test |
| `QGD-PII-0006` | Club data on a user's machine is theirs. Nothing is collected, no telemetry is sent, and no feature pushes another person's details to a shared or public service. | Static, Inspection |
| `QGD-PII-0007` | **A callsign lookup may be shown in full; none of it is kept or passed on except named radio fields** (KI7MT, 2026-10-09). A lookup the operator asked for is displayed as the service returned it, street address, email address and telephone number included: the service is the source for that lookup, as its own site is. What this requirement governs is what the product **keeps and passes on**. A lookup result is never written to a log (`QGD-CRD-0006`), never saved to any store (`QGD-ENG-0001`), a cache or any file, and never leaves the machine in an export, a sync or anything shared. What may be **persisted** is a named list — callsign, name, grid, country, DXCC, CQ and ITU zone, licence class, coordinates where a grid needs them, QSL manager, and the LoTW and eQSL flags — never *everything except* a list of exclusions, because a denylist is a guess about somebody else's response format and the format can change underneath it. So the allowlist governs storage and egress, not the screen. | Test |

## 3.2 Callsigns and services

`QGD-PRT-0106`. P1 built the mechanism — a callsign, a provider, a secret in the OS credential store — and
nothing wrote down the rules it answers to. These do. The credential core's own rules are §3
above and are not restated here.

The area is `QGD-PSN`: a callsign is the operator's identity, and a service profile is what a
service needs from them. Both are the core's, not an extension's (`QGD-REP-0003`).

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PSN-0001` | **A credential belongs to a callsign and a service, never to the application.** A callsign is the call letters, an optional description to tell it by ("Home", "Portable"), and the period it was used, under a permanent id (`QGD-CRD-0003`); an operator has as many as they need, and one call may be held more than once (KI7MT, 2026-10-22: "persona" is retired; the word is callsign, in the screens, the code and this specification). The call, the description and the dates can all be changed, and the callsign's credentials, preferences and default location stay with it, because they are kept against its id. Removing a callsign removes its credentials from the credential store, its preferences and its default location (`QGD-STN-0005`). Nothing is stored against "the user". | Test |
| `QGD-PSN-0002` | **What a service needs is data, not branches.** Each service's profile records the fields it takes, which of them is a secret, how it is tested, and what the operator has to do at the service's own site to get one. A service added to the register appears in setup with its own fields and its own test, with no code change — the same rule `QGD-REF-0005` applies to ADIF's definitions, applied to services. | Test |
| `QGD-PSN-0003` | **The six services P1 hardcoded become register entries.** `qrz`, `qrz_logbook`, `eqsl`, `lotw`, `hamqth` and `clublog` are the Release 1 set and are what the register ships with. A command naming a service the register does not hold is refused before it reaches the credential core (`QGD-SEC-0006`). POTA is **not** among them: it is reference data (`QGD-REF-0009`), this product never signs in to it (`QGD-SCP-0007`), and the extension that uses it holds no credential. | Test |
| `QGD-PSN-0004` | **Guided setup asks for the callsign and nothing else.** On a machine with no callsigns the application offers to make one; every service after that is optional, can be skipped, and can be returned to. A setup that cannot be left half-done is a setup an operator abandons. | Test, Demo |
| `QGD-PSN-0005` | **Every service either has a test or says it has none**, and which it is is known before the operator presses anything (`QGD-CRD-0011`). A test reports what happened — accepted, rejected, could not be reached, rate-limited, nothing saved to test — and never the secret it used (`QGD-CRD-0006`). **A test runs every time the operator asks for one: this product imposes no wait of its own** (KI7MT, 2026-10-10). `rate-limited` is the service's answer and never this product's; it held a cooldown of thirty seconds, and five minutes after a refusal, which told a ham who had just corrected a password to wait for a service that was willing to answer. A button already disabled while its own request is in flight is not a limit. | Test |
| `QGD-PSN-0006` | **No credential this product stores expires, because it holds no certificate.** TQSL is a required install the user owns (D-9). This product holds no certificate and manages none of TQSL's station locations: it lists the locations TQSL holds and signs through TQSL's library. Its own stations (§3.3) are a different thing and never TQSL's (`QGD-STN-0008`). So the LoTW credential kept here is the web account, which carries no date, and there is nothing to read an expiry out of. The register states that per service, and a register claiming an expiry is refused, because nothing in this product can compute one. If a credential that expires is ever stored, its expiry is read from the credential itself and never from something the operator typed (`QGD-CRD-0002`), and the application says so while there is still time to act. The status answers *no expiry known* rather than leaving a credential looking good for ever. | Test |
| `QGD-PSN-0007` | **An export is encrypted or it is not written.** Callsigns, their service settings and their secrets leave the machine only as one file, encrypted with a passphrase the operator chooses at the moment of export. The passphrase is not stored, not defaulted, and not derived from anything the machine knows — an export a thief can open by stealing the machine is not an export, it is a copy. | Test |
| `QGD-PSN-0008` | **The export names its algorithms and its version in the clear**, so a file can be read by a later release that has moved on from them: AES-256-GCM over the whole payload, a key from PBKDF2-HMAC-SHA-256 with a random salt and a recorded iteration count, and a random nonce. The wording of any claim about them is `QGD-SEC-0015`'s. | Test, Static |
| `QGD-PSN-0009` | **An import is all of the file or none of it**, and it says what it would overwrite before it does. A file that fails its authentication tag is refused whole. | Test |
| `QGD-PSN-0010` | **A wrong passphrase and an altered file are the same signal, and the product says so rather than guessing.** An AEAD tag fails identically for both, so an import reports "this file could not be opened with that passphrase — it may be the wrong passphrase, or the file may have been altered". Claiming to know which would be a guess presented as a fact. | Test |
| `QGD-PSN-0011` | **Nothing leaves the machine.** An export is written where the operator chooses and sent nowhere, exactly as `QGD-LOG-0012` has it for diagnostics. Exporting is an explicit action and never a side effect of opening or saving anything (`QGD-PII-0004`). | Test |
| `QGD-PSN-0012` | **This product does not sign in as somebody else's application.** An OAuth or Cognito client identifier names the application, not the operator, so using POTA's web client would mean telling their sign-in service that QSO Graph is POTA's website — a false identity even with the operator's own password and consent, and one that leaves POTA unable to tell our traffic from their own, rate-limit it, or revoke it. The same holds for any service. Where a service offers no client of its own for this product, there is no sign-in: the capability waits until that service registers one. (KI7MT, 2026-10-09, dropping a POTA SRP exchange that was half built on exactly this path.) | Inspection, Static |
| `QGD-PSN-0013` | **A capability this product does not have is stated, not worked around.** Where a service cannot be reached, the operator is told so plainly, before they try, and is not sent to find a setting or perform a step nobody has confirmed exists. This is written from getting it wrong: a requirement here briefly told operators to set a password at a service whose accounts cannot be given one, which would have read to every one of them as their own failure to find it. | Test, Inspection |

## 3.3 Stations

`QGD-PRT-0109`. A callsign is who the operator is; a station is where they are operating from. TQSL
draws the same line: a callsign certificate is identity, and station locations are separate named
records, several per certificate (KI7MT, 2026-10-19, `qso-graph-desktop#36`). Sunrise, sunset, the
grey line, the log's own fields and every award that counts a place need the station, so no
feature that does is built before it.

The area is `QGD-STN`. Stations are core, not an extension's (`QGD-REP-0003`, `QGD-PRT-0005`).

**What the operator sees** (KI7MT, 2026-10-22): the words hams already know from LoTW, QRZ, eQSL and
their loggers. A callsign (§3.2) is shown on a page called **Callsigns**; a station is
shown as a **station location**, on a page called **Station Locations**, and **Locations** in the rail
(TQSL's own term, which LoTW users already know). "Station" alone is not used for a place: in ADIF,
`STATION_CALLSIGN` is a callsign. This specification and the code keep "station" as their own name for
a location; "persona" is retired everywhere (KI7MT, 2026-10-22). The requirement IDs (`QGD-PSN`,
`QGD-STN`) are unchanged.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-STN-0001` | **A station is its own named record, separate from a callsign.** An operator has as many as they need — home, a park, a summit, the car — and one station may be used by more than one callsign. Stations are kept by QG Storage in `state.sqlite` (`QGD-ENG-0001`); none of a station is in the credential core or the OS credential store, because none of it is secret. | Test |
| `QGD-STN-0002` | **A station's place is ADIF's own fields, with ADIF's definitions.** It holds `MY_GRIDSQUARE`, `MY_GRIDSQUARE_EXT`, `MY_VUCC_GRIDS`, `MY_LAT`, `MY_LON`, `MY_ALTITUDE`, `MY_DXCC`, `MY_CQ_ZONE`, `MY_ITU_ZONE`, `MY_STATE`, `MY_CNTY`, `MY_ARRL_SECT`, `MY_STREET`, `MY_CITY` and `MY_POSTAL_CODE`, and the activity references `MY_POTA_REF`, `MY_SOTA_REF`, `MY_WWFF_REF` and `MY_IOTA`. Each value is checked against the ADIF definitions in reference data (`QGD-REF-0005`), and a value they refuse is refused with the reason, never altered to fit. No private rule stands in for one of ADIF's. | Test |
| `QGD-STN-0003` | **A station needs a name and a grid; every other field is optional** (KI7MT, 2026-10-20: the grid is always required). The grid is `MY_GRIDSQUARE`, or `MY_VUCC_GRIDS` for a station on a grid line or corner. It is the station's position wherever no latitude and longitude are given, and the editor fills latitude and longitude from it at the operator's asking, with the centre of the grid, calculated locally. Operating mobile or off grid there may be no street, city or postal code, and a station with a name and a grid is complete. A station also holds the operator's own **notes** (directions, parking, access, what worked; KI7MT, 2026-10-22), free text that is not an ADIF field, is never written into a log, and like the address never reaches an extension. Street, city and postal code are the operator's own and are kept only on this machine; they leave it only in something the operator explicitly exports (`QGD-PSN-0011`). | Test |
| `QGD-STN-0004` | **A station's kind is a label the operator picks: Home, Portable, Mobile or Remote.** It is a label and nothing more: it changes no field, no check and no behaviour, and since ADIF has no field for it, it is never written into a log. | Test |
| `QGD-STN-0005` | **Each callsign may name a default station, and one station is active at a time.** Making a callsign active makes its default station active; the operator can change the active station without changing the callsign. A default is kept against the callsign's id, so it survives a change of call or description, and it goes when the callsign is removed (KI7MT, 2026-10-22), so no default outlives the callsign it was for. The status bar names the active callsign and station together (`QGD-FRM-0012`). A change of station is a new question for Home's cards, as a change of callsign is (`QGD-HOM-0005`). | Test |
| `QGD-STN-0006` | **A portable station can be made from a POTA park reference.** The park's grid, coordinates and state are taken from POTA's park list in reference data (`QGD-REF-0009`), its reference goes into `MY_POTA_REF`, and the operator can change any of it before saving. A park whose coordinates POTA publishes as unusable fills nothing from them and says so. The station is kept: going back to the park is choosing that station in Stations and making it active, and nothing about it changes (KI7MT, 2026-10-19). A station is identified by its name; its parks are values on it, so a two-fer or three-fer is one station naming several parks, and two stations may name the same park. SOTA summits are the same once they are downloaded (`QGD-REF-0018`): a location made from a summit takes its reference into `MY_SOTA_REF`, its six-character grid and position, and its height into `MY_ALTITUDE` (shown as Elevation), and an open location can be filled from the summit it names. A summit SOTA does not list, or lists as valid only on other dates, is refused when saved, with the dates; a retired summit is still drafted, and says so. Other references are typed until their reference data exists. | Test |
| `QGD-STN-0007` | **The grid is typed.** There is no GPS field, because ADIF has none; a position source added later writes only `MY_GRIDSQUARE`, `MY_GRIDSQUARE_EXT`, `MY_LAT` and `MY_LON`, the fields that already exist. | Inspection |
| `QGD-STN-0008` | **These are this product's stations, never TQSL's.** It does not read, write or import TQSL's station data. How a station lines up with a TQSL location when LoTW signing is built is decided then, against `QGD-PSN-0006`. | Inspection |
| `QGD-STN-0009` | **A station holds at least everything a TQSL station location does, so a log made at it signs for LoTW without retyping** (KI7MT, 2026-10-19: the most important thing). Each field TQSL asks for in a station location, and the ADIF field TQSL checks it against when it signs a log, is held as that ADIF field: Call Sign is the active callsign's call (`STATION_CALLSIGN`), never stored on the station; DXCC Entity is `MY_DXCC`; Grid Square is `MY_GRIDSQUARE`, or `MY_VUCC_GRIDS` for a station on a grid line or corner; ITU Zone is `MY_ITU_ZONE`; CQ Zone is `MY_CQ_ZONE`; IOTA ID is `MY_IOTA`; US State, Canadian Province, Russian Oblast, Chinese Province, Australian State, Japanese Prefecture and Finnish Kunta are `MY_STATE`; US County and Japanese City/Gun/Ku are `MY_CNTY`. Those values come from ADIF's own subdivision lists for the station's `MY_DXCC`. TQSL's Park (a US national park unit, as `NP33`) has no ADIF field; the station holds it as its own LoTW park field, typed, and it is written only where TQSL takes it. The list is TQSL's as published in its source (`config.xml` and `tqslconvert.cpp`), checked again whenever TQSL adds a field. | Test, Inspection |
| `QGD-STN-0010` | **A US county is LoTW's, and is filled from where the location is** (KI7MT, 2026-10-22: LoTW first; ADIF is the core, ARRL/LoTW is met first, the rest after). For the United States, Alaska and Hawaii, `MY_CNTY` is the county-equivalent the location is in, written `ST,County` and spelled as TQSL's `US_COUNTY` list spells it, current counties only; in Alaska, as ADIF's own `Secondary_Administrative_Subdivision` list spells it, because ADIF is the core and TQSL still uses retired Alaska names. The County pick list is the state's counties from that list, and a typed county not in it, or of another state, is refused with the reason and never altered. **Fill the county** gives the county at a typed latitude and longitude, found in Census cartographic boundaries; with only a grid, the county its square lies in, or, where the square crosses a county line, the counties it reaches for the operator to pick. A state already set is never changed by it. One county per location: a county-line park is two locations. **The ARRL section follows ARRL's Section Boundaries:** the Section pick list is the state's own sections, a state with one section has it filled in, and filling the county fills the county's section where the state is split; a section of another state, or not the county's, is refused with the reason. ARRL's page is pinned as an Internet Archive copy, because ARRL's own varies by request, and `scripts/arrl-sections.mjs` compares the two. CQ USA-CA's 3,077 counties are derived from this for awards (an Alaska borough to its judicial district, an independent city of Virginia or Nevada to a bordering county) and are not stored. Sources and rules: `data/county-sources.json`. | Test |
| `QGD-STN-0011` | **A location's parks and summit link to their pages on POTA and SOTA** (KI7MT, 2026-10-22). Each park and summit a location names, in its list's form, has a View on POTA or View on SOTA link that opens that page in the operator's browser. The page is built in the main process from `data/links.json` and the reference, never from a URL the window supplies (`QGD-SEC-0009`); it needs the network and is the operator's choice, so it is not the application going online (`QGD-SEC-0020`). | Test |

## 4. Process map

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PRC-0001` | Every risky job runs in its own process, so a crash in one never takes the application down. | Test |
| `QGD-PRC-0002` | The renderer holds screens only — no credentials, no network. | Static, Test |
| `QGD-PRC-0003` | The main process is windows and the IPC broker only. | Inspection |
| `QGD-PRC-0004` | The credential core, station I/O, QG Storage (`QGD-ENG-0006`) and the extension host, QG Extensions (`QGD-APP-0015`), each run as their own utility process. | Inspection |
| `QGD-PRC-0005` | IPC is a typed contract; malformed messages are rejected, not coerced. | Test |
| `QGD-PRC-0006` | Context isolation and the sandbox are enabled; Node is absent from the renderer; new windows are denied; outbound fetch from the renderer is refused. | Test |
| `QGD-PRC-0007` | Only one instance of the application runs at a time. A second launch exits and raises the window already open, so two instances can never both own the profile, the settings file, the storage files and the operating system's credential-store entries — which `QGD-CRD-0003` keys by name rather than by profile, so a second instance would be writing over the first. | Test |

## 4.1 Application logging

How this section came to land ahead of the rest: `QGD-HDBK-001` §6.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-LOG-0001` | Every process logs as structured JSON lines into one stream: the TypeScript side through `pino` and the Rust credential core's `tracing` output forwarded into the same stream. | Test |
| `QGD-LOG-0002` | Logs stay on the machine, in the operating system's standard log folder. Nothing is transmitted; there is no telemetry. | Static, Test |
| `QGD-LOG-0003` | Redaction happens in the logger, by field name, so a caller cannot forget it. | Test |
| `QGD-LOG-0004` | The credential core never hands a secret to a logger. | Static, Test |
| `QGD-LOG-0005` | The log folder is inside the sentinel scan's coverage, under `QGD-CRD-0006`. | Test |
| `QGD-LOG-0006` | Log files rotate by size. | Test |
| `QGD-LOG-0007` | The log folder has a hard total cap; when it is exceeded the oldest file is removed first. | Test |
| `QGD-LOG-0008` | Logs are retained by age, and older ones are removed. | Test |
| `QGD-LOG-0009` | The default level is `info`. | Test |
| `QGD-LOG-0010` | A raised debug level reverts on its own, both after a set time and at restart, so it cannot be left on. | Test |
| `QGD-LOG-0012` | Exporting diagnostics produces one redacted archive for the user to send. Nothing leaves the machine unless the user sends it. | Test |
| `QGD-LOG-0013` | **The logs, the level switch and the export action are reached from Troubleshooting on the status bar, and are not in Settings** (KI7MT, 2026-10-10). Troubleshooting is also in the application's Help menu, as Help → Troubleshooting… (KI7MT, 2026-10-22); the status bar's button stays. Settings holds the operator's preferences; a log viewer is something they need on one occasion, which is reporting a fault. The behaviour it drives is `QGD-LOG-0009`–`QGD-LOG-0012`. | Demo |

**Retired and never reused:** `QGD-LOG-0011`, the engine's log (2026-10-10, with the engine).

## 4.2 Local storage

The core bundled and ran PostgreSQL until 2026-10-10. KI7MT decided to replace it with SQLite, because no
requirement needed a database server. The reasoning is in `QGD-HDBK-001` §13.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-ENG-0001` | **The core keeps its data in files it owns, and nothing else connects to them.** `settings.json` (`QGD-ENG-0003`) is a plain file that main reads. The SQLite stores are opened by one storage process (`QGD-ENG-0006`): `state.sqlite`, which holds the installation, the outcome of reference refreshes, small per-extension key-values under the extension's identifier, and the session state a screen needs; one folder per extension under `extensions/` (`QGD-ENG-0018`); and `reference.sqlite` (`QGD-ENG-0015`). All of them are in the application's own directory. There is no database server. An extension never receives a path or a connection: it reaches its data through the extension API (`QGD-APP-0009`). | Inspection |
| `QGD-ENG-0002` | **Drizzle is the database layer, in its SQLite dialect**: a TypeScript schema, SQL-like queries and generated migrations. The driver is `node:sqlite`, from the Node that Electron carries, reached through Drizzle's `sqlite-proxy` and one adapter of this product's. No native SQLite module is added, so nothing is rebuilt per platform or per Electron version. The adapter returns rows in the positional shape Drizzle expects and decodes booleans, JSON and missing rows as the schema declares, and each part of that contract is tested. | Test |
| `QGD-ENG-0003` | **Preferences and granted permissions live in `settings.json`, not in a database.** Main reads it synchronously when it creates the window, so the first paint is in the operator's theme. The extension API reads granted permissions from it on every request, so a withdrawal takes effect at once (`QGD-APP-0012`). | Test |
| `QGD-ENG-0006` | **QG Storage is the only process that opens a SQLite store.** It is a utility process under `QGD-PRC-0004`, and if it exits it is restarted with back-off while the window keeps running. Its arguments are paths inside the application's own directory, and no part of them comes from a user. The status it reports is pushed when it changes (on exit, restart and a finished reference build). A screen reads it once when it subscribes and removes its listener when the subscription ends. Status is never polled. | Test |
| `QGD-ENG-0007` | **Each store is created when it is first needed**, and a creation that fails leaves nothing behind that the next start would take for a store. `state.sqlite` is created on first run. An extension's folder is created when that extension first needs it (`QGD-ENG-0018`). `reference.sqlite` exists only once a build has published it, and until then reference data is *not loaded* (`QGD-REF-0014`). | Test |
| `QGD-ENG-0008` | **One writer per file.** Only QG Storage opens the SQLite stores, and `QGD-PRC-0007` keeps a second instance of the application from starting. A file that is not a SQLite database is refused and never overwritten. | Test |
| `QGD-ENG-0011` | **Backup is not part of the core before the first extension that holds operator data** (KI7MT, 2026-10-10). It is designed with that extension, as both a local copy and a copy shipped to S3-compatible storage, beside QG Sync. Until then nothing in the stores is the only copy of anything: the installation row is recreated, and reference data is rebuilt from its sources. | Inspection |
| `QGD-ENG-0013` | **Migrations are generated by Drizzle and applied by QG Storage when it opens `state.sqlite` or an extension's database.** The whole pending run commits or none of it does. Drizzle's proxy migrator hands over the statements without a transaction, so the adapter runs them in one. Which migrations have been applied is recorded in the file itself. A migration that fails leaves that store as it was, and fails that store alone. | Test |
| `QGD-ENG-0015` | **`reference.sqlite` is derived and never migrated.** Its schema is the Drizzle declaration rendered to DDL, checked against the declaration and stamped with a version. A new version of the schema or of a source means building a new file. A build writes the new file beside the live one and checks it with `integrity_check`, `foreign_key_check`, the expected row counts, and the assertions for each dataset it holds (`QGD-REF-0014`). It then closes the file in rollback-journal mode and puts it in place of the live file, once every handle to the live file is closed. A build that fails at any step leaves the live file as it was. **A build never publishes less than the live file holds**: if a dataset the file has cannot be had now (its cached input gone and the network with it), the build is deferred and the file stands. The build runs on a worker thread, so QG Storage keeps answering, and it is the only writer. Everything else opens the file read-only. | Test |
| `QGD-ENG-0015.1` | **The reference file is the record of what is loaded.** Its own source table says which sources it holds, where each came from, and the SHA-256 of the exact content each was built from, which is what decides whether an input has changed. `state.sqlite` records only the outcome of refreshes (last attempt, last check, last failure), written after the swap. At start, QG Storage reconciles what is loaded from the file itself, so a crash between a swap and its outcome is still read correctly. | Test |
| `QGD-ENG-0016` | **A storage error carries no values.** Every error caught in storage or reference code passes through one reduction before it is used anywhere: in an outcome, a reason, a log entry or a reply. What leaves is an error kind of this product's, SQLite's primary result code, and the name SQLite gives that code (`SQLITE_CONSTRAINT`), looked up from the code alone. It never carries the message, the SQL, a bound value or any text a caller supplied. Drizzle puts bound parameters in its own error message, and the logger redacts by field name (`QGD-LOG-0003`), so a value inside a message would get past it. This protects `QGD-CRD-0006` and `QGD-PII-0003` on every failure path, including errors that are caught and folded into a result rather than thrown. | Test, Static |
| `QGD-ENG-0017` | **No storage component opens a listener of any kind:** no TCP port, no loopback port, and no Unix socket bound to a path. Electron's own channels between its processes are unnamed and are not this product's to open or close. | Test |
| `QGD-ENG-0018` | **Each extension's data is a folder the core owns,** `extensions/<id>/`. It is created when the extension first needs it and removed with the extension. The identifier comes from a loaded manifest, and the resolved path is checked to stay inside `extensions/` (`QGD-SEC-0004`). The path is never given to the extension. | Test |
| `QGD-ENG-0019` | **Callsigns sort under SQLite's default `BINARY` collation; names sort in the operator's language.** Under `BINARY`, digits come before letters and `W1AW` before `W1AW/4`, because callsigns are ASCII. Names are not ASCII, and their order depends on the language: `Ångström` sorts before `Zulu` in English and after it in Swedish. So a name column is never ordered in SQL. Names are sorted in TypeScript with `Intl.Collator` in the operator's locale, and the tests pin the locale they run in. | Test |
| `QGD-ENG-0020` | **Each request QG Storage serves is one unit of work, run alone on its connection from its first statement to its last.** Drizzle's proxy awaits between the statements of a transaction. Without this rule, an unrelated request could run in the middle of a transaction and be rolled back with it. | Test |

**Retired and never reused** (2026-10-10, with the PostgreSQL engine): `QGD-ENG-0004`, `QGD-ENG-0004.1`,
`QGD-ENG-0004.2`, `QGD-ENG-0005`, `QGD-ENG-0005.1`, `QGD-ENG-0009`, `QGD-ENG-0009.1`, `QGD-ENG-0010`,
`QGD-ENG-0012`, `QGD-ENG-0014` and `QGD-ENG-0014.1`. Their text is in the history of this file.

## 4.2.1 Reference data

| ID | Requirement | Verify |
|---|---|---|
| `QGD-REF-0001` | Reference data lives in `reference.sqlite` (`QGD-ENG-0015`), built by the core from sources it fetched and verified. It is not compiled into the product: a later ADIF release is new data, not a new build. **One exception, the US counties (`QGD-STN-0010`), ships with the product** (KI7MT, 2026-10-22: "county list functionality is a core thing"): it is public-domain Census data that changes about once a decade, and a first run with no network must still fill and check a county. It is built from pinned, checksummed sources when the product is built, and nothing of those sources is in the repository. | Test |
| `QGD-REF-0002` | **Every reference list records who owns it, separately from where this copy came from.** ADIF issues none of the lists it reproduces — the award sponsor does, or the national society, or the ITU — so a list's authority and its source are two different facts and both are recorded, with the version, the date and the SHA-256 of what was fetched. | Test, Inspection |
| `QGD-REF-0003` | ADIF's definitions come from the published resources archive at a pinned version, verified by SHA-256 before anything is read out of it. | Test |
| `QGD-REF-0004` | What is loaded is ADIF's own structure — its data types, its enumerations and its fields — and not a subset re-typed by hand. A field ADIF defines and this product has never heard of is still loaded. | Test |
| `QGD-REF-0005` | The validation is built from the loaded data rather than written against it. A field is checked against the data type and the enumeration ADIF gives it, and against its Minimum Value and Maximum Value where ADIF gives them (a CQ zone is 1 to 40), so a later release that adds a field, a mode or an entity changes the data and not the code. | Test |
| `QGD-REF-0006` | **Where ADIF names an enumeration it does not supply, the validator says so.** `DARC_DOK` and `MY_DARC_DOK` are typed `Enumeration` and ADIF ships no list for either — its own note is that DARC publishes two. Such a value is checked for format and reported as *not checked against a list*, which is neither a pass nor a failure and must not be recorded as one. | Test |
| `QGD-REF-0007` | CQ and ITU zones are carried by ADIF only as columns on `Primary_Administrative_Subdivision`, never as lists of their own. The lists belong to CQ Magazine and to the ITU. What is derived from ADIF's columns is recorded as derived, with ADIF named as the copy and the owner named as the authority (`QGD-REF-0002`). | Test |
| `QGD-REF-0008` | The validation answers ADIF's own test QSOs, which ship in the same archive as the definitions. A case this product disagrees with ADIF about is a finding against this product until shown otherwise. | Test |
| `QGD-REF-0009` | POTA's parks, programs and locations are core reference data (KI7MT, 2026-10-08), held like the rest of it. They are fetched from POTA at run time and **never redistributed**: nothing of POTA's is in this repository or in a release. POTA is credited where the data is used, under `QGD-REP-0005`. | Test, Inspection |
| `QGD-REF-0010` | The park list changes daily, so it is **not pinned by checksum** — `QGD-REF-0003`'s treatment would be wrong for it. Instead every load records where it came from, its `ETag`, its `Last-Modified`, when it was fetched and how many rows arrived; a refresh happens only when the operator asks for it (`QGD-REF-0017`) and asks conditionally; the shape is checked before the previous load is replaced; and a fetch that fails or arrives malformed **keeps the last good data**. Reference data that is briefly stale is worth more than reference data that is briefly wrong. The last good data is kept as files. Each list's body is stored under its SHA-256, and one record of its provenance is renamed into place beside it. Body and provenance are therefore published together, a crash before the rename leaves the previous pair, and a rebuild never invents a fetch time. Each list succeeds or fails on its own: a build after a mixed refresh takes the new lists that arrived and, for a list that failed, its last good body and that body's provenance. A `304 Not Modified` moves the last check forward without a rebuild. A cached body that no record points to is removed after a successful build, so a list that changes daily does not keep every day it ever had. | Test |
| `QGD-REF-0011` | **Published values are stored exactly as published and never corrected** (KI7MT). A row that is wrong is stored as it is and flagged, so the flag is this product's opinion and the value stays POTA's record. Four parks publish coordinates outside the possible range: they are flagged, kept out of anything that measures or maps, and still found by reference. Retired parks are kept, so an old QSO still resolves. POTA's own test park is flagged as a test and kept out of what a user sees. | Test |
| `QGD-REF-0012` | **POTA's `entityId` is POTA's, not ADIF's DXCC entity code**, however often the two agree. Of 311 entity numbers observed in the park list, 298 are also ADIF DXCC codes and 13 are not: POTA numbers Bonaire 524 where ADIF has 520, Crete 536 where ADIF has 40, Mount Athos 534 where ADIF has 180, and lists India under two of its own numbers. The ADIF entity is therefore recorded as a **derived, nullable link where the numbers agree**, never as a key — a foreign key would have refused 113 parks, and dropping a park because two organisations number the world differently is the product deciding one of them is wrong. | Test |
| `QGD-REF-0013` | A park can be in more than one location: 1,618 of them publish `locationDesc` as a comma-separated list. Locations are therefore a table of their own, one row per park per location, rather than a column holding a list. | Test |
| `QGD-REF-0014` | **A reference build that cannot happen does not stop the application starting, and is never reported as a pass.** The definitions and POTA's lists are both fetched from somewhere else, so a first run with no network reaches a working application with no reference data. That state is read from the absence of the file, recorded, and reported as *not loaded* — the same answer `QGD-REF-0006` gives for a list ADIF does not supply, and for the same reason: a validator that cannot consult a list must say so rather than pass everything or fail everything. A build checks only the datasets it holds. POTA without ADIF is published with its ADIF links empty, and ADIF without POTA is published too. A migration failing fails that store (`QGD-ENG-0013`); a build failing does not. | Test |
| `QGD-REF-0015` | **A list derived from ADIF's zone columns is a coverage list, not the zone list, and a cell the derivation cannot read is recorded rather than skipped.** ADIF fills those columns for 152 of its 1,965 subdivisions — five DXCC entities — so the derivation yields 11 of CQ's 40 zones and 22 of the ITU's 90. A zone is therefore reported as *not checked against a list*, which is `QGD-REF-0006`'s answer, and never checked against the derivation. Three of those cells are not zone numbers at all (`S=16 T=17`, `07/08`, `06/07`); they are kept exactly as published, flagged as uninterpreted, and nothing guesses what they mean. A derivation that discards what it cannot read is indistinguishable from one that read everything, which is why recording the unreadable cell is required rather than optional. | Test |
| `QGD-REF-0016` | **A list that does not cover the value's domain cannot judge it.** ADIF's `Secondary_Administrative_Subdivision` enumeration holds 58 rows, every one of them in a single DXCC entity (Alaska), while `CNTY` is typed against it for every entity and `USACA_COUNTIES`'s own documented example is `MA,Franklin:MA,Hampshire`. Three Massachusetts counties appear in ADIF's own test QSOs and none of them is in the list. A value outside what a list covers is therefore reported as *not checked against a list* — `QGD-REF-0006`'s answer — while a value inside its coverage that is absent is invalid. Coverage is decided from the data: by the entity the parameter names where the reference is parameterised, and otherwise by the leading segment of the enumeration's own composite codes. Checking a county against one state's boroughs would have this product call ADIF's documentation invalid, which `QGD-REF-0008` says is a finding against this product. | Test |
| `QGD-REF-0017` | **Reference data is fetched only when the operator asks, one resource at a time** (KI7MT, 2026-10-11: startup must be fast). A start fetches nothing and builds nothing. Settings lists each resource the register names (`data/reference-sources.json`, `resources`) with what it holds, who owns it, its size, whether it is downloaded and when it was last updated, and its own **Download** while it is not on this computer; someone who never uses a resource never downloads it. Once downloaded, **Update** is offered only when it could bring something new: POTA's lists change daily, so always; ADIF's definitions change only with a new ADIF release, which reaches the application when a release pins it, so only while the installed ADIF version is behind the pinned one, and the row names both versions (KI7MT, 2026-10-12). A downloaded resource older than its refresh interval, or a version behind what this release pins, is shown as *out of date*; one never downloaded is *not downloaded*, which is a choice and not a fault. Adding a resource is a row in the register and its loader, not a new screen. | Test |
| `QGD-REF-0018` | **SOTA's summits are reference data the operator may download** (KI7MT, 2026-10-22), held as POTA's lists are: fetched from Summits on the Air only when the operator asks, at most once a day and conditionally, never redistributed, a fetch that fails or arrives malformed keeping the last good list, and every summit stored as published, retired ones with their dates (`QGD-REF-0010`, `QGD-REF-0011`). Kept for each summit are its code, association, region, name, height in metres, position and the dates it is valid between; SOTA's points and its activation count, date and callsign are not kept, the last because it names other operators. A refresh that names no resource checks SOTA only once it has been downloaded, so an operator who never asked for its 25 MB is never sent them. | Test |

## 4.3 Security rules

Electron's threat model treats the screens as untrusted and the dependency tree as a supply
chain. These add to `QGD-PRC-0006`, `QGD-CRD-0006` and `QGD-LOG-*` and do not restate them.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-SEC-0001` | No `eval`, no `new Function`, and no string-form timer. | Static |
| `QGD-SEC-0002` | No `child_process.exec` and no `shell: true`. A child process is started with `spawn` or `execFile` and an argument array. | Static |
| `QGD-SEC-0003` | No dynamic `require` or `import` of a path built from input. | Static |
| `QGD-SEC-0004` | A file path derived from input is checked against traversal before it is used. | Test |
| `QGD-SEC-0005` | Drizzle's `sql.raw()` is not used, except on a fixed literal that carries no input. | Static |
| `QGD-SEC-0006` | Every IPC message, file input and API response is validated against a schema and **rejected, never coerced**, including keys that would pollute a prototype. | Test |
| `QGD-SEC-0007` | The preload exposes named functions only. It never exposes `ipcRenderer`, a generic send, or anything that forwards an arbitrary channel. | Static, Test |
| `QGD-SEC-0008` | The content security policy forbids `unsafe-eval`, inline scripts and remote script sources. | Static, Test |
| `QGD-SEC-0009` | `shell.openExternal` is called only with an allowlisted `https://` URL. | Static, Test |
| `QGD-SEC-0010` | The Electron fuses stay set in a packaged build. | Test |
| `QGD-SEC-0011` | No `{@html}` with content that did not come from this application. | Static |
| `QGD-SEC-0012` | The lockfile is committed and installs use `npm ci`. Dependencies on the credential, crypto, IPC and packaging paths are pinned exactly, a new dependency is a decision someone reviewed, and an audit finding is fixed rather than carried. | Static, Inspection |
| `QGD-SEC-0013` | `make verify` runs the ESLint security rules, `svelte/no-at-html-tags`, and the `sql.raw` ban. | Test |
| `QGD-SEC-0014` | `make verify` runs Electronegativity against the packaged application. | Test |
| `QGD-SEC-0019` | TypeScript is pinned to an exact 6.x. The pin exists so the product is linted from source with type information rather than after compilation, and so component and Electron checking need no isolated dependency trees. **It moves to 7 when `typescript-eslint` supports 7**, and not before: that one tool gates the others in practice. | Static |
| `QGD-SEC-0020` | **The credential core is the only process in this product that opens an outbound connection, and it is the only TLS stack.** All of the application's outbound HTTPS goes through the Rust credential core over `rustls` and AWS-LC in FIPS mode (D-18, D-31). Electron's own networking is BoringSSL, which is not the validated module, so traffic that went that way would not be covered by the FIPS claim this product makes. FIPS-approved suites are the only ones offered, so a server's preference never decides. A connection that carries a credential is TLS 1.3 only. A fetch of public reference data, which carries none, may use TLS 1.2 where its source offers nothing newer, still in FIPS mode: ECDHE with AES-GCM on P-256 or P-384, with Extended Master Secret (NIST SP 800-52r2; KI7MT, 2026-10-11, because adif.org.uk offers only TLS 1.2). Two kinds of destination are permitted and no others: the hosts the reference register names, and the validation endpoint each service profile names. No telemetry, no update check, no analytics, nothing from the renderer (`QGD-CRD-0007`), and nothing from QG Storage, which asks the credential core and receives bytes rather than connecting. A connection from another process, to another host, or on another port is a finding. | Static, Test |
| `QGD-SEC-0021` | **A static gate's scope is derived from the tree, never a list of file names.** Every TypeScript file under `src/` is scanned, and an exception is named with the reason it is one. Three gates in this project went quiet because their scope was a list somebody had to remember to extend: ESLint reviewed no Svelte component, `svelte-check` excluded every story, and `QGD-CRD-0007`'s network gate scanned seven files while the product grew to thirty-six — a `fetch` added to the engine passed it. Each gate therefore carries a control proving its scope is derived: a file placed in the tree with the defect in it must fail the gate. | Static, Test |

### 4.3.1 Cryptographic claims

The wording below is the whole of what this project says about FIPS. It is reproduced in the
README and the documentation **exactly**, and nowhere is it paraphrased.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-SEC-0015` | A cryptographic claim uses the wording in this section exactly, and the wording that applies to the platform the artifact runs on. | Static, Inspection |
| `QGD-SEC-0016` | **Never** "FIPS compliant", "FIPS certified", "FIPS approved application", or "validated" for any module version or platform that is not on a CMVP certificate. | Static |
| `QGD-SEC-0017` | Release evidence records the built module version, the crate version, the platform, and the CMVP validated and submitted lists with the date they were checked. | Test |
| `QGD-SEC-0018` | When a 4.x module version is CMVP-validated, `aws-lc-rs` is pinned to exactly that version and the wording steps up to "validated". An older validated version is not pinned in the meantime. | Inspection |

**Windows and Linux:**

> QSO Graph Desktop performs its cryptography in its credential core using AWS-LC's FIPS module
> (version 4.2.0) in FIPS mode, with FIPS-approved cipher suites only: TLS 1.3 for anything
> that carries a credential, and TLS 1.3 or 1.2 for public reference data. Earlier
> versions of this module hold CMVP certificates; version 4.2.0 is not yet validated. Each
> release records evidence of the module version and mode.

**macOS:**

> Credentials are stored in the macOS Keychain. Network connections use FIPS-approved cipher
> suites, built from AWS-LC's FIPS module source: TLS 1.3 for anything that carries a
> credential, and TLS 1.3 or 1.2 for public reference data. macOS builds are not FIPS builds.

**README:**

> On AWS-LC's FIPS module (FIPS mode on Windows and Linux; not a FIPS build on macOS):
> TLS 1.3 only for anything that carries a credential, and TLS 1.3 or 1.2 with FIPS-approved
> suites for public reference data, whose sources do not all offer 1.3.

> Before the macOS line is published, Apple's current corecrypto certificate for the targeted
> macOS version is checked. Apple's validations trail its releases, so where the targeted
> version is not covered the phrase is "Apple's own cryptographic module", not "validated".

## 4.4 Core and shell

| ID | Requirement | Verify |
|---|---|---|
| `QGD-FRM-0001` | The default theme is Dark (KI7MT, 2026-10-22: rig control and SDR software is dark, day or night). System follows the operating system — light when the system is light, dark when it is dark — and changes with it while the application is running, without a restart. | Test |
| `QGD-FRM-0002` | Settings offers System, Light and Dark. Dark is the default, and the choice is remembered for that user. | Test |
| `QGD-FRM-0003` | Light and dark are equally first class. Dark is properly dark, for night nets and contests, not grey; light carries strong contrast for daylight field use. Both are approved by KI7MT under `QGD-PRT-0103`. | Demo, Inspection |
| `QGD-FRM-0004` | A low-light or red night theme is not built in Release 1. | Inspection |
| `QGD-FRM-0005` | The shell is built in Svelte. | Inspection |
| `QGD-FRM-0006` | Each reusable `ui` component and each reusable pattern has a story. | Test |
| `QGD-FRM-0007` | Every story renders in both light and dark, so a component is seen in each before it is accepted. | Test, Demo |
| `QGD-FRM-0008` | `make verify` builds the gallery, so a story that no longer builds fails the run rather than waiting for someone to open it. | Test |
| `QGD-FRM-0009` | The gallery is development-only. It is not in the shipped application, and it is neither hosted nor published. | Static, Test |
| `QGD-FRM-0011` | **The application opens on Home: our welcome at the top, then the operator's pins** (KI7MT, 2026-10-22: "our advertisement, and the user's quick links"; `QGD-HOM-0003`). The welcome says what the product is and sells it, and every part of it is useful: a headline and one paragraph; three points, each a way into the place it speaks of (the callsigns and the store their logins are kept in, the locations, the pins); this release in one line, with a way to what is new (`QGD-FRM-0016`); and, until each is done, three steps for a new install (add a callsign, add a location, download ADIF's definitions), each a way to where it is done, ticked when done and gone once all are. It repeats nothing the status bar or Settings shows: the version, and what the application sends anywhere, are in Settings' About section; the active callsign and station are on the status bar on every page (`QGD-STN-0005`); reference data is in Settings (`QGD-REF-0017`); the rail is the way into each place. Home is at the top of the rail, and it reads nothing it does not have to: no credential (`QGD-CRD-0009`), nothing fetched, and nothing that waits on QG Storage. That way the first thing an operator sees is drawn whatever else is or is not working. | Test |
| `QGD-FRM-0012` | **The status bar names the data the operator is working in, the way VS Code's names the repository and branch, and storage has no indicator of its own** (KI7MT, 2026-10-10). There is no engine to start or stop. The slot names the active extension's data, and it is empty until an extension holds data (P8). Troubleshooting is reached from the same bar. It carries where the stores are, their sizes, whether reference data is loaded, its sources and when they were fetched, together with the logs, the level switch and a support bundle (`QGD-LOG-0013`). What it shows comes from QG Storage's pushed status (`QGD-ENG-0006`). | Test, Demo |
| `QGD-FRM-0014` | **The header carries the clock** (KI7MT, 2026-10-22; until then Home's Your station card, `QGD-HOM-0009`, retired). UTC first, because ham radio is talked about in UTC, with its date, to the second; local time beside it. Both are the computer's clock, shown within a few milliseconds of each second, and the UTC date changes at 00:00:00 UTC. The application does not check or correct the computer's clock: keeping it right is the operator's (KI7MT, 2026-10-22). The status bar names the active callsign, and the active location with its grid. Sunrise and sunset at the active location, with twilight, the moon and the grey line, belong to the Astro extension's own page (KI7MT, 2026-10-22), to be specified; until it exists they are not shown. | Test |
| `QGD-FRM-0015` | **Help opens the project's documents, each kept once, in the repository** (KI7MT, 2026-10-22). Help's Privacy, Security, License, Attributions, Contributors and Contributing open `PRIVACY.md`, `SECURITY.md`, `LICENSE`, `NOTICE`, `CONTRIBUTORS.md` and `CONTRIBUTING.md` in the operator's browser, as VS Code's Help does, and the documentation site shows the same files; no second copy of any is kept in the application. Settings' About opens the same pages. **Privacy** says what stays on the computer and where logins are kept; when the product goes online, which is only when the operator tests a login, downloads or updates reference data, or pins a card, with nothing about them sent and no analytics, tracking or account; and what can leave, an encrypted export or a support bundle with secrets removed, only where the operator saves it. What it says about going online is what `connection-capture` measures. **Attributions** (`NOTICE`) gives every source of data the product downloads or ships, who it is from and on what terms: every source the registers name is credited, and nothing else is. **Contributors** names who built the product, with thanks: KI7MT, Claude Code and Codex, and whoever else makes a meaningful contribution, as KI7MT decides. `LICENSE` and `NOTICE` also ship inside the application. | Test |
| `QGD-FRM-0016` | **A welcome at start, as WSJT-X shows one** (KI7MT, 2026-10-22): the release, what is new in it, where to report a problem, and thanks to those who built it. It sits over the window and delays nothing; it closes itself after twenty seconds, or when the operator closes it. Its "Don't show this again" holds until the next release, which shows it once more. It replaces the update strip once planned for Home (#46). The suites turn it off for an unpackaged run, as they use recorded NOAA responses; a packaged application always behaves as the operator set it. | Test |
| `QGD-FRM-0010` | The patterns listed in `data/story-patterns.json` have stories by `QGD-PRT-0103`'s exit gate: the page layout, a form showing its validation errors, a list in each of its empty, loading, error and populated states, a confirmation dialog, and the credential test with its status display. A later extension copies the pattern that is there rather than inventing its own. | Inspection, Demo |

## 4.5 Extensions: the runtime and the extension API

`QGD-PRT-0107`. `QGD-PRT-0005` divides the build here: P0 to P7 are the core, and P8 onward are
extensions built on this API. Everything a ham *does* is an extension (D-21); the core holds
only what every extension needs and what protects the user.

This area is constrained by three decisions before any requirement is written. **D-33:** QSO
Graph's own extensions use the same message API as every other extension, with no private
shortcut, unless a measurement later shows one is needed and it is written down as a numbered
decision. **D-2:** three tiers — official, contributed, unofficial — with contributed and
unofficial sandboxed (D-2). **D-21:**
the core's scope, above.

**Vocabulary** (KI7MT, 2026-10-10). The layers are named as developers already know them, from the
open-source desktop applications whose extension models this one follows (`QGD-HDBK-001` §14):

| Term | Meaning | Manifest tier |
|---|---|---|
| **Core** | P0–P7: what every extension relies on and what protects the user | — |
| **Built-in extension** | an official extension shipped and on by default | `official` |
| **Official extension** | built, verified and maintained by this project; built in, or installed by choice | `official` |
| **Third-party extension** | anyone else's; sandboxed, after Release 1 (D-2) | `contributed`, `unofficial` |

Operators see each extension named for what it does ("Club", "Net Control"). The word *extension*
appears only where extensions are added and removed. The code uses the same names: `extension-api`,
`extensions/` and the extension broker (`qso-graph-desktop#34`).

| ID | Requirement | Verify |
|---|---|---|
| `QGD-APP-0001` | **An extension declares itself in data.** A manifest gives its id, its name, its tier, its version, the grants it asks for, what it contributes, and where its page is if it has one (`QGD-APP-0019`). Nothing about an extension is learned by running it, so the core can refuse one before any of its code is loaded. Same rule as the service register (`QGD-PSN-0002`): what a thing needs is data, not branches. | Test |
| `QGD-APP-0002` | **One API path.** An extension reaches the core only through `extension-api`, and a built-in extension uses it exactly as a third-party one would (D-33, `QGD-REP-0003`). There is no second route for official code — no direct import of `callsigns`, `storage`, `reference` or `main`, which `QGD-REP-0006` enforces over the imports themselves. | Test, Static |
| `QGD-APP-0003` | **The API is messages, not functions.** Every call is a typed message, validated on arrival and rejected rather than coerced (`QGD-PRC-0005`, `QGD-SEC-0006`), and nothing the core hands an extension is a live reference into the core. This is what makes D-2's sandbox a later Part rather than a retrofit: moving an extension into its own process changes the transport and leaves the API alone. An API of function calls would have to be redesigned to be sandboxed, and by then there would be extensions written against it. | Test, Inspection |
| `QGD-APP-0004` | **Only the official tier loads in Release 1, and an unofficial manifest is refused rather than trusted.** The three tiers are named now because the API's shape depends on there being more than one, but the sandbox contributed and unofficial need is a later Part. Until it exists, a manifest whose tier is not `official` fails to load and says so — it is never loaded unsandboxed because the sandbox is not written yet. Failing closed is the whole point: the alternative is a release that runs third-party code with the core's privileges. | Test |
| `QGD-APP-0005` | **No grant, no capability.** An extension starts with nothing: it can draw its page and call the parts of the API that need no grant, and every capability beyond that is refused unless the manifest asked for it and the operator allowed it. A grant is checked in the core at the point the capability is used, never in the extension that is asking. | Test |
| `QGD-APP-0006` | **The set of grants is closed and declared in data.** A manifest asking for a grant the register does not define is refused at load, with the grant named. A capability nobody has written down is not a capability — it is a hole, and an extension that could ask for anything would be checked against nothing. | Test |
| `QGD-APP-0007` | **An extension never receives a credential secret.** A `service` grant lets the core act with a credential on the extension's behalf and return the result; it never returns the secret, and no reply, log line or error carries one (`QGD-CRD-0006`, `QGD-CRD-0007`). The extension names a callsign and a service and gets an answer. | Test, Static |
| `QGD-APP-0008` | **An extension opens no connection, and never names a destination.** All outbound HTTPS is the credential core's (D-18, D-31), so an extension asks for a *registered source* by name and the URL comes from the register — the same rule reference data follows (`QGD-REF-0001`). An extension carrying a host or a URL is a destination nobody registered. | Test, Static |
| `QGD-APP-0009` | **Each extension's data is its own folder and database, reached only through the API** (`QGD-ENG-0018`). An extension never receives a path or a connection, and it reaches its own data and no other extension's. Reference data is read through the API and never by opening `reference.sqlite`, because the core is what enforces the grants (`QGD-REP-0003`) and a direct handle would bypass it. | Test |
| `QGD-APP-0010` | **An extension reads and writes only what the operator chose in that action.** There is no ambient filesystem: a path arrives from a dialog the operator used, is used for that one action, and is not kept. The extension's own folder (`QGD-ENG-0018`) belongs to the core and is never a path the extension holds. Exporting or sharing is an explicit action and never a side effect (`QGD-PII-0004`). | Test |
| `QGD-APP-0011` | **A refusal is visible.** When a capability is refused the operator is told, in words, which extension asked and what for, and the refusal is logged (`QGD-LOG-0001`). A silently refused extension looks broken, and the person who could report it has nothing to report. | Test |
| `QGD-APP-0012` | **What each extension holds is recorded, and a withdrawal takes effect without a restart.** The core reads the allowed grants on every request rather than at load, so taking one back needs no restart and no reload of the extension. This is the guarantee; where it is put to the operator is `QGD-APP-0012.1`. | Test |
| `QGD-APP-0012.1` | **An official extension's grants are enforced and are not put to the operator** (KI7MT, 2026-10-10). Its grants are what the extension is, so a per-capability choice offers no decision and teaches the operator to agree. A contributed or unofficial extension is instead trusted by its **source, once, when it is installed**, and that trust is revocable in one place. This requirement is met by the Part that introduces those tiers under D-2; until then there is no such extension and every grant an unofficial manifest asks for fails closed. | Test |
| `QGD-APP-0013` | **An extension that fails does not take the core down** (`QGD-PRC-0001`), and the core says which extensions were affected rather than failing as something else; which one caused it is named only on evidence (`QGD-APP-0022`). | Test |
| `QGD-APP-0014` | **The grant model is proven by unit tests, and demonstrated by extensions that are real features** (KI7MT, 2026-10-10). Every decision the runtime can make — a grant held, a grant asked for and not allowed, a grant never declared, a capability that does not exist, a duplicate identifier, an unreadable manifest, a tier that may not load — is exercised against manifest fixtures with no window, no database and no network, because a decision that needs those to test is a decision tested once. **No extension exists only to be demonstrated.** The end-to-end demonstration is the first extension that does ham work. | Test |
| `QGD-APP-0014.1` | **The packaged application is built from a list of the paths that ship, and that list is asserted on the artifact.** An allowlist is what makes every development-only thing absent by construction rather than by remembering: the gallery (`QGD-FRM-0009`), the suites, the fixtures and anything added later are outside it unless somebody names them. So the check is that the list is still a list — not a wildcard over the repository with exclusions — and that the built archive holds no path from the development tree. "Not shipped" is a check on what was built, never a statement of intent. | Test |
| `QGD-APP-0015` | **Extension code runs only in an extension host** (KI7MT, 2026-10-11, the VS Code model): an Electron utility process, **QG Extensions**, started by the extension broker. An extension's logic never runs in the renderer or in main, which is the broker that enforces grants. An extension's own page, if it has one, is a **webview** as in VS Code: its files in an isolated, sandboxed frame of their own origin, with no Node and nothing but messaging to the core; its contract is specified before the first extension with a page ships. The broker addresses *a* host, never *the* host, so how many hosts there are and how they are reached stay internal and can change; the contract in `QGD-APP-0019`–`0021` cannot. | Test, Static |
| `QGD-APP-0016` | **Official extensions are trusted code** (KI7MT, 2026-10-11). A utility process has Node's file, network and process access, so a host does not contain malicious code; the grant model holds an official extension to its declared grants against mistakes, not against intent. Containing code that is not trusted needs an OS-enforced sandbox, verified on each platform, and that sandbox is a precondition of loading any contributed or unofficial extension (`QGD-APP-0004`). | Inspection |
| `QGD-APP-0017` | **Official status comes from provenance, never from the manifest.** The project decides what is official, with KI7MT as maintainer: an extension is reviewed, verified fully compatible, and maintained by the project from then on. Until signing exists only extensions shipped inside the application package load; once installable official extensions exist, each is signed with the project's key and verified against the public key the application carries before any of it loads (`QGD-SCP-0003`). A manifest's `tier` field confers nothing. | Test |
| `QGD-APP-0018` | **The broker owns identity.** It gives each extension its own channel to the broker, bound to that extension alone, and attributes every request by the channel it arrived on, never by an identifier the request carries. A host relays an extension's channel and cannot address another extension's. | Test |
| `QGD-APP-0019` | **The contract is versioned from the first extension.** A manifest states its `manifestVersion` and the extension API versions it works with (`engines.qgd`, as VS Code's `engines.vscode`); one the core cannot satisfy is refused with the version it needs. Field names follow VS Code's: `main`, `contributes`, `activationEvents`; `page` is optional. An unknown field is refused, never ignored (`QGD-SEC-0006`). Extension and card identifiers, once published, do not change. | Test |
| `QGD-APP-0020` | **Lifecycle.** An extension's `main` module exports `activate(context)` and may export `deactivate()`. Activation follows from its contributions (a pinned card activates the extension that offers it) as well as from `activationEvents`; concurrent reasons to activate become one activation, and an extension is active at most once at a time. A failed activation marks the extension failed, its cards say so, and it is not retried until it is re-enabled or its host restarts. Disabling deactivates it; re-enabling activates it again in the same host. `context` holds message wrappers and disposables only: never a core object, a path or a Node capability the core grants. Deactivation is bounded in time; an extension that overruns it causes its host to be restarted, which is reported as affecting every extension in that host. | Test |
| `QGD-APP-0021` | **Messages carry their own bookkeeping.** Every request has a correlation id and a deadline. Cancelling is a request, not a guarantee: every request ends **completed**, **cancelled** (confirmed not to have taken effect) or **unknown**, and a write that ends unknown, by deadline, cancellation or crash, is reported as such and never replayed automatically. A reply after its deadline, or a second reply, is discarded. Every failure is a structured error with a kind and no value (`QGD-ENG-0016`). The deadlines, the message size limit, the number in flight and the restart budget are numbers in `data/extension-limits.json`, so each is testable and none is a constant in code. | Test |
| `QGD-APP-0022` | **The host is supervised for hangs as well as crashes** (refines `QGD-APP-0013`). A watchdog stops a host that stops answering; restarts back off and stop at the budget in `data/extension-limits.json`; requests in flight end as `QGD-APP-0021` says; replies from a host that has been replaced are discarded. The core says which extensions were affected, and names one as the cause only when the evidence points to it. | Test |
| `QGD-APP-0023` | **Window readiness never awaits the host.** The host starts in the background after the broker is ready, and an extension activates only when something needs it, so a Home with nothing pinned starts no extension (`QGD-SCP-0009`). | Test |

## 4.6 Home and its cards

Home is the base product: *informational, not overbearing, useful*. It answers "should I turn the
radio on, and what's out there?" at a glance (KI7MT, 2026-10-11, `qso-graph-desktop#35`). The core
owns the page; extensions contribute what is on it, as dashboard cards come from providers in the
reference projects.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-HOM-0001` | **Cards come from extensions, through a declared contribution.** An extension's manifest lists the cards it offers, each with an id, a name, a one-line description and the shortest interval it may refresh at. The core keeps the list of every available card and never hard-codes one. | Test |
| `QGD-HOM-0002` | **The core draws every card.** An extension answers a card's request with data in one of the core's card shapes (figures, a list of items, an alert, from card data version 2 a table of rows under named columns, which follows its card's width rather than wrapping a column a word to a line, and from version 3 a figure's own observed time, where its source updates on a different schedule from the card's other figures) and the core renders it with the shared components. No extension code or markup runs on Home. The shapes are versioned and carry units, the time the data was observed, how fresh it is, and an unavailable or failed state; their content is bounded. The data is checked on arrival and refused rather than coerced (`QGD-SEC-0006`). | Test |
| `QGD-HOM-0003` | **Pins, as on a GitHub profile.** Up to eight pages are pinned to Home, in an order the operator sets, by dragging them on Home, with Alt and the arrow keys, or in a "Customize your pins" list that shows each available page's name and description. Pins are kept in `settings.json`. Installing or enabling an extension offers its pages and never pins them. **A pin is a tile, not a dashboard** (KI7MT, 2026-10-22): drawn by the core from the extension's manifest alone, its icon from the core's set, its name on one line and its description on two, the same shape and size for every extension, so every extension conforms. Home fetches nothing; clicking a tile opens its page in the main pane, and Home returns to the tiles. **Home is laid out as a GitHub profile:** a welcome of the project's own at the top (`QGD-FRM-0011`), then the pins under a "Pinned" heading, in a grid of at most four to a row so eight read as two rows of four. The grid is never wider than four tiles (1088 px), stays at the left as every other page's content does, and answers to the width of the page rather than the window, falling to three, two and one as the page narrows; four across is a 14–15" laptop at full screen, the default target. | Test, Inspection |
| `QGD-HOM-0004` | A new install starts with the day-one cards pinned: Conditions, and DX on the air once it exists. A pin for a card that no longer exists is skipped. | Test |
| `QGD-HOM-0005` | **Only pinned cards fetch, and the broker decides when.** The broker schedules each refresh from the pins, whether Home is showing and the card's interval; an extension never polls on its own, and a reply that arrives after its card was unpinned or the callsign changed is discarded. A card refreshes only while Home is showing, and never more often than the interval it declared or its source allows, as `QGD-REF-0010` holds POTA's lists to once a day. A callsign change is a new question rather than a refresh: what each card showed is dropped and it is asked again once, when Home next shows. An unpinned card costs nothing. | Test |
| `QGD-HOM-0006` | A card whose source fails says so in words on that card, and the rest of Home is unaffected. | Test |
| `QGD-HOM-0007` | **On the Air** is a built-in extension: it ships with the application, is on by default, and can be turned off, which removes its cards from Home and from the list. It reaches the core only through the extension API and its grants (`QGD-APP-0002`). | Test |
| `QGD-HOM-0008` | **Conditions:** solar flux, the planetary K and A indices, NOAA's space weather scales (R, S and G), an alert when any of them is above 0, each reading with its own observed time (KI7MT, 2026-10-22: NOAA measures the flux once a day, at 20:00 UTC, and the K index every three hours, so one time for the card made one of them look a day old), the flux as the number alone, and the band-by-band outlook as a table of band, status and comment whose status is one of five words defined in `extensions/on-the-air/BAND-OUTLOOK.md` (Excellent, Good, Fair, Poor, Sporadic; KI7MT, 2026-10-22: no standard defines them, so this project does, and its per-band thresholds are rules of thumb, said so), from NOAA's Space Weather Prediction Center, fetched through the credential core like every outbound request (`QGD-SEC-0020`). `solar-mcp` is the specification for its behaviour: both are tested against the same recorded NOAA responses, and neither copies the other's code. | Test |
| `QGD-HOM-0010` | Home meets the floor: with its day-one cards pinned it stays within `QGD-SCP-0009`'s memory and responsiveness on a Raspberry Pi 5. | Demo |

**Retired and never reused:** `QGD-HOM-0009`, Home's Your station card (2026-10-22, KI7MT: everything on it is shown elsewhere). The clock moved to the header and the callsign and location to the status bar (`QGD-FRM-0014`); sunrise and sunset move to the Astro extension's page, to be specified.

## 5. Test, verification and release

| ID | Requirement | Verify |
|---|---|---|
| `QGD-TST-0001` | One command, `make verify`, runs every check and produces the report. | Test |
| `QGD-TST-0002` | `make verify` exits non-zero on any failure. | Test |
| `QGD-TST-0003` | The report records pending acceptance evidence honestly — a gate not yet met is reported as not met, never as passed or omitted. | Inspection |
| `QGD-TST-0004` | `QGD-RVM-001.md` is generated from this document's Verify columns. A hand-edited RVM fails `make verify`. | Test |
| `QGD-TST-0005` | Every requirement in this document carries at least one Verify method. `make verify` fails if one does not. | Static |
| `QGD-TST-0006` | Security tests pass before any artifact is published outside this machine. | Test |
| `QGD-TST-0007` | A failure of the credential round-trip in `QGD-PRT-0100` stops only the suites that use the OS credential store; `make verify` reports those as not run, and still runs and reports every suite that does not use it, including the build and the packaging step. | Test |

## 6. What this document does not contain

Deliberately absent, with where each lives instead:

| Not here | Where |
|---|---|
| Rationale, history, worked examples, the dialectical record | `QGD-HDBK-001` |
| Review findings and open questions | GitHub issues on `qso-graph/qso-graph-desktop` |
| The verification matrix | `QGD-RVM-001` — generated, never hand-written |
| Review process, gates, panel composition, merge authority | Nowhere in this repo; it is not product |
| Registers of transports and critical services | Data files beside the code, not prose |
