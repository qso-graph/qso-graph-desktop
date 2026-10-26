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

Prefer a package? Use `sudo apt install ./qso-graph-desktop-*-linux-amd64.deb` on Debian, Ubuntu
or Raspberry Pi OS, or `sudo dnf install ./qso-graph-desktop-*-linux-x86_64.rpm` on Fedora, Rocky or
RHEL (arm64 builds of each are there too). These do not update themselves: the application tells
you when a newer version is out.

## macOS

Download `…-mac-arm64.dmg` (Apple silicon), open it, and drag **QSO Graph Desktop** to
**Applications**. Open it from Applications, not from the disk image: the first time, macOS asks
whether to open an app downloaded from the internet. It is signed by Greg Beam (KI7MT) with an Apple Developer ID, and notarized by Apple.

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
