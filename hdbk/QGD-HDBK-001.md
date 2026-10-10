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

QSO Graph Desktop's planning material reached 125,956 characters across six documents in
`qso-graph-devel/planning/`. Four of them contained a build order. The four did not agree.

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
Launchpad will build or carry a package bundling an Electron runtime, a native addon and a
managed PostgreSQL. That is a bridge to cross at Release 1 packaging, not now.

`QGD-PRT-0001` — operating system level components before the screens wired to them — was
proposed in review and accepted by KI7MT on 2026-10-07 as "normally a better way to build."
It is stated once, in the SPEC, and the Part catalogue's ordering is its only expression.
There is deliberately no second document stating the principle, because the previous second
document is what disagreed with the table.

## 3. Sources

The following are background and are **not normative**. They are retained for history and
should not be loaded to build anything:

- `qso-graph-devel/planning/QG-DESKTOP-RESEARCH.md` — the original research record
- `qso-graph-devel/planning/QG-DESKTOP-DECISIONS.md` — decisions 1–33 with their reasoning
- `qso-graph-devel/planning/QG-DESKTOP-SPEC.md` — the superseded specification
- `qso-graph-devel/planning/QG-DESKTOP-DOC-REVIEW.md` — the review that said do not lock it
- `qso-graph-devel/planning/QG-DESKTOP-OPEN-FINDINGS.md` — findings that never reached the PR

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

`qso-graph-desktop#19` recorded decisions KI7MT made with Bob on 2026-10-08 and was held, to
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
the logger is shared by `main`, `engine` and `personas`. It had no home among the nine packages
that existed: putting it in `main` would have made the engine depend on the main process to
write a log line. The naming of the engine's own log files moved with it, having lived in the
engine's endpoint module — which is what had made the logger depend on the engine to sweep its
own directory.

The bloat controls — `QGD-LOG-0006` through `QGD-LOG-0011` — are separate requirements rather
than one because each is a different failure. A log folder can grow without bound through a
single file that never rotates, through many files that rotate but are never removed, through a
debug level somebody left on, or through the engine's own log, which no amount of care on our
side constrains. One requirement covering all four would be met by addressing any one of them.


## 7. The catalogue re-cut, and what it is for

`qso-graph-desktop#19` landed whole once P2 was signed off, before any P3 code, because the
Parts it re-numbers are all ahead of the build rather than behind it. Re-cutting a catalogue
under work already done is the failure §1 describes; re-cutting it ahead of the work is just
planning.

**P0 to P7 are the frame and P8 onward are applications on its API** (`QGD-PRT-0005`). That line
is what the rest follows from. Reference data moves to P5 and depends on P4 alone, because
definitions and zone tables are data in a database and need nothing else. Personas becomes P6
and the app runtime P7, whose sign-off now includes a test application that uses the API and
nothing else — the only way to find out whether the API is usable is to be its first consumer.
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
then found that the core's shapes and the IPC contract's shapes are not the same,
and that one was being handed to the renderer as the other. Neither would have
been visible from compiled output.

The cost is 0.3 seconds a build and being deliberately one major release behind,
which is only safe as a dated decision with a trigger rather than as drift. The
trigger is in the requirement: `typescript-eslint` supporting 7. That one gates
the others in practice.

## 12. The app API's one irreversible choice

`QGD-APP-0003` — that an application reaches the frame by message and not by function call — is
the load-bearing requirement of that area. Everything else in it can be changed later. An API
written as function calls could not be sandboxed afterwards without breaking every application
already written against it, and D-2 commits this project to sandboxing two of its three tiers.

So the message boundary is not a style preference deferred to taste: it is the decision that
has to be right before the first application exists, because the second one cannot be written
against a different shape without discarding the first.
