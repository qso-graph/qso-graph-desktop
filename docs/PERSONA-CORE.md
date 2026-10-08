# Rust persona core — local Mac build

The implementation model is `qso-graph-auth`. Its published Python package stays
unchanged. This core follows its persona operations and stored formats:

- Non-secret index: `personas.json`, `{ "personas": { name: record } }`.
- Record: lowercase name, uppercase callsign, start/end dates, provider refs.
- Active persona: `current.txt` in the same directory.
- Credentials: JSON `username`, `password`, `api_key`, with empty fields omitted,
  in Keychain service `adif-mcp`, account `persona:provider` lowercased.
- Secret selection: `qrz_logbook` prefers `api_key`; others prefer `password`;
  each falls back to the other, as in `PersonaManager.require()`.

Default profile directory follows qso-graph-auth on macOS:
`$XDG_CONFIG_HOME/adif-mcp` or `~/.config/adif-mcp`. Only the trusted app process
chooses this path. Tests use their own temporary directory and unique fake
Keychain entries; no test reads or changes an existing user credential.

Registered before implementation:

| Test | Required result |
|---|---|
| persona-records | create, update, list and case-insensitive lookup preserve `qso-graph-auth`'s stored format; date ordering is validated |
| persona-active | a known persona can be selected; missing names are refused |
| credential-selection | QRZ logbook uses the key when both values exist; other providers retain password-first behavior |
| rust-unit | the core's own unit tests, including the simulated Keychain refusal and retry, run under `make verify` |
| keychain-roundtrip | the writing process round-trips, replaces, selects and deletes its own unique synthetic entry; a metadata-only lookup confirms the convention name; cleanup in all exit paths |
| credential-isolation | two synthetic personas cannot read one another's entries |
| secret-containment | public display/status APIs return presence flags, never secrets; non-secret files and captured output contain no fixture secret |
| ipc-boundary | wrong frame, malformed commands and extra fields are refused; core lives in a utility process |
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
The Python interoperability proof is out of P0 (KI7MT, 2026-10-07): cross-application
reads raise a macOS authorization dialog that an explicit trusted-application list
cannot remove, because every party is ad-hoc signed. See QGD-HDBK-001 section 5. The
replacement Rust round-trip passes unattended in under 0.2 s. Judge later
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
secret removes the Keychain entry. Service default preserves qso-graph-auth's
selection order; a desktop override prefers password or API key and falls back
to the other if the preferred value is missing. The core enforces that choice.
Overrides are non-secret, stored in `desktop-preferences.json` per persona and
provider. The published Python package remains unchanged and does not consume
these desktop overrides.

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

The Mac build copies the separate AWS-LC FIPS dynamic library unchanged beside
the addon; only the addon's dependency path is relocated. Both native loading
and packaged utility-process loading passed. The packaged UI test exercises the
test action on an unsupported service without transmitting synthetic passwords
to a live provider. Accepted/rejected QRZ responses are covered by Rust fixtures;
live credential acceptance is checked only when the user presses Test credential.
