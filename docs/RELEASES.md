# Releases: how QSO Graph Desktop is versioned, named and published

Decided by KI7MT, 2026-10-23. It follows **Podman Desktop**, which is built the
way this application is (Electron, electron-builder, published on GitHub), so
there is a working example of every rule below.

Previews and pre-releases are published by CI (`.github/workflows/ci.yml`, the
`preview` and `release` jobs); promoting a pre-release is
`.github/workflows/promote.yml`. The last section lists what is still to build.

## Versions

Every version is **Semantic Versioning** (semver.org): `MAJOR.MINOR.PATCH`.

| Part | Goes up when | Example |
|---|---|---|
| **MAJOR** | a change breaks what a user or an extension relied on | `1.0.0` to `2.0.0` |
| **MINOR** | a release adds features | `0.1.0` to `0.2.0` |
| **PATCH** | a release only fixes things | `0.1.0` to `0.1.1` |

- **0.x is before the first general release.** Anything may still change.
  **1.0.0** is the first release meant for every ham.
- **The version lives in one place:** `version` in `package.json`. The
  installers, the About box and the release all take it from there.
- **A tag is the version with a `v`:** `v0.1.0`.
- **develop always carries the next version.** Once `0.1.0` is out, develop's
  `package.json` moves to `0.2.0`, so everything built from develop says which
  release it is heading for.

## The three kinds of build

| Kind | Built from | Version and tag | Published | For |
|---|---|---|---|---|
| **Preview** | each green build of develop | the next version, the UTC date and time of the commit, and the commit: `0.2.0-202610230124-34d3a62a1b0` | **one** pre-release named **Preview** on this repository's Releases page, tag `preview`, replaced by each green build | testing what is on develop, every day |
| **Pre-release** | main, after a release PR from develop | the version itself, no suffix: `v0.2.0`, then `v0.2.1`, `v0.2.2` for fixes | a **pre-release** on this repository's Releases page | testing a release before it is called final |
| **Release** | the same build as the pre-release it was | unchanged: `v0.2.1` | the pre-release **promoted** to a full release, marked **Latest** | everyone |

### Previews

- A preview's version is `<next version>-<YYYYMMDDHHMM>-<commit>`: the version
  develop is heading for, the **commit's** UTC date and time to the minute, and
  the first 11 characters of the commit. `0.2.0-202610230124-34d3a62a1b0` sorts
  by time and names exactly the code it was built from. The commit's time
  rather than the build's, because each platform is built on its own machine
  at its own moment, and every file of one preview must carry one version. It
  is added by the build and never committed.
- **There is one preview at a time**, on this repository's Releases page: a
  pre-release named Preview, tag `preview`, with every installer as its own
  download. Each green build of develop replaces it, files, tag and all. Old
  previews are not kept (KI7MT, 2026-10-23: "we dont have hundreds of
  contributors"). Podman Desktop keeps a history of its previews in a
  repository of their own; that needs a credential for another repository in
  this one's public CI, which one preview at a time does not.

### Pre-releases and releases

- **There are no release candidates by name.** A release goes out first as a
  pre-release with its final version, `v0.2.0`. A fix is a new patch,
  `v0.2.1`, also a pre-release. When one has proved itself it is **promoted**:
  the same pre-release, its same files, marked a full release and Latest.
  Nothing is rebuilt or renamed, so what was tested is what ships.
- **main changes only by a release PR** from develop (or `security/*`), as this
  repository's rules already require. A merged release PR builds the
  pre-release; tagging it is part of that build.
- **KI7MT decides** when a release PR is opened and when a pre-release is
  promoted.

### Making a release

The text steps are `scripts/release.mjs`; the builds are CI's.

1. **On develop:** `node scripts/release.mjs prepare`. CHANGELOG.md's
   `[Unreleased]` becomes `[0.2.0] - <today>`, under a new empty
   `[Unreleased]`. Commit it.
2. **The release PR**, develop to main, when KI7MT says so. Merging it is the
   release.
3. **main's build checks first:** the version is a plain `MAJOR.MINOR.PATCH`,
   CHANGELOG.md has its section, and the tag is not taken. Any one missing
   stops the build in minutes, before hours of packaging.
4. **main's build publishes the pre-release** `v0.2.0`: every installer, each
   file checked to carry that version, `SHA256SUMS.txt`, and that version's
   CHANGELOG section as the notes. Creating the release creates the tag, on
   the commit that was built; a version already released is refused.
5. **On develop:** `node scripts/release.mjs next minor` (or `patch`, or
   `major`) moves `package.json` and its lock to the next version. Commit it.
6. **Promote**, when the pre-release has proved itself and KI7MT says so:
   Actions → **Promote** → Run workflow, with the version. It checks the
   release is a pre-release this repository built from main, then marks it a
   full release and Latest. Nothing is rebuilt.

## File names

Every file is named

```
qso-graph-desktop-<version>-<os>-<arch>.<ext>
```

| Platform | Files |
|---|---|
| Windows x64 | `…-win-x64.exe` (installer), `…-win-x64.zip` (portable) |
| macOS Apple Silicon | `…-mac-arm64.dmg`, `…-mac-arm64.zip` |
| Linux x64 | `…-linux-x86_64.AppImage`, `…-linux-amd64.deb`, `…-linux-x86_64.rpm`, `…-linux-x64.zip` |
| Linux arm64 | `…-linux-arm64.AppImage`, `…-linux-arm64.deb`, `…-linux-aarch64.rpm`, `…-linux-arm64.zip` |

The architecture word follows each format's own convention (Debian says
`amd64`, RPM and AppImage `x86_64`), as electron-builder writes it. No spaces,
and the full version is in every name, so a file on its own says what it is.

- **A `.zip` is the portable build:** unpack it anywhere and run it, with
  nothing to install.
- **macOS is Apple Silicon only.** Apple's macOS 26 is the last release for
  Intel Macs.
- **Each release has a `SHA256SUMS.txt`** listing every file's SHA-256, so a
  download can be checked.

## Release notes

`CHANGELOG.md` collects changes under **Unreleased** as they land. A release
renames that heading to its version and date, and the release's notes on
GitHub are that section. A pull request never changes the version: a release
does.

## Signing

Builds are **unsigned** until the Apple Developer ID and a Windows
code-signing certificate are in place. Until then Windows SmartScreen and macOS
Gatekeeper warn the first time it runs, and every release's notes say so.
Signing will change nothing above but the warning.

## Updates

Decided by KI7MT, 2026-10-23: **an easy update is a must**, whichever kind of
ham is updating. Some always want the newest; some want it to just keep
working. Both get one click.

### Two tracks

| Track | Offered | For |
|---|---|---|
| **Stable** (the default) | full releases only | hams who want it to just work |
| **Early** | full releases and pre-releases | hams who want the newest the day it is out |

Chosen in Settings. Previews are never offered as an update: they are for
testing develop, not for running the station.

### How it asks

- **Never forced, and never restarted without asking.** When an update has
  downloaded, a quiet line says *"Version 0.2.0 is ready. What's new ·
  Restart to update"*. Ignored, it installs the next time the application
  quits.
- **What's new** opens that version's notes (its `CHANGELOG.md` section).
- **Offline, nothing is tried.** The check waits for the network, as every
  page that needs the internet does.

### What updates itself

| Build | Update |
|---|---|
| Windows installer | itself: downloads in the background, installs on restart |
| Linux AppImage | itself: the new AppImage replaces the old |
| macOS | itself **once the app is signed** (Apple's updater refuses an unsigned app); until then, a notice with the download link |
| Linux deb and rpm | through a package repository later, with the rest of the system; until then, a notice with the download link |
| A portable zip | a notice with the download link, by design: it lives where the operator put it |

### How it is safe

- **Through the credential core**, as every outbound connection is
  (`QGD-SEC-0020`): the core fetches the release's update information and the
  download, and only a file the core fetched and checked is handed to
  electron-updater to install. The application opens no connection of its own
  for updates.
- **Checked:** every download against the SHA-512 its release publishes.
  Until the builds are signed that catches a broken download, not a tampered
  release, because the sum is published beside the file; signing closes that,
  and is wanted before 1.0.
- **Private:** checking for updates is going online, so **Check for updates**
  is a switch in Settings, **on** by default, and Privacy names it. It asks
  this repository's releases what is newest and sends nothing about the
  operator.

## Not built yet

1. Self-update, as above.
