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

**Status:** a local macOS preview of QSO Graph Desktop with a Rust credential core. Create or
edit station personas, select the active persona, and save or remove service
credentials in macOS Keychain. Saved passwords and API keys are never displayed.
Remove password and API key independently, choose which to prefer, or remove a
persona together with its credentials. Saving one secret keeps the other saved
secret; use the explicit removal controls to delete it.

The credential core owns its own Keychain entry names: the `io.qso-graph.desktop` service
with `persona:provider` accounts, a `personas.json` index and a `current.txt` active marker
(`QGD-CRD-0003`). Those live in a `personas` directory inside the one the operating system
gives the application — `~/Library/Application Support/QSO Graph Desktop` on macOS — beside the
application's own SQLite stores and the reference cache (`QGD-ENG-0001`).
It never reads or writes the qso-graph MCP servers' data (`QGD-CRD-0004`).
Test credential checks QRZ lookup login or QRZ logbook STATUS, through the Rust
core's TLS 1.3 client. Other services explicitly report that testing is pending.
The rest of the desktop shell is still pending.

TLS 1.3 only, on AWS-LC's FIPS module (FIPS mode on Windows and Linux; not a FIPS build on
macOS).

On a Mac with Apple silicon, use the Node version in `.node-version`, Rust and CMake; run `make setup`, then `make start`.
`make setup` installs the npm dependencies and fetches the pinned ADIF release, verified by
SHA-256 before it is unpacked, and POTA's lists. There is no database server: storage is SQLite,
through the `node:sqlite` that Electron already carries (`QGD-ENG-0002`).
`make package` produces `out/mac-arm64/QSO Graph Desktop.app`.
`make installer` produces a local DMG. Signing and publication are deferred.

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
