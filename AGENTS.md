# AGENTS.md — QSO Graph Desktop

`spec/QGD-SPEC-001.md` is the only normative document. Everything below points at it and
restates nothing: a second copy of a requirement is a defect, because the two copies will
eventually disagree (`QGD-SPEC-001` §0.1).

## Before writing code

- Read the requirements for what you are touching. Reach them by grepping an ID, not by reading
  the document end to end.
- A Part registers its acceptance tests before any of its code is written — `QGD-PRT-0003`.
- Build order is the catalogue in §2.1 and nowhere else. P0–P7 are the frame; P8 onward are
  applications on its API — `QGD-PRT-0005`.

## Security

- The rules are `QGD-SEC-0001`–`QGD-SEC-0014`, with `QGD-PRC-0006`, `QGD-CRD-0006` and
  `QGD-LOG-*` beside them. Rationale: `QGD-HDBK-001` §8.
- Cryptographic claims: `QGD-SEC-0015`–`QGD-SEC-0018`. The exact wording is §4.3.1, reproduced
  verbatim and never paraphrased.
- No Python, no MCP-server interoperability, in any Part — `QGD-CRD-0004`.

## Verifying

- `make verify` runs every check and writes `report/`. `QGD-TST-0001`.
- The RVM is generated. A hand edit fails the build — `QGD-TST-0004`.
- A requirement without a Verify method is not a requirement — `QGD-TST-0005`.

## Working

- Before Release 1 there are no GitHub pull requests. Review locally with `codex review`, then
  commit to `develop`. This changes after a release. (Process, so it lives here rather than in
  the specification — see §6 of that document.)
- Part sign-off is KI7MT's and is recorded in `data/part-signoff.json`. A green local run is
  evidence, not sign-off.
