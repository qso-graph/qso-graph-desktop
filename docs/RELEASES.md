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
| **Preview** | develop, each night it has changed and passed its tests | the next version, the UTC date and time of the commit, and the commit: `0.2.0-202610230124-34d3a62a1b0` | **one** pre-release named **Preview** on this repository's Releases page, tag `preview`, replaced each night | testing what is on develop, every day |
| **Pre-release** | main, after a release PR from develop | the version itself, no suffix: `v0.2.0`, then `v0.2.1`, `v0.2.2` for fixes | a **pre-release** on this repository's Releases page | testing a release before it is called final |
| **Release** | the same build as the pre-release it was | unchanged: `v0.2.1` | the pre-release **promoted** to a full release, marked **Latest** | everyone |

### Previews

- **Built each night, not on each push** (KI7MT, 2026-10-24). Signing and
  notarizing the Mac build cost minutes every time, Apple's queue included,
  so they are paid once a night and on releases. A push to develop is tested
  and packaged, unsigned, and publishes nothing. The night's run builds
  develop, signs and notarizes it, and replaces the Preview, and does nothing
  at all when develop is what the Preview already is. GitHub runs a schedule
  from main, so the nightly starts once this workflow is on main; until then,
  and whenever one is wanted sooner, **Actions → CI → Run workflow** on
  develop makes the same signed Preview. Ticking **mac_only** builds, signs,
  notarizes and launches only the Mac package and publishes nothing, for
  work on signing itself.

- A preview's version is `<next version>-<YYYYMMDDHHMM>-<commit>`: the version
  develop is heading for, the **commit's** UTC date and time to the minute, and
  the first 11 characters of the commit. `0.2.0-202610230124-34d3a62a1b0` sorts
  by time and names exactly the code it was built from. The commit's time
  rather than the build's, because each platform is built on its own machine
  at its own moment, and every file of one preview must carry one version. It
  is added by the build and never committed.
- **There is one preview at a time**, on this repository's Releases page: a
  pre-release named Preview, tag `preview`, with every installer as its own
  download. Each night's build replaces it, files, tag and all. Old
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
5. **The feed's Early entry** (below): `release.mjs feed early` from the
   pre-release's `SHA256SUMS.txt`, committed to the updates repository. Early
   installs are offered it from then.
6. **On develop:** `node scripts/release.mjs next minor` (or `patch`, or
   `major`) moves `package.json` and its lock to the next version. Commit it.
7. **Promote**, when the pre-release has proved itself and KI7MT says so:
   Actions → **Promote** → Run workflow, with the version. It checks the
   release is a pre-release this repository built from main, then marks it a
   full release and Latest. Nothing is rebuilt.
8. **The feed's Stable entry**, the same way: everyone on Stable is offered it
   from then.

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

**macOS builds are signed and notarized** (KI7MT, 2026-10-23). Every macOS
build of develop and main is signed with the project's Apple Developer ID,
"Developer ID Application: Greg Beam (DP5KUCDR7L)", under the hardened
runtime with one exception (JIT, which V8 needs: `build/entitlements.mac.plist`),
notarized by Apple, and the ticket stapled, so Gatekeeper opens it on first
launch, offline too. CI checks all three before the files are kept.

- The certificate, its password and the notarization key are secrets in the
  repository's **macos-signing** Environment, released only to jobs on develop
  and main: never to a pull request, never to a fork. Only the macOS packaging
  step reads them. They are KI7MT's; no agent holds or sees them.
- A pull request's macOS build, and any build made locally, is unsigned, as
  before.
- **Windows is unsigned** until it has a certificate, so SmartScreen warns the
  first time it runs, and every release's notes say so. Linux packages are
  unsigned too.

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
| macOS | itself: the signed zip, checked against the feed and then by `codesign` to be signed by the same team, replaces the application where it is. Run from the disk image, or from a folder it cannot write to, a notice with the download link |
| Linux deb and rpm | through a package repository later, with the rest of the system; until then, a notice with the download link |
| A portable zip | a notice with the download link, by design: it lives where the operator put it |

### How it is safe

- **Through the credential core**, as every outbound connection is
  (`QGD-SEC-0020`): the core fetches the feed and the download, and the
  application opens no connection of its own for updates.
- **Installed by the application itself**, not electron-updater (KI7MT,
  2026-10-23): electron-updater installs only what it downloaded, over
  Electron's own networking, and handing it the core's file would need a local
  server, which this product does not have. What it does at the end is small:
  the Windows installer is run silently, an AppImage is replaced in place, the
  signed macOS zip is unpacked beside the application, checked to be signed by
  the same team as the running one, and swapped in, and all of it happens as
  the application quits, after its stores have closed.
- **Checked:** every download against the SHA-256 the feed gives for it, as it
  arrives; a file that does not match is deleted, never installed. Until the
  builds are signed that catches a broken download or a mirror sending
  something else, not a tampered release, because the feed and the files are
  published by the same hands; signing closes that, and is wanted before 1.0.

### The feed

One small file, `https://updates.qso-graph.io/desktop.json`, is all an
installed copy asks. It lives in its own public repository,
`qso-graph/qso-graph-desktop-updates`, served by GitHub Pages at that name
through a CNAME in the qso-graph.io zone. The application knows only the
address, in `data/update-sources.json`, which the credential core builds in;
where the address points can change by DNS, with no release. That register
also names the hosts a download may come from: GitHub's release hosts, any
name under qso-graph.io, qso-graph.com or qso-graph.org (a Cloudflare R2 mirror,
say), and SourceForge's download hosts. A host is trusted to deliver bytes,
never to say what they are: the feed says that.

```json
{
  "format": "qso-graph-desktop-updates",
  "version": 1,
  "stable": { "version": "0.1.0", "files": {
    "win-x64":      { "name": "qso-graph-desktop-0.1.0-win-x64.exe",           "url": "https://github.com/…/v0.1.0/…", "sha256": "…" },
    "linux-x86_64": { "name": "qso-graph-desktop-0.1.0-linux-x86_64.AppImage", "url": "…", "sha256": "…" },
    "linux-arm64":  { "name": "qso-graph-desktop-0.1.0-linux-arm64.AppImage",  "url": "…", "sha256": "…" },
    "mac-arm64":    { "name": "qso-graph-desktop-0.1.0-mac-arm64.zip",         "url": "…", "sha256": "…" }
  } },
  "early": { "version": "0.2.0", "files": { … } }
}
```

Stable is offered `stable`; Early the newer of `stable` and `early`. A track
the application cannot read offers nothing. Each change to the feed is a
commit in its repository, so what was offered, and when, is on record, and
reverting a commit withdraws a bad release.

`node scripts/release.mjs feed <early|stable> <version> SHA256SUMS.txt desktop.json`
writes a track's entry from the release's own `SHA256SUMS.txt`.
- **Private:** checking for updates is going online, so **Check for updates**
  is a switch in Settings, **on** by default, and Privacy names it. It asks
  this repository's releases what is newest and sends nothing about the
  operator.

## Not built yet

1. The updates repository and its DNS name, before the first release.
2. A package repository for deb and rpm.
