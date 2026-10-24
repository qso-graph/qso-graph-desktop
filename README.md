<p align="center">
  <img src="docs/images/qso-graph-desktop-banner.svg" alt="QSO Graph Desktop" width="720">
</p>

<p align="center">
  <a href="https://github.com/qso-graph/qso-graph-desktop/actions/workflows/ci.yml?query=branch%3Adevelop"><img src="https://img.shields.io/github/actions/workflow/status/qso-graph/qso-graph-desktop/ci.yml?branch=develop&label=CI" alt="CI on develop"></a>
  <a href="https://github.com/qso-graph/qso-graph-desktop/releases"><img src="https://img.shields.io/github/v/release/qso-graph/qso-graph-desktop?include_prereleases&sort=semver&label=Release&color=blue" alt="Latest release"></a>
  <a href="https://adif.org.uk/"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fqso-graph%2Fqso-graph-desktop%2Fdevelop%2Fdata%2Freference-sources.json&query=%24.adif.version&label=ADIF&color=blue" alt="ADIF version"></a>
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20Linux%20%7C%20macOS-blue" alt="Platforms: Windows, Linux, macOS">
</p>

# QSO Graph Desktop

**A desktop home for your station.** Your callsigns, your logins for the services hams use, and
the places you operate from, kept safely in one place, with Parks On the Air, the sun and the moon,
band conditions and ADIF's definitions a click away. Free software, on Windows, Linux and macOS,
and everything you enter stays on your computer.

## What you can do

- **Keep your callsigns and their logins** for QRZ.com, QRZ Logbook, Logbook of The World, eQSL,
  HamQTH and Club Log, in your computer's own credential store: Credential Manager on Windows, the
  keyring on Linux, Keychain on macOS. Passwords are never shown again and never leave the computer.
- **Keep your Locations**: grid, DXCC, zones, county and ARRL section the way LoTW wants them, and
  your POTA, SOTA, WWFF and IOTA references. Start one from a park or a summit in a click.
- **Parks On the Air**: the parks near you, even with no internet; who is on the air from a park
  right now; and the parks in your area that have been activated least.
- **Astro**: sunrise, sunset, twilight, the moon, and the grey line on a world map.
- **Conditions**: solar flux, the K and A indices, NOAA's space weather and a band-by-band outlook.
- **ADIF Lookup**: every ADIF field and list value, in ADIF's own words.
- **Back up and restore** your callsigns and Locations, and run it **portable** from a USB stick.

The [User Guide](guide/README.md) walks through each, and [CHANGELOG.md](CHANGELOG.md) says what is
new in each release.

## Get it

From the [Releases page](https://github.com/qso-graph/qso-graph-desktop/releases). No account is
needed to download.

- **Windows:** the installer (`…-win-x64.exe`). It is not signed yet, so the first time it runs,
  SmartScreen asks: choose **More info**, then **Run anyway**.
- **Linux:** the **AppImage**, one file for almost any distribution, on a PC or a Raspberry Pi 5.
  Mark it executable and run it; it updates itself. Ubuntu 22.04 and later need FUSE for it
  (`sudo apt install libfuse2t64` on 24.04). A `.deb` and an `.rpm` are there too.
- **macOS** (Apple silicon): the disk image (`.dmg`). Drag the app to Applications. It is signed and
  notarized by Apple.

Each platform also has a portable `.zip`, and `SHA256SUMS.txt` lets you check any download. The
application checks for updates once a day (Stable or Early, or off, in Settings) and never
restarts without asking. The [install page](guide/install.md) has the details.

**The Preview** on the Releases page is the newest build of `develop`, rebuilt each night it has
changed: for testing what is coming, not for running your station.
[docs/RELEASES.md](docs/RELEASES.md) explains versions, previews and releases.

## Yours, and only yours

There is no account to make and no server of ours. Your callsigns, Locations, settings and logs stay
on your computer, and your logins stay in its credential store. The application goes online only
for what you ask of it, such as reference data, a page of outside data, or the daily update check,
and sends nothing about you. [PRIVACY.md](PRIVACY.md) says exactly what it does.

Every connection goes through the application's own core, over HTTPS, using AWS-LC's
FIPS-validated cryptographic module on Windows and Linux. The windows and the extensions open no
connection of their own, and nothing listens for one. [SECURITY.md](SECURITY.md) says how to report
a security problem.

## Extensions, and no lock-in

Everything past callsigns and Locations is an **extension**, built on the same extension API anyone
can build on, and you choose which ones run: each starts off until you turn it on. The core gives
every extension your identities without ever showing it a password, verified reference data, its
own storage, and one look and way of working, so an extension author writes only the ham part.

Today the application loads its own official extensions; extensions by other authors arrive once
the sandbox they run in is finished. Want to write one? See
[CONTRIBUTING.md](CONTRIBUTING.md#writing-an-extension).

## Building from source

You need the Node version in `.node-version`, Rust, CMake and Go. Then `make setup` and
`make start`. [CONTRIBUTING.md](CONTRIBUTING.md) has the rest: building, testing, the specification
and how changes are made.

## Licence

[GPL-3.0-only](LICENSE). Third-party material and its licences are in [NOTICE](NOTICE). Thanks to
everyone in [CONTRIBUTORS.md](CONTRIBUTORS.md).
