<p align="center">
  <img src="docs/images/qso-graph-desktop-banner.svg" alt="QSO Graph Desktop" width="720">
</p>

# QSO Graph Desktop

A local macOS preview of QSO Graph Desktop with a Rust persona core. Create or
edit station personas, select the active persona, and save or remove service
credentials in macOS Keychain. Saved passwords and API keys are never displayed.
Remove password and API key independently, choose which to prefer, or remove a
persona together with its credentials. Saving one secret keeps the other saved
secret; use the explicit removal controls to delete it.

The credential core owns its own Keychain entry names: the `io.qso-graph.desktop` service
with `persona:provider` accounts, a `personas.json` index and a `current.txt` active marker
(`QGD-CRD-0003`). Those live in a `personas` directory inside the one the operating system
gives the application — `~/Library/Application Support/QSO Graph Desktop` on macOS — beside the
engine's data and the reference cache (`QGD-CRD-0013.1`).
It never reads or writes the qso-graph MCP servers' data (`QGD-CRD-0004`).
Test credential checks QRZ lookup login or QRZ logbook STATUS, through the Rust
core's TLS 1.3 client. Other services explicitly report that testing is pending.
The rest of the desktop shell is still pending.

TLS 1.3 only, on AWS-LC's FIPS module (FIPS mode on Windows and Linux; not a FIPS build on
macOS).

On a Mac with Apple silicon, use the Node version in `.node-version`, Rust and CMake; run `make setup`, then `make start`.
`make setup` installs the npm dependencies and fetches the pinned PostgreSQL
build the engine runs from — a ~59 MB download, verified by SHA-256 against
`data/postgres-build.json` before it is unpacked.
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
