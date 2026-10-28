# Changelog

All notable changes to QSO Graph Desktop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The Windows installer has our own artwork:** the QSO Graph icon on the app's dark navy, on the
  installer's first and last pages and along the top of the others. (#122)

- **Linux: install from our own apt or dnf repository**, and QSO Graph Desktop updates with the rest
  of your system. Every package and index is signed with our release key, which KI7MT's own key
  signs; the install page has the steps. (#113)

### Fixed

- **What's New shows only what's new to you.** After an update, it shows the releases from the version you
  had to the one you have now, and nothing older, even if you never closed the line on Home after earlier
  updates. Updating from 0.2.1 to 0.3.1 shows 0.3.0 and 0.3.1. After going back to an older version, Home
  says *Went back to* it, with nothing to read. (#119)
- **A test build can go back to a release.** A lab build installed by hand now checks for updates like a
  Preview, so **Choose a version…** lists the Stable releases to go back to. It installs only an update
  signed by us. (#121)
- **An update that can't be installed says so.** If the version you chose can't be installed after you
  click **Restart to update**, QSO Graph Desktop tells you, changes nothing, and opens again as it was,
  instead of closing and leaving nothing on screen. (#121)

## [0.3.1] - 2026-10-27

### Changed

- **Restart to update says what happens first.** A dialog says which version is installing, that QSO Graph
  Desktop closes and reopens by itself, and how long that takes (about a minute on Windows, where nothing is on
  screen while it installs). **OK** installs; **Cancel** leaves it to install when you next quit. (#114)

### Security

- **Conditions can't be held up by a malformed NOAA reply.** Stripping the padding NOAA's servers sometimes
  add took time growing with the square of its length: a reply padded with 200,000 of them in the middle held
  the page for about 15 seconds. It's now stripped in one pass. Found by GitHub's code scanning, with seven
  more alerts fixed and one closed as a false alarm in code the native-addon library generates. (#115)

### Fixed

- **A busy service's wait is never cut short.** When two requests to the same service were out at once,
  whichever answered last decided how long to leave it alone, even if that was shorter than the other
  had been asked for. The longer wait now always stands. (#110)

## [0.3.0] - 2026-10-27

### Changed

- **Checking for updates only checks.** When a newer version is out, Settings and the status bar say
  so, with *Download and install*; nothing is downloaded until you choose. Then, as before, it waits
  for you to restart, or installs when you quit. (#52)
- **Polite to the services it asks.** No source is asked more often than it needs: POTA spots once a
  minute, NOAA's conditions every 15 minutes, and the park and summit lists once a day, whatever a
  page's Refresh or Settings' Update asks. A list that is current says when its next check is,
  instead of offering Update. A service that says it is busy is left alone for as long as it asks.
  (#79)
- **Choose a version, and go back.** *Choose a version…* in Settings → Updates lists the versions you
  can install: newer ones, and the Stable releases before yours. Before any update installs, your
  callsigns, Locations, settings and extensions' data are copied as they are; going back to a Stable
  release puts back the copy from when you left it, and says first what is lost. Your logins are
  never touched. A third choice, **Previews**, offers last night's build; Early and Previews carry no
  guarantee. While a newer Stable release is out, the window's title says so. (#77)
- **One backup, with ticks.** *Tools → Back Up…* saves your **Callsigns and Locations** and your
  **Settings** (theme, pins, which extensions are on, your POTA Focus Area, the updates choice), both
  ticked; untick either. *Restore…* shows what a backup holds, ticked; each part you restore replaces
  this computer's, and restoring the settings restarts the application, which it says first.
  Backups from earlier versions still restore. Still no login, username or Location notes. (#64)

### Security

- **The part that holds your logins and makes secure connections is up to date.** Seven published
  weaknesses in the libraries it uses for encrypted connections (rustls, its certificate checking and
  its list of trusted certificate authorities) and for constant-time comparisons are fixed, including
  one that could accept certificates from a distrusted authority. Every build now checks these
  libraries against the public advisory databases and stops if one has a known problem. (#103)

## [0.2.1] - 2026-10-25

### Added

- **You can check that a download is an official build**, and who published it: the README's
  *Verify your download* shows how on Windows, Linux and macOS. Every published file now carries
  GitHub's signed record that this project's own build made it. (#83)

### Fixed

- **QSO Graph Desktop works on a freshly installed Windows 11.** It needs Microsoft's Visual C++
  runtime, which a new PC doesn't have, and without it nothing that goes online worked. The installer
  now gets Microsoft's own installer from Microsoft, checks Microsoft signed it, and runs it (one
  administrator prompt, once per PC); the Microsoft Store package asks the Store for it; and if it's
  still missing, the application says so when it starts, with Microsoft's page. (#91)
- **Help's documents open from the main branch**, which is where they are kept now. (#94)

## [0.2.0] - 2026-10-25

### Changed

- **Windows builds are signed** in the developer's name, Gregory Beam (KI7MT), as the macOS builds
  are: Windows shows who published the installer instead of an unknown publisher.
- **A Windows update is installed only when it is signed by the same publisher** as the copy that
  is running, as on macOS. One that isn't is removed, and Settings → Updates says why.
- **QSO Graph Desktop for the Microsoft Store** (Windows), submitted for Microsoft's review:
  installed from the Store, without the download warnings, and kept up to date by the Store. The Store copy says so in Settings → Updates,
  and that uninstalling it also deletes your callsigns, Locations and settings, so back up first.

## [0.1.3] - 2026-10-24

### Changed

- **The window opens where you left it**: the same place and size, and maximized if it was, unless
  that place is no longer on a screen.
- **A View menu**: Zoom In, Zoom Out and Actual Size (Ctrl or ⌘ with +, − and 0, or with the mouse
  wheel), from 80% to 150%, and Full Screen.
- **Menus where each platform keeps them**: on macOS, Settings… (⌘,) and Check for Updates… are in
  the QSO Graph Desktop menu; on Windows and Linux, Settings… (Ctrl+,) is in Setup and Check for
  Updates… in Help.
- **Parks On the Air has a Settings tab**, and its Focus Area (was My POTA Focus Area, on
  Locations) is there: an extension's own settings live in its area, and Settings is the
  application's. **Setup → POTA Focus Area…** opens it, and is there only while POTA is on.
- **About QSO Graph Desktop** is in the QSO Graph Desktop menu on macOS, and in Help on Windows and
  Linux.
- **Help → Save Diagnostics for Support…** saves the redacted diagnostics archive for you to attach to
  a report yourself. Nothing is sent for you.
- **The status bar's callsign and Location** each open their page, to change them, and the empty
  slot beside them is gone.

### Fixed

- **Restoring a backup is all or nothing.** A backup is checked whole (every callsign and every
  Location, by the same rules as one entered by hand) before anything on the computer changes;
  the Locations are written in one transaction; and what is restored is exactly the file that was
  previewed. Before, a bad file could remove what was there and then refuse itself.
- **Updates follow the settings as they are**: turning checking off, or moving from Early to
  Stable, while a check is under way no longer downloads an update; and a platform is only ever
  offered its own file.
- **Settings → About names the licence as GPL-3.0-only**, as the project is licensed; it said
  "or later".
- **County fill finds every county a grid square reaches**, however thin the sliver: CM87us now
  offers San Francisco as well as Alameda, instead of filling Alameda alone.
- **Most Wanted** ranks every park in your focus area (it ranked only the first 20,000 by
  reference), and a park in two locations takes its count from the list fetched more recently.
- **Near Me finds parks just inside 300 km**, at the equator and toward the poles, that it left out.
- **The Distance filter is exact**: distances show to a tenth of a km, so a park 25.4 km away no
  longer passes "Within 25 km".
- **Spots counts activators**, not spots: one activator at two parks is one.
- **Astro's days follow your computer's clock on the days summer time starts and ends**, and the
  radio depths' today and tomorrow are your clock's days, not the Location's solar day.
- **Conditions dates NOAA's scales**, and the page's time includes them.
- **My POTA Focus Area shows its choices the first time**, when it is still your Location's own.
- **Refresh says Refreshing… until the page has its new answer**, then Refreshed; it said
  Refreshed the moment it was pressed.
- **Diagnostics no longer say passwords and keys were removed**: the logs never hold any.
- **Updates switched back on while offline** no longer go on saying checking is off.
- **What's New after updating from a preview** shows that release's notes, not develop's.

Twenty of these were found by Turing (OpenAI Codex), one of the AI agents QSO Graph Desktop is
built with, in a security review and a correctness review: eight and twelve findings, every one
confirmed against the code and fixed with a test that failed first.

## [0.1.2] - 2026-10-24

### Changed

- **Settings → Updates takes two lines**: the switch, then Stable or Early, what the last check
  found, and Check now.
- **Conditions** keeps its figures together instead of spread across the page, and says under them
  what NOAA's R, S and G scales are.
- **Astro's grey-line map** is no wider than 720 pixels, so it no longer fills a full-screen
  window.
- **Astro's grey-line DX check** asks for a **DX grid**, without saying the grey line twice.
- **Help** starts with **About QSO Graph Desktop** and **What's New**. About (and, on macOS, the
  application menu's About) opens Settings → About: the version, what the application sends
  anywhere, the project's documents, a link to What's New for this version, and the icons' credit.
- **Settings → Updates** says why a build does not check: the switch is off, or it is a development
  build or a preview.

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
