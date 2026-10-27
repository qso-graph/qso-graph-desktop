# Privacy

**QSO Graph Desktop collects nothing about you.** There's no analytics, no tracking, no crash
reporting and no account. There's no QSO Graph server to send anything to.

## What stays on your computer

Your callsigns, locations, settings and logs. Your logins for services such as QRZ, LoTW and eQSL,
their usernames included, are kept in your computer's own credential store (Credential Manager on
Windows, the keyring on Linux, Keychain on macOS), not in the application's files, and never leave it.

**The application keeps nothing about you that isn't public.** A callsign is published by the
authority that issued it. A location is a grid square, POTA and SOTA references and the like: no street
address, and no latitude and longitude of your home. Your own notes on a location are the one private
thing, and they stay on this computer.

## When it goes online

Only when you:
- **test a login** for a service you've set up;
- **download or update reference data**, such as ADIF definitions, POTA's parks or SOTA's summits;
- **open a page that shows outside data**, such as Conditions from NOAA, or Parks On the Air's Spots and
  Most Wanted from POTA. Only the page on screen is asked for; Home's tiles fetch nothing, and a page that
  needs no outside data, such as Astro, ADIF Lookup or Parks On the Air's Near Me, makes no request at all.
  Most Wanted asks POTA for the parks of My POTA Focus Area, part by part (US-ID, or a whole program), at
  most once a day each, so POTA's server sees which areas are asked for, as it would from its own website.

And, unless you turn it off, it **checks for updates** once a day while you're online (Settings →
Updates → Check for updates). It asks `updates.qso-graph.io` which version is newest and tells you when
there's a newer one; only when you choose **Download and install** does it download it, from GitHub,
where the releases are published. Nothing
about you is sent: no callsign, no settings, no identifier. GitHub, like any web server, sees the
address the download came from.

Nothing about you is sent with any of these. All of the application's connections go through its
credential core, over HTTPS (`QGD-SEC-0020`); the screens never open one.

A link you choose, such as Help → Privacy or View on POTA, opens in your web browser. What that site
does is up to that site.

## What can leave, only when you choose

- **A backup of your callsigns and locations** (Settings → Back up and restore): a plain file of what
  is public, with no login, no username and no location notes in it.
- **A support bundle** (Troubleshooting → Export diagnostics): the application's logs, with
  passwords and keys removed.

Both are saved where you choose, and sent nowhere. They're shared only if you send them yourself.

## Questions

Ask in a GitHub issue, or write to **maintainers@qso-graph.io**. To report a security problem, see
[SECURITY.md](SECURITY.md).
