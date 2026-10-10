# Storage plan: PostgreSQL out, SQLite in

Status: **decided by KI7MT, 2026-10-10.** Every decision below is settled; §3.1 records his answers.
Work proceeds in the order of §8.
Author: Bob, 2026-10-10. It comes from a full inventory of `develop` at `ede4ab1` (spec, handbook,
RVM, `docs/`, every package, every suite, every register). Revision 2 adds the 15 findings from
Turing's first review (Codex gpt-6-astra, high), and revision 3 the 6 from his second. Each finding was
checked against the code before it was accepted.

## 1. The decision being planned

The frame stops bundling and running PostgreSQL. Storage becomes SQLite, opened by the frame,
through Drizzle. KI7MT, Watson and Bob agreed this on 2026-10-10.

**Why.** The spec gives two reasons for PostgreSQL (`QGD-ENG-0001`): per-application roles, and
several processes connecting at once. Neither carries the weight here.

- **Roles restrict what a database connection may do**: `packages/engine/roles.ts` grants each role
  its own schema and nothing else. They do not protect the files from a process running as the same
  OS user, and every process of this product runs as that user. Only one thing is ever offered a
  connection, the frame. An application is never offered one (`QGD-APP-0009`). So the boundary
  that counts is the brokered app API (`QGD-APP-0002`, `QGD-APP-0003`), which already carries
  credentials and sources. Data goes the same way, and roles would only duplicate it.
- **Several processes** comes down to one owning process per file. SQLite handles that.
- **Nothing in the shipping product uses the rest.** The app starts PostgreSQL, applies two
  migrations, writes one row, and loads ADIF and POTA. Per-app roles, backup and restore are called
  only from test scripts. No application and no screen has a database connection.

**The references agree.** Each was read in its own source on 2026-10-10:

- **VS Code** keeps state in SQLite. `package.json` lists `@vscode/sqlite3` 5.1.12-vscode, and
  `src/vs/base/parts/storage/node/storage.ts` is its `SQLiteStorageDatabase`. Settings are JSON. Each
  extension's key-value state is stored under its ID (`src/vs/workbench/api/common/extHostMemento.ts`),
  and each extension gets its own folder (`extHostStoragePaths.ts`: `globalStorageHome/<id>`).
- **Podman Desktop** has no database. It keeps one `settings.json`
  (`packages/main/src/plugin/configuration-registry.ts`) and gives each extension a folder,
  `extensions-storage/<id>`, as `storagePath` (`extension/extension-loader.ts`). Secrets go in one
  `data.json` encrypted with Electron `safeStorage`, scoped per extension
  (`safe-storage/safe-storage-registry.ts`).
- **Bitwarden desktop** keeps its data in one `electron-store` JSON file. `apps/desktop/package.json`
  lists `electron-store` 11.0.2, used by `apps/desktop/src/platform/main/storage/electron-store-backend.ts`.
  The backend sets no encryption key, so the file itself is not encrypted. Bitwarden encrypts the
  sensitive values before it stores them. There is no database either way.
- **N1MM Logger+** stores its log in SQLite (`ham.s3db`). In multi-computer operation each computer
  holds a full copy and they replicate peer to peer. N1MM's own documentation explains the design:
  *"using a single database would not be as reliable as having each computer log its own QSOs and
  replicate them on all the other computers"*. That is the "Multi-Computer" page on n1mm.com, found
  by Watson. It is documentation, not source code.

**What goes:**
- a 62 MB download, and 121 MB in the package
- the pin, the SHA-256 register and the trim
- the supervisor, `initdb`, the postmaster, the Unix socket and the Windows port
- peer authentication, the 104-byte socket path limit, roles and random passwords
- the stopped-engine backup and the major-version dead end
- the per-platform PostgreSQL problem that mission 2 had just reached: the only Linux build found
  ships OpenSSL 1.1, which is past end of life, and EDB stopped publishing Linux binaries after 10.

## 2. The target layout

Everything lives in the product's own directory, Electron's `app.getPath('userData')`.

| Store | Holds | Owner | Notes |
|---|---|---|---|
| `settings.json` | preferences (theme) and granted permissions | frame | **Unchanged.** Still a file, for a new reason (D3). |
| `state.sqlite` | the installation row; the outcome of reference refreshes (D4); small per-app key-values under the app's ID; session and UI state once a screen needs some | frame (QG Storage) | Drizzle migrations; WAL mode. |
| `apps/<app-id>/` | that app's own database (`data.sqlite`) and files | frame, on the app's behalf | The app never sees the path (D5). Created on first need and deleted with the app. Empty until P8. |
| `reference.sqlite` | all reference data: ADIF definitions and POTA, later the QG Reference datasets (CQ/ITU zones, DOKs) | frame (QG Storage) | **Derived** (D4): no migrations. Rebuilt beside the old file and swapped in. Read-only to everything except the build. |
| `reference/` | the verified source files `reference.sqlite` is built from | frame | **This directory already exists** (`engine-broker.ts`, `fetch.ts` `cachePath`). The ADIF archive stays where it is now. POTA's last good lists are added beside it. |
| `personas/` (`personas.json`, `current.txt`) | the persona index | Rust core | Unchanged (`docs/PERSONA-CORE.md`). |
| OS credential store | secrets | Rust core | Unchanged. |

## 3. Decisions

### 3.1 KI7MT's answers, 2026-10-10

| | Answer |
|---|---|
| D1, D2, D3, D4, D6, D8, D11 | Accepted as recommended. |
| D5 | **The broker is the enforcement point.** `QGD-CRD-0002` is reworded to name the app broker for app requests; the core stays the only holder of credentials. |
| D7 | **Deferred**, with backup to be planned as **both local and remote, shipping to S3-compatible storage**, as discussed for QG Sync (`qso-graph-desktop#21`). Designed with the first app that holds operator data. |
| D9 | **The database indicator is removed.** In its place the status bar names **the data the operator is working in**: the active app's database, the way VS Code's status bar names the repository and branch. Until an app holds data (P8), the slot is empty. Storage detail moves to Troubleshooting. |
| D10 | Accepted: P4 re-signed on its new gate, P5 and P7 on their rewritten tests, P0–P3 and P6 untouched. |
| D12 | **Fresh start.** No conversion and no reset logic in the product. Development machines delete their old profile (`userData`, including `engine/`) and start clean; KI7MT or an agent does it by hand. The offline-upgrade test is dropped, because there is nothing to upgrade from. |


**Recommended** means Bob proposes it and KI7MT accepts or changes it. **KI7MT** means it is his call.

### D1. Driver: Node's built-in `node:sqlite`, through Drizzle's `sqlite-proxy`. Recommended.

Electron 44.6.0 carries Node 24.21.0, whose `node:sqlite` embeds SQLite 3.53.4. I checked it loads
under Electron's Node without a warning. Turing also loaded it inside a Node worker. Node marks it
*Stability 1.2, release candidate* from 24.15 onward (`doc/api/sqlite.md` at v24.21.0). It offers
read-only opening, foreign keys on by default, and online `backup()`.

The alternative, `better-sqlite3`, is a native module whose ABI differs between Node and Electron.
It would need rebuilding per platform and per Electron upgrade, and suites run under plain Node could
not load the Electron build. That is exactly the cross-platform cost this change exists to remove.

Drizzle's stable 0.45.4 has no `node:sqlite` driver; its 1.0 release candidate does. So we use
stable Drizzle's `sqlite-proxy` driver over an adapter of ours, and switch to Drizzle's own driver
when 1.0 is final. The adapter is small but not trivial. Its contract is written down and each part
of it is tested:

- **Result shapes.** Drizzle's proxy expects positional rows. `all` and `values` return arrays of
  arrays, and `get` returns one array or `undefined`. Node's default object rows map to `[{}]`, as
  Turing reproduced. The adapter therefore turns on array mode.
- **Binding and decoding.** Parameters bind by position. Booleans, JSON and missing rows decode as
  the Drizzle column modes declare.
- **Atomic migrations.** Drizzle's proxy migrator gathers every pending statement plus its
  bookkeeping inserts and hands the whole list to our callback **without a transaction**
  (`node_modules/drizzle-orm/sqlite-proxy/migrator.js`). The callback runs the list inside one
  `BEGIN IMMEDIATE … COMMIT` and rolls back all of it on any failure. That keeps the existing
  "a broken migration rolls back the whole pending run" assertion.
- **Serialized units of work.** The proxy's `transaction()` awaits between statements on one
  connection, so a second request can interleave, and Turing showed an unrelated insert being
  rolled back by another request's transaction. QG Storage therefore runs **every request as one
  unit of work under a per-connection queue**. A unit holds the queue from its first statement to
  its last. Nothing else touches that connection meanwhile.
- **Errors never carry values.** See D11.

Risk: `node:sqlite` is not yet stable. The adapter keeps that to one file. The storage suites run it
on every Electron upgrade, and `better-sqlite3` remains the fallback, at the cost described above.

### D2. Process: one storage utility process, "QG Storage". Recommended.

`QGD-PRC-0003` keeps the main process to windows and IPC, and `node:sqlite` is synchronous, so the
stores cannot live in main. The design:

- **QG Storage replaces QG Engine** as a utility process. It is the only owner of `state.sqlite`,
  `apps/*/data.sqlite` and `reference.sqlite`, and it answers the brokers.
- **Reference builds run on a `worker_thread` inside QG Storage**, so queries keep answering during
  a build of about 100k rows. The worker writes only the new file. QG Storage performs the swap
  after closing its read handle.
- **All outbound HTTPS still goes through the Rust core** (`QGD-SEC-0020`): QG Storage asks the
  persona broker for bytes, as the engine does today. Node's `fetch` is never used.
- **Single instance:** `QGD-PRC-0007` remains the guard against a second copy of the application.
- **Recovery:** if QG Storage exits, the broker restarts it with back-off, as for QG Engine today.
  If a build worker fails, the live file is untouched and the refresh outcome records the failure.
  Both get acceptance tests (`QGD-PRC-0001`). The existing `process-recovery` suite exercises only
  the persona service.
- **Verified first, not assumed.** Turing confirmed `node:sqlite` in a Node-mode worker. A worker
  **inside an Electron utility process**, and loading from the **packaged ASAR**, are not yet
  verified. Stage 3 opens with a spike that proves both on the packaged app before anything is
  built on them.
- **Retained limitation, not fixed here.** The Rust core's `fetchReference` is a synchronous napi
  call, so while a reference download is in flight the persona service answers nothing else
  (`docs/P7.md`). Moving the build to a worker does not change that, because the download happens
  before the build. It stays recorded as a known limitation, to be fixed separately.

### D3. `settings.json` stays a file. Recommended.

Its old reason, *"so the application starts before the engine is up"*, no longer applies. Two new
ones keep it a file:

1. Main reads it synchronously, with no other process involved, when it creates the window, so the
   first paint is in the right theme.
2. The app API reads granted permissions from it **on every request** (`allowed: () => load().grants`),
   which is why a withdrawal takes effect at once.

`QGD-ENG-0003` is rewritten with those reasons. Its example "window size" moves to `state.sqlite`.

### D4. `reference.sqlite` is a derived file. Recommended.

- **No migrations.** The schema is the Drizzle declaration, rendered to DDL by `drizzle-kit` at build
  time and checked in. A unit test fails if the checked-in DDL and the declaration disagree. The
  schema version is stamped in `PRAGMA user_version`. A new schema version, a new ADIF pin or a POTA
  refresh means building a new file.
- **Inputs, one at a time.** Each input is the newest copy that passed its own checks; otherwise the
  last good cached copy is used.
  - ADIF: the SHA-256-pinned archive.
  - POTA: each of the three lists on its own. POTA is not checksum-pinned (`QGD-REF-0010`), and that
    does not change.
  - Today's partial-success rules are kept:
    - POTA loads when ADIF is unavailable, and its `adif_entity` links stay null (`start.ts`).
    - Each POTA list succeeds or fails on its own (`pota-load.ts`).
    - A `304 Not Modified` advances the last-check time without rebuilding (`pota-load.ts`).
- **The POTA cache is new.** Today only the database rows persist, and `loadOne()` commits each list's
  data and its provenance together. The cache keeps that pairing:
  - Each list's verified body is written under its own SHA-256 name.
  - The list then gets **one record file**: URL, `ETag`, `Last-Modified`, fetch time, row count and
    the body's SHA-256. It is written to a temporary name and renamed into place.
  - The rename publishes body and provenance together. A crash before it leaves the previous record
    pointing at the previous body.
  - A rebuild takes each list's provenance from its record and never invents a fetch time.
  - Bodies no record points at are removed after a successful build.
  - **Control:** a crash planted between writing a body and renaming its record. The next build uses
    the previous body with the previous provenance.
- **Checks before publication:**
  - `integrity_check`
  - **`foreign_key_check`**, because Turing showed `integrity_check` passes with an orphaned foreign key
  - the expected row counts
  - the semantic assertions the current suites make, **applied per dataset actually present**:
    - **ADIF present:** provenance and structure (`reference-load`), and the ADIF validation corpus.
    - **Each POTA list present:** published coordinates and flags unchanged (`pota-load`).
    - **ADIF absent:** its source row is absent, `readRuleset()` reports *not loaded* (it does not
      throw), and every `adif_entity` link is null.
    - **A POTA list absent:** its source row says so, and the other lists stand.
  - **Controls** for both partial builds: POTA-only (the supported no-ADIF case) and ADIF-only
    (a first run that gets ADIF but no POTA). Each must publish, not be rejected.
  - journal mode DELETE, so no `-wal` or `-shm` file is left behind
  - then a rename over the old file, after every handle to it is closed. Windows cannot rename over
    an open file.

  A build that fails at any step leaves the live file untouched.
- **Which record is authoritative.** `reference.sqlite`'s own `source` table says what is loaded,
  because it is written in the same file as the data. `state.sqlite` records only refresh outcomes:
  last attempt, last check, last failure. **Publication order:** the swap first, then the outcome.
  On start, QG Storage reconciles what is loaded from the file itself, so a swap followed by a crash
  before the outcome was written is still read correctly.
- **Not loaded:** with no file (a first run offline), the state is *not loaded*, read from the absence
  of the file and recorded in `state.sqlite`. The frame starts regardless (`QGD-REF-0014`).
- **One file for all reference data**, because the datasets refer to each other: zones and parks are
  keyed on ADIF's DXCC codes. A foreign key only works inside one file. ADIF validation does not join
  across files at all, because `validate.ts` reads the ruleset into memory once.

### D5. Apps never get a path or a connection. Recommended.

- **Ownership.** The frame creates `apps/<app-id>/` and opens its database. An app reaches its data
  only through brokered app-API requests, the way it already reaches credentials and sources. That
  satisfies `QGD-APP-0010` (no ambient filesystem) and `QGD-APP-0003` (nothing handed over is a live
  reference).
- **Path safety.** The ID comes from a loaded manifest (`^[a-z][a-z0-9-]{1,30}$`), and the resolved
  path is checked to stay inside `apps/` (`QGD-SEC-0004`). Apps read reference data through the
  reference API.
- **The app-data request kinds are designed with the first real app (P8), not now.** Building an
  API before anything uses it is the mistake the proof apps made. This plan renames the grant
  (`engine:own-schema` becomes `storage:own`) and states the rule.
- **The enforcement point needs settling: KI7MT.** `QGD-CRD-0002` says the Rust core is "the grant
  model's enforcement point". The code enforces grants in the app broker in main
  (`packages/main/app-serve.ts`, `app-broker.ts`). That mismatch exists today and was not introduced
  by this plan. This plan rests on the broker, so the spec has to say which is true. Bob recommends
  rewording `QGD-CRD-0002` to name the broker as the enforcement point for app requests. The core
  stays the only holder of credentials, which is what `QGD-CRD-0002` exists to protect.

### D6. Sorting. Recommended.

- **Callsigns** sort under SQLite's default BINARY collation. That gives the same order as
  PostgreSQL's `C.UTF-8`: digits before letters, `W1AW` before `W1AW/4`.
- **Names already exist** (`pota_program.name`, `pota_location.location_name`, `pota_park.name`).
  They sort in TypeScript with `Intl.Collator` **in the operator's own locale** (Electron's
  `app.getLocale()`). Order depends on locale: Turing confirmed in the same Electron build that
  `Ångström` sorts before `Zulu` under `en` and after it under `sv`. That is what a Swedish operator
  expects. Tests pin the locale they test under.
- SQL never orders by a name column. `QGD-ENG-0004.2` is rewritten to say so.

### D7. Backup and restore. Decided: deferred (§3.1).

Today backup exists only in test scripts. There is nothing to back up yet: one installation row,
plus reference data that rebuilds itself.
- **(a) Defer** to the first app that holds operator data, and build it then on `node:sqlite`'s
  online `backup()`. Bob leans this way, for the same reason as D5.
- **(b) Keep it now:** an online backup of `state.sqlite` and `apps/`, never `reference.sqlite`, with
  a staged restore.

### D8. Names. Recommended.

- `packages/engine` becomes `packages/storage`.
- The spec keeps the `QGD-ENG` prefix, because renaming it breaks every citation. Its area becomes
  "Local storage". Retired IDs are never reused.
- `engine:request` becomes `storage:request`, and `EngineStatus` becomes a storage-status contract.

### D9. What the screen shows. Decided: indicator removed (§3.1).

Podman Desktop shows engine state on its status bar because it manages an engine. We no longer have
one: there is nothing to start or stop.
- **(a) Remove the status-bar indicator.** Troubleshooting keeps a "Storage" section: where the files
  are, their sizes, whether reference data is loaded, its sources, and when it was fetched. Bob
  recommends this.
- **(b) Repurpose the indicator** for reference data ("Reference data: loaded / not loaded").

**Either way, status cannot simply stop being polled.** QG Storage can exit and restart, and a build
can finish, independently of anything the screen does. `renderer/app.ts` already documents the
stale-status defect that polling fixed. The replacement:
- the storage broker **pushes validated status events** for process exit and restart and for build
  completion
- the renderer **synchronises the initial state** when it subscribes, and **removes its listener**
  when the subscription ends
- `renderer/app.ts`, `shell-store.ts` and `Shell.svelte` change with it

The screenshot baselines change either way and wait for KI7MT's approval.

### D10. Part sign-offs. KI7MT.

- P4's exit gate (`QGD-PRT-0104`) is PostgreSQL from end to end, and was signed off on 2026-10-08.
- P5's evidence says it "loads the definitions into a real PostgreSQL".
- P7's test *P7-own-schema-only* is built on roles and schemas.

Under `QGD-PRT-0003`, **the new P4, P5 and P7 acceptance tests are all registered in stage 2**,
before any code. The old registrations stay as dated records, marked superseded. Recording the
supersession and any new sign-off in `data/part-signoff.json` is KI7MT's. Proposed: P4 re-signed
against its new gate, P5 and P7 re-signed on their rewritten tests, P0–P3 and P6 untouched.

### D11. Errors never carry values. Recommended. (New in revision 2.)

Drizzle's `DrizzleQueryError` puts the SQL **and the bound parameters** in `error.message`, and
Turing reproduced it. The current engine service logs an error's message and returns it as the status
`reason` (`engine-service.ts`). The logger redacts by **field name**, so a value inside `reason` is not
protected.

**The boundary is every catch, not the edge of a unit of work.** Some errors never leave as errors:
`pota-load.ts` catches a failure and folds `error.message` into a successful *kept* outcome, which
startup then logs. Turing reproduced a bound sentinel arriving that way, past any outer handler. So:
- every caught error in storage and reference code goes through **one reduction function** before it
  is used anywhere: in an outcome, a reason, a log entry or a reply. The reduced shape is an error
  kind of ours, plus SQLite's numeric code and its fixed error string. Never the message, the SQL or
  the parameters.
- `security-lint` bans reading `.message` from a caught error in `packages/storage` and
  `packages/reference`, except inside the reduction function. A control shows the rule fires.

That covers `QGD-CRD-0006`, `QGD-PII-0003` and `QGD-LOG-0003` on every failure path.

**Controls:** a sentinel planted in a bound parameter, then a forced failure **through each path**:
the outer unit of work, and the POTA partial-success (*kept*) path. A scan shows the sentinel appears
in no log, no outcome, no status reply and no report.

### D12. Installations that already exist. Decided: fresh start (§3.1).

Before Release 1 the only installations are development machines: KI7MT's and the agents'. What their
PostgreSQL holds is one installation row plus ADIF and POTA, all reloadable. Nothing in it is
operator data.
- **(a) Reset (Bob recommends).** The first run of the new version ignores `engine/`. Reference data
  is rebuilt: ADIF from the archive already cached in `reference/`, POTA from the network. The release
  notes say so. An installation upgraded while offline is *not loaded* for POTA until its first
  refresh. `engine/` is left on disk and named in the release notes for the user to delete, because
  the frame deleting a directory it no longer understands is a worse failure than leaving 300 MB.
- **(b) Convert.** Read the old PostgreSQL once and export POTA into the new cache. This means
  shipping PostgreSQL in the very release that removes it, to save one download.

**Decided: fresh start** (§3.1). Nothing is converted and no upgrade path is built.

## 4. What changes: the specification, handbook and RVM

**41 requirements are affected: 10 deleted, the rest rewritten or reworded.** No retired number is
reused. The RVM is regenerated (`node scripts/gen-rvm.mjs`), never hand-edited.

**QGD-ENG, all 19 rows:**

| ID | Action | New content |
|---|---|---|
| `0001` | REWRITE | SQLite through Drizzle, owned by QG Storage. The stores in §2. Apps never get a path or a connection (D5). |
| `0002` | REWORD | Drizzle's SQLite dialect and the `sqlite-proxy` adapter over `node:sqlite`, with its contract (D1). `reference.sqlite` has no migrations (D4). |
| `0003` | REWRITE | `settings.json`, with the new reasons (D3). |
| `0004`, `0004.1`, `0005`, `0005.1`, `0009`, `0009.1`, `0010`, `0014`, `0014.1` | DELETE | Binary set, trim, client tools, `pg_ctl`, endpoint, socket length, roles, major upgrades. |
| `0004.2` | REWRITE | Sorting (D6). |
| `0006` | REWRITE | One owner per file, QG Storage, with its recovery (D2). |
| `0007` | REWRITE | First run creates the layout. A failed creation leaves nothing the next start would take for real. |
| `0008` | REWRITE | One writer per file, with requests serialised as units of work (D1). `QGD-PRC-0007` guards against a second instance. |
| `0011`, `0012` | per D7 | Deferred, or an online backup with a staged restore. |
| `0013` | REWRITE | QG Storage runs migrations when it opens `state.sqlite` or an app's database. The whole pending run commits or none of it does (D1). A failure fails only that store. |
| new | ADD | `reference.sqlite` is derived, checked and swapped, with its authority and publication order (D4). Storage errors carry no values (D11). No storage component opens a listener. The app folder's path is validated (D5). |

**Outside QGD-ENG, 22 rows:**

- **REWRITE:**
  - `QGD-PRC-0004`: QG Storage replaces the engine supervisor.
  - `QGD-REF-0001`: reference data lives in `reference.sqlite`.
  - `QGD-REF-0014`: *not loaded* comes from the file and is recorded in `state.sqlite`.
  - `QGD-SEC-0020`: QG Storage asks the core for bytes.
  - `QGD-FRM-0012`: per D9.
  - `QGD-APP-0009`: own folder and database, brokered.
  - `QGD-APP-0010`: the app folder is the frame's and is never handed over.
  - `QGD-LOG-0001`: no engine log.
  - `QGD-PRT-0104`: the new P4 gate.
  - `QGD-SCP-0006`: no managed PostgreSQL.
  - `QGD-CRD-0002`: per D5. **Added in revision 2.**
- **DELETE:** `QGD-LOG-0011`, the engine's log.
- **REWORD:**
  - `QGD-REF-0003`: drop its `QGD-ENG` citation.
  - `QGD-REF-0010`: the POTA cache and the per-list rules (D4).
  - `QGD-PRC-0007`: the SQLite files join the list.
  - `QGD-PII-0007`: "the database" means every store.
  - `QGD-FRM-0011`.
  - `QGD-APP-0014`: "no database".
  - `QGD-PRT-0105`.
  - `QGD-REP-0001`, `0003`, `0006` and `QGD-APP-0002`: the package rename.

**Prose:**
- Spec: the §0.1 area table and the §4.2 heading become "Local storage"; the §2.1 P4 and P5 rows change.
- Handbook §2: no managed PostgreSQL.
- Handbook §6: the logging bloat controls lose their fourth failure mode, and the range becomes
  `QGD-LOG-0006`–`0010`.
- Handbook §7: reference data no longer depends on "a database".
- **A new handbook section on the storage decision:** the evidence in §1, with source paths; what
  roles did and did not protect; the layout; and what was weighed and rejected (bundled PostgreSQL,
  PostgreSQL from the platform, `better-sqlite3`, PGlite).

**Every citation that would dangle is fixed in the same change.** The affected IDs are
`QGD-ENG-0004`, `0005`, `0010`, `0011`, `0013` and `QGD-LOG-0011`. They are cited from the spec,
`docs/P4–P7`, `docs/VERIFY-ACCOUNT.md`, `AGENTS.md` and `data/app-grants.json`.

## 5. What changes: code

| Package | Change |
|---|---|
| `engine` → `storage` | **DELETE:** `supervisor.ts`, `endpoint.ts`, `roles.ts`, and `backup.ts` (unless D7b). **REWRITE:** `migrate.ts` (the proxy migrator with the atomic callback); `schema.ts` (`sqliteTable`; the installation row loses `postgres_major`); the contract (D8); the service (QG Storage, with its per-connection queue and error reduction, D1 and D11). **NEW:** `sqlite.ts` (the adapter: array mode, `foreign_keys=ON`, WAL for writable stores, read-only opening for the reference file) and the app-folder resolver. |
| `reference` | **REWRITE:** `schema.ts` (12 tables, mapped below); `load.ts` and `pota-load.ts` (SQLite SQL with no `::` casts and no `now()`; booleans as 0/1; arrays and JSON as text; times as ISO text; single-quoted literals only); the build-and-swap on a worker with its checks (D4); the POTA cache. **EDIT:** `validate.ts` (`readRuleset` reads from SQLite and parses JSON). **KEEP:** `fetch.ts`, `adif.ts`, `adi.ts`, `pota.ts`, `zip.ts`. |
| `main` | **DELETE** `engine-broker.ts`. **NEW** storage broker: same shape as the old one, plus restart with back-off, pushed status events (D9), and the reference-fetch relay through the Rust core. **EDIT** `main.ts`: no PostgreSQL helpers or environment variables, and no quit-hold for the postmaster; quit waits for QG Storage to close its files. **Comments** in `app-runtime.ts`, `app-broker.ts`, `diagnostics.ts`, `persona-broker.ts` and `settings.ts`. |
| `logging` | Remove the engine-log special case: `ENGINE_LOG_PREFIX`, `isEngineLog`, `liveEngineLogs`. |
| `preload` | `window.engine` becomes `window.storage`, with a subscribe call for status events (D9). |
| `renderer`, `ui` | Per D9: `app.ts` (the polling loop becomes a subscription with initial sync and cleanup), `shell-store.ts`, `Shell.svelte`, `StatusBar.svelte`, `HomePage.svelte`, `TroubleshootingPanel.svelte`. `EnginePage.svelte` becomes a Storage section in Troubleshooting with no Start/Stop. `StatusBar.svelte` loses `#engine-indicator` and gains an empty data-context slot for P8 (§3.1). Text saying "on this Mac" goes. Stories follow the components. |
| `app-api` | The grant rename (D5). The manifest comment that says an ID "names a database schema and a database role". |
| `persona-core`, `personas` | No change. D2's retained limitation is recorded, not fixed. |
| root | `package.json`: drop `pg` and `@types/pg`, the `vendor/postgres` `extraResources`, and `data/postgres-build.json` from `build.files`. **The build cleans `dist/` before compiling**, so the old `dist/engine/*` cannot reach a package. `drizzle.config.ts`: `dialect: 'sqlite'`, one configuration for `state.sqlite` and one for app databases; the reference DDL is rendered separately (D4). `drizzle/`: regenerated. `data/postgres-build.json`: deleted. `data/app-grants.json`: the grant rename. `Makefile`: no `fetch-postgres`. |

**Schema mapping.** Today: 13 tables, 2 migrations, one foreign key, and no enums, serials or
secondary indexes.

| PostgreSQL | SQLite through Drizzle |
|---|---|
| `pgSchema('qg_ref')`, `pgSchema('qg_frame')` | none: the file is the namespace |
| `text`, `integer` | same |
| `boolean` | `integer({ mode: 'boolean' })` |
| `doublePrecision` | `real` |
| `text[]` (`field.data_types`, `enumeration.header`) | `text({ mode: 'json' })` |
| `jsonb` (`enumeration_value.value`) | `text({ mode: 'json' })` |
| `timestamptz defaultNow()` (`installation.created_at`, `source.fetched_at`) | ISO-8601 UTC text, set in TypeScript |
| FK `enumeration_value.enumeration → enumeration.name` | same, with `foreign_keys=ON`, and checked by `foreign_key_check` before publication |
| column named `column` (`uninterpreted`) | quoted, as now |
| `ON CONFLICT … excluded`, `count(*) FILTER (WHERE …)`, `UPDATE … AS alias`, `count(*)::text` | All four checked on 2026-10-10 under both Node 26.9 and Electron 44's `node:sqlite`. The first three work as written; the cast becomes `CAST(count(*) AS TEXT)`. |
| string literals in double quotes | **Refused** by `node:sqlite`'s build ("no such column"). Ported SQL uses single quotes, which is also standard. Double-quoted *identifiers* still work. |

## 6. What changes: verification and build

There are **31 suites today** (`scripts/suites.mjs`), plus the `artifact-scan` row that `verify.mjs`
appends.

| Suite | Action |
|---|---|
| `engine-binaries` | DELETE |
| `engine-backup` | DELETE, or `storage-backup` under D7b |
| `engine-lifecycle` | REWRITE as `storage`. **Checks:** the layout is created on first run; a second run is idempotent; an app ID trying to leave `apps/` is refused; a file that is not SQLite is refused; callsign order under BINARY; no listener is opened. **Adapter contract:** result shapes, missing rows, binding, JSON and boolean decoding. **Units of work:** a planted interleaving does not roll back an unrelated request. **D11 sentinel control.** |
| `engine-migrations` | REWRITE as `storage-migrations`. The atomic callback on `state.sqlite` and on an app database. Planted broken migrations roll back the whole pending run. |
| `reference-load` | REWRITE as `reference-build`. The D4 checks, including `foreign_key_check` with a planted orphan. **Controls:** a throw before the rename leaves the live file intact; a hash mismatch is refused before the swap; a swap while a reader holds the old file (the Windows rule); a crash between swap and outcome is reconciled on start; offline first run reports *not loaded*. A failed worker leaves the live file untouched. |
| `adif-validation` | EDIT. The ruleset comes from `reference.sqlite`; the add/remove control runs on a writable scratch copy. |
| `pota-load` | EDIT. SQLite SQL. **Keeps:** the per-list independence, the `304` rule, POTA loading without ADIF, the "published values unchanged" assertions, and keep-last-good (the cached list and the previous file survive). |
| `process-recovery` | EDIT. Adds a QG Storage kill-and-recover case beside the persona-service case. |
| `connection-capture` | EDIT. The postmaster labelling and its rule go. The engine's "holds no sockets" rule is **renamed for QG Storage, not deleted**. It is observed on the running application's own utility process, identified by its logged pid, and the identification must succeed or the suite fails (no vacuous pass). It covers **loopback listeners too**: the external-endpoint check deliberately ignores loopback, so it would not catch one. **Control:** a planted loopback listener in QG Storage fails the rule. |
| `electron-smoke`, `packaged-launch`, `screenshots` | EDIT. No 180 s wait for "Running". Assert that `state.sqlite` exists, is closed cleanly on quit, and reopens under `integrity_check`, and that no sentinel bytes appear in any `*.sqlite` or `-wal` file. **`packaged-launch` proves `node:sqlite` loads in the packaged utility process and worker** (D2). |
| `package-contents` | EDIT. No `Resources/postgres`, no `data/postgres-build.json`, **no `dist/engine/`**. |
| `package-boundaries`, `security-lint` | EDIT. **Rename.** **`security-lint`:** add a ban on `DatabaseSync.exec`/`prepare` with a non-literal or interpolated argument **everywhere except the adapter and the migration runner**, the two places that must execute generated SQL. A control shows the rule still fires one file away. A control is also added for the existing `sql.raw` ban, which has none today. |
| `unit` | **DELETE** `tests/engine-binaries.test.mjs`. **EDIT:** `logging`, `diagnostics`, `network-static` (loses its `endpoint.ts` exception), `keychain-namespace` (it fails the moment `endpoint.ts` goes), `suite-gate`, `storybook` (exact `build.files`), `package-boundaries`, `shell`, `suite-speed`. **NEW:** the check that the reference DDL matches its declaration (D4). |
| `scripts/suite-gate.mjs` | EDIT. `engine-binaries` leaves `ALWAYS_RUN`. The `engine-*` rule goes. `adif-validation` and `pota-load` become blocked by `reference-build`. |
| the other 18 | KEEP |

**Result:** 29 suites, or 30 with a backup suite, plus `artifact-scan`. `make check` can grow from 9
to as many as 13: `@playwright/test` was the only thing making the storage and reference suites slow,
and `node:sqlite` loads under plain Node.

**Packaging:** no native module is added (D1). The package loses about 121 MB.

**Baselines:** all eight change (D9). An agent records them as *awaiting*, never as approved.

**Suites that launch the app** (`setup-walk`, `axe`, `screenshots`, `smoke`) get a pre-seeded
reference cache, as `connection-capture` already has. Today each run goes to the network.

## 7. What changes: documents

- **`docs/P4.md`, `P5.md`, `P7.md`:** the old registrations are kept, dated and marked superseded.
  The new acceptance tests are registered in stage 2. *P7-own-schema-only* becomes own-folder-only;
  its test is written when P8 gives apps data.
- **`docs/P6.md`:** two citations of `QGD-ENG-0011` (per D7).
- **`docs/PERSONA-CORE.md`, `docs/VERIFY-ACCOUNT.md`:** the layout, and `make setup` without PostgreSQL.
- **`AGENTS.md`:** the layer table, the tree, and the libraries (SQLite through `node:sqlite`, no
  node-postgres or PostgreSQL); the "own role and schema" pattern; `make setup`.
- **`README.md`, `CONTRIBUTING.md`, `SECURITY.md`:** setup text and the components named.
- **`NOTICE`:** SQLite (public domain, part of Electron), recorded for completeness.
- **`CHANGELOG.md`:** one entry under Unreleased, noting that development profiles start fresh (D12).

**Found along the way.** None of these is caused by this change, but each sits in lines this change
touches, so they are fixed in the same pass:
- `NOTICE` never listed the PostgreSQL we ship. This becomes moot once it goes.
- `docs/P4.md` still says "a free port", against its own gate.
- `USAGE_DATA.md` line 23 points at "Settings → Logs", which mission 1 moved.
- Handbook §7 says P7 includes a test application, against `QGD-APP-0014`.
- `sql.raw`'s ban has no control.
- `QGD-CRD-0002` and the code disagree about where grants are enforced (D5).

## 8. Order of work

One stage at a time. Each stage ends green on `make check`, with a `codex review` before committing.

1. **Decisions.** Done: KI7MT, 2026-10-10 (§3.1).
2. **Spec, handbook and RVM in one pass,** with the **new P4, P5 and P7 acceptance tests registered**
   (`QGD-PRT-0003`).
3. **Spike first:** `node:sqlite` in an Electron utility process, in a worker inside it, and from the
   packaged ASAR. If the spike fails, stop and return to D1. Then `packages/storage`: the adapter
   and its contract, `state.sqlite`, the atomic migrations, the unit-of-work queue, error reduction,
   and the app-folder resolver, with the `storage` and `storage-migrations` suites. Nothing is wired
   into the app yet.
4. **`reference.sqlite`:** the build, the POTA cache, and the build-and-swap on a worker with its checks
   and reconciliation, with `reference-build`, `adif-validation` and `pota-load`.
   **The SQLite loaders are new modules beside the PostgreSQL ones, not edits of them.**
   `engine/start.ts` imports `load.ts` and `pota-load.ts` and passes them a PostgreSQL client, so
   changing those files in place would break the app still running on PostgreSQL. The pure parsers
   (`adif.ts`, `adi.ts`, `pota.ts`, `zip.ts`, `fetch.ts`) are shared unchanged. Both sets coexist
   until stage 5, and every stage stays green.
5. **Wiring:** QG Storage replaces QG Engine; the broker with restart and pushed status; the IPC
   contract, preload, renderer subscription, status bar and Troubleshooting (D9); then the smoke,
   packaged, screenshot, recovery and capture suites. Then PostgreSQL is deleted: the package, the
   PostgreSQL loaders, the scripts, the register, `extraResources` and `pg`. The build cleans `dist/`.
6. **Documents** (§7), with the baselines recorded as awaiting KI7MT.
7. **`make verify` in full on the verification account** (`QGD-TST-0001`–`0003`,
   `docs/VERIFY-ACCOUNT.md`), so the report, packaging, recovery and screenshots are all evidence.
8. **KI7MT** looks at the screens, approves the baselines, and records the sign-offs (D10).

**Then mission 2 resumes, smaller.** On Linux and Windows the PostgreSQL work disappears completely.
What remains is the Rust core (Linux done locally, Windows next), the native-library name per
platform, and per-platform packaging.

## 9. Risks

| Risk | Mitigation |
|---|---|
| `node:sqlite` is a release candidate, not yet stable | One adapter file. Storage suites run on every Electron upgrade. `better-sqlite3` is the fallback, at the cost in D1. |
| `node:sqlite` in a utility-process worker or from the packaged ASAR does not work | The stage 3 spike proves it before anything is built on it, and `packaged-launch` keeps proving it. |
| The proxy migrator and proxy transactions are not atomic on their own | The atomic callback and the per-connection unit-of-work queue (D1), each with a planted control. |
| A storage error leaks values into logs or the screen | One reduction function at every catch (D11), a lint rule against reading `.message` elsewhere, and a sentinel control on the outer path and the partial-success path. |
| A POTA body and its provenance are split by a crash | One record file per list, renamed into place (D4), with a crash control. |
| QG Storage opens a loopback listener | `connection-capture` keeps its no-sockets rule for QG Storage, with a planted-listener control. |
| A reference build blocks queries | The build runs on a worker (D2). `reference-build` checks QG Storage still answers during a build. |
| The persona service blocks during a reference download | Existing, retained and recorded (D2). Not made worse. |
| The Windows rename over an open file | Every handle is closed before the swap, with a control. |
| A swap and its outcome are split by a crash | The file is authoritative and is reconciled on start (D4), with a control. |
| Losing POTA's keep-last-good, partial success or `304` rules | The POTA cache and the per-input rules (D4); `pota-load` keeps every control. |
| A stale `dist/engine` ships | The build cleans `dist/`; `package-contents` asserts it is absent. |
| Plan and spec drift apart | Stage 2 lands before any code, and each code stage cites the requirements it meets. |
