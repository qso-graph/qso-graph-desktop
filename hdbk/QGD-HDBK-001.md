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

This narrowed P0's scope; it did not retire the contract. `QGD-CRD-0003` still makes the keyring
naming convention the contract between the core and `qso-graph-auth`, and `QGD-CRD-0005` still
leaves the languages either side of it free. One consequence is worth stating plainly, because
it is a property of the platform and not of this build: an operator who saves a credential in
the desktop will be asked by macOS to authorize the first read of it by any other application,
including the Python MCP servers. Signing under D-27 would settle our own side of that; a PyPI
package running under the user's own interpreter it would not.


## 6. Logging arrives with the process map, and only logging

`qso-graph-desktop#19` records decisions KI7MT made with Bob on 2026-10-08 and is held: it
lands as one specification pull request at P5–P6, so that P0 and P1 work is not disturbed by a
catalogue being re-cut underneath it. It carries one carve-out, that the logging section comes
across early because it belongs with the process map, and `QGD-SPEC-001` §4.1 is that carve-out
and nothing more.

What is deliberately **not** here, and remains held: the Part catalogue re-ordering, the
repository layout, the database layer, the club and personal-data decisions, and the removal of
the `qso-graph-auth` contract from `QGD-CRD-0003`. Until that pull request lands, this
specification is what the build follows, and a reader comparing the two should expect them to
differ.

`QGD-PRT-0102`'s row is the one exception taken from the issue, because a Part whose scope
included logging while its own row did not mention it would be the §0.1 failure again: the
catalogue is the build order, and a Part's scope has to be visible in it.

The bloat controls — `QGD-LOG-0006` through `QGD-LOG-0011` — are separate requirements rather
than one because each is a different failure. A log folder can grow without bound through a
single file that never rotates, through many files that rotate but are never removed, through a
debug level somebody left on, or through the engine's own log, which no amount of care on our
side constrains. One requirement covering all four would be met by addressing any one of them.
