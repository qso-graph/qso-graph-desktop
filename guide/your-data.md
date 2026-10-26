# Your data

Everything you enter stays on your computer. There is no account and no server of ours. The full
story is in [Privacy](../PRIVACY.md).

## What is kept where

- **Your logins** are in your computer's own credential store (Credential Manager, the keyring or
  Keychain), never in the application's files.
- **Everything else** (callsigns, Locations, settings, downloaded reference data, each extension's
  data) is in the application's own folder in your user profile, or in the `qso-graph-data` folder
  beside a [portable build](install.md#the-portable-build).

## Back up and restore

**Settings → Back up and restore**, or **Tools → Back Up…** and **Tools → Restore…**

**Back up to a file** saves what you tick, in one plain file you can read:

- **Callsigns and Locations**: your callsigns, the services each one uses, and your Locations.
- **Settings**: your theme, pins, which extensions are on, your POTA Focus Area, and the updates
  choice. Not the window's size and place, which belong to each computer.

Both are ticked, which is a full backup. It holds only what is public: no login, no username, and no
Location notes.

**Choose a backup** on another computer, or this one after a fresh install, shows what it holds
before anything changes, with each part ticked. Untick a part to leave this computer's as it is.
Each part you restore replaces this computer's; nothing is merged. Restoring onto a computer that
already has callsigns or Locations asks first. Restoring the settings restarts QSO Graph Desktop,
and it says so before you press Restore.

**Your logins do not move.** Enter them again on each computer, in Callsigns. They never leave the
computer they were saved on.
