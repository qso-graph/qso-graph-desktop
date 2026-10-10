# Contributing to QSO Graph Desktop

Thanks for your interest. QSO Graph Desktop is a free, open-source desktop application for amateur
radio operators, licensed GPL-3.0-only. This page explains how work gets done here.

## Writing an extension

If you've written an extension for a modern open-source desktop app, you already know how to write
one for QSO Graph Desktop: a core, extensions on its API, and the same lifecycle (`QGD-HDBK-001`
§14). Hams who are also developers are exactly who we hope to hear from. Build an extension, then
either propose it as an **official** extension (we review it, verify it is fully compatible, and
maintain it from then on) or, once third-party extensions arrive, publish it under your own name.
The template, the extension API's documentation and an example extension are on the way
(`qso-graph-desktop#34`).

## Before you start

- **Read [AGENTS.md](AGENTS.md).** It's the orientation guide for anyone changing the code, human
  or AI: the layers, the patterns, and the pitfalls this project has already hit.
- **The specification is the rule book.** `spec/QGD-SPEC-001.md` is the only normative document.
  Find requirements by their ID (for example `grep -n "QGD-CRD-0009" spec/QGD-SPEC-001.md`).
  Rationale is in `hdbk/QGD-HDBK-001.md`.
- **Build order** is the Part catalogue in spec §2.1. Work on a Part starts by registering its
  acceptance tests in `docs/Pn.md` (`QGD-PRT-0003`).

## Setting up

Before Release 1 the only supported platform is macOS on Apple silicon (`QGD-SCP-0002`). You need
the Node version in `.node-version`, a Rust toolchain and CMake.

```bash
make setup     # npm ci, plus the pinned ADIF release (checksum-verified) and POTA's lists
make start     # build and run
make verify    # the full gate; must be green before anything is committed
```

## Making a change

1. **Find the requirement IDs** your change touches. If a change needs a requirement that doesn't
   exist, it starts with a spec change: edit the spec, then regenerate the matrix with
   `node scripts/gen-rvm.mjs` (`QGD-TST-0004`).
2. **Write or update the tests first,** and prove each new check can fail: plant the defect it
   is meant to catch and watch it go red.
3. **Keep to the layer.** Credentials, network and cryptography stay in the Rust credential core;
   extensions use only the extension API. See the layer table in [AGENTS.md](AGENTS.md).
4. **Run `make verify`.** Green is evidence, not sign-off.
5. **Get an independent review** before committing (see below).

## Reviews, commits and branches

- **Before Release 1:** reviewed work is committed directly to `develop`, with no GitHub pull
  requests. The review is a local, independent one (for example `codex review`) run before the
  commit. This changes after Release 1.
- **After Release 1:** work branches named `fix-…`, `feat-…` or `docs-…`, pull requests into
  `develop`, and a release is a pull request from `develop` into `main`.
- **Commits:** one logical change each, with a message that explains why. Merge commits, not
  squash, so contributors' history and credit are kept.
- **Outside contributions** are credited in [CHANGELOG.md](CHANGELOG.md).

## Coding conventions

- **TypeScript** for the core and extensions (pinned version in `package.json`), **Svelte** for
  screens, **Rust** only in `packages/persona-core`. No Python.
- **Dependencies:** each new runtime dependency is a reviewed decision, pinned exactly
  (`QGD-SEC-0012`). Prefer none.
- **Security rules** are `QGD-SEC-*` with `QGD-PRC-0006`, `QGD-CRD-0006` and `QGD-LOG-*`. Lint and
  Electronegativity checks enforce many of them.
- **UI:** every reusable component and pattern has a Storybook story, in light and dark
  (`QGD-FRM-0006`, `QGD-FRM-0007`). Write for hams who aren't developers: plain words.
- **Data from outside sources** (ADIF, POTA and others) is used under each publisher's terms;
  see the `QGD-REF-*` requirements before adding a source.

## AI-assisted contributions

Much of this project is written with AI agents. The rules for that are in
[LLM_POLICY.md](LLM_POLICY.md).

## Reporting problems

- **Bugs and feature requests:** GitHub issues, using the issue forms.
- **Security vulnerabilities:** never in a public issue. See [SECURITY.md](SECURITY.md).
- **Conduct:** see [CODE-OF-CONDUCT.md](CODE-OF-CONDUCT.md).
