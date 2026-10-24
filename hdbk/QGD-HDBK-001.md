---
title: "QGD-HDBK-001 — QSO Graph Desktop Handbook"
doc_type: handbook
status: draft
version: v0.1.0
date: 2026-10-07
license: CC-BY-4.0
copyright: "Copyright (c) 2026 Agentics Labs LLC"
authors:
  - "Gregory A. Beam (KI7MT)"
companion_to: ../spec/QGD-SPEC-001.md
---

# QGD-HDBK-001 — QSO Graph Desktop Handbook

> Companion handbook to `QGD-SPEC-001`. This document carries the rationale, the design
> reasoning, and the record of how decisions were reached. **The SPEC is what gets built and
> audited; this handbook is what gets read.**
>
> **This handbook cites SPEC requirement IDs by number. It never restates them.** Where it
> discusses a requirement it says `QGD-PRT-0001` and explains why — it does not reproduce the
> requirement's text, because a second copy of a normative statement is a defect waiting to
> happen. If you find a requirement written out in this handbook, that is a bug in this
> handbook.

## 1. Why this structure exists

QSO Graph Desktop's planning material reached 125,956 characters across six documents in an
earlier planning repository. Four of them contained a build order. The four did not agree.

The Part catalogue in the locked specification placed the shell ahead of the Rust credential
core, while the decision log in the same repository recorded the opposite rule — operating
system level components before the screens wired to them. Both were written in a single
commit, `6b1a55d`, whose own message states its goal as "one Part catalogue." Four review
passes by three agents did not catch it, because each pass reviewed one file's diff rather
than the whole against the intent. A reviewer returned `REQUEST_CHANGES`; the
specification was locked before those findings reached the pull request, because the
reviewer's GitHub credential had expired.

The build then followed the locked order, and the first Part produced was packaging and a
signed installer for three operating systems — correct under D-27 as a Release 1 target, but
sequenced ahead of the credential core the product depends on.

The diagnosis that produced the six-document split was that the original document was too
long. That diagnosis was wrong, and the fix made the problem worse: one 80K document became
126K across six. `FIDUCIAL-MESH-SPEC-001` is 394,983 characters, with a 147,784-character
handbook beside it, and does not have this failure mode. Length was never the constraint.

What `FIDUCIAL-MESH-SPEC-001` has, and what `QGD-SPEC-001` now copies:

1. **One normative document.** Everything else cites its IDs and never restates them.
2. **Stable requirement identifiers**, so the document is reached by `grep` rather than read
   end to end. A 400K specification is cheap when access is by address.
3. **Derived artifacts are generated, and a hand-edited derivative fails the build.**
   `QGD-RVM-001` is produced by `scripts/gen-rvm.mjs` from the SPEC's Verify columns, and
   `make verify` fails if the two disagree (`QGD-TST-0004`). Two contradicting copies become
   mechanically impossible rather than a thing reviewers are asked to notice.
4. **Every requirement carries a verification method**, so "is this met" has an answer that is
   not a reviewer's opinion (`QGD-TST-0005`).

Of those, item 3 is the one that would have prevented the failure above outright. The other
three make it cheaper to work with; that one makes the defect impossible.

## 2. Scope: sequencing, not cancellation

`QGD-SCP-0003` and `QGD-SCP-0004` are **sequencing requirements, not prohibitions.** D-27
(*Code signing and the public repo*, decided by KI7MT on 2026-10-07) sets SignPath for
Windows, an Apple Developer ID and notarization for macOS, and QSO Graph's own key for Linux,
and it is not reversed. KI7MT's direction of the same date is that it waits until there is a
useful product to sign. Signing was therefore **deferred, not unrequested** — an earlier draft
of this handbook said otherwise and was wrong.

`QGD-SCP-0006` records a genuinely open question rather than a decision: whether COPR and
Launchpad will build or carry a package bundling an Electron runtime and a native addon. Until
2026-10-10 the list also included a managed PostgreSQL, which §13 removed. That is a bridge to
cross at Release 1 packaging, not now.

`QGD-PRT-0001` — operating system level components before the screens wired to them — was
proposed in review and accepted by KI7MT on 2026-10-07 as "normally a better way to build."
It is stated once, in the SPEC, and the Part catalogue's ordering is its only expression.
There is deliberately no second document stating the principle, because the previous second
document is what disagreed with the table.

## 3. Sources

The earlier planning documents are background and are **not normative**: the original
research record, decisions 1–33 with their reasoning (cited here and in the specification as
`D-1` to `D-33`), the superseded specification, the review that said not to lock it, and
findings that never reached a pull request. They are kept privately for history and should not
be needed to build anything.

Material from these is folded into this handbook as it is needed. Open findings become GitHub
issues on `qso-graph/qso-graph-desktop`, not documents.

## 4. Why a failed credential proof stops some suites and not others

An earlier version of `scripts/verify.mjs` stopped every remaining suite once the credential
proof failed. The reasoning was sound as far as it went — a `PASS` on packaging, reported
beside a broken credential path, reads as a healthier build than there is. But it threw away
results that were never in doubt. Packaging does not touch the OS credential store, so its
outcome is not made misleading by a credential failure; suppressing it loses a real answer to
prevent a misleading one that was not going to occur.

`QGD-TST-0007` draws the line at the dependency instead of at the point of failure, which is
what KI7MT directed on 2026-10-07. A suite is stopped when its result would depend on the
thing that just failed, and run otherwise. `QGD-TST-0003` already requires the report to be
honest about what was not met; a suite reported as not run, naming what blocked it, satisfies
that better than a suite silently absent.

## 5. Why the Python proof left P0

`QGD-CRD-0004` originally made a cross-application round trip a P0 gate: the desktop writes a
credential, `qso-graph-auth` reads the value back, and the reverse. It never passed twice. The
diagnosis recorded at the time was an unresolved Keychain authorization, and the suspicion was
a permission dialog.

Measurement on 2026-10-07 confirmed the dialog and then found that nothing available to this
project can remove it. Operations performed by the process that wrote an entry complete in
hundredths of a second with no prompt. An entry written by one process and read by another
raises a macOS authorization dialog that a human must answer. Seeding the entry with an
explicit trusted-application list — the two reading binaries by path, not "all applications" —
did **not** remove the prompt, because `codesign` reports every party as ad-hoc signed with no
team identifier: `node`, the `python` interpreter, and the `napi-rs` addon itself. macOS cannot
form a stable designated requirement for an ad-hoc binary, so a trusted-application entry can
never match one and authorization always falls through to the operator. The only setting that
would silence it is "allow all applications", which widens the ACL on every entry the product
writes and is not acceptable for a credential store.

A gate that cannot be met unattended is not a gate; it is a standing request for someone to
click. Worse, it was declared `Test` while needing a human, which is the same defect as a tick
in `QGD-RVM-001` with no check behind it — the thing `QGD-TST-0004` and `QGD-TST-0005` exist to
make impossible. KI7MT's direction on 2026-10-07 was to take Python out of P0 entirely.

What replaced it is `QGD-PRT-0100`'s exit gate, proven by `scripts/keychain-roundtrip.mjs`:
the writing process round-trips, replaces, selects and deletes its own entry, and a
metadata-only lookup confirms the entry is named by the convention. Metadata carries no secret
and needs no authorization, so `QGD-CRD-0003` keeps its `Test` method without a second runtime.
The suite runs in under a fifth of a second, unattended, where its predecessor needed an
operator and still timed out.

That narrowed P0's scope. KI7MT closed the question the following day: `QGD-CRD-0004` now rules
out Python and MCP-server interoperability in any Part, and `QGD-CRD-0003` makes the credential
core the owner of its own entry names rather than a party to a contract with something else.
The measurement above is why that is cheap rather than costly — the interoperability it would
have bought could not be proven unattended on this platform anyway.


## 6. Logging arrived with the process map, ahead of the rest

`qso-graph-desktop#19` recorded decisions KI7MT made on 2026-10-08 and was held, to
land as one specification change so that P0 and P1 work would not be disturbed by a catalogue
being re-cut underneath it. One carve-out came across early — the logging section, because it
belongs with the process map, and §4.1 is that. The rest followed after P2 was signed off and is
described in §7 below.

`QGD-PRT-0102`'s row is the one exception taken from the issue, because a Part whose scope
included logging while its own row did not mention it would be the §0.1 failure again: the
catalogue is the build order, and a Part's scope has to be visible in it.

`logging` became a package of its own at the restructure, and was not in the version of
`QGD-REP-0001` written before it. Every process logs into one stream (`QGD-LOG-0001`), and the
log directory's caps cover the engine's files as well as the application's (`QGD-LOG-0011`), so
the logger is shared by `main`, `engine` and `callsigns`. It had no home among the nine packages
that existed: putting it in `main` would have made the engine depend on the main process to
write a log line. The naming of the engine's own log files moved with it, having lived in the
engine's endpoint module — which is what had made the logger depend on the engine to sweep its
own directory.

The bloat controls (`QGD-LOG-0006` through `QGD-LOG-0010`) are separate requirements rather
than one, because each is a different failure. A log folder can grow without bound through a
single file that never rotates, through many files that rotate but are never removed, or through
a debug level somebody left on. One requirement covering all three would be met by addressing
any one of them. There was a fourth, the database engine's own log, which no amount of care on
our side constrained. `QGD-LOG-0011` capped it until the engine was removed (§13). The paragraph
above, about the logger's home, records why the package exists. The engine it mentions is history.


## 7. The catalogue re-cut, and what it is for

`qso-graph-desktop#19` landed whole once P2 was signed off, before any P3 code, because the
Parts it re-numbers are all ahead of the build rather than behind it. Re-cutting a catalogue
under work already done is the failure §1 describes; re-cutting it ahead of the work is just
planning.

**P0 to P7 are the core and P8 onward are extensions on its API** (`QGD-PRT-0005`). That line
is what the rest follows from. (The core was called the frame, and an extension an application,
until 2026-10-10; §14 says why the words changed.) Reference data moves to P5 and depends on P4 alone, because
definitions and zone tables are stored data and need nothing else. Callsigns becomes P6
and the extension runtime P7. P7 was first to be signed off on a test extension that used the API
and nothing else. On 2026-10-10 KI7MT replaced that test extension with unit tests over the
runtime and the first real extension (`QGD-APP-0014`), because an extension that exists only
to be demonstrated proves less than one that does ham work.
QG Club moves off ADIF and onto P7, because a roster is people, not contacts, and never needed
ADIF to describe it.

**The logbook store and QG Log leave Release 1**, replacing D-29. Release 1 reads and writes
ADIF files and keeps no QSOs. That is a smaller product and a much smaller surface: a store
that holds a user's whole log is a different undertaking from a tool that validates a file, and
pretending otherwise is how Release 1 never ships.

**The repository layout is recorded now and moved at P7** (`QGD-REP-0002`). Recording it early
settles where things will live so that P3 through P6 can be written in the right shape; moving
early would be churn for its own sake.

**Clubs customise by defining lists, never by adding fields** (`QGD-PII-0005`). A club that can
add a field forks the schema, and from then on every feature has to ask which club it is talking
to. Offices, membership classes and net roles are rows with dates, so history survives and the
schema stays one schema. `QGD-PII-0006` closes D-30 the same way: the data stays where the user
put it.

## 8. Security rules, before the screens are written

`QGD-SPEC-001` §4.3 exists because P3 brings Svelte screens and `QGD-PRT-0003` says a Part
registers its acceptance tests before any of its code is written. Rules that arrive after the
code are a cleanup; rules that arrive before it are a constraint.

Electron's threat model is the reason the list looks the way it does. The renderer is treated as
untrusted — it is a browser running content, and the question is never whether it is honest but
what it can reach if it is not. So the preload exposes named functions rather than a channel
(`QGD-SEC-0007`), the policy forbids inline and remote scripts (`QGD-SEC-0008`), and external
links are an allowlist rather than a URL the screen hands over (`QGD-SEC-0009`). The rest —
`eval`, `shell: true`, dynamic `require`, `sql.raw`, `{@html}` — are the ways untrusted content
becomes executable, each cheap to forbid and expensive to find later.

The dependency rules (`QGD-SEC-0012`) are there because a credential application ships its whole
dependency tree to the people who install it. The two gates, ESLint and Electronegativity, are
what make any of this more than intention: `QGD-SEC-0013` and `QGD-SEC-0014` put them in
`make verify`, where a rule that stops holding fails the build rather than waiting for a reader
to notice.

## 9. Saying only what is true about FIPS

§4.3.1 carries the exact wording rather than a description of it, because the difference between
"uses AWS-LC's FIPS module" and "is FIPS validated" is the difference between a fact and a claim
somebody could act on.

The facts, checked on 2026-10-08 against the built binary and AWS's own register: this project
builds **AWS-LC FIPS 4.2.0**, from crate `aws-lc-fips-sys` 0.14.2 — two different numbers that
are easy to confuse. CMVP has validated 1.0, 2.0, 3.1 and a NetOS build; 4.0 is submitted and
not yet validated; **4.2.0 is in neither list.** AWS supports FIPS builds on Linux and Windows
only, so a macOS build is not a FIPS build and no AWS certificate will ever cover one.

KI7MT's decision was to say so, per platform, rather than to reach for the nearest validated
version. Pinning back to a validated 3.1 would buy a word in a sentence and cost every fix since.
`QGD-SEC-0018` sets the condition for changing it: a validated 4.x, pinned exactly, and the
wording steps up then and not before.


## 10. Themes follow the system, and dark is not an afterthought

`QGD-FRM-0001` to `QGD-FRM-0004` are KI7MT's decision of 2026-10-08. Following the operating
system is the default because an operator who has already told their machine which they want
should not have to tell this application too, and `QGD-FRM-0002` keeps the override for the
case where they do.

`QGD-FRM-0003` is the one that costs something. A dark theme that is really dark grey is
comfortable in an office and useless at two in the morning on a contest, where the screen beside
the radio is the brightest thing in the room; a light theme without strong contrast is unreadable
on a picnic table in sunlight. Both of those are the operating conditions this application is
for, which is why `QGD-PRT-0103`'s gate now requires KI7MT to approve the baselines in both
rather than in whichever one happened to be set.

`QGD-FRM-0004` says what is not being built. A red night theme is a real idea for a later Part
and writing it down as out of scope is cheaper than discovering halfway through P3 that somebody
started it.


## 11. Why TypeScript is pinned behind the current release

TypeScript 7 is the native port and is roughly twice as fast on this codebase —
0.32 seconds against 0.65. It also could not be used by three tools at once:
`typescript-eslint`, `svelte-check` and Electronegativity's parser all peer on a
TypeScript below 6.1, and all three failed to install or to start.

The workarounds each worked and each cost something. The product was linted
**after compilation**, so findings named a line nobody edits and had to be
translated back through a source map, and no type-aware rule could run at all.
Electronegativity needed its own dependency tree and a postinstall step to
populate it. `svelte-check` could not be wired, so component type checking was
replaced by a build failure that would fire when the first component arrived.

KI7MT's decision on 2026-10-08 was to pin 6.0.3 and delete all of that
(`QGD-SEC-0019`). The reason is not tidiness. Each isolation layer is a place a
gate can stop working quietly, and that had already happened once here:
`eslint-plugin-security` ships its rules as warnings, the reporter counted
errors, and the whole family was inert while printing a clean result. Three such
layers is three more chances at the same failure, in the checks meant to catch
the serious things.

What the pin bought immediately was not theoretical. Linting the source with
type information found that every call into the Rust credential core was `any` —
the addon arrives through `createRequire` untyped, so `saveCredentials`,
`requireCredential` and `deleteCredentials` were all unchecked at the one
boundary `QGD-CRD-0002` makes responsible for the OS credential stores. Typing it
then found that the credential core's shapes and the IPC contract's shapes are not the same,
and that one was being handed to the renderer as the other. Neither would have
been visible from compiled output.

The cost is 0.3 seconds a build and being deliberately one major release behind,
which is only safe as a dated decision with a trigger rather than as drift. The
trigger is in the requirement: `typescript-eslint` supporting 7. That one gates
the others in practice.

## 12. The extension API's one irreversible choice

`QGD-APP-0003` — that an extension reaches the core by message and not by function call — is
the load-bearing requirement of that area, and the first of several that cannot change once an
extension exists; the rest are set out at the end of this section. An API
written as function calls could not be sandboxed afterwards without breaking every extension
already written against it, and D-2 commits this project to sandboxing third-party extensions.

So the message boundary is not a style preference deferred to taste: it is the decision that
has to be right before the first extension exists, because the second one cannot be written
against a different shape without discarding the first.

**Where extension code runs, and what that commits to** (KI7MT, 2026-10-11). Extension code runs
in an extension host process, as VS Code's does, and never in the window or in main
(`QGD-APP-0015`). Podman Desktop runs its extensions in Electron's main process; here main is the
broker that enforces grants, and code that is checked should not live beside the checker. A
second opinion (Codex, 2026-10-11) agreed, and sharpened three things that are now requirements.
First, a host process is not a sandbox: it has Node's file and network access, so official
extensions are accepted as trusted code, and an OS-enforced sandbox is the precondition for any
other tier (`QGD-APP-0016`). Second, trust and identity come from the core, never from what an
extension says about itself: official status from provenance (`QGD-APP-0017`), identity from the
broker's binding of hosts to extensions (`QGD-APP-0018`). Third, the message boundary alone
understated the promise: the manifest's version and fields, the `activate` lifecycle, the message
bookkeeping and the card shapes are all compatibility obligations from the first extension
(`QGD-APP-0019`–`0021`, `QGD-HOM-0002`). How many hosts there are, and how they are reached, stays
internal, which is what lets third-party extensions later run in their own sandboxed host with the
same API.

## 13. Why storage is SQLite and not a database server

Until 2026-10-10 the frame bundled PostgreSQL 17 and ran it as a supervised server: 121 MB in the
package, a pinned and trimmed binary set, a Unix socket (and a loopback port on Windows), peer
authentication, a role and schema per extension, and backups taken with the engine stopped.
`QGD-ENG-0001` gave two reasons: per-extension roles are how the grant model reaches the data,
and several processes connect at once.

**Neither reason needed a server.**
- **Roles do restrict what a database connection may do.** They do not protect the files from a
  process running as the same operating-system user, and every process of this product runs as
  that user. Only the core is ever offered a connection; an extension never is
  (`QGD-APP-0009`). The boundary that counts is therefore the brokered extension API, which already
  carries credentials and sources, and roles duplicated it.
- **"Several processes" turned out to mean one owning process per file.**
- **Most of the server went unused by the shipping product.** It started the server, applied two
  migrations, wrote one row, and loaded ADIF and POTA. The roles, the backup and the restore
  were called only by test scripts.

KI7MT's test was: if no use case can be named where a server is mandatory, its overhead cannot be
justified.

**The references agree.** VS Code, Podman Desktop and Bitwarden were read in their own source on
2026-10-10. N1MM is closed source, so it was read in its documentation.
- **VS Code** keeps its state in SQLite (`@vscode/sqlite3`; `src/vs/base/parts/storage/node/storage.ts`)
  and its settings in JSON. Each extension's state is stored under the extension's ID, and each
  extension gets a folder of its own.
- **Podman Desktop** has no database: one `settings.json`
  (`packages/main/src/plugin/configuration-registry.ts`), a folder per extension
  (`extensions-storage/<id>`, `extension/extension-loader.ts`), and one secrets file encrypted with
  Electron `safeStorage` and scoped per extension (`safe-storage/safe-storage-registry.ts`).
- **Bitwarden desktop** keeps one `electron-store` file (`electron-store` 11.0.2;
  `apps/desktop/src/platform/main/storage/electron-store-backend.ts`, which sets no encryption key on
  the file), and encrypts the sensitive values it puts in it.
- **N1MM Logger+**, a contest logger in wide use for multi-operator stations, keeps its log in SQLite. For multi-operator work
  it gives each computer a full copy and replicates between them, because, in N1MM's own words,
  *"using a single database would not be as reliable as having each computer log its own QSOs and
  replicate them on all the other computers"*.

None of the four runs a database server.

**What was weighed and rejected.**
- **PostgreSQL from each platform:** EDB for macOS and Windows, and the platform's own package on
  Linux, the way Podman Desktop relies on the system's Podman. This answered "where does the
  server come from" but not "why a server".
- **Zonky's embedded-PostgreSQL binaries**, which the P4 build had used: a repackaging made for a
  Java testing library. Its Linux build carries OpenSSL 1.1, which is past its end of life:
  `embedded-postgres-binaries-linux-amd64` 17.11.0 bundles `lib/libssl.so.1.1` and
  `libcrypto.so.1.1`, and `bin/postgres` links them (checked with `ldd` on 2026-10-10).
- **`better-sqlite3`:** a native module whose ABI differs between Node and Electron. It would be
  rebuilt per platform and per Electron upgrade, and the suites run under plain Node could not load
  the Electron build.
- **PGlite:** PostgreSQL compiled to WebAssembly. It keeps the dialect, but not the reason for it.

**What it is instead** (`QGD-ENG-0001`):
- `settings.json` for preferences and grants
- `state.sqlite` for what the core keeps
- a folder per extension
- one derived `reference.sqlite`, rebuilt and swapped rather than migrated, because it can be
  remade from its sources

Main reads `settings.json`. The SQLite stores are opened by one utility process, through the
`node:sqlite` that Electron already carries.

**What it cost.** P4's sign-off, and the parts of P5's and P7's evidence that named PostgreSQL,
are re-earned against rewritten tests (`QGD-PRT-0104`). It was cheapest now. The frame held one
row, reference data rebuilds itself, and no operator data existed anywhere. Every extension
built on the server would have made the move dearer, and the first one to keep operator data would
have made it a migration rather than a decision.

## 14. Core and extensions: the words developers already know

Until 2026-10-10 this product called its layers the **frame** and its **applications**. KI7MT
found that confusing, and said that others would too. The structure was the one the open-source
desktop applications use, but it was described in words of its own, which needed a translation
table. The rule since: **model the layers, and name them, the way the reference projects do,
unless there is a very good reason not to.**

| Here | Podman Desktop | VS Code |
|---|---|---|
| **Core** (P0–P7) | the application core: the shell, navigation, status bar, settings, Troubleshooting, the generic pages | the workbench: the editor, explorer, terminal, settings, keybindings |
| **Built-in extension** | the extensions in its own repository's `extensions/` folder (Podman, Docker, Kind, Compose) | built-in extensions (Git, the TypeScript, JSON and Markdown language features) |
| **Official extension** | its makers' own catalogue extensions (such as AI Lab) | Microsoft's own Marketplace extensions (Python, C#, Remote) |
| **Third-party extension** | other authors' catalogue extensions | other authors' Marketplace extensions |

The vocabulary table and how it maps onto manifest tiers are in the specification (§4.5). This
section records why.

**What differs, and why it keeps the same words.** This core holds more than VS Code's does:
callsigns, the credential core, storage and reference data. That is why shared concerns such as HCL
configuration belong to the core, the way VS Code's own settings and keybindings are core and not
an extension. Extensions here are also fenced in. A VS Code extension runs with full access to the
machine; an extension here reaches the core only by message, with grants, because the core holds
credentials. Those are behaviours. The vocabulary stays the same.

**Two audiences.** *Developers*, the contributors, get the vocabulary above: in the specification,
the code, the documentation and the contribution guide. *Hams* see each extension named for what it
does ("Club", "Net Control", "Log"). The word "extension" appears only where extensions are added
and removed, which is the word the reference projects show their own users. The ideal contributor
is both: a ham who builds an extension, then proposes it as an official extension (reviewed,
verified as fully compatible, and maintained by this project from then on) or publishes it as a
third-party extension under their own name.

**A proven lifecycle, not an invented one.** The path an extension author follows mirrors the
references': a template and an example, a development harness, a compatibility version in the
manifest, one signed package, review into a catalogue, per-extension updates, and retirement. What
retirement owes the operator (notice, and a way to take their data first) is to be specified with the
lifecycle. Today the specification says only that an extension's folder is removed with it
(`QGD-ENG-0018`). Each step is checked against the references' current documentation when
it is designed (`qso-graph-desktop#34`).

**Credit, and where names appear.** This is the project's own code, built from the ground up. It
follows the references' design and vocabulary and copies none of their code. Were code ever copied,
its notice would go in `NOTICE` (VS Code is MIT, Podman Desktop Apache-2.0). Public copy names no
other project, so that it cannot read as an endorsement; it uses the open-source framing
(*"Our own code, built from the ground up on proven open-source practice."*). The developer
documentation names Podman Desktop, VS Code and Bitwarden, because that is where a contributor
learns the patterns, and it is the credit.

**The code uses the same words.** It was renamed in one pass (`qso-graph-desktop#34`) before any
extension was built, while that was still cheap: `packages/extension-api`, `extensions/`, the
extension broker, and `extension_state` in `state.sqlite`, by a migration rather than an edit, so a
store made before the rename keeps what it holds. Requirement IDs keep the `QGD-APP` prefix and
registered test IDs keep their names, because an identifier that changes breaks every reference to it.


## 15. Three systems, four builds, one floor

Before Release 1 only macOS is required (`QGD-SCP-0004`), and no Part's gate waits on another
system. KI7MT brought Windows and Linux into CI anyway, as Mission 2 (2026-10-11), because
problems found on the third system are cheaper found early than at Release 1. They were.
Every push now runs the development pass, the window and credential-store suites, and the
installers on macOS arm64, Windows x64, Linux x64 and Linux arm64 (`QGD-SCP-0002`).

What each system taught:

- **Windows.** `cargo` is `cargo.exe`; `node_modules/.bin` holds shell scripts Windows cannot run,
  so tools are started through Node from their own JavaScript; the temp folder and the checkout
  sit on different drives, so a rename between them fails; Defender holds a file it has just
  seen written while it scans it, so the reference swap retries a refused rename. That last one
  is a real product fix: users run Defender too.
- **Linux.** A headless test needs a display, a Secret Service and a window manager, as a desktop
  has, and Chromium's sandbox needs the user namespaces Ubuntu 24.04 restricts. The sandbox stays
  on.
- **Every system.** What the suites asked of the operating system (the process list, freezing a
  process, a process's sockets) goes through each system's own tool, in one module
  (`scripts/platform-process.mjs`), so no check is skipped on any of them.
- **The credential store has three names.** Keychain, Credential Manager and the keyring. The
  screens and messages now say the one the operator has (`QGD-CRD-0014`).

**The floor is a Raspberry Pi 5** (`QGD-SCP-0009`): if it runs well there, it runs on any ham's
machine, and it keeps the core lean. CI's arm64 runner proves the build runs on arm64, not that it
is fast enough on a Pi, so a real Pi 5 is the check that counts. The first one on a real Pi found
what CI could not: the Linux credential core, built on Ubuntu 24.04, needed glibc 2.39 and would
not load on Raspberry Pi OS's 2.36, nor on Debian 12, Ubuntu 22.04 or Rocky 9. CI never saw it
because it built and tested on the same new system. The core is now built against glibc 2.28,
and the build refuses one that needs more (`QGD-SCP-0008`). On the Pi it starts in about four
seconds and uses about 500 MB across its processes.
