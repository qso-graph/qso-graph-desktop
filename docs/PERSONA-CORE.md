# Rust credential core — local Mac build

The credential core owns its entry names and stored formats (`QGD-CRD-0003`). They began as
`qso-graph-auth`'s and are kept because they work, not because anything else reads
them — `QGD-CRD-0004` rules out Python and MCP interoperability in any Part:

- Non-secret index: `personas.json`, `{ "personas": { name: record } }`.
- Record: lowercase name, uppercase callsign, start/end dates, provider refs.
- Active persona: `current.txt` in the same directory.
- Credentials: JSON `username`, `password`, `api_key`, with empty fields omitted,
  in Keychain service `io.qso-graph.desktop`, account `persona:provider` lowercased.
  Until 2026-10-09 this said `adif-mcp` — the MCP servers' namespace — and so did the
  code (`QGD-CRD-0003`, `QGD-CRD-0013`).
- Secret selection: `qrz_logbook` prefers `api_key`; others prefer `password`;
  each falls back to the other, as in `PersonaManager.require()`.

Default profile directory: a `personas` directory inside the one the operating
system gives the application — `~/Library/Application Support/QSO Graph Desktop`
on macOS — beside the application's own SQLite stores and the reference cache. Only the trusted
app process chooses this path.

It was `~/.config/adif-mcp` until 2026-10-09, which is the MCP servers' own
directory, so `personas.json` was a file both products wrote
(`QGD-CRD-0013.1`). Nothing there is migrated, read or removed by this product.

Tests use their own temporary profile directory, and their Keychain fixtures go
to a service of their own, `io.qso-graph.desktop.test`, swept when a suite exits
(`QGD-CRD-0013`). A release's verification run happens in an account whose login
keychain holds nothing of the operator's (`QGD-CRD-0013.1`). The claim
that "no test reads or changes an existing user credential" was true of the
index and false of the Keychain: seventeen fixtures were found in KI7MT's real
login keychain under the shared namespace, which is why both controls exist.

Registered before implementation:

| Test | Required result |
|---|---|
| persona-records | create, update, list and case-insensitive lookup preserve the stored record format; date ordering is validated |
| persona-active | a known persona can be selected; missing names are refused |
| credential-selection | QRZ logbook uses the key when both values exist; other providers retain password-first behavior |
| rust-unit | the credential core's own unit tests, including the simulated Keychain refusal and retry, run under `make verify` |
| keychain-roundtrip | the writing process round-trips, replaces, selects and deletes its own unique synthetic entry; a metadata-only lookup confirms the convention name; cleanup in all exit paths |
| credential-isolation | two synthetic personas cannot read one another's entries |
| secret-containment | public display/status APIs return presence flags, never secrets; non-secret files and captured output contain no fixture secret |
| ipc-boundary | wrong frame, malformed commands and extra fields are refused; the credential core lives in a utility process |
| usable-mac | create and select a persona, save and remove a synthetic service credential through the UI; state survives restart |
| process-recovery | killing the persona utility process leaves the window present and answering; a request in the held-open outage is refused with a static message, not queued; the service restarts unaided as a different pid and the record is unchanged; thirteen malformed commands are refused; a subframe can be created but holds no persona bridge and is unreachable from the main frame |
| connection-capture | across a full credential workflow no process in the tree holds an endpoint outside loopback, and the renderer and credential core hold none; the renderer reaches a listener by none of its seven outbound routes; no outbound-network API appears in the product TypeScript; three detectors each carry a positive control |
| crypto-evidence | the AWS-LC library version is read from the module that was built and agrees with the lock and the addon's linkage; it is compared against the recorded CMVP register; the operational environment is recorded |
| artifact-scan | reports, evidence, recent crash artifacts, the packaged application including `app.asar`, and the compiled output carry no credential or roster sentinel; no report artifact asserts validation or certification; each suite's raw output is scanned before redaction; unreadable files fail rather than counting as clean |

Rust exports: `PersonaCore` constructor (trusted profile directory), `list`,
`upsert`, `setActive`, `active`, `saveCredentials`, `credentialStatus`,
`deleteCredentials`, `requireCredential` (trusted-core round-trip tests only;
never exposed through renderer IPC). No raw-secret read method reaches the UI.
The editable controls also use `removeSecret`, `setPreference` and `removePersona`.

This is local development. No signing, publication or CI work blocks it.
The test client builds with AWS-LC FIPS and rustls. This is build evidence only;
module certification and operational-environment evidence remain separate, so
this preview makes no validated-module compliance claim.

Issue #3's acceptance run is complete: process recovery and malformed IPC,
connection capture, the sentinel scan and the crypto-module and
operational-environment evidence all run under `make verify`. See
`report/connections.json`, `report/artifact-scan.json` and
`report/crypto-evidence.json`.

Local evidence on 2026-10-07: Rust unit tests passed (3 tests); the development
window and the packaged arm64 app both passed create, activate, Keychain save,
restart, and credential deletion tests using isolated synthetic profiles.
Python interoperability is out, in any Part (KI7MT, 2026-10-08, `QGD-CRD-0004`).
It was first dropped from P0 on 2026-10-07 because cross-application reads raise a
macOS authorization dialog that an explicit trusted-application list cannot remove,
every party being ad-hoc signed. See QGD-HDBK-001 section 5. The Rust round-trip
passes unattended in under 0.2 s. KI7MT later
confirmed a successful QRZ test through the app using a saved credential. That
user check is separate from the isolated automated validation described below.

Credential editing: native Edit-menu commands and an editable-field context
menu support copy/paste. Command-C and Command-V into both password and API-key
inputs passed in the development window and packaged Mac app with synthetic
values. This does not provide a saved-secret reveal operation.

Saved credentials show a fixed eight-dot placeholder and a field-specific
saved-in-Keychain indicator. These use only the presence flags; the inputs
remain empty, and no secret value or length is retrieved for display. Indicators
refresh on persona/service selection and disappear after credential deletion.

Password and API key can be removed independently. Saving only one field keeps
the other saved field; empty inputs are not deletion requests. Removing the last
secret removes the Keychain entry. The service default keeps the original
selection order; a desktop override prefers password or API key and falls back
to the other if the preferred value is missing. The credential core enforces that choice.
Overrides are non-secret, stored in `desktop-preferences.json` per persona and
provider. Nothing outside this application reads them.

Remove persona requires UI confirmation and deletes its indexed service
credentials, checks all supported providers for legacy entries, clears its
preferences and active marker, then removes its index record. A Keychain
refusal preserves the persona record for retry and reports that some credentials
may already have been removed. Other personas and their credentials are retained.

Validation for these controls: 27 contract/policy/report tests passed, 4 Rust
unit tests passed (including simulated Keychain refusal and retry), the native
credential-editing test passed actual merge/removal/selection/cascade/isolation
checks with synthetic entries, and the packaged UI test passed preference
persistence, individual removal, deletion cancellation, persona removal and
absence of credentials when recreating the same persona after restart.

Test credential: QRZ lookup uses an HTTPS POST login; QRZ logbook uses read-only
ACTION=STATUS. Destinations are fixed, redirects and proxies are disabled,
certificates are verified, and only TLS 1.3 is offered. Requests have a 12-second
timeout and responses a 64-KiB limit. The credential/session/response/error text
never reaches the renderer, which receives only a fixed outcome. Service-wide
cooldowns are 30 seconds, or five minutes after rejection/rate limiting.

The displayed result includes the time and lasts for the current app session.
Changing a saved secret or its preference invalidates the previous result.
Other services explicitly return unsupported. QRZ response-parser tests cover
success, rejection, malformed replies, duplicate result fields, and secret echoes.
The real ClientHello test confirms the library reports its FIPS build configuration and advertises TLS 1.3 only. AWS supports FIPS builds on Linux and Windows only, so on macOS this is not a FIPS build; see `report/crypto-evidence.json`. Both QRZ
servers passed credential-free TLS 1.3 certificate-verified handshakes; no real
user credential was read or transmitted by these validation tests.

Reference data (ADIF's archive, POTA's lists, NOAA's feeds) is fetched by the same core with the
same FIPS provider and roots, but may use TLS 1.2 where a source offers nothing newer: adif.org.uk
offers only TLS 1.2, and a 1.3-only client never reached it. TLS 1.2 here means ECDHE with AES-GCM
on P-256 or P-384 with Extended Master Secret. No credential is ever sent over this client
(`reference_tls_config`, `QGD-SEC-0020`).

The Mac build copies the separate AWS-LC FIPS dynamic library unchanged beside
the addon; only the addon's dependency path is relocated. Both native loading
and packaged utility-process loading passed. The packaged UI test exercises the
test action on an unsupported service without transmitting synthetic passwords
to a live provider. Accepted/rejected QRZ responses are covered by Rust fixtures;
live credential acceptance is checked only when the user presses Test credential.
