# Changelog

All notable changes to QSO Graph Desktop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Restore open destination tabs on Home after a restart, and ask to save pending changes before closing tabs or turning off an extension.

### Changed

- Closing the last window quits on macOS too, asks about unsaved tabs, and stops the application’s processes. The next single-instance start removes only prior-run processes whose recorded OS identities still match; detached update installers continue.

- Settings groups its existing cards into General, Data sources and Extensions tabs, remembers the last tab, and opens the matching tab from menu and welcome links.

- Tab shortcuts switch in order or to the previously shown destination, close through the unsaved-changes question, and move tabs left or right. The Tabs menu shows each platform's shortcuts, including the macOS move chord.
- Destinations open once in a tab bar above the page. Tabs can be closed, reordered by dragging, and selected with arrow keys, Home and End; closing the shown tab returns to the most recently used destination.
- The specification describes 0.8.0's frame (`QGD-PRT-0114`, `QGD-PRT-0115`): every destination opens as a tab and the open tabs come back after a restart, a resizable panel beneath holds the live sources' terminals with a list of them on its right, Settings is in tabs by type, and closing the window ends the application on every system, macOS included, so the next start holds no port from the last.
- QG Trust 0.2.2. The test for a `.p12` with no password reads one from QG Trust's test corpus instead of making it with the `openssl` on `PATH`, which failed wherever that was LibreSSL, as on macOS Intel.

## [0.7.1] - 2026-11-12

### Changed

- The handbook (`hdbk/QGD-HDBK-001.md`) is GPL-3.0-or-later like the rest of QSO Graph; it had carried CC-BY-4.0 over from the template it was started from. A change to the handbook alone is now documentation and builds nothing.
- The specification governs Desktop's own behaviour; where Desktop uses a QSO Graph library (QG Trust, QG Interop), that library's specification governs what the library does, and Desktop's spec cites it rather than restating it.

### Fixed

- LoTW's Trusted roots tab always said the roots could not be read: a built-in root has no accepted time, and the native code left that field out instead of sending `null`, so the list was refused. A certificate without a DXCC name would have done the same to Certificates. Both now send `null`, a test reads them from the real native code, and the pages name the LoTW grants only when a grant refused the request (#200).

## [0.7.0] - 2026-11-12

### Added

- Sync from TQSL on Locations: choose station locations to copy once, with field comparisons and new names for clashes. TQSL stays unchanged (#155).
- LoTW Sign log… previews ADI, ADX and Cabrillo logs, confirms the callsign, certificate, Location and dates, and writes a `.tq8`. Disagreements are refused and already-signed QSOs are omitted unless Sign again is selected. Upload signed log… and the signing result’s Upload to LoTW… use a separate confirmation and the credential core’s TLS.
- Extension pages can offer buttons (extension API 1.2.0): page actions and row actions, declared in the manifest and drawn by the core. A press is accepted only for the open page, a declared action and a row on screen, one at a time per page, and the page refreshes when it finishes.
- The LoTW extension, off until turned on in Settings → Extensions: the installed certificates with their call, DXCC, serial, QSO dates, validity and whether the key is installed; Load certificate…, Restore TQSL backup… and Delete…; and the trusted roots. If the store changes after a confirmation, it says that nothing was imported or deleted.
- `lotw:manage`: load LoTW certificates, restore TQSL backups and delete certificates through core-owned file, password and confirmation dialogs. An import or a delete commits exactly what the confirmation showed; if the store changed in between, nothing is changed and Desktop says to look again. A backup whose keys have different passwords asks for each, naming its call and serial. Backup locations can become Desktop Locations: a name already taken, compared without case, gets a ` (TQSL)` suffix and existing Locations are never overwritten, and creating them is unchecked by default. A pending operation is cancelled when its deadline passes or the extension host exits, and a late dialog answer is ignored.
- `make verify` audits every packaged Electron window and its content security policy, the password window included.

### Fixed

- Updated QG Trust to 0.2.1. A certificate file whose PEM body is truncated no longer hangs an import. An ADX log is recognised after comments without an XML declaration, a county whose state prefix disagrees with the Location is refused, and a Location created from ADIF refuses contradictory repeated station fields, naming the field to correct.
- Opening a log, signed log, certificate or backup no longer hangs on a named pipe. Large logs with many refusals or distinct station callsigns prepare and display promptly. Invalid station values are identified as invalid instead of asking you to add them to a Location.
- LoTW signatures carry exactly the Location shown in the confirmation. A QSO naming a station field the Location leaves empty is refused, and VUCC grid lists must agree on every QSO. Invalid station values refuse that QSO with its field and line or record number instead of stopping the preview. Location details such as POTA, SOTA and WWFF references, altitude and ARRL section no longer prevent signing. Subdivisions without a LoTW field for that entity are left out. Ordinary log fields such as `MY_RIG` and `MY_ANTENNA` do not cause station refusals, and QSOs outside the selected dates are counted separately.
- An extension turned on in Settings is on the rail at once; it used to appear only after a visit to Home.

### Changed

- TQSL backup restore and Sync share a Rust field conversion checked by rebuilding the exact signing station.
- CodeQL excludes one rule, `rust/access-invalid-pointer`, which only ever flagged napi-derive's generated code (alerts #13 and #28, false positives that returned whenever the code moved): our Rust denies `unsafe_code` (QGD-SEC-0022), so the compiler already refuses what the rule looks for. `tests/no-unsafe.test.mjs` checks the exclusion stays exactly that one rule.
- Rust formatting and Clippy are enforced in verification and CI.
- Development tooling (eslint, @electron/universal) uses minimatch 11.0.5, through an override limited to the affected range, for GHSA-g3hv-75wg-m249. The packaged application never contained minimatch.
- Licensed GPL-3.0-or-later, the same as every QSO Graph project.
- AGENTS.md and CLAUDE.md: the organization's shared agent guide, and this repository's own.
- README: American spelling, as the QSO Graph style guide asks.

## [0.6.0] - 2026-11-02

### Changed

- **Updates: Release and Beta** (#157). Settings → Updates now offers two choices. **Release**, the
  default, gets finished releases. **Beta** also gets the next release's Betas (`0.6.0-beta.1`, …)
  before it is final. If you had chosen Previews, you are on Beta. **Choose a version…** lists the
  current Release and the one before, and on Beta the next release's Betas; going back is still to
  a Release only. Daily builds are on the Releases page for 7 days and never offered by the
  application.
- **A copy installed with Homebrew no longer updates itself** (#157). It tells you a new Release
  is out and to run `brew upgrade --cask qso-graph-desktop`, so Homebrew always knows which version
  you have. Copies from Homebrew, apt and dnf take Releases only, and Settings says so; the install
  guide's *Trying a Beta* shows how to get one.
- **The Callsigns page shows only what each service takes** (KI7MT). eQSL, LoTW and HamQTH ask for
  a username and password, with no API key field; QRZ Logbook and Club Log ask for their key or
  token alone. Preferred credential appears only for a service that takes both a password and a
  key, which none does today, so each service simply uses its own kind.

### Fixed

- **eQSL: Test credential could not connect** ("Could not connect securely to eQSL"). eQSL's server
  offers nothing newer than TLS 1.2, and the application spoke only TLS 1.3 to any service that
  takes your password. eQSL's login alone now also accepts TLS 1.2, limited to the strong,
  FIPS-approved kind the application already allows for public reference data. Every other service
  is still TLS 1.3 only.
- **LoTW: Test credential said "unexpected response"** (#12) with a correct login. The test now asks
  LoTW the way other LoTW programs do, for your confirmations since this minute, which answers with a
  small file that says the login was accepted. If a service ever answers in a way the application
  cannot read, the log now says what kind of answer it was (its size and type, never its contents),
  so the cause can be found.
- **Club Log: Test credential failed with Password preferred.** A Club Log password saved before
  Club Log moved to tokens was sent as the token, and Club Log refused it. Each service is now
  tested with the kind of secret it takes, whatever preference was saved.
- **QRZ Logbook: Test credential with only the API key saved** (#11). Guided setup saves the
  logbook's key on its own, and the test answered that nothing was saved, because it looked for a
  username the logbook never asks for. It now asks for a username only where the service signs in
  with one, which is QRZ's lookup.

### Added

- **Club Log: Test credential works** (#11). Club Log now gives each ham a token for each program,
  instead of asking for your email and password, so Club Log setup asks for one thing: a token you
  make at Club Log under Settings → API, labelled QSO Graph Desktop. Test credential asks Club Log
  for your account's usage with it, which reads nothing from your log and changes nothing. A token
  Club Log refuses is reported once and never retried, as Club Log asks. Every request now names
  the application and its website, which Club Log requires.
- **eQSL, HamQTH and LoTW: Test credential works** (#9, #10, #12), so now every service the
  application lists can be tested. eQSL is asked for the date of your last upload, LoTW for a report
  with no QSOs in it, and HamQTH signs you in through its current API; none of them reads or changes
  your log. HamQTH takes your password in the body of the request. eQSL and LoTW take it only in the
  web address, so there it goes over HTTPS only, is never followed to another site, and never
  appears in a message or the log.

### Security

- **The application log holds only the application's own messages** (#12). The libraries under the
  credential core, for HTTPS and for Linux's keyring, write detailed messages of their own about
  connections and keyring calls, and those reached the log. Until now no password went in a web
  address, but eQSL and LoTW take it there, so a message describing one of those connections could
  have carried it. Only the application's own messages, which never hold a credential, are written now.

## [0.5.2] - 2026-10-30

### Security

- **Linux and Windows: no connection to Google at startup** (#138). Each time it started, the
  application's browser engine fetched a spellcheck dictionary from Google's servers, though spell
  checking was already off. Nothing about you was sent, but it was a connection the application
  promises not to make: only its credential core goes online, and only for what you ask. It no
  longer fetches one. macOS was not affected.

### Fixed

- **dnf can read our repository after every release** (#134). Publishing 0.5.0 left one of the two
  dnf repositories on packages.qso-graph.net without its index, first x86_64's and then aarch64's,
  so dnf there could not update QSO Graph Desktop. Publishing now removes only files the new
  repositories no longer name, and checks every file they hold before it finishes.
- **The banner Windows shows while an update installs says all of its message** (#135). Its second
  line was cut off after "when it's"; it now reads "It reopens when it's done."
- **dnf installs and updates from our repository again** (#143). After 0.5.1 was published, dnf
  refused its package with "checksum doesn't match", and older versions the same way. Each time the
  repository was rebuilt, every package was signed again and the index described the new copy,
  while the site kept the old one. Packages already published are now kept as they are, and
  publishing checks every file the site serves, packages included, against what was built.
- **The Linux package is named `qso-graph-desktop`, like everything else** (#145). It was
  `qg-desktop`, so `sudo dnf upgrade qso-graph-desktop` and its apt equivalent answered that no such
  package exists. The package and the command that starts the application are now
  `qso-graph-desktop`. A copy installed under the old name moves over on its next `sudo dnf upgrade`
  or `sudo apt upgrade`, settings and all.

## [0.5.0] - 2026-10-30

### Added

- **The Monitor: WSJT-X's decodes, as they arrive** (#125). Turn on the **WSJT-X** adapter and the
  **Monitor** in Settings → Extensions, point WSJT-X's UDP Server at this computer, and the Monitor
  shows each copy of WSJT-X's dial frequency, mode and whether it is transmitting, with its decodes
  grouped by cycle, newest first, low-confidence and off-air ones marked. **All** shows every copy
  together; each copy has a tab of its own. It asks WSJT-X for the decodes it already has, so it is
  not empty when it opens. It is read-only: nothing is sent to WSJT-X but that one request, and
  nothing it shows changes your data.
- **Integrations**, in the rail: what is listening for the programs your station runs. Nothing
  listens until you turn an adapter on, and turning it off closes its port. Each adapter listens on
  this computer alone unless you choose a network, and on a network only the computers you name
  may send. The page shows the port, who may send, whether it is hearing WSJT-X and when it last
  did, and anything it dropped and why.

### Fixed

- **Settings and Home no longer scroll the whole window.** A second scrollbar appeared beside the
  page's own, and scrolling it moved the header, the rail and the status bar off the window, leaving
  an empty band below. Only the page scrolls now.
- **The rpm installs on Rocky Linux and RHEL 10 without EPEL.** It required `libXScrnSaver`, which
  the application does not use and which those systems ship only in EPEL, so on a system without
  EPEL dnf refused to install it. The deb drops the same library (`libxss1`).

## [0.4.1] - 2026-10-29

### Security

- **The update feed is signed, and nothing in it is believed without that signature** (#128). On
  Linux an AppImage update was trusted on what the feed said alone, so whoever could change the feed
  could choose what was installed. The feed is now signed with the release key that signs our apt
  and dnf repository, and the application checks that signature, and that the feed is not older
  than one it has already seen, before it reads a word of it. Windows and macOS were already
  protected by the installer's own signature, and now have both.

### Fixed

- **QRZ Logbook's credential test works with just its API key** (#8). It asked for a username the
  setup never offered, so a key saved through Setup could not be tested.
- **QSO Graph Desktop tells QRZ and every other service its real version** (#129), instead of
  `0.0.0-preview.1`.

### Changed

- **A release's page starts with Quick downloads:** the file for your computer, Windows, Linux or
  macOS, before the full list, and ends with one line saying CI's checks passed on every platform,
  linked to the build the files came from.

- **The documentation says what the application does.** Every extension starts off until you turn it
  on in Settings → Extensions (four READMEs said "on by default"); the extensions README lists the
  four that ship; the Windows installer is signed (Troubleshooting said it wasn't); Linux packages
  come from our signed apt and dnf repository; diagnostics are saved from Help → Save Diagnostics for
  Support…; security fixes are made for the latest Stable release on `main`; and the install page
  shows Homebrew for macOS.

## [0.4.0] - 2026-10-28

### Added

- **The Windows installer has our own artwork:** the QSO Graph icon on the app's dark navy, on the
  installer's first and last pages and along the top of the others. (#122)
- **Start it when the installer finishes:** the Windows installer's last page has *Run QSO Graph Desktop*,
  ticked; untick it to finish without starting. (#122)

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

Twenty of these were found in review by an AI reviewer, one of the AI agents QSO Graph Desktop is
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
