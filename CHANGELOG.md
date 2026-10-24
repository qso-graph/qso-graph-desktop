# Changelog

All notable changes to QSO Graph Desktop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Settings → Updates takes two lines**: the switch, then Stable or Early, what the last check
  found, and Check now.
- **Conditions** keeps its figures together instead of spread across the page, and says under them
  what NOAA's R, S and G scales are.
- **Astro's grey-line map** is no wider than 720 pixels, so it no longer fills a full-screen
  window.
- **Help → About QSO Graph Desktop** (and, on macOS, the application menu's About) opens Settings →
  About: the version, what the application sends anywhere, the project's documents, and the icons'
  credit.

### Fixed

- **A backup now carries which callsign is active**, and restoring it makes that callsign active
  again. Backups made before this are still read. A copy of 0.1.0 or 0.1.1 says a new backup is
  from a different version instead of reading it.

## [0.1.1] - 2026-10-24

### Changed

- **Callsigns are listed as Locations are**: a row for each, the active one first with its
  **Active** badge, then the rest by start date, newest first. **Make active** and **Edit** are on
  each row; a callsign whose end date has passed is marked **Expired** and has Edit only. They were
  listed in no particular order, so the active callsign could end up at the bottom.
- **The window's title shows the version**: *QSO Graph Desktop v0.1.1*, or for a preview, the
  release it leads to.
- **Locations**: the two cards that start a Location from a park or a summit are titled **Add
  location from a POTA park** and **Add location from a SOTA summit**.
- **The User Guide** explains operating away from home: what the active callsign and Location
  decide, and how a callsign's default Location comes with it.

## [0.1.0] - 2026-10-24

The first release of QSO Graph Desktop: a home for your callsigns, your logins and your operating
locations, with Parks On the Air, the sun and the moon, band conditions and ADIF's definitions to
start. It runs on Windows, Linux (including a Raspberry Pi 5) and macOS, and everything you enter
stays on your computer.

### Added

- **Callsigns.** Keep each callsign you hold, with a description and the dates it is valid, and
  choose which one is active. The status bar always shows it.
- **Logins for QRZ.com, QRZ Logbook, Logbook of The World, eQSL, HamQTH and Club Log**, kept with
  each callsign in your computer's own credential store: Credential Manager on Windows, the keyring
  on Linux, Keychain on macOS. Passwords and keys are never shown again once saved, never written
  to the application's files, and never leave the computer. Test the QRZ.com and QRZ Logbook logins
  with one click; testing the others is to follow.
- **Locations**, the places you operate from: grid square, DXCC entity, CQ and ITU zones, state,
  county and ARRL section (filled in from where you are, the way LoTW wants them), and POTA, SOTA,
  WWFF and IOTA references. Make one from a POTA park or a SOTA summit in a click, and choose which
  is active. A location holds only public facts: no street address, and no latitude and longitude.
- **Home**: a welcome that says what the application does, getting-started steps that tick
  themselves as you go, and up to eight pins for the pages you use most.
- **Extensions you choose.** Everything past the core is an extension, and every one starts off:
  turn on what you use in Settings, and it appears on the rail.
  - **Parks On the Air**: **Near Me**, the parks within about a day's drive, nearest first, and
    which have never been activated, from the downloaded park list, so it works without the
    internet; **Spots**, who is on the air from a park right now; and **Most Wanted**, the parks in
    your POTA focus area that have been activated least. Each filters by POTA's own Program, Entity
    and Location, and each park opens its page on pota.app.
  - **Astro**: sunrise, sunset and twilight, the moon, and the grey line on a world map, for five
    days on your computer's clock.
  - **Conditions**: solar flux, the planetary K and A indices, NOAA's space weather scales with an
    alert when one is raised, and a band-by-band outlook.
  - **ADIF Lookup**: every ADIF field, and every value of every list (bands, modes, DXCC entities
    and the rest), found by typing, in ADIF's own words.
- **My POTA Focus Area** (Setup menu): the programs, entities and locations you work, so Most Wanted
  asks POTA for those and nothing else.
- **Reference data** downloaded when you ask, never at start: ADIF's definitions, POTA's parks and
  SOTA's summits, each checked as it arrives and updated from Settings.
- **Back up and restore** (Settings, or Tools): your callsigns and locations in one plain file, to
  keep a copy or move to another computer. It holds what is public, never a login.
- **Updates**: the application checks once a day, while online, whether a newer version is out,
  and asks before restarting. Choose Stable (full releases) or Early (pre-releases too), or turn
  checking off, in Settings. On Windows, the Linux AppImage and macOS it updates itself; other
  builds say a newer version exists and where to get it.
- **What's new**: after an update, Home says so in one line, with these notes a click away. Help
  → What's New opens them at any time.
- **Portable mode**: unpack the `.zip` build anywhere, a USB stick included, and its data stays in
  a folder beside it.
- **A clock** in the header: UTC and local time, and a lamp for whether the internet is reachable.
- **Help**: Troubleshooting, with the logs and one-click diagnostics with passwords and keys
  removed, and the project's Privacy, Security, Attributions and Contributors pages.
- **Dark by default**, with Light and System a click away.

### Security

- **Every connection goes through one place**: the application's own core, over HTTPS, using
  AWS-LC's FIPS-validated cryptographic module on Windows and Linux. The windows and the extensions open none of their own, and nothing
  in the application listens for connections.
- **Nothing about you is collected.** No analytics, no tracking, no account and no server of ours.
- **The macOS build is signed and notarized by Apple**, so it opens like any other app.

### Known limitations

- **Windows is unsigned** for now, so SmartScreen warns the first time it runs: choose More info,
  then Run anyway.
- **The Linux AppImage needs FUSE**, which Ubuntu 22.04 and later do not install by default: on
  Ubuntu 24.04, `sudo apt install libfuse2t64`.
- **Preview testers**: a profile made by a build before 2026-10-10 is not converted. Delete it
  before the first run (on macOS, `~/Library/Application Support/QSO Graph Desktop`).
