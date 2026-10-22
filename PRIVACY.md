# Privacy

**QSO Graph Desktop collects nothing about you.** There's no analytics, no tracking, no crash
reporting and no account. There's no QSO Graph server to send anything to.

## What stays on your computer

Your callsigns, locations, settings and logs. Your logins for services such as QRZ, LoTW and eQSL
are kept in your computer's own credential store (Keychain on macOS, Credential Manager on Windows,
the keyring on Linux), not in the application's files.

## When it goes online

Only when you:
- **test a login** for a service you've set up;
- **download or update reference data**, such as ADIF definitions, POTA's parks or SOTA's summits;
- **pin a card on Home** that shows outside data, such as Conditions from NOAA.

Nothing about you is sent with any of these. All of the application's connections go through its
credential core, over HTTPS (`QGD-SEC-0020`); the screens never open one.

A link you choose, such as Help → Privacy or View on POTA, opens in your web browser. What that site
does is up to that site.

## What can leave, only when you choose

- **An export of your callsigns,** which is encrypted with a passphrase you choose.
- **A support bundle** (Troubleshooting → Export diagnostics): the application's logs, with
  passwords and keys removed.

Both are saved where you choose, and sent nowhere. They're shared only if you send them yourself.

## Questions

Ask in a GitHub issue, or write to **maintainers@qso-graph.io**. To report a security problem, see
[SECURITY.md](SECURITY.md).
