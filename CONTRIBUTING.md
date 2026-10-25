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

macOS on Apple silicon is the primary platform; CI also builds and tests Windows and Linux, x64 and
arm64, on every push (`QGD-SCP-0002`). You need the Node version in `.node-version`, a Rust
toolchain, CMake and Go. On Windows there is no `make`; `.github/workflows/ci.yml` spells out the
npm commands.

```bash
make setup     # npm ci, plus the pinned ADIF release (checksum-verified) and POTA's lists
make start     # build and run
make verify    # the full gate; must be green before anything is committed
```

## Building and testing

`make help` lists every target.

- `make package` produces the unpacked application under `out/`; `make installer` the platform's
  installers. Releases are built and published by CI (`docs/RELEASES.md`), never by hand.
- `make update` pulls this branch's latest, its dependencies and a build, to try a change someone
  has pushed; then `make start`.
- `make suite SUITE=<name>` runs one suite as CI does. `make screenshots` captures the screens and
  compares them with the approved baselines; `make approve-screenshots BY=<name>` records them as
  approved, by the person approving.
- `make verify` builds and packages the application, runs every suite, and checks that the
  hardened native bundle launches and stops. It writes `report/report.md` and
  `report/summary.json`; gates that need another platform or a clean machine stay explicit there.

`make setup` fetches the pinned ADIF release, verified by SHA-256 before it is unpacked, and POTA's
lists. There is no database server: storage is SQLite, through the `node:sqlite` Electron carries
(`QGD-ENG-0002`).

**How the application is put together, in brief.** The renderer has no Node integration,
networking or permissions; a narrow preload API sends validated commands through the main process.
Credentials and every outbound connection belong to the Rust credential core, in a utility process
of its own: it exposes whether a credential is saved, never its value, and connects only over
HTTPS, on AWS-LC's FIPS module (FIPS mode on Windows and Linux; not a FIPS build on macOS): TLS 1.3
only for anything that carries a credential, TLS 1.3 or 1.2 with FIPS-approved suites for public
reference data. Its entries in the operating system's store are the `io.qso-graph.desktop`
service with `<id>:<service>` accounts, the id being each callsign's own random id; the index of
callsigns is `callsigns.json` in a `callsigns` folder beside the application's SQLite stores
(`QGD-CRD-0003`, `QGD-ENG-0001`). It never reads or writes the qso-graph MCP servers' data
(`QGD-CRD-0004`). Only bundled HTML, CSS and JavaScript load, and the packaged build uses ASAR and
hardened Electron fuses. [AGENTS.md](AGENTS.md) has the layers in full.

No credentials or real station data belong in this repository.

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

- **One working branch, `main`,** and every change reaches it by a pull request, merged by
  KI7MT. Merging never publishes: a release is made on purpose, by the Release workflow
  ([docs/RELEASES.md](docs/RELEASES.md)).
- **Maintainers work one milestone at a time,** on one branch named for its version
  (`feature/0.2.1`), with one pull request into `main`. Each fix is validated on that pull
  request's own build before it is merged.
- **Outside contributions:** fork the repository and open a pull request into `main` from a
  branch of your own (`fix-…`, `feat-…`, `docs-…`). KI7MT decides when it is merged, usually
  as part of the current milestone.
- **Documentation-only changes** (README, the guide, `docs/`) build nothing and can be merged
  straight away.
- **Commits:** one logical change each, with a message that explains why. Merge commits, not
  squash, so contributors' history and credit are kept.
- **Outside contributions** are credited in [CHANGELOG.md](CHANGELOG.md).

## Coding conventions

- **TypeScript** for the core and extensions (pinned version in `package.json`), **Svelte** for
  screens, **Rust** only in `packages/callsign-core`. No Python.
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
