# Governance

## Who decides

QSO Graph Desktop is led by **KI7MT**, who has final say on:
- scope, priorities and the build order (the Part catalogue in `spec/QGD-SPEC-001.md` §2.1);
- product and design decisions;
- **sign-off of each Part**, recorded in `data/part-signoff.json`;
- **approval of screenshot baselines**, recorded in `data/baseline-approval.json`;
- releases.

## How decisions are recorded

- **The specification** (`spec/QGD-SPEC-001.md`) is the only normative document. A decision that
  changes what the product must do becomes a requirement with an ID and a verification method.
- **The handbook** (`hdbk/QGD-HDBK-001.md`) records why.
- **GitHub issues** record proposals, open questions and future work.

## Who does the work

Most code is written by AI agents working under KI7MT's direction (see
[LLM_POLICY.md](LLM_POLICY.md)), with every change independently reviewed before it's committed.
Agents may write code, tests and documents, but **may not** sign off a Part, approve a baseline, or
make a release.

## Contributors

Outside contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Contributors' commits
are kept, and they're credited in [CHANGELOG.md](CHANGELOG.md).

## Changes to this document

Governance changes are made by KI7MT.
