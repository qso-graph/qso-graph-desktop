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

**Settings → Back up and restore**, or **Tools → Back Up Callsigns and Locations…**

**Back up to a file** saves your callsigns and Locations in one plain file you can read. It holds
only what is public: no login, no username, and no Location notes.

**Choose a backup** on another computer, or this one after a fresh install, shows what it holds
before anything changes. Restoring onto a computer that already has callsigns replaces them, and
asks first.

**Your logins do not move.** Enter them again on each computer, in Callsigns. They never leave the
computer they were saved on.
