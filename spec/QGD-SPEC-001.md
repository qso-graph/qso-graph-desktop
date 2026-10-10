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
| `QGD-CRD` | Credential core, persona storage, grants |
| `QGD-PII` | Personal data — club rosters and anything carrying a third party's details |
| `QGD-PSN` | Personas, service profiles, and moving them between machines |
| `QGD-PRC` | Process map and IPC |
| `QGD-FRM` | Frame, shell, and the component gallery |
| `QGD-APP` | App runtime, the app API, grants and trust tiers |
| `QGD-ENG` | Database engine |
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

## 1. Scope

| ID | Requirement | Verify |
|---|---|---|
| `QGD-SCP-0001` | The target is a single operator on a single computer. | Inspection |
| `QGD-SCP-0002` | The current build platform is **macOS on arm64**, on the M3, and nothing else. | Static |
| `QGD-SCP-0003` | **Signing and notarization are deferred, not cancelled.** D-27 stands as the Release 1 intent — SignPath (Windows), Apple Developer ID and notarization (macOS), QSO Graph's own key (Linux). **No Part before Release 1 is gated on a signing identity, a signing pipeline, or a notarized artifact.** | Static |
| `QGD-SCP-0004` | **macOS arm64 is the only platform required before Release 1.** Windows and Linux remain Release 1 targets under D-27. No Part's exit gate before Release 1 requires a second operating system, a CI matrix, or a clean VM of another OS. | Static |
| `QGD-SCP-0005` | The sequencing in `QGD-SCP-0003` and `QGD-SCP-0004` changes only by KI7MT's direction, recorded here. **An agent may not pull signing or a second platform forward into an earlier Part.** | Inspection |
| `QGD-SCP-0006` | Linux distribution through COPR and Launchpad is an **open question**, not a commitment: a bundled Electron runtime, a native addon and a managed PostgreSQL may exceed what those services will build or carry. Resolved before Release 1 packaging, tracked in an issue. | Inspection |
| `QGD-SCP-0007` | **Known limitation, not a requirement met: QSO Graph does not sign in to POTA, and holds no POTA credential.** POTA's sign-in registers one client, for POTA's own web app, and `QGD-PSN-0012` forbids borrowing it. An email-and-password account could have been reached by an SRP exchange, but that serves only accounts created that way — not an Amazon, Google or Facebook account, which has no password and cannot be given one. **That path is not taken** (KI7MT, 2026-10-09). So the POTA application is built to work with no POTA login at all — park data, spots and filters, self-spotting, logging to the neutral log, and public statistics — and submitting a log is done on POTA's own page. An in-app upload waits until POTA registers a desktop client for QSO Graph. | Inspection |

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
| `QGD-PRT-0005` | **P0 to P7 are the frame; P8 onward are applications built on the API the frame provides.** A Part in the second group uses the app API and the grant model, never a private route into the frame. | Inspection |

### 2.1 Parts

| Part | ID | What | Depends on | Exit gate |
|---|---|---|---|---|
| **P0** | `QGD-PRT-0100` | Rust persona core (`napi-rs`), OS credential manager only, keyring naming convention | — | The core loads in Node and round-trips a credential through the macOS Keychain, unattended: write, read back, replace, select, delete, and the entry named by the convention |
| **P1** | `QGD-PRT-0101` | A window that calls the core and shows a persona on screen | P0 | `npm start` opens a window on the M3 showing persona metadata and **credential status** (stored / present, never the value) obtained through the Rust core. The secret round-trip is proven in the core's Keychain round-trip under `QGD-PRT-0100`, never on screen — see `QGD-CRD-0006`, `QGD-CRD-0007` |
| **P2** | `QGD-PRT-0102` | Process map: main as IPC broker, utility processes, typed IPC contract; application logging | P1 | Killing a utility process leaves the window running and the process recovers; malformed IPC is rejected. Every process logs into one redacted JSON-lines stream held inside the size, total and retention caps, and a raised level reverts on its own |
| **P3** | `QGD-PRT-0103` | Shell: rail, pages, Settings, status bar, themes | P2 | e2e navigation; screenshot baselines approved by KI7MT **in both light and dark**; axe clean |
| **P4** | `QGD-PRT-0104` | Engine: bundled PostgreSQL, lifecycle, data directory, local endpoint, roles per app, backup and restore, migrations | P2 | Engine starts on its local endpoint — a Unix socket where the platform has one, a free loopback port where it does not; restore works; migrations apply |
| **P5** | `QGD-PRT-0105` | Reference data: ADIF definitions (`all.json`), CQ and ITU zones, DOKs, and the validation built from them | P4 | The reference data loads into the engine and the validation built from it answers ADIF's own cases |
| **P6** | `QGD-PRT-0106` | QG Personas: personas, service profiles, guided setup and a test per credential, expiry warnings, encrypted export and import | P0, P4 | KI7MT walks setup on a clean machine; export round-trips |
| **P7** | `QGD-PRT-0107` | App runtime, official tier, grant model, over the message API — the app API | P6 | An app without a grant is refused, proven by unit tests over the runtime, the manifest validator and the broker; demonstrated end to end by the first real application (KI7MT, 2026-10-10) |
| **P8** | `QGD-PRT-0108` | QG ADIF: validate, check and repair `.adi` files, using the core's ADIF definitions from `QGD-PRT-0105` through the app API, as any application does under `QGD-REP-0003`, rather than loading them itself. **Files only; no QSO storage** | P5, P7 | ADIF's test QSOs pass; an anonymized copy of KI7MT's log round-trips, equal except documented fields |
| **P9** | `QGD-PRT-0109` | QG Club: club definition and roster | P7 | The field canvas's cases load |
| **P10** | `QGD-PRT-0110` | QG Editor: **generate, validate and maintain** a club's `.cli` (club information) and `.prf` (roster) files in NetLogger's own format — the authoring tool clubs currently do not have | P9 | A club with no file generates a valid one; a file carrying headers copied from another club's file is detected and reported; synthetic fixtures round-trip byte for byte where the user did not edit |
| **P11** | `QGD-PRT-0111` | Updates and onboarding | P6–P10 | An update installs on a clean machine |

**Release 1 = P0–P11.**

**The logbook store and QG Log are not in Release 1.** This replaces D-29, which placed the
logbook store inside it. Release 1 reads and writes ADIF files; it does not keep QSOs.

**After Release 1**, in order: the logbook store, then QG Log. Then, each its own Part in an
order KI7MT sets: QG Reference's browsable surface, QG Net, the representative spike, QG NCS,
LoTW signing, the contributed tier and sandbox, QG Spots, QG Rig, the Vault store, QG Sync,
QG Atlas, QG Predict, QG Chat, and QG Awards once "awards" is defined.

> Any document placing the shell ahead of the credential core contradicts `QGD-PRT-0001` and is
> wrong by this specification. Rationale: `QGD-HDBK-001` §2.

## 2.2 Repository layout

| ID | Requirement | Verify |
|---|---|---|
| `QGD-REP-0001` | The repository is laid out as `packages/` — `persona-core`, `main`, `preload`, `renderer`, `ui`, `engine`, `reference`, `personas`, `logging`, `app-api` — `apps/` — `adif`, `club`, `editor` — each application carrying its own `package.json`, `src/`, `tests/`, README and icon, and `storybook/` at the root for the component gallery. A package holds its files directly; `src/` and `tests/` are an application's shape, not a package's. The compiled tree mirrors it, so `dist/<package>/` is where a process finds its siblings. | Inspection |
| `QGD-REP-0002` | The move to that layout happens at `QGD-PRT-0107` and not before. Recording it here is not permission to begin it. | Inspection |
| `QGD-REP-0006` | **The dependency direction between packages is fixed, and enforced over the imports themselves.** `persona-core`, `logging`, `reference`, `ui`, `preload` and `app-api` depend on no other package — `app-api` because a surface that imported the frame's own contracts would hand an application the frame's internals through its own types; `personas` and `engine` depend only on those; `main` adds `personas`, `engine` and `app-api`; `renderer` may depend on anything below it and nothing may depend on `renderer`. An application depends on `app-api` and `ui` and on nothing else, which is `QGD-REP-0003` made structural. A contract lives with the side that serves it and its callers depend on it, never the reverse. Checked against the imports rather than asserted, because the layout is only worth the move if a wrong-direction import cannot land. Stories are excluded and the exclusion is named: a `.stories.svelte` ships nowhere (`QGD-FRM-0009`) and the gallery is required to show a component the way the shell does (`QGD-FRM-0006`), which is why the rail's story reads the shell's own page list. | Test |
| `QGD-REP-0003` | A built-in application uses only the app API and its grants, exactly as a contributed application would. Personas, the engine and the reference data are frame, not applications, because the frame enforces the grants. | Inspection |
| `QGD-REP-0004` | `app-api` and `ui` are separate packages: what an application may call and what it may look like are different contracts. | Inspection |
| `QGD-REP-0005` | Third-party material that ships inside the application is recorded in `NOTICE`, with its licence and the version that ships. Where that licence requires attribution, the attribution also appears in a surface the user can reach — the About panel — because a file in the repository is not somewhere a user can be expected to look. | Test, Inspection |

## 3. Credential core

| ID | Requirement | Verify |
|---|---|---|
| `QGD-CRD-0001` | The credential core is Rust, built as a `napi-rs` native addon. | Static |
| `QGD-CRD-0002` | The core owns the OS credential stores, X.509 and PKCS#12 handling, certificate expiry, and the grant model's enforcement point. | Inspection |
| `QGD-CRD-0003` | The credential core owns its OS credential-store entry names and sets them explicitly, never leaving them to a library default. | Test |
| `QGD-CRD-0004` | **QSO Graph Desktop has no Python and no MCP-server interoperability, in any Part, now or later** (KI7MT, 2026-10-08). No requirement, suite, gate or shipped artifact depends on a Python runtime or on `qso-graph-auth`. | Static |
| `QGD-CRD-0005` | The credential core is Rust and the shell and frame are TypeScript. | Inspection |
| `QGD-CRD-0006` | A credential never appears in a log, an error message, an IPC payload rendered to a screen, or a report. | Static |
| `QGD-CRD-0007` | The renderer never holds a credential and never opens a network connection. | Static, Test |
| `QGD-CRD-0008` | The OS credential manager is the only store in Release 1. A user's own Vault is a later Part. | Inspection |
| `QGD-CRD-0011` | A control that cannot be used says why, without being pressed, in words a screen reader reaches. Whether a service can be tested at all, and whether there is anything saved to test, are both known in advance and are reported in advance. **A disabled control is never drawn as a busy one.** (KI7MT, 2026-10-08: Club Log's Test button was disabled, unexplained, and drawing a spinning busy cursor, because the shared disabled style said `cursor: wait`.) | Test |
| `QGD-CRD-0009` | **No credential secret is read at startup, by navigation, or to display status.** A secret is read only on an explicit action of the operator's that needs it — testing a credential, or handing one to something that will use it. Reading a secret is what makes macOS ask for the login keychain password, and asking for it before the operator has done anything is both alarming and unearned. (KI7MT, 2026-10-08: opening the application prompted him, because the remembered persona was selected and its status read.) | Test |
| `QGD-CRD-0010` | The status display answers from the index and from the existence of the Keychain entry — which the Keychain reports from an item's attributes without unlocking its data — and never from the secret. Which kinds of secret an entry holds is not itself a secret, and is recorded when it is written. | Test |
| `QGD-CRD-0012` | **A secret is stored only if the operator entered it in that action.** Intent is read from the operator's own input, not from what the field holds when the button is pressed — so a value that reached a secret field some other way (a stale value, an autofill, a paste landing late while focus moves) is not written. A blank field still means *keep what is saved*, and `Remove` is still how a secret is deleted; what changed is that untouched now means the same as blank. (KI7MT, 2026-10-09: `packaged-launch` stored a password into an entry whose field the suite had just emptied, and he directed it be treated as a security bug rather than a record entry. It was not reproduced in twelve runs, eight under load, so this removes the product's dependence on that field being correct rather than fixing a known mechanism — which is what every candidate mechanism had in common.) | Test |
| `QGD-CRD-0013` | **The suites never write a credential beside a real one.** Fixtures go to a Keychain service of their own, selected by the presence of an environment variable and never named by one — a variable that supplied the service would be a route into another product's namespace from outside the process. Everything under the test service is swept when a suite exits, including when it throws or is signalled, and again before the next run starts, because the runs that left fixtures behind were the ones that never reached their cleanup. (KI7MT, 2026-10-09: seventeen `qg-test-…` fixtures were found in his real login keychain, in the same namespace as his and KE1HA's actual credentials. Nothing under that namespace is migrated, read or deleted by this product — it may be the MCP servers' data.) | Test |
| `QGD-CRD-0013.1` | **A release's verification run happens in an account whose login keychain holds nothing of the operator's** (KI7MT, 2026-10-09). `make verify` runs from the non-admin `qgdesktop` account. A separate account has its own login keychain, so the isolation is the operating system's property rather than something the suites have to keep getting right — and it needs no change to the credential core's proven paths, which a per-run temporary keychain would have, because targeting a keychain file means routing the credential path off the library the naming convention is a contract with (D-17, `QGD-CRD-0003`). The per-service scoping in `QGD-CRD-0013` stays as the net for day-to-day runs: two controls, and the one that does not depend on the suites behaving is the stronger. That account cannot read the working repository and holds no credential for the remote, both deliberately, so the commit is pushed across to a shared checkout from the developing side. Procedure: `docs/VERIFY-ACCOUNT.md`. | Demo, Inspection |

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

| `QGD-PII-0005` | A club customises by **defining lists** — offices, membership classes, net roles, award categories — and by assigning members to them with dates, so history is kept. A club never adds fields: the schema is the same for every club. | Inspection, Test |
| `QGD-PII-0006` | Club data on a user's machine is theirs. Nothing is collected, no telemetry is sent, and no feature pushes another person's details to a shared or public service. | Static, Inspection |
| `QGD-PII-0007` | **A callsign lookup may be shown in full; none of it is kept or passed on except named radio fields** (KI7MT, 2026-10-09). A lookup the operator asked for is displayed as the service returned it, street address, email address and telephone number included: the service is the source for that lookup, as its own site is. What this requirement governs is what the product **keeps and passes on**. A lookup result is never written to a log (`QGD-CRD-0006`), never saved to the database, a cache or any file, and never leaves the machine in an export, a sync or anything shared. What may be **persisted** is a named list — callsign, name, grid, country, DXCC, CQ and ITU zone, licence class, coordinates where a grid needs them, QSL manager, and the LoTW and eQSL flags — never *everything except* a list of exclusions, because a denylist is a guess about somebody else's response format and the format can change underneath it. So the allowlist governs storage and egress, not the screen. | Test |

## 3.2 Personas and services

`QGD-PRT-0106`. P1 built the mechanism — a persona, a provider, a secret in the Keychain — and
nothing wrote down the rules it answers to. These do. The credential core's own rules are §3
above and are not restated here.

The area is `QGD-PSN`: a persona is the operator's identity, and a service profile is what a
service needs from them. Both are the frame's, not an application's (`QGD-REP-0003`).

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PSN-0001` | **A credential belongs to a persona and a service, never to the application.** A persona is a callsign, a name to tell it by, and the period it was used; an operator has as many as they have callsigns. Nothing is stored against "the user". | Test |
| `QGD-PSN-0002` | **What a service needs is data, not branches.** Each service's profile records the fields it takes, which of them is a secret, how it is tested, and what the operator has to do at the service's own site to get one. A service added to the register appears in setup with its own fields and its own test, with no code change — the same rule `QGD-REF-0005` applies to ADIF's definitions, applied to services. | Test |
| `QGD-PSN-0003` | **The six services P1 hardcoded become register entries.** `qrz`, `qrz_logbook`, `eqsl`, `lotw`, `hamqth` and `clublog` are the Release 1 set and are what the register ships with. A command naming a service the register does not hold is refused before it reaches the core (`QGD-SEC-0006`). POTA is **not** among them: it is reference data (`QGD-REF-0009`), this product never signs in to it (`QGD-SCP-0007`), and the application that uses it holds no credential. | Test |
| `QGD-PSN-0004` | **Guided setup asks for the callsign and nothing else.** On a machine with no personas the application offers to make one; every service after that is optional, can be skipped, and can be returned to. A setup that cannot be left half-done is a setup an operator abandons. | Test, Demo |
| `QGD-PSN-0005` | **Every service either has a test or says it has none**, and which it is is known before the operator presses anything (`QGD-CRD-0011`). A test reports what happened — accepted, rejected, could not be reached, rate-limited, nothing saved to test — and never the secret it used (`QGD-CRD-0006`). | Test |
| `QGD-PSN-0006` | **No credential this product stores expires, because it holds no certificate.** TQSL is a required install the user owns (D-9). This product holds no certificate and manages no station locations: it lists the locations TQSL holds and signs through TQSL's library. So the LoTW credential kept here is the web account, which carries no date, and there is nothing to read an expiry out of. The register states that per service, and a register claiming an expiry is refused, because nothing in this product can compute one. If a credential that expires is ever stored, its expiry is read from the credential itself and never from something the operator typed (`QGD-CRD-0002`), and the application says so while there is still time to act. The status answers *no expiry known* rather than leaving a credential looking good for ever. | Test |
| `QGD-PSN-0007` | **An export is encrypted or it is not written.** Personas, their service settings and their secrets leave the machine only as one file, encrypted with a passphrase the operator chooses at the moment of export. The passphrase is not stored, not defaulted, and not derived from anything the machine knows — an export a thief can open by stealing the machine is not an export, it is a copy. | Test |
| `QGD-PSN-0008` | **The export names its algorithms and its version in the clear**, so a file can be read by a later release that has moved on from them: AES-256-GCM over the whole payload, a key from PBKDF2-HMAC-SHA-256 with a random salt and a recorded iteration count, and a random nonce. The wording of any claim about them is `QGD-SEC-0015`'s. | Test, Static |
| `QGD-PSN-0009` | **An import is all of the file or none of it**, and it says what it would overwrite before it does. A file that fails its authentication tag is refused whole. | Test |
| `QGD-PSN-0010` | **A wrong passphrase and an altered file are the same signal, and the product says so rather than guessing.** An AEAD tag fails identically for both, so an import reports "this file could not be opened with that passphrase — it may be the wrong passphrase, or the file may have been altered". Claiming to know which would be a guess presented as a fact. | Test |
| `QGD-PSN-0011` | **Nothing leaves the machine.** An export is written where the operator chooses and sent nowhere, exactly as `QGD-LOG-0012` has it for diagnostics. Exporting is an explicit action and never a side effect of opening or saving anything (`QGD-PII-0004`). | Test |
| `QGD-PSN-0012` | **This product does not sign in as somebody else's application.** An OAuth or Cognito client identifier names the application, not the operator, so using POTA's web client would mean telling their sign-in service that QSO Graph is POTA's website — a false identity even with the operator's own password and consent, and one that leaves POTA unable to tell our traffic from their own, rate-limit it, or revoke it. The same holds for any service. Where a service offers no client of its own for this product, there is no sign-in: the capability waits until that service registers one. (KI7MT, 2026-10-09, dropping a POTA SRP exchange that was half built on exactly this path.) | Inspection, Static |
| `QGD-PSN-0013` | **A capability this product does not have is stated, not worked around.** Where a service cannot be reached, the operator is told so plainly, before they try, and is not sent to find a setting or perform a step nobody has confirmed exists. This is written from getting it wrong: a requirement here briefly told operators to set a password at a service whose accounts cannot be given one, which would have read to every one of them as their own failure to find it. | Test, Inspection |

## 4. Process map

| ID | Requirement | Verify |
|---|---|---|
| `QGD-PRC-0001` | Every risky job runs in its own process, so a crash in one never takes the application down. | Test |
| `QGD-PRC-0002` | The renderer holds screens only — no credentials, no network. | Static, Test |
| `QGD-PRC-0003` | The main process is windows and the IPC broker only. | Inspection |
| `QGD-PRC-0004` | The credential core, station I/O, and the engine supervisor each run as their own utility process. | Inspection |
| `QGD-PRC-0005` | IPC is a typed contract; malformed messages are rejected, not coerced. | Test |
| `QGD-PRC-0006` | Context isolation and the sandbox are enabled; Node is absent from the renderer; new windows are denied; outbound fetch from the renderer is refused. | Test |
| `QGD-PRC-0007` | Only one instance of the application runs at a time. A second launch exits and raises the window already open, so two instances can never both own the profile, the settings file and the operating system's credential-store entries — which `QGD-CRD-0003` keys by name rather than by profile, so a second instance would be writing over the first. | Test |

## 4.1 Application logging

How this section came to land ahead of the rest: `QGD-HDBK-001` §6.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-LOG-0001` | Every process logs as structured JSON lines into one stream: the TypeScript side through `pino`, the Rust core's `tracing` output forwarded into the same stream, and the engine's own log carried under the same controls. | Test |
| `QGD-LOG-0002` | Logs stay on the machine, in the operating system's standard log folder. Nothing is transmitted; there is no telemetry. | Static, Test |
| `QGD-LOG-0003` | Redaction happens in the logger, by field name, so a caller cannot forget it. | Test |
| `QGD-LOG-0004` | The credential core never hands a secret to a logger. | Static, Test |
| `QGD-LOG-0005` | The log folder is inside the sentinel scan's coverage, under `QGD-CRD-0006`. | Test |
| `QGD-LOG-0006` | Log files rotate by size. | Test |
| `QGD-LOG-0007` | The log folder has a hard total cap; when it is exceeded the oldest file is removed first. | Test |
| `QGD-LOG-0008` | Logs are retained by age, and older ones are removed. | Test |
| `QGD-LOG-0009` | The default level is `info`. | Test |
| `QGD-LOG-0010` | A raised debug level reverts on its own, both after a set time and at restart, so it cannot be left on. | Test |
| `QGD-LOG-0011` | The engine's log is held inside the same size, total and retention caps. | Test |
| `QGD-LOG-0012` | Exporting diagnostics produces one redacted archive for the user to send. Nothing leaves the machine unless the user sends it. | Test |
| `QGD-LOG-0013` | **The logs, the level switch and the export action are reached from Troubleshooting on the status bar, and are not in Settings** (KI7MT, 2026-10-10). Settings holds the operator's preferences; a log viewer is something they need on one occasion, which is reporting a fault. The behaviour it drives is `QGD-LOG-0009`–`QGD-LOG-0012`. | Demo |

## 4.2 Database engine

| ID | Requirement | Verify |
|---|---|---|
| `QGD-ENG-0001` | PostgreSQL is the database, provided by the frame as a substrate service rather than by an application. Per-application roles are how the grant model reaches the data, and several processes connect at once. | Inspection |
| `QGD-ENG-0002` | Drizzle is the database layer: a TypeScript schema, SQL-like queries and generated migrations. | Inspection |
| `QGD-ENG-0003` | Simple settings — theme, window size and the like — live in a settings file rather than the database, so the application starts before the engine is up. | Test |
| `QGD-ENG-0004` | The engine runs from a binary set the frame provides — one pinned PostgreSQL build, recorded in `data/postgres-build.json` with its version, its source and its SHA-256, and verified before it is started. Whatever PostgreSQL happens to be installed on the machine is never used, and never appears on the supervisor's `PATH`. | Test |
| `QGD-ENG-0004.1` | What is bundled is the published build cut down to what this product runs: identical libraries stored under several names become symlinks, and `lib/postgresql` keeps only the plugins the server will not start without. 356 MB as published, 121 MB as bundled. The trim is applied only after the SHA-256 in `QGD-ENG-0004` has been checked, so what is cut down is always a tree already known to be what was published. | Test |
| `QGD-ENG-0004.2` | The database is created with PostgreSQL's built-in `C.UTF-8` provider, not ICU. Callsigns sort correctly under it — digits before letters, `W1AW` before `W1AW/4` — because they are ASCII. **Names do not**: an accented initial sorts after `Z`, so `Ångström` follows `Zulu`. A column holding names therefore carries an ICU collation of its own rather than relying on the database default. ICU itself is not removable: the server binary links `libicuuc` and `libicui18n`, and no ICU-free build is published for macOS arm64. | Test |
| `QGD-ENG-0014` | A PostgreSQL major-version upgrade has no path inside the bundle: `pg_upgrade` is not in it, and `QGD-ENG-0011`'s backups do not move between majors. Raising the pinned major is therefore a **migration release** under D-7 and not a Part — it needs both binary sets, a validated conversion, and the old version still running if the conversion is made to fail. Nothing before Release 1 raises it. | Inspection |
| `QGD-ENG-0014.1` | `pg_dump` and `pg_restore` are added with that migration release (KI7MT, 2026-10-08), not before. They lift both of the limits `QGD-ENG-0011` and `QGD-ENG-0012` carry: a backup could then be taken with the engine running, and a backup could move between major versions. Measured: 452 KB and 250 KB, and every library they link — `libpq`, `libintl`, `libzstd`, `liblz4`, `libcrypto` — is already bundled, so the cost is about 700 KB and no new dependency. What they need is a source: the arm64 build bundled here does not carry them and no published one does, so they are either built from the pinned version's own source or taken from another build of it and relinked against this bundle's `@rpath`. That choice is part of the migration release, because it is the same question `pg_upgrade` asks — where a second set of PostgreSQL binaries comes from and how its provenance is recorded. | Inspection |
| `QGD-ENG-0005` | The build that is bundled carries the server, `initdb` and `pg_ctl` and **no client tools**: there is no `pg_dump`, `pg_restore` or `psql` in it, and no arm64 build published by EDB or Zonky has them. Anything the engine must do is done with the server, `initdb`, or a connection. | Static |
| `QGD-ENG-0005.1` | `pg_ctl` is not used. It builds the postmaster's command line as a string and runs it through a shell, which `QGD-SEC-0002` bans everywhere this project writes itself — and that layer is where a data directory under `Application Support` was split into two arguments. The supervisor owns the lifecycle already: it spawns the server with an argument array, decides readiness by connecting, and asks for a fast shutdown by signalling the postmaster. | Static, Test |
| `QGD-ENG-0006` | The engine supervisor is the only thing that starts, stops or checks the engine, as its own utility process under `QGD-PRC-0004`. Its arguments are the data directory, the endpoint and the binary set; no part of them comes from a user. | Test |
| `QGD-ENG-0007` | The data directory is created on first run, and a creation that fails leaves nothing behind — never a half-made directory that the next start would treat as a database. | Test |
| `QGD-ENG-0008` | Two engines never run against one data directory. A start that finds the directory already in use reports that and does not begin a second. | Test |
| `QGD-ENG-0009` | On macOS and Linux the engine listens on a Unix socket and opens **no TCP port at all**; on Windows, which has no equivalent, it listens on loopback on a port chosen free at start. The port chooser is tested on every platform because it is the Windows path. | Test |
| `QGD-ENG-0009.1` | The socket goes in the application's own directory where it fits, and a short directory of the user's own where it does not. A socket path is bounded — 104 bytes on macOS, 108 on Linux, including what PostgreSQL appends — and the obvious place for it, beside the data under `Application Support`, is close enough to that bound to fail on a machine with a longer home directory. The directory is chosen by measuring, and a start with nowhere short enough reports that rather than failing as something else. | Test |
| `QGD-ENG-0010` | One database role and one schema per application, and the role's password is fresh random bytes at each start, held in memory and never written to disk. | Test |
| `QGD-ENG-0011` | A backup is a copy of the data directory taken with the engine stopped, recorded with the major version that made it. Taken this way because `QGD-ENG-0005` leaves no `pg_dump` to take a portable one; the cost is that the engine must be stopped and that a backup is not portable across major versions, which is why a restore refuses one made by a different major rather than corrupting a database with it. Both limits lift when `QGD-ENG-0014.1` lands. | Test |
| `QGD-ENG-0012` | A restore never leaves a half-replaced data directory: it is staged beside the live one and moved into place, and a restore that fails leaves the database that was there untouched. A failed backup leaves the previous backup in place. | Test |
| `QGD-ENG-0013` | Migrations are generated by Drizzle and applied by the supervisor at start; which have been applied is recorded in the database, and a migration that fails stops the engine rather than leaving it half-migrated. | Test |

## 4.2.1 Reference data

| ID | Requirement | Verify |
|---|---|---|
| `QGD-REF-0001` | Reference data lives in the engine, in a schema of the frame's, loaded there by the frame. It is not compiled into the product: a later ADIF release is new data, not a new build. | Test |
| `QGD-REF-0002` | **Every reference list records who owns it, separately from where this copy came from.** ADIF issues none of the lists it reproduces — the award sponsor does, or the national society, or the ITU — so a list's authority and its source are two different facts and both are recorded, with the version, the date and the SHA-256 of what was fetched. | Test, Inspection |
| `QGD-REF-0003` | ADIF's definitions come from the published resources archive at a pinned version, verified by SHA-256 before anything is read out of it, exactly as `QGD-ENG-0004` treats the database build. | Test |
| `QGD-REF-0004` | What is loaded is ADIF's own structure — its data types, its enumerations and its fields — and not a subset re-typed by hand. A field ADIF defines and this product has never heard of is still loaded. | Test |
| `QGD-REF-0005` | The validation is built from the loaded data rather than written against it. A field is checked against the data type and the enumeration ADIF gives it, so a later release that adds a field, a mode or an entity changes the data and not the code. | Test |
| `QGD-REF-0006` | **Where ADIF names an enumeration it does not supply, the validator says so.** `DARC_DOK` and `MY_DARC_DOK` are typed `Enumeration` and ADIF ships no list for either — its own note is that DARC publishes two. Such a value is checked for format and reported as *not checked against a list*, which is neither a pass nor a failure and must not be recorded as one. | Test |
| `QGD-REF-0007` | CQ and ITU zones are carried by ADIF only as columns on `Primary_Administrative_Subdivision`, never as lists of their own. The lists belong to CQ Magazine and to the ITU. What is derived from ADIF's columns is recorded as derived, with ADIF named as the copy and the owner named as the authority (`QGD-REF-0002`). | Test |
| `QGD-REF-0008` | The validation answers ADIF's own test QSOs, which ship in the same archive as the definitions. A case this product disagrees with ADIF about is a finding against this product until shown otherwise. | Test |
| `QGD-REF-0009` | POTA's parks, programs and locations are core reference data (KI7MT, 2026-10-08), held like the rest of it. They are fetched from POTA at run time and **never redistributed**: nothing of POTA's is in this repository or in a release. POTA is credited where the data is used, under `QGD-REP-0005`. | Test, Inspection |
| `QGD-REF-0010` | The park list changes daily, so it is **not pinned by checksum** — `QGD-REF-0003`'s treatment would be wrong for it. Instead every load records where it came from, its `ETag`, its `Last-Modified`, when it was fetched and how many rows arrived; a refresh asks conditionally and at most once a day; the shape is checked before the previous load is replaced; and a fetch that fails or arrives malformed **keeps the last good data**. Reference data that is briefly stale is worth more than reference data that is briefly wrong. | Test |
| `QGD-REF-0011` | **Published values are stored exactly as published and never corrected** (KI7MT). A row that is wrong is stored as it is and flagged, so the flag is this product's opinion and the value stays POTA's record. Four parks publish coordinates outside the possible range: they are flagged, kept out of anything that measures or maps, and still found by reference. Retired parks are kept, so an old QSO still resolves. POTA's own test park is flagged as a test and kept out of what a user sees. | Test |
| `QGD-REF-0012` | **POTA's `entityId` is POTA's, not ADIF's DXCC entity code**, however often the two agree. Of 311 entity numbers observed in the park list, 298 are also ADIF DXCC codes and 13 are not: POTA numbers Bonaire 524 where ADIF has 520, Crete 536 where ADIF has 40, Mount Athos 534 where ADIF has 180, and lists India under two of its own numbers. The ADIF entity is therefore recorded as a **derived, nullable link where the numbers agree**, never as a key — a foreign key would have refused 113 parks, and dropping a park because two organisations number the world differently is the product deciding one of them is wrong. | Test |
| `QGD-REF-0013` | A park can be in more than one location: 1,618 of them publish `locationDesc` as a comma-separated list. Locations are therefore a table of their own, one row per park per location, rather than a column holding a list. | Test |
| `QGD-REF-0014` | **A reference load that cannot happen does not stop the engine starting, and is never reported as a pass.** The definitions and POTA's lists are both fetched from somewhere else, so a first run with no network reaches a working engine with no reference data in it. That state is recorded and reported as *not loaded* — the same answer `QGD-REF-0006` gives for a list ADIF does not supply, and for the same reason: a validator that cannot consult a list must say so rather than pass everything or fail everything. A migration failing still stops the engine (`QGD-ENG-0013`); a load failing does not. | Test |
| `QGD-REF-0015` | **A list derived from ADIF's zone columns is a coverage list, not the zone list, and a cell the derivation cannot read is recorded rather than skipped.** ADIF fills those columns for 152 of its 1,965 subdivisions — five DXCC entities — so the derivation yields 11 of CQ's 40 zones and 22 of the ITU's 90. A zone is therefore reported as *not checked against a list*, which is `QGD-REF-0006`'s answer, and never checked against the derivation. Three of those cells are not zone numbers at all (`S=16 T=17`, `07/08`, `06/07`); they are kept exactly as published, flagged as uninterpreted, and nothing guesses what they mean. A derivation that discards what it cannot read is indistinguishable from one that read everything, which is why recording the unreadable cell is required rather than optional. | Test |
| `QGD-REF-0016` | **A list that does not cover the value's domain cannot judge it.** ADIF's `Secondary_Administrative_Subdivision` enumeration holds 58 rows, every one of them in a single DXCC entity (Alaska), while `CNTY` is typed against it for every entity and `USACA_COUNTIES`'s own documented example is `MA,Franklin:MA,Hampshire`. Three Massachusetts counties appear in ADIF's own test QSOs and none of them is in the list. A value outside what a list covers is therefore reported as *not checked against a list* — `QGD-REF-0006`'s answer — while a value inside its coverage that is absent is invalid. Coverage is decided from the data: by the entity the parameter names where the reference is parameterised, and otherwise by the leading segment of the enumeration's own composite codes. Checking a county against one state's boroughs would have this product call ADIF's documentation invalid, which `QGD-REF-0008` says is a finding against this product. | Test |

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
| `QGD-SEC-0020` | **The credential core is the only process in this product that opens an outbound connection, and it is the only TLS stack.** All of the application's outbound HTTPS goes through the Rust core over `rustls` and AWS-LC in FIPS mode (D-18, D-31). Electron's own networking is BoringSSL, which is not the validated module, so traffic that went that way would not be covered by the FIPS claim this product makes. TLS 1.3 is the floor and FIPS-approved suites the only ones offered, so a server's preference never decides. Two kinds of destination are permitted and no others: the hosts the reference register names, and the validation endpoint each service profile names. No telemetry, no update check, no analytics, nothing from the renderer (`QGD-CRD-0007`), and nothing from the engine's supervisor — which asks the core and receives bytes rather than connecting. A connection from another process, to another host, or on another port is a finding. | Static, Test |
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
> (version 4.2.0) in FIPS mode, with TLS 1.3 and FIPS-approved cipher suites only. Earlier
> versions of this module hold CMVP certificates; version 4.2.0 is not yet validated. Each
> release records evidence of the module version and mode.

**macOS:**

> Credentials are stored in the macOS Keychain. Network connections use TLS 1.3 with
> FIPS-approved cipher suites, built from AWS-LC's FIPS module source; macOS builds are not
> FIPS builds.

**README:**

> TLS 1.3 only, on AWS-LC's FIPS module (FIPS mode on Windows and Linux; not a FIPS build on
> macOS).

> Before the macOS line is published, Apple's current corecrypto certificate for the targeted
> macOS version is checked. Apple's validations trail its releases, so where the targeted
> version is not covered the phrase is "Apple's own cryptographic module", not "validated".

## 4.4 Frame and shell

| ID | Requirement | Verify |
|---|---|---|
| `QGD-FRM-0001` | The default theme follows the operating system — light when the system is light, dark when it is dark — and changes with it while the application is running, without a restart. | Test |
| `QGD-FRM-0002` | Settings offers System, Light and Dark. System is the default, and the choice is remembered for that user. | Test |
| `QGD-FRM-0003` | Light and dark are equally first class. Dark is properly dark, for night nets and contests, not grey; light carries strong contrast for daylight field use. Both are approved by KI7MT under `QGD-PRT-0103`. | Demo, Inspection |
| `QGD-FRM-0004` | A low-light or red night theme is not built in Release 1. | Inspection |
| `QGD-FRM-0005` | The shell is built in Svelte. | Inspection |
| `QGD-FRM-0006` | Each reusable `ui` component and each reusable pattern has a story. | Test |
| `QGD-FRM-0007` | Every story renders in both light and dark, so a component is seen in each before it is accepted. | Test, Demo |
| `QGD-FRM-0008` | `make verify` builds the gallery, so a story that no longer builds fails the run rather than waiting for someone to open it. | Test |
| `QGD-FRM-0009` | The gallery is development-only. It is not in the shipped application, and it is neither hosted nor published. | Static, Test |
| `QGD-FRM-0011` | The application opens on a Home page: what this is, its version, the active persona, what the database is doing, and the way into each of the other places. It is at the top of the rail, and it reads nothing it does not have to — no credential (`QGD-CRD-0009`) and no engine — so the first thing an operator sees is drawn whatever else is or is not working. (KI7MT, 2026-10-08.) | Test, Demo |
| `QGD-FRM-0012` | **The engine's state is an indicator on the status bar, with the detail a click away, and is not a page in Settings** (KI7MT, 2026-10-10). What the database is doing is something an operator glances at; starting, stopping and the version detail are reached from that indicator. Troubleshooting is reached from the same bar and carries the logs, the level switch and a support bundle (`QGD-LOG-0013`). | Test, Demo |
| `QGD-FRM-0010` | The patterns listed in `data/story-patterns.json` have stories by `QGD-PRT-0103`'s exit gate: the page layout, a form showing its validation errors, a list in each of its empty, loading, error and populated states, a confirmation dialog, and the credential test with its status display. A later application copies the pattern that is there rather than inventing its own. | Inspection, Demo |

## 4.5 App runtime and the app API

`QGD-PRT-0107`. `QGD-PRT-0005` divides the build here: P0 to P7 are the frame, and P8 onward are
applications built on this API. Everything a ham *does* is an application (D-21); the frame holds
only what every application needs and what protects the user.

This area is constrained by three decisions before any requirement is written. **D-33:** QSO
Graph's own applications use the same message API as every other application, with no private
shortcut, unless a measurement later shows one is needed and it is written down as a numbered
decision. **D-2:** three tiers — official, contributed, unofficial — with contributed and
unofficial sandboxed (D-2). **D-21:**
the frame's scope, above.

| ID | Requirement | Verify |
|---|---|---|
| `QGD-APP-0001` | **An application declares itself in data.** A manifest gives its id, its name, its tier, its version, the grants it asks for, and where its page is. Nothing about an application is learned by running it, so the frame can refuse one before any of its code is loaded. Same rule as the service register (`QGD-PSN-0002`): what a thing needs is data, not branches. | Test |
| `QGD-APP-0002` | **One API path.** An application reaches the frame only through `app-api`, and a built-in application uses it exactly as a contributed one would (D-33, `QGD-REP-0003`). There is no second route for official code — no direct import of `personas`, `engine`, `reference` or `main`, which `QGD-REP-0006` enforces over the imports themselves. | Test, Static |
| `QGD-APP-0003` | **The API is messages, not functions.** Every call is a typed message, validated on arrival and rejected rather than coerced (`QGD-PRC-0005`, `QGD-SEC-0006`), and nothing the frame hands an application is a live reference into the frame. This is what makes D-2's sandbox a later Part rather than a retrofit: moving an application into its own process changes the transport and leaves the API alone. An API of function calls would have to be redesigned to be sandboxed, and by then there would be applications written against it. | Test, Inspection |
| `QGD-APP-0004` | **Only the official tier loads in Release 1, and an unofficial manifest is refused rather than trusted.** The three tiers are named now because the API's shape depends on there being more than one, but the sandbox contributed and unofficial need is a later Part. Until it exists, a manifest whose tier is not `official` fails to load and says so — it is never loaded unsandboxed because the sandbox is not written yet. Failing closed is the whole point: the alternative is a release that runs third-party code with the frame's privileges. | Test |
| `QGD-APP-0005` | **No grant, no capability.** An application starts with nothing: it can draw its page and call the parts of the API that need no grant, and every capability beyond that is refused unless the manifest asked for it and the operator allowed it. A grant is checked in the frame at the point the capability is used, never in the application that is asking. | Test |
| `QGD-APP-0006` | **The set of grants is closed and declared in data.** A manifest asking for a grant the register does not define is refused at load, with the grant named. A capability nobody has written down is not a capability — it is a hole, and an application that could ask for anything would be checked against nothing. | Test |
| `QGD-APP-0007` | **An application never receives a credential secret.** A `service` grant lets the frame act with a credential on the application's behalf and return the result; it never returns the secret, and no reply, log line or error carries one (`QGD-CRD-0006`, `QGD-CRD-0007`). The application names a persona and a service and gets an answer. | Test, Static |
| `QGD-APP-0008` | **An application opens no connection, and never names a destination.** All outbound HTTPS is the credential core's (D-18, D-31), so an application asks for a *registered source* by name and the URL comes from the register — the same rule reference data follows (`QGD-REF-0001`). An application carrying a host or a URL is a destination nobody registered. | Test, Static |
| `QGD-APP-0009` | **One database role and one schema per application** (`QGD-ENG-0010`), and an application reaches its own schema and no other. Reference data is read through the API rather than by connecting to the engine, because the frame is what enforces the grants (`QGD-REP-0003`) and a connection bypasses it. | Test |
| `QGD-APP-0010` | **An application reads and writes only what the operator chose in that action.** There is no ambient filesystem: a path arrives from a dialog the operator used, is used for that one action, and is not kept. Exporting or sharing is an explicit action and never a side effect (`QGD-PII-0004`). | Test |
| `QGD-APP-0011` | **A refusal is visible.** When a capability is refused the operator is told, in words, which application asked and what for, and the refusal is logged (`QGD-LOG-0001`). A silently refused application looks broken, and the person who could report it has nothing to report. | Test |
| `QGD-APP-0012` | **What each application holds is recorded, and a withdrawal takes effect without a restart.** The frame reads the allowed grants on every request rather than at load, so taking one back needs no restart and no reload of the application. This is the guarantee; where it is put to the operator is `QGD-APP-0012.1`. | Test |
| `QGD-APP-0012.1` | **An official application's grants are enforced and are not put to the operator** (KI7MT, 2026-10-10). Its grants are what the application is, so a per-capability choice offers no decision and teaches the operator to agree. A contributed or unofficial application is instead trusted by its **source, once, when it is installed**, and that trust is revocable in one place. This requirement is met by the Part that introduces those tiers under D-2; until then there is no such application and every grant an unofficial manifest asks for fails closed. | Test |
| `QGD-APP-0013` | **An application that fails does not take the frame down** (`QGD-PRC-0001`), and the frame says which application stopped rather than failing as something else. | Test |
| `QGD-APP-0014` | **The grant model is proven by unit tests, and demonstrated by applications that are real features** (KI7MT, 2026-10-10). Every decision the runtime can make — a grant held, a grant asked for and not allowed, a grant never declared, a capability that does not exist, a duplicate identifier, an unreadable manifest, a tier that may not load — is exercised against manifest fixtures with no window, no engine and no network, because a decision that needs those to test is a decision tested once. **No application exists only to be demonstrated.** The end-to-end demonstration is the first application that does ham work. | Test |
| `QGD-APP-0014.1` | **The packaged application is built from a list of the paths that ship, and that list is asserted on the artifact.** An allowlist is what makes every development-only thing absent by construction rather than by remembering: the gallery (`QGD-FRM-0009`), the suites, the fixtures and anything added later are outside it unless somebody names them. So the check is that the list is still a list — not a wildcard over the repository with exclusions — and that the built archive holds no path from the development tree. "Not shipped" is a check on what was built, never a statement of intent. | Test |

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
