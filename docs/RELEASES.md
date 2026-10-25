# Releases: how work becomes a release of QSO Graph Desktop

Decided by KI7MT, 2026-10-25, replacing the develop/release-branch flow of
2026-10-23 and the GitFlow tried for one evening. It follows **Podman Desktop**,
built the way this application is (Electron, electron-builder, published on
GitHub), and the shape VS Code and Bitwarden use: one working branch, and
releases started on purpose.

**Why:** nothing reaches the street until it's ready, by design rather than by
convention, with as few branches, pull requests and builds as that allows.
Merging never publishes; only the Release workflow does, and it refuses while
the milestone is unfinished.

Items marked *(not built yet)* are listed at the end, with what builds them.

## The rules

1. **One working branch: `main`.** It holds the latest finished, validated
   work. Merging into it builds and tests, and **never publishes**.
2. **One milestone at a time, worked serially** (KI7MT: "parallel is what gets
   us going sideways every time"). One milestone open, one `feature/x.y.z`
   branch, one issue in hand, and nothing started until the one before is
   finished.
3. **A milestone is a version.** KI7MT names it (`0.2.1`) and lists its issues.
   That list is the definition of "ready for the street".
4. **Every fix is validated on a build of exactly that fix**, never on a
   Preview. Previews are for daily testing only.
5. **Only the Release workflow publishes.** KI7MT decides when; it is run on
   his word ("release 0.2.1"), by him or by an agent, and the run records who.
6. **Nobody pushes to `main`.** Every change reaches it by a pull request that
   KI7MT merges, with a merge commit, and **only once CI's "all green" check
   has passed**: a required check, so a red pull request cannot be merged.
   Documentation-only changes run just the citation check (every `QGD-…` ID a
   Markdown file cites must exist in the spec), about a minute, and build
   nothing else. Work is authored by an agent and merged
   by KI7MT, so each change is merged by someone other than its author, which
   is what OpenSSF Scorecard's code-review check asks. A change KI7MT authors
   and merges himself does not meet that check; that is accepted, and rare.
7. **This governs QSO Graph Desktop.** The qso-graph MCP repositories keep
   their own release workflow for now, until this one is settled and they are
   brought in line.

## Branches

| Branch | From | Into | Lives |
|---|---|---|---|
| **`main`** | | | always |
| **`feature/x.y.z`** | `main`, when milestone `x.y.z` starts | `main`, by one pull request, when every issue in the milestone is validated | the length of the milestone |
| **`x.y.x`** (`0.2.x`) | the release's tag, `v0.2.0` | released from itself; never merged back | only when an already released version needs a fix: rare |
| **`docs/<topic>`** | `main` | `main` | a documentation-only change: only the citation check runs (a minute), then merged |

The author deletes a branch once it is merged, everywhere it exists, by name, never
in bulk.

## A milestone, start to finish

1. **KI7MT defines the milestone:** its version and its issues.
2. **`feature/x.y.z` is created from `main`.** Its first commit sets the
   version in `package.json` (and its lock) to `x.y.z`.
3. **Its pull request into `main` is opened at once, as a draft.** Every push
   to the branch builds a **validation build** (below), and its installer links
   are posted on the pull request.
4. **The issues are worked one at a time.** Each commit names its issue
   (`#91: …`). When an issue's fix is in, KI7MT installs that validation build
   and tries it. The issue records **"validated on x.y.z-pr<N>.<commit>"**
   and is closed.
5. **When every issue is closed:** the release checks on a lab machine
   (screenshots and the gallery, as before), `node scripts/release.mjs prepare`
   (CHANGELOG.md's `[Unreleased]` becomes `[x.y.z] - <date>`), a final
   validation build, a review on the pull request, and **KI7MT merges it**.
6. **Release** (below).
7. **Promote** to Stable when the pre-release has proved itself.
8. **The next milestone** starts from `main` again, at step 2.

## The kinds of build

| Kind | Built from | Version | Where it goes | For |
|---|---|---|---|---|
| **Validation build** | each push to a pull request from this repository's own branch | `x.y.z-pr<N>.<commit>`: `0.2.1-pr96.c0b8250` | that CI run's files, one download each, linked from one comment on the pull request | validating each issue's fix |
| **Preview** | `main`, each night it has changed | `<version>-<YYYYMMDDHHMM>-<commit>` | **one** pre-release, **Preview of x.y.z**, tag `vx.y.z-preview`, replaced each night | daily testing; never issue validation |
| **Pre-release** | the **Release** workflow, from `main` | `x.y.z`, no suffix | a pre-release, tag `vx.y.z`, on the Early track | the release, before it is called final |
| **Release** | the same pre-release, **promoted** | unchanged | marked a full release and Latest, on the Stable track | everyone |

### Validation builds

- Built from the branch's own commit, not GitHub's merge of it into `main`,
  and stamped `x.y.z-pr<N>.<commit>` (the pull request's number and the first
  7 characters of that commit), so the installed application's title bar and
  Settings → About say exactly what is being tested. A validation build never
  updates itself.
- **Signed** like a release (Windows: Gregory Beam; macOS: Developer ID,
  notarized) when the branch is a milestone's (`feature/x.y.z`) or a fix's
  (`x.y.x`). Other branches of this repository build unsigned; a fork's pull
  request gets no validation build at all, only the checks.
- When the build finishes, one comment on the pull request links each
  installer, unzipped and under its own file name. Each new build edits that
  comment, so it always shows the latest. GitHub keeps the files 14 days, and
  downloading them needs a GitHub sign-in.

### Previews

- **Built each night, not on each push** (KI7MT, 2026-10-24): signing and
  notarizing cost minutes each time, Apple's queue included. The night's run
  builds `main`, signs it, and replaces the Preview, and does nothing when
  `main` is what the Preview already is. **Actions → CI → Run workflow** on
  `main` makes one sooner. Ticking **mac_only** builds, signs, notarizes and
  launches only the Mac package and publishes nothing.
- A Preview's version is `<version>-<YYYYMMDDHHMM>-<commit>`: `main`'s version,
  the **commit's** UTC date and time to the minute, and the first 11
  characters of the commit, so every platform's file carries one version.
- **One Preview at a time**, named **Preview of** the version, tagged
  `v<version>-preview`, so GitHub (which sorts by version and puts any other
  tag last) shows it at the top. Each night's replaces the last.

## Making a release

1. **The milestone's pull request is merged** (step 5 above), so `main` has
   the version, the CHANGELOG section and every validated fix.
2. **Actions → Release → Run workflow**, version `x.y.z` *(not built yet)*.
   It refuses, in minutes and before any packaging, unless:
   - `main`'s `package.json` says `x.y.z`, and the tag `vx.y.z` is not taken;
   - CHANGELOG.md has a `[x.y.z]` section;
   - milestone `x.y.z` has **no open issues**.
3. **It builds, tests, signs and publishes** the pre-release `vx.y.z`: every
   installer (each checked to carry that version), `SHA256SUMS.txt`, and the
   CHANGELOG section as its notes. The tag is created on the commit that was
   built. The Microsoft Store package is kept with the run, for upload to
   Partner Center.
4. **It updates the Early feed** to `x.y.z` *(not built yet: the feed moves
   into this repository so the workflow can publish it with this repository's
   own permission)*, and **closes the milestone**.
5. **Promote**, when it has proved itself and KI7MT says so: Actions →
   **Promote** → Run workflow, with the version. It marks the same
   pre-release a full release and Latest. Nothing is rebuilt. Then the Stable
   feed.

## Fixing a released version

Rare: most fixes simply go into the next milestone. When an already released
version must be fixed and the next milestone isn't close:

1. **Pick the version first.** A fix to a released version takes the **next
   free patch number** (`0.2.1` after `0.2.0`). If the open milestone already
   holds that number, the milestone moves up (to `0.2.2`, or the next minor)
   before anything is built: two builds must never claim one version or one
   tag.
2. `0.2.x` from the release's tag (`v0.2.0`), if it does not already exist.
3. The fix, as its own pull request into `0.2.x`, validated on its build, and
   the same fix made on `main` too, in the current milestone.
4. **Release** from `0.2.x`, with the version chosen in step 1.

## Versions

Every version is **Semantic Versioning** (semver.org): `MAJOR.MINOR.PATCH`.

| Part | Goes up when | Example |
|---|---|---|
| **MAJOR** | a change breaks what a user or an extension relied on | `1.0.0` to `2.0.0` |
| **MINOR** | a release adds features | `0.1.0` to `0.2.0` |
| **PATCH** | a release only fixes things: nits, tweaks and bug fixes (KI7MT, 2026-10-24) | `0.2.0` to `0.2.1` |

- **0.x is before the first general release.** Anything may still change.
  **1.0.0** is the first release meant for every ham.
- **The version lives in one place:** `version` in `package.json`. The
  installers, the About box and the release all take it from there. It is set
  by the first commit of a milestone's branch, never by the release itself.
- **A tag is the version with a `v`:** `v0.2.1`. Tags are made only by the
  Release workflow.

## Release notes

`CHANGELOG.md` collects changes under **Unreleased** as they land on a
milestone's branch. **Every change starts from an issue** (KI7MT, 2026-10-25),
so the history reads issue, commits naming it (`#91: …`), the build it was
validated on, and **a CHANGELOG line that cites it** (`(#91)`). Changes a user
can't see (CI, process, documentation) need an issue but no CHANGELOG line.

`release.mjs prepare` renames that heading to the version
and date, and the release's notes on GitHub are that section. The CHANGELOG
also ships inside the application as What's New, which is why a change to it
always builds.

## Signing

Every official build is signed in KI7MT's own name (`QGD-SCP-0003`).

- **macOS:** signed with the Apple Developer ID "Developer ID Application:
  Greg Beam (DP5KUCDR7L)", under the hardened runtime with one exception (JIT,
  which V8 needs: `build/entitlements.mac.plist`), notarized by Apple, and the
  ticket stapled. The certificate, its password and the notarization key are
  secrets in the **macos-signing** Environment.
- **Windows:** signed through Microsoft's Azure Artifact Signing with a
  certificate issued to KI7MT's verified legal name, **Gregory Beam**: the
  installer, the application and the native credential core. CI signs in to
  Azure with GitHub's own token, trusted for the **windows-signing**
  Environment of this repository alone, so no signing secret exists; the
  Environment holds only three IDs. CI checks every signed file says
  `CN=Gregory Beam`. A new signature has no download history yet, so Edge and
  SmartScreen may still warn; the **Microsoft Store** copy shows no warning,
  and the Store signs its own package.
- **Linux:** packages are unsigned; `SHA256SUMS.txt` lets a download be
  checked.
- The signing Environments release their secrets to `main` and, for
  validation builds, to pull requests: GitHub checks a pull request's run
  against `refs/pull/*/merge`, never against its branch's name, so that is the
  rule each Environment carries. **A fork's pull request still never signs,**
  and not because of a condition in the workflow, which the same pull request
  could edit: GitHub gives a run from a fork no secrets and no token Azure
  would accept, whatever its workflow asks for. The workflow's own check (this
  repository's branch, `feature/x.y.z` or `x.y.x`) only keeps other branches
  of ours from spending signing time. The secrets are KI7MT's; no agent holds
  or sees them.

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
daily testing, not for running the station. A copy from the Microsoft Store
is updated by the Store and never updates itself.

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
  the Windows installer is run silently, only once Windows finds it signed by
  the same publisher as the running copy, an AppImage is replaced in place, the
  signed macOS zip is unpacked beside the application, checked to be signed by
  the same team as the running one, and swapped in, and all of it happens as
  the application quits, after its stores have closed.
- **Checked:** every download against the SHA-256 the feed gives for it, as it
  arrives; a file that does not match is deleted, never installed. That
  catches a broken download or a mirror sending something else; the signature
  checks above (same publisher on Windows, same team on macOS) catch a
  tampered one. Linux AppImages have only the SHA-256 until Linux signing
  exists.

### The feed

One small file, `https://updates.qso-graph.io/desktop.json`, is all an
installed copy asks. Today it lives in its own public repository,
`qso-graph/qso-graph-desktop-updates`, served by GitHub Pages at that name
through a CNAME in the qso-graph.io zone; it moves into this repository so
the Release workflow can update it *(not built yet)*. The application knows only the
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

What this document describes but CI does not do yet, in the order it will be
built (the first pass of milestone 0.3.0, released as 0.2.1):

1. **The Release workflow** (Actions → Release, with the version): its checks
   (version, tag, CHANGELOG section, milestone closed), publishing the
   pre-release, the Early feed, closing the milestone. Until it exists, a
   release is published as before, by a pull request into `main`.
2. **Merging into `main` stops publishing**, once the Release workflow does.
3. **The update feed moves into this repository**, at the same address.
4. **GitHub settings:** `main` becomes the default branch, and `develop` is
   retired along with the "protect main and develop" ruleset's reference to
   it.
5. A package repository for deb and rpm.
