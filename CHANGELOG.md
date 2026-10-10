# Changelog

All notable changes to QSO Graph Desktop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Pre-release development toward Release 1. The frame is being built Part by Part (see
`spec/QGD-SPEC-001.md` §2.1 and `data/part-signoff.json` for what's signed off).

### Changed

- **Storage is SQLite; the bundled PostgreSQL is gone** (2026-10-10). The application keeps its
  data in files it owns: `settings.json`, `state.sqlite`, a folder per application, and one
  derived `reference.sqlite` built from ADIF's and POTA's published data. Main reads
  `settings.json`; one utility process, QG Storage, opens the SQLite files through the
  `node:sqlite` that Electron carries. There is no database
  server, no socket and no port, and the package is about 121 MB smaller. Why, and what was
  weighed: `hdbk/QGD-HDBK-001.md` §13; the plan of work: `docs/STORAGE-PLAN.md`.
- The status bar's database indicator is gone; storage's detail is in Troubleshooting, and Home
  says whether reference data is loaded.
- **Development profiles start fresh.** Nothing converts a profile made by an earlier build: delete
  it (on macOS, `~/Library/Application Support/QSO Graph Desktop`, including its old `engine/`
  folder) before the first run.
