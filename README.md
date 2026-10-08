# QG Desktop

A local macOS preview of QSO Graph Desktop with a Rust persona core. Create or
edit station personas, select the active persona, and save or remove service
credentials in macOS Keychain. Saved passwords and API keys are never displayed.
Remove password and API key independently, choose which to prefer, or remove a
persona together with its credentials. Saving one secret keeps the other saved
secret; use the explicit removal controls to delete it.

The credential core owns its own Keychain entry names: the `adif-mcp` service with
`persona:provider` accounts, a `personas.json` index and a `current.txt` active marker.
The default profile directory is `${XDG_CONFIG_HOME:-~/.config}/adif-mcp`.
Test credential checks QRZ lookup login or QRZ logbook STATUS, through the Rust
core's TLS 1.3 client. Other services explicitly report that testing is pending.
The rest of the desktop shell is still pending.

TLS 1.3 only, on AWS-LC's FIPS module (FIPS mode on Windows and Linux; not a FIPS build on
macOS).

On the M3, use Node 26.9.0, Rust and CMake; run `npm ci`, then `make start`. The root
install also installs the Electron audit tooling under `tools/electronegativity`, which has
its own dependency tree because its parser needs an older TypeScript than this project uses.
`make package` produces `out/mac-arm64/QG Desktop.app`.
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
