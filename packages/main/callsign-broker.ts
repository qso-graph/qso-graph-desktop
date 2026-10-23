// SPDX-License-Identifier: GPL-3.0-only
import { app, BrowserWindow, dialog, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  allowsSender, isReply, validateCommand,
  type FetchedReference, type CallsignCommand, type CallsignReply, type SealedExport, type ServiceCommand,
  type CoreImportPreview, type CoreImportResult, type ImportPreview, type ImportResult
} from '../callsigns/callsign-contract.js';
import { isStationsBackup, type StationsBackup } from '../storage/station-contract.js';
import { readServices, serviceIds } from '../callsigns/services.js';
import { deadlineFor } from '../callsigns/deadlines.js';
import { forStore } from '../callsigns/credential-store.js';
import { createLogger, writeForwarded } from '../logging/logger.js';

const log = createLogger('broker');


// The answer while the credential core is not up yet. Nothing was sent
// anywhere, so a caller may ask again soon (QG Storage does, for reference
// data). Any other failure may have reached a server.
export const CALLSIGNS_STARTING = 'Callsigns are still starting. Try again.';

// A callsign as an application may see it: the id, the call and the
// description, and nothing else (QGD-CRD-0010).
export interface CallsignBrief { id: string; call: string; description: string }

// The Locations, which QG Storage holds, for a backup and a restore: given
// to this broker by main once QG Storage has started.
export interface StationsHooks {
  backup: () => Promise<StationsBackup | string>;
  restore: (backup: StationsBackup, replace: boolean) => Promise<number | string>;
  count: () => number;
}

export interface CallsignBroker {
  stop: () => void;
  // Main hands over the Locations once QG Storage has started.
  connectStations: (hooks: StationsHooks) => void;
  // Called after a callsign was added, changed, removed or made active, so
  // what Home shows for the old one can be dropped (QGD-HOM-0005).
  onCallsignsChanged: (listener: () => void) => void;
  // Called with the callsign's id after one is made active, so its default
  // location becomes active with it (QGD-STN-0005).
  onCallsignActivated: (listener: (id: string) => void) => void;
  // Called with the callsign's id after one is removed, so what is kept for
  // it elsewhere goes with it (its default location, QGD-STN-0005).
  onCallsignRemoved: (listener: (id: string) => void) => void;
  // Reference data, fetched by the credential core because that is where all
  // of this product's outbound HTTPS goes (D-18, D-31). Handed to the engine
  // broker by main; never reachable from a renderer, which has no command for
  // it (see validateCommand in callsign-contract.ts).
  fetchReference: (url: string, etag?: string, lastModified?: string) => Promise<FetchedReference | string>;
  // The callsigns an application may be shown (QGD-CRD-0010). Reached only
  // through the extension API with its list grant.
  callsignBriefs: () => Promise<readonly CallsignBrief[] | string>;
  // The active callsign, or null when none is active.
  activeBrief: () => Promise<CallsignBrief | null | string>;
  // Acting with a credential on an application's behalf (QGD-APP-0007). Not
  // reachable from a renderer: `service-lookup` is a ServiceCommand, which
  // validateCommand does not accept.
  serviceLookup: (
    service: string, id: string, operation: string, parameters: Readonly<Record<string, string>>
  ) => Promise<Readonly<Record<string, string>> | string>;
}

// The commands after which the callsigns, or which one is active, may differ.
const CHANGES_CALLSIGNS = new Set(['create', 'update', 'set-active', 'remove-callsign', 'import-callsigns']);

// Built field by field rather than passed through. A callsign record carries
// its service entries, and an application has no business seeing which
// services an operator holds credentials for (QGD-CRD-0010).
function briefsOf(data: unknown): CallsignBrief[] | string {
  const list = (data as { callsigns?: unknown } | null)?.callsigns;
  if (!Array.isArray(list)) return 'The callsigns could not be read.';
  return list.flatMap((entry: { id?: unknown; call?: unknown; description?: unknown }) =>
    typeof entry.id === 'string' && typeof entry.call === 'string' && typeof entry.description === 'string'
      ? [{ id: entry.id, call: entry.call, description: entry.description }]
      : []);
}

export function startCallsignBroker(distDirectory: string, registerFile: string): CallsignBroker {
  const changeListeners = new Set<() => void>();
  const activationListeners = new Set<(id: string) => void>();
  const removalListeners = new Set<(id: string) => void>();
  let worker: UtilityProcess | undefined;
  let ready = false;
  let stopped = false;
  let nextId = 0;
  let failures = 0;
  const pending = new Map<number, { resolve: (reply: CallsignReply) => void; timer: NodeJS.Timeout }>();
  let stations: StationsHooks | undefined;
  // Inside the directory the operating system gives this application, beside
  // everything else it owns — the engine's data and the reference cache are
  // already under the same root (enginePaths, QGD-CRD-0013.1).
  //
  // Two wrongs were fixed here. Until 2026-10-09 this was `~/.config/adif-mcp`,
  // the MCP servers' own directory, so the list of callsigns was
  // was a file both products wrote. The first fix moved it to
  // `~/.config/qso-graph-desktop`, which stopped the sharing but kept a Linux
  // convention on macOS and put the callsigns somewhere the rest of this
  // application does not live. The right answer is to ask the platform.
  //
  // Nothing in either old directory is migrated, read or removed. The first
  // may be the MCP side's data, and separating two products is not the same as
  // taking one's.
  const profileDirectory = process.env.QG_DESKTOP_PROFILE_DIR || join(app.getPath('userData'), 'callsigns');
  // The services a command may name (QGD-PSN-0002). Read once, here, rather
  // than listed in the contract. A register that cannot be read leaves this
  // empty, which refuses every command naming a service while leaving the
  // callsign commands — list, create, set-active — working: an unreadable
  // register is not a reason to lose the callsigns too.
  // The file the operator chose to look at, between looking and importing.
  // The path, never the contents, and never more than one.
  let inspected: string | undefined;
  let services: ReadonlySet<string> = new Set();
  void readServices(registerFile)
    .then(register => { services = serviceIds(register); })
    .catch(error => log.error({ reason: String(error instanceof Error ? error.message : error) },
      'the service register could not be read; no service credential can be reached'));
  function failPending() {
    for (const item of pending.values()) { clearTimeout(item.timer); item.resolve({ ok: false, error: 'Callsigns are restarting. Try again.' }); }
    pending.clear();
  }
  function start() {
    if (stopped) return;
    ready = false;
    worker = utilityProcess.fork(join(distDirectory, 'callsigns', 'callsign-service.js'), [profileDirectory, registerFile], {
      serviceName: 'QG Callsigns', stdio: 'ignore', allowLoadingUnsignedLibraries: true
    });
    worker.on('message', (message: unknown) => {
      if (message === null || typeof message !== 'object') return;
      const payload = message as { ready?: unknown; log?: unknown; id?: unknown; reply?: unknown };
      if (typeof payload.log === 'string') { writeForwarded(payload.log); return; }
      if (payload.ready === true) { ready = true; failures = 0; return; }
      // QGD-SEC-0006: the id and the reply are both checked before either is
      // used, even though the sender is our own utility process.
      if (!Number.isSafeInteger(payload.id) || !isReply(payload.reply)) return;
      const id = payload.id as number;
      const item = pending.get(id);
      if (item) { clearTimeout(item.timer); pending.delete(id); item.resolve(payload.reply); }
    });
    worker.once('exit', () => {
      ready = false; worker = undefined; failPending();
      if (!stopped) {
        const wait = Math.min(250 * 2 ** failures++, 10_000);
        log.warn({ waitMs: wait, failures }, 'callsign service exited; restarting');
        setTimeout(start, wait);
      }
    });
  }
  start();

  // One command to the service, awaited.
  function ask(command: ServiceCommand): Promise<CallsignReply> {
    if (!ready || !worker) return Promise.resolve({ ok: false, error: CALLSIGNS_STARTING });
    if (pending.size >= 16) return Promise.resolve({ ok: false, error: 'A callsign request is still running. Try again shortly.' });
    const id = ++nextId;
    return new Promise(resolve => {
      // Per command, not one number for all of them: see deadlines.ts.
      const deadline = deadlineFor(command.type);
      const timer = setTimeout(
        () => { pending.delete(id); resolve({ ok: false, error: forStore(deadline.said, process.platform) }); }, deadline.ms);
      pending.set(id, { resolve, timer });
      worker!.postMessage({ id, command });
    });
  }

  // The two commands the main process has to finish itself, because they
  // touch the file system and a renderer must not (QGD-PSN-0011). The
  // operator chooses the place; the bytes never reach a screen.
  async function moveCallsigns(
    window: BrowserWindow | null,
    command: Extract<CallsignCommand, { type: 'export-callsigns' | 'import-callsigns' }>
  ): Promise<CallsignReply> {
    if (command.type === 'export-callsigns') {
      const chosen = window
        ? await dialog.showSaveDialog(window, {
            title: 'Back up callsigns and Locations',
            defaultPath: 'qso-graph-backup.json',
            filters: [{ name: 'QSO Graph backup', extensions: ['json'] }]
          })
        : await dialog.showSaveDialog({ defaultPath: 'qso-graph-backup.json' });
      if (chosen.canceled || !chosen.filePath) return { ok: false, error: 'Backup cancelled.' };

      // The Locations go in the same file (KI7MT, 2026-10-23); no login does,
      // and the core reads none for a backup. Everything in it is public, so
      // it is plain JSON, with no passphrase to lose.
      const backup = stations ? await stations.backup() : { stations: [], defaults: {}, active: null };
      if (typeof backup === 'string') return { ok: false, error: backup };
      // Made first, written second: a backup that cannot be made must not
      // leave a file behind.
      const made = await ask({ type: 'export-callsigns', locations: JSON.stringify(backup) });
      if (!made.ok) return made;
      const bytes = (made.data as SealedExport | null)?.bytes;
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        return { ok: false, error: 'The export could not be written.' };
      }
      try {
        await writeFile(chosen.filePath, bytes);
      } catch {
        return { ok: false, error: 'That file could not be written. Choose another place.' };
      }
      log.info({ bytes: bytes.length }, 'callsigns exported');
      return { ok: true, data: { written: basename(chosen.filePath), bytes: bytes.length } };
    }

    // Looking and importing are two commands, and the operator chose the file
    // for the first of them. Asking again for the second would be asking the
    // same question twice, so the path is kept — the path only, never the
    // bytes — and the file is read again when the import is confirmed. A file
    // that changed in between fails its tag at that point, like any other
    // altered file.
    let path: string | undefined = command.apply ? inspected : undefined;
    if (!path) {
      const chosen = window
        ? await dialog.showOpenDialog(window, {
            title: 'Restore callsigns and Locations',
            properties: ['openFile'],
            filters: [{ name: 'QSO Graph backup', extensions: ['json'] }]
          })
        : await dialog.showOpenDialog({ properties: ['openFile'] });
      if (chosen.canceled || chosen.filePaths.length !== 1) return { ok: false, error: 'Restore cancelled.' };
      path = chosen.filePaths[0];
    }
    let file: Buffer;
    try {
      file = await readFile(path);
    } catch {
      inspected = undefined;
      return { ok: false, error: 'That file could not be read.' };
    }
    if (file.length === 0 || file.length > 4_194_304) {
      inspected = undefined;
      return { ok: false, error: 'That file is not an export this product wrote.' };
    }
    // Looked at first, whether to show or to restore: what the file holds is
    // checked whole before anything here changes.
    const looked = await ask({ type: 'import-callsigns', apply: false, replace: false, file });
    if (!looked.ok) { inspected = undefined; return looked; }
    const core = looked.data as CoreImportPreview;
    let backup: StationsBackup = { stations: [], defaults: {}, active: null };
    if (core.locations !== '') {
      let parsed: unknown;
      try { parsed = JSON.parse(core.locations); } catch { parsed = undefined; }
      if (!isStationsBackup(parsed)) { inspected = undefined; return { ok: false, error: 'The Locations in that file could not be read.' }; }
      backup = parsed;
    }
    const locationsHere = stations?.count() ?? 0;
    if (!command.apply) {
      // Remembered only while there is something to confirm: a look that
      // succeeded. Forgotten the moment it is used, refused, or cancelled.
      inspected = path;
      const preview: ImportPreview = {
        created: core.created, callsigns: core.callsigns, arriving: core.arriving, here: core.here,
        locations: backup.stations.map(entry => entry.name), locationsHere
      };
      return { ok: true, data: preview };
    }
    inspected = undefined;
    // A clean slate, never a merge (KI7MT, 2026-10-23): with anything here,
    // the operator must have said to remove it first.
    if (!command.replace && (core.here.length > 0 || locationsHere > 0)) {
      return { ok: false, error: 'This computer already has callsigns or Locations. Choose to remove them first, then restore.' };
    }
    if (!stations) return { ok: false, error: 'The Locations cannot be restored just now. Try again in a moment.' };
    const applied = await ask({ type: 'import-callsigns', apply: true, replace: command.replace, file });
    if (!applied.ok) return applied;
    const restored = await stations.restore(backup, command.replace);
    if (typeof restored === 'string') return { ok: false, error: `The callsigns were restored; the Locations were not: ${restored}` };
    const result: ImportResult = { callsigns: (applied.data as CoreImportResult).callsigns, locations: restored };
    log.info({ callsigns: result.callsigns, locations: result.locations }, 'callsigns and locations restored');
    return { ok: true, data: result };
  }

  ipcMain.handle('callsigns:request', (event, command: unknown): Promise<CallsignReply> | CallsignReply => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateCommand(command, services)) {
      log.warn({ accepted: false }, 'callsign request refused');
      return { ok: false, error: 'Invalid callsign request.' };
    }
    const told = (reply: CallsignReply): CallsignReply => {
      if (reply.ok && CHANGES_CALLSIGNS.has(command.type)) for (const listener of changeListeners) listener();
      if (reply.ok && command.type === 'set-active') for (const listener of activationListeners) listener(command.id);
      if (reply.ok && command.type === 'remove-callsign') for (const listener of removalListeners) listener(command.id);
      return reply;
    };
    if (command.type === 'export-callsigns' || command.type === 'import-callsigns') {
      return moveCallsigns(BrowserWindow.fromWebContents(event.sender), command).then(told);
    }
    return ask(command).then(told);
  });
  return {
    connectStations: hooks => { stations = hooks; },
    onCallsignsChanged: listener => { changeListeners.add(listener); },
    onCallsignActivated: listener => { activationListeners.add(listener); },
    onCallsignRemoved: listener => { removalListeners.add(listener); },
    stop: () => { stopped = true; failPending(); worker?.kill(); ipcMain.removeHandler('callsigns:request'); },
    async callsignBriefs() {
      const reply = await ask({ type: 'list' });
      if (!reply.ok) return reply.error;
      return briefsOf(reply.data);
    },
    async activeBrief() {
      const reply = await ask({ type: 'list' });
      if (!reply.ok) return reply.error;
      const briefs = briefsOf(reply.data);
      if (typeof briefs === 'string') return briefs;
      const active = (reply.data as { active?: unknown }).active;
      return briefs.find(brief => brief.id === active) ?? null;
    },
    async serviceLookup(service, id, operation, parameters) {
      const reply = await ask({ type: 'service-lookup', service, id, operation, parameters: { ...parameters } });
      if (!reply.ok) return reply.error;
      const data = reply.data as { outcome?: unknown; fields?: { name?: unknown; value?: unknown }[] } | null;
      if (!data || typeof data.outcome !== 'string') return 'The lookup could not be read.';
      const answer: Record<string, string> = { outcome: data.outcome };
      for (const field of Array.isArray(data.fields) ? data.fields : []) {
        if (typeof field.name === 'string' && typeof field.value === 'string') answer[field.name] = field.value;
      }
      return answer;
    },
    async fetchReference(url, etag, lastModified) {
      const reply = await ask({
        type: 'fetch-reference', url,
        ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {})
      });
      if (!reply.ok) return reply.error;
      const data = reply.data as FetchedReference | null;
      if (!data || typeof data.fresh !== 'boolean') return 'The reference source could not be read.';
      return data;
    }
  };
}
