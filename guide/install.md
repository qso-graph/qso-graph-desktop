# Install and update

Everything is on the [Releases page](https://github.com/qso-graph/qso-graph-desktop/releases). No
account is needed to download. Each file's name says the version and what it is for, and
`SHA256SUMS.txt` beside them lets you check a download.

## Windows

Download `…-win-x64.exe` and run it. Choose where to install it and whether it is for you alone or
everyone on the computer, and it adds itself to the Start menu.

The Windows build is not signed yet, so the first time it runs SmartScreen says *Windows protected
your PC*. Choose **More info**, then **Run anyway**. It does not ask again.

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
whether to open an app downloaded from the internet. It is signed and notarized by Apple.

## The portable build

Each platform also has a `.zip`. Unpack it anywhere, a USB stick included, and run it: nothing is
installed. To keep its data beside it rather than in your user folder, make a folder named
`qso-graph-data` next to the application before the first start. Your logins are never put in that
folder: each computer keeps its own, in its own credential store.

## Keeping it up to date

Once a day, while you are online, the application asks whether a newer version is out. It sends
nothing about you. When one is downloaded, a line at the bottom of the window says so: choose
**Restart to update**, or carry on, and it updates the next time you quit. It never restarts
without asking.

In **Settings → Updates** you choose:

- **Stable**, the default: full releases only.
- **Early**: pre-releases too, the newest the day it is out.
- Or turn **Check for updates** off.

The Windows installer, the AppImage and the Mac app update themselves. The `.deb`, the `.rpm` and
the portable `.zip` tell you a newer version is out, and its page opens from there.

After an update, Home's top line says *Updated to* the new version, with **See what's new**.
Help → What's New shows the notes at any time.
