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
