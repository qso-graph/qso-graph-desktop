<p align="center">
  <img src="docs/images/qso-graph-desktop-banner.svg" alt="QSO Graph Desktop" width="720">
</p>

# QSO Graph Desktop

**QSO Graph Desktop is an extensible desktop platform for amateur radio: a secure core that ham
radio extensions build on.** One app for your station, with the tools you choose.

## Get it

**One app, every desk, nothing to wrestle with.**

- **Windows:** a standard installer.
- **Linux: a single AppImage.** Download it, mark it executable, run it. No installer, no root,
  nothing scattered across your system. It runs from your shack PC or off a USB stick in the field,
  on x64 and on arm64, down to a Raspberry Pi 5. Rather install it? There's a `.deb` and an `.rpm`
  as well. (A few newer distributions leave out the FUSE 2 library AppImages use: install `libfuse2`,
  or use the `.deb` or `.rpm`.)
- **macOS:** a disk image. Drag it to Applications. Apple silicon.

**Where:** the [Releases page](https://github.com/qso-graph/qso-graph-desktop/releases). Until the
first release, the **Preview** there is the newest build of `develop`, replaced each time one passes
its tests: every installer is its own download, each `.zip` is a portable build you unpack and run,
and `SHA256SUMS.txt` lets you check a download. It is a preview to test, not a release, and is
unsigned for now, so Windows and macOS warn the first time it runs. How versions and releases are
named: [docs/RELEASES.md](docs/RELEASES.md).

Your callsigns, logins and logs stay on your computer. There's no account to make and no server of
ours to talk to.

**No vendor or developer lock-in.** Everything past the core frame is an extension, built on the same
extension API anyone can build on, and you choose which ones run. Today the application loads its
own official extensions; extensions by other authors arrive once the sandbox they run in is
finished. Want to write one? See [CONTRIBUTING.md](CONTRIBUTING.md#writing-an-extension).

> **Preview:** until Release 1, the downloads are the unsigned installers each CI run produces. Open
> the latest run of the `ci` workflow on the Actions tab and download the one for your system.
> Signed releases will appear on the Releases page.

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
AppImage, `.deb` and `.rpm`. Create or edit callsigns, select the active callsign, and save
or remove service credentials in the system's own store: Keychain on macOS, Credential Manager on
Windows, the keyring on Linux. Saved passwords and API keys are never displayed.
Remove password and API key independently, choose which to prefer, or remove a
callsign together with its credentials. Saving one secret keeps the other saved
secret; use the explicit removal controls to delete it.

The credential core owns its own entry names in that store: the `io.qso-graph.desktop` service
with `<id>:<service>` accounts, where the id is each callsign's own random id, a `callsigns.json`
index and a `current.txt` active marker
(`QGD-CRD-0003`). Those live in a `callsigns` directory inside the one the operating system
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
API sends validated callsign commands through the main process to a utility
process that owns the Rust addon. It exposes credential presence, never saved
secret values. Only bundled HTML, CSS and JavaScript can load. The packaged build
uses ASAR and hardened Electron fuses.

GPL-3.0-only. No credentials or real station data belong in this repository.
