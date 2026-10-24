# Troubleshooting

**Troubleshooting**, on the status bar or in the Help menu, shows:

- **Storage**: the application's data, and whether the reference data is loaded.
- **Logs**: what the application has been doing, and the **detail level**. Raise it to *debug*
  before repeating a problem; it goes back to normal on its own after an hour, or at the next start.
- **Export diagnostics**: one archive of the logs, saved where you choose and sent nowhere. The
  logs never record a password or key. **Help → Save Diagnostics for Support…** does the same.

## Reporting a problem

Open an issue on [GitHub](https://github.com/qso-graph/qso-graph-desktop/issues): what you did,
what you expected, what happened, your platform, and the version (Settings → About). Attach the
diagnostics archive if it helps; look through it first, it is yours to send or not.

Security problems go privately, as [SECURITY.md](../SECURITY.md) says, not in a public issue.

## Common problems

- **Windows says it protected your PC**: the Windows build is not signed yet. **More info → Run
  anyway**.
- **The AppImage does not start on Ubuntu**: install FUSE (`sudo apt install libfuse2t64` on 24.04).
- **A page says it is waiting for the network**: check the [Internet lamp](offline.md).
- **Parks On the Air's Near Me is empty**: download POTA's parks in **Settings → Reference data**,
  and check that your active Location has a grid square.
