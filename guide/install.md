# Install and update

Everything is on the [Releases page](https://github.com/qso-graph/qso-graph-desktop/releases). No
account is needed to download. Each file's name says the version and what it is for, and
`SHA256SUMS.txt` beside them lets you check a download. To check that a download is an official
build, and who published it, see [Verify your download](../README.md#verify-your-download).

## Windows

Download `…-win-x64.exe` and run it. Choose where to install it and whether it is for you alone or
everyone on the computer, and it adds itself to the Start menu.

It is signed by Gregory Beam (KI7MT). The signature is new, so Edge may say the file *isn't commonly
downloaded* (choose **Keep**), and Windows may say it *protected your PC*: **More info** shows the
publisher, then **Run anyway**. It does not ask again.

QSO Graph Desktop needs Microsoft's **Visual C++ runtime**, which a brand-new Windows PC may not
have yet. If yours doesn't, the installer downloads Microsoft's own installer from Microsoft, checks
that Microsoft signed it, and runs it: Windows asks once for an administrator's permission. If that
can't happen (no internet while installing, say), QSO Graph Desktop tells you when it starts, with a
button to Microsoft's page.

## Linux

**The AppImage** is the one most people want: one file that runs on almost any distribution, on a
PC (`…-linux-x86_64.AppImage`) or a Raspberry Pi 5 (`…-linux-arm64.AppImage`), and updates itself.

1. Download it, and make it runnable: right-click → Properties → *Allow executing file as
   program*, or `chmod +x qso-graph-desktop-*.AppImage`.
2. Double-click it, or run it from a terminal.

On Ubuntu 22.04 and later, an AppImage needs FUSE, which is not installed by default:
`sudo apt install libfuse2t64` on Ubuntu 24.04, `sudo apt install libfuse2` on 22.04.

**Prefer a package?** Install from our own repository, and QSO Graph Desktop updates with the rest of
your system. It offers Stable releases, on PCs and on a Raspberry Pi 5.

On Debian, Ubuntu or Raspberry Pi OS:

```bash
sudo curl -fsSL -o /usr/share/keyrings/qso-graph-desktop.gpg https://packages.qso-graph.net/qso-graph-desktop.gpg
echo "deb [signed-by=/usr/share/keyrings/qso-graph-desktop.gpg] https://packages.qso-graph.net/apt stable main" | sudo tee /etc/apt/sources.list.d/qso-graph-desktop.list
sudo apt update
sudo apt install qso-graph-desktop
```

On Fedora, Rocky or RHEL:

```bash
sudo curl -fsSL -o /etc/yum.repos.d/qso-graph-desktop.repo https://packages.qso-graph.net/qso-graph-desktop.repo
sudo dnf install qso-graph-desktop
```

dnf asks you to accept our key the first time. Check that its fingerprint is
`E4EC 9751 F1AA 66AB 2BA5  08EF 0410 96B9 A6EB D256` (*QSO Graph Releases*), then answer **y**. Every
package and every index in the repository is signed with it, and apt and dnf refuse anything that
isn't. The key is itself signed by KI7MT's own long-standing key, `C177 6630 7115 78FE 9A2B  9F7F
18C0 F6B7 0DA2 F991`.

From then on, `sudo apt upgrade` or `sudo dnf upgrade` brings each new release.

You can also install a single `.deb` or `.rpm` from the Releases page, with
`sudo apt install ./qso-graph-desktop-*-linux-amd64.deb` or
`sudo dnf install ./qso-graph-desktop-*-linux-x86_64.rpm`. A package installed that way doesn't
update itself: the application tells you when a newer version is out.

## macOS

Download `…-mac-arm64.dmg` (Apple silicon), open it, and drag **QSO Graph Desktop** to
**Applications**. Open it from Applications, not from the disk image: the first time, macOS asks
whether to open an app downloaded from the internet. It is signed by Greg Beam (KI7MT) with an Apple Developer ID, and notarized by Apple.

Or with [Homebrew](https://brew.sh), which installs the same signed download:

```bash
brew install qso-graph/tap/qso-graph-desktop
```

The app updates itself either way. To have Homebrew move it to a new Stable release, name it:
`brew upgrade qso-graph-desktop`.

## The portable build

Each platform also has a `.zip`. Unpack it anywhere, a USB stick included, and run it: nothing is
installed (on Windows it still needs Microsoft's Visual C++ runtime, above). To keep its data beside
it rather than in your user folder, make a folder named
`qso-graph-data` next to the application before the first start. Your logins are never put in that
folder: each computer keeps its own, in its own credential store.

## Keeping it up to date

Once a day, while you are online, the application asks whether a newer version is out. It sends
nothing about you. When one is out, a line at the bottom of the window says so, with **Download
and install**; nothing is downloaded until you choose. Once it has downloaded, choose **Restart to
update**, or carry on, and it updates the next time you quit. It never restarts without asking.
While a newer Stable release is out, the window's title says so too.

In **Settings → Updates** you choose:

- **Stable**, the default: full releases only.
- **Early**: pre-releases too, the newest the day it is out.
- **Previews**: last night's build too.
- Or turn **Check for updates** off.

Early releases and Previews are for those who want to try what is coming. They carry no guarantee.

### Going back

**Choose a version…** lists the versions you can install: newer ones, as your choice above allows,
and the Stable releases before the one you run. Going back is only ever to a Stable release.

Before any update installs, the application keeps a copy of your callsigns, Locations, settings and
your extensions' data, as they are. Going back to a version puts back the copy kept when you left
it, so the older version opens the data it knew; anything you changed since is lost, and you are
told so before anything happens. The copies of the last three Stable versions you left are kept.
Your logins are in your computer's own credential store and are never touched.

The Windows installer, the AppImage and the Mac app update themselves. The `.deb`, the `.rpm` and
the portable `.zip` tell you a newer version is out, and its page opens from there.

After an update, Home's top line says *Updated to* the new version, with **See what's new**.
Help → What's New shows the notes at any time.
