# Security Policy

QSO Graph Desktop stores operators' credentials for services such as QRZ, LoTW and eQSL, so
security problems are taken seriously.

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests.**

- **Email:** **maintainers@qso-graph.io**. This works at any time and reaches the maintainers
  only. While the repository is private (before Release 1), it's the way to report.
- **Once the repository is public:** use GitHub's **private vulnerability reporting**. On this
  repository, open the **Security** tab and choose **Report a vulnerability**. The report is
  visible only to the maintainers. (GitHub offers this only on public repositories; it will be
  enabled when the repository is published.)

Helpful details:
- what the problem is, and what an attacker could do with it;
- steps to reproduce, or a proof of concept;
- the version or commit, and your macOS version.

**Never include a real credential** in a report. Use made-up values.

## What happens next

- We aim to acknowledge a report within a few days.
- We investigate, keep you informed, and agree a disclosure timeline with you.
- Fixes for security findings are released as soon as they're ready, not held for a scheduled
  release.
- We credit reporters who want to be credited.

## Supported versions

Before Release 1 there are no supported releases; only the current `develop` branch is
maintained. After Release 1, security fixes are made for the latest release.

## Scope

In scope: the desktop application and its credential core, the bundled engine as configured by the
application, and the build and packaging scripts in this repository.

Out of scope: vulnerabilities in third-party services QSO Graph connects to (report those to the
service), and in upstream components such as Electron or PostgreSQL unless QSO Graph's own
configuration causes or worsens them.

## How the application is designed to protect you

The security design is in the specification (`QGD-SEC-*`, `QGD-CRD-*`, `QGD-PRC-*`, `QGD-LOG-*`), with
the rationale in the handbook. In short: credentials live only in the operating system's credential
store, only the credential core connects to the network, the screens never hold a secret, and
nothing is sent anywhere you didn't ask for (see [USAGE_DATA.md](USAGE_DATA.md)).
