# Usage Data

**QSO Graph Desktop collects no usage data.**

- **No telemetry, analytics or crash reporting** is sent anywhere.
- **No accounts** with QSO Graph: there's no QSO Graph server.
- **Your data stays on your computer:** your log, personas, settings and the application's logs
  are stored locally. Credentials are kept in your operating system's credential store.

## What the application does connect to

The application connects to the network only through its credential core (`QGD-SEC-0020`), and
only to:
- **reference-data publishers,** to download public reference data such as ADIF definitions and
  POTA's park list (`QGD-REF-*`);
- **the services you set up** (QRZ, eQSL and others), and only when you use them, for example to
  test a credential.

Nothing else is contacted, and nothing about you or your use of the application is reported.

## Sharing diagnostics

**Troubleshooting** (on the status bar) **→ Export diagnostics** creates an archive, with credentials
removed. It's saved on your computer, and it's shared only if you choose to send it.
