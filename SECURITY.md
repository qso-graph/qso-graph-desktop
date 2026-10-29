# Security Policy

QSO Graph Desktop stores operators' credentials for services such as QRZ, LoTW and eQSL, so
security problems are taken seriously.

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests.**

- **GitHub's private vulnerability reporting:** on this repository, open the **Security** tab and
  choose **Report a vulnerability**. The report is visible only to the maintainers.
- **Email:** **maintainers@qso-graph.io**, if you'd rather not use GitHub. It reaches the
  maintainers only.

Helpful details:
- what the problem is, and what an attacker could do with it;
- steps to reproduce, or a proof of concept;
- the version or commit, and your operating system and its version.

**Never include a real credential** in a report. Use made-up values.

## What happens next

- We aim to acknowledge a report within a few days.
- We investigate, keep you informed, and agree a disclosure timeline with you.
- Fixes for security findings are released as soon as they're ready, not held for a scheduled
  release.
- We credit reporters who want to be credited.

## Supported versions

Security fixes are made for the latest Stable release, and land on `main`. A security fix is
released as soon as it is ready.

## Scope

In scope: the desktop application and its credential core, its storage (the SQLite files it keeps
and the process that opens them), and the build and packaging scripts in this repository.

Out of scope: vulnerabilities in third-party services QSO Graph connects to (report those to the
service), and in upstream components such as Electron or SQLite unless QSO Graph's own
configuration causes or worsens them.

## How the application is designed to protect you

The security design is in the specification (`QGD-SEC-*`, `QGD-CRD-*`, `QGD-PRC-*`, `QGD-LOG-*`), with
the rationale in the handbook. In short: credentials live only in the operating system's credential
store, only the credential core connects to the network, the screens never hold a secret, and
nothing is sent anywhere you didn't ask for (see [PRIVACY.md](PRIVACY.md)).
