<p align="center">
  <img src="docs/images/qso-graph-desktop-banner.svg" alt="QSO Graph Desktop" width="720">
</p>

# QSO Graph Desktop

**QSO Graph Desktop is an extensible desktop platform for amateur radio: a secure core that ham
radio extensions build on.** One app for your station, with the tools you choose.

The core gives every extension, for free:

- **your identities and credentials**, kept safely, with no extension ever seeing a password
- **reference data** (ADIF's definitions, POTA's parks), fetched, verified and kept current
- **storage**: each extension's own database, with nothing to set up
- **one look and one way of working** across every extension

An extension author writes only the ham part. Our own code, built from the ground up on proven
open-source practice.

**Status:** a preview. macOS on Apple silicon is the primary platform, and every change is also
built and tested on Windows and on Linux, x64 and arm64 (a Raspberry Pi 5 is the floor,
`QGD-SCP-0009`). Each CI run carries unsigned installers to try: a DMG, a Windows installer, and an
AppImage, `.deb` and `.rpm`. Create or edit station personas, select the active persona, and save
or remove service credentials in the system's own store: Keychain on macOS, Credential Manager on
Windows, the keyring on Linux. Saved passwords and API keys are never displayed.
Remove password and API key independently, choose which to prefer, or remove a
persona together with its credentials. Saving one secret keeps the other saved
secret; use the explicit removal controls to delete it.

The credential core owns its own entry names in that store: the `io.qso-graph.desktop` service
with `persona:provider` accounts, a `personas.json` index and a `current.txt` active marker
(`QGD-CRD-0003`). Those live in a `personas` directory inside the one the operating system
gives the application — `~/Library/Application Support/QSO Graph Desktop` on macOS — beside the
application's own SQLite stores and the reference cache (`QGD-ENG-0001`).
It never reads or writes the qso-graph MCP servers' data (`QGD-CRD-0004`).
Test credential checks QRZ lookup login or QRZ logbook STATUS, through the Rust
core's TLS 1.3 client. Other services explicitly report that testing is pending.
The rest of the desktop shell is still pending.

On AWS-LC's FIPS module (FIPS mode on Windows and Linux; not a FIPS build on macOS):
TLS 1.3 only for anything that carries a credential, and TLS 1.3 or 1.2 with FIPS-approved
suites for public reference data, whose sources do not all offer 1.3.

To build, use the Node version in `.node-version`, Rust, CMake and Go (AWS-LC's FIPS module
builds with Go); run `make setup`, then `make start`. Windows has no `make`: the npm commands it
runs are spelled out in `.github/workflows/ci.yml`.
`make setup` installs the npm dependencies and fetches the pinned ADIF release, verified by
SHA-256 before it is unpacked, and POTA's lists. There is no database server: storage is SQLite,
through the `node:sqlite` that Electron already carries (`QGD-ENG-0002`).
`make package` produces the unpacked application under `out/`, and `make installer` the
platform's installers. Signing and publication are deferred (`QGD-SCP-0003`).

`make help` lists every target. To try a change someone has pushed, `make update` (this
branch's latest, its dependencies and a build), then `make start`. `make suite SUITE=<name>`
runs one suite as CI does, `make screenshots` captures the screens and compares them with the
approved baselines, and `make approve-screenshots BY=<name>` records them as approved, by the
person approving.

`make verify` builds and packages the application, runs the unit and Electron smoke suites,
and checks that the hardened native bundle launches and stops. It
writes `report/report.md` and `report/summary.json`. Pending release,
cross-platform and clean-machine gates remain explicit in the report.

The renderer has no Node integration, networking or permissions. A narrow preload
API sends validated persona commands through the main process to a utility
process that owns the Rust addon. It exposes credential presence, never saved
secret values. Only bundled HTML, CSS and JavaScript can load. The packaged build
uses ASAR and hardened Electron fuses.

GPL-3.0-only. No credentials or real station data belong in this repository.
