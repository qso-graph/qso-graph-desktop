// SPDX-License-Identifier: GPL-3.0-only
import { app, BrowserWindow, dialog, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  allowsSender, isReply, validateCommand,
  type FetchedReference, type PersonaCommand, type PersonaReply, type SealedExport, type ServiceCommand
} from '../personas/persona-contract.js';
import { readServices, serviceIds } from '../personas/services.js';
import { deadlineFor } from '../personas/deadlines.js';
import { createLogger, writeForwarded } from '../logging/logger.js';

const log = createLogger('broker');


// The answer while the credential core is not up yet. Nothing was sent
// anywhere, so a caller may ask again soon (QG Storage does, for reference
// data). Any other failure may have reached a server.
export const PERSONA_STARTING = 'The persona service is starting. Try again.';

export interface PersonaBroker {
  stop: () => void;
  // Reference data, fetched by the credential core because that is where all
  // of this product's outbound HTTPS goes (D-18, D-31). Handed to the engine
  // broker by main; never reachable from a renderer, which has no command for
  // it (see validateCommand in persona-contract.ts).
  fetchReference: (url: string, etag?: string, lastModified?: string) => Promise<FetchedReference | string>;
  // The personas an application may be shown: callsign and name, nothing else
  // (QGD-CRD-0010). Reached only through the extension API with a persona:list
  // grant.
  personaBriefs: () => Promise<readonly { name: string; callsign: string }[] | string>;
  // Acting with a credential on an application's behalf (QGD-APP-0007). Not
  // reachable from a renderer: `service-lookup` is a ServiceCommand, which
  // validateCommand does not accept.
  serviceLookup: (
    service: string, persona: string, operation: string, parameters: Readonly<Record<string, string>>
  ) => Promise<Readonly<Record<string, string>> | string>;
}

export function startPersonaBroker(distDirectory: string, registerFile: string): PersonaBroker {
  let worker: UtilityProcess | undefined;
  let ready = false;
  let stopped = false;
  let nextId = 0;
  let failures = 0;
  const pending = new Map<number, { resolve: (reply: PersonaReply) => void; timer: NodeJS.Timeout }>();
  // Inside the directory the operating system gives this application, beside
  // everything else it owns — the engine's data and the reference cache are
  // already under the same root (enginePaths, QGD-CRD-0013.1).
  //
  // Two wrongs were fixed here. Until 2026-10-09 this was `~/.config/adif-mcp`,
  // the MCP servers' own directory, so personas.json — holding KI7MT's and
  // KE1HA's real personas — was a file both products wrote. My first fix moved
  // it to `~/.config/qso-graph-desktop`, which stopped the sharing but kept a
  // Linux convention on macOS and put the personas somewhere the rest of this
  // application does not live. Bob's correction is the right one: ask the
  // platform.
  //
  // Nothing in either old directory is migrated, read or removed. The first
  // may be the MCP side's data, and separating two products is not the same as
  // taking one's.
  const profileDirectory = process.env.QG_DESKTOP_PROFILE_DIR || join(app.getPath('userData'), 'personas');
  // The services a command may name (QGD-PSN-0002). Read once, here, rather
  // than listed in the contract. A register that cannot be read leaves this
  // empty, which refuses every command naming a service while leaving the
  // persona commands — list, upsert, set-active — working: an unreadable
  // register is not a reason to lose the personas too.
  // The file the operator chose to look at, between looking and importing.
  // The path, never the contents, and never more than one.
  let inspected: string | undefined;
  let services: ReadonlySet<string> = new Set();
  void readServices(registerFile)
    .then(register => { services = serviceIds(register); })
    .catch(error => log.error({ reason: String(error instanceof Error ? error.message : error) },
      'the service register could not be read; no service credential can be reached'));
  function failPending() {
    for (const item of pending.values()) { clearTimeout(item.timer); item.resolve({ ok: false, error: 'The persona service is restarting. Try again.' }); }
    pending.clear();
  }
  function start() {
    if (stopped) return;
    ready = false;
    worker = utilityProcess.fork(join(distDirectory, 'personas', 'persona-service.js'), [profileDirectory, registerFile], {
      serviceName: 'QG Personas', stdio: 'ignore', allowLoadingUnsignedLibraries: true
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
        log.warn({ waitMs: wait, failures }, 'persona service exited; restarting');
        setTimeout(start, wait);
      }
    });
  }
  start();

  // One command to the service, awaited.
  function ask(command: ServiceCommand): Promise<PersonaReply> {
    if (!ready || !worker) return Promise.resolve({ ok: false, error: PERSONA_STARTING });
    if (pending.size >= 16) return Promise.resolve({ ok: false, error: 'A persona operation is still running. Try again shortly.' });
    const id = ++nextId;
    return new Promise(resolve => {
      // Per command, not one number for all of them: see deadlines.ts.
      const deadline = deadlineFor(command.type);
      const timer = setTimeout(
        () => { pending.delete(id); resolve({ ok: false, error: deadline.said }); }, deadline.ms);
      pending.set(id, { resolve, timer });
      worker!.postMessage({ id, command });
    });
  }

  // The two commands the main process has to finish itself, because they
  // touch the file system and a renderer must not (QGD-PSN-0011). The
  // operator chooses the place; the bytes never reach a screen.
  async function movePersonas(
    window: BrowserWindow | null,
    command: Extract<PersonaCommand, { type: 'export-personas' | 'import-personas' }>
  ): Promise<PersonaReply> {
    if (command.type === 'export-personas') {
      const chosen = window
        ? await dialog.showSaveDialog(window, {
            title: 'Export personas',
            defaultPath: 'qso-graph-personas.qgp',
            filters: [{ name: 'QSO Graph export', extensions: ['qgp'] }]
          })
        : await dialog.showSaveDialog({ defaultPath: 'qso-graph-personas.qgp' });
      if (chosen.canceled || !chosen.filePath) return { ok: false, error: 'Export cancelled.' };

      // Sealed first, written second: a cancelled or failed seal must not
      // leave a file behind, and a passphrase the core refuses is refused
      // before anything is created.
      const sealed = await ask(command);
      if (!sealed.ok) return sealed;
      const bytes = (sealed.data as SealedExport | null)?.bytes;
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        return { ok: false, error: 'The export could not be written.' };
      }
      try {
        await writeFile(chosen.filePath, bytes);
      } catch {
        return { ok: false, error: 'That file could not be written. Choose another place.' };
      }
      log.info({ bytes: bytes.length }, 'personas exported');
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
            title: 'Import personas',
            properties: ['openFile'],
            filters: [{ name: 'QSO Graph export', extensions: ['qgp'] }]
          })
        : await dialog.showOpenDialog({ properties: ['openFile'] });
      if (chosen.canceled || chosen.filePaths.length !== 1) return { ok: false, error: 'Import cancelled.' };
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
    const answer = await ask({ type: 'import-personas', passphrase: command.passphrase, apply: command.apply, file });
    // Remembered only while there is something to confirm: a look that
    // succeeded. Forgotten the moment it is used, refused, or cancelled.
    inspected = !command.apply && answer.ok ? path : undefined;
    return answer;
  }

  ipcMain.handle('persona:request', (event, command: unknown): Promise<PersonaReply> | PersonaReply => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateCommand(command, services)) {
      log.warn({ accepted: false }, 'persona request refused');
      return { ok: false, error: 'Invalid persona request.' };
    }
    if (command.type === 'export-personas' || command.type === 'import-personas') {
      return movePersonas(BrowserWindow.fromWebContents(event.sender), command);
    }
    return ask(command);
  });
  return {
    stop: () => { stopped = true; failPending(); worker?.kill(); ipcMain.removeHandler('persona:request'); },
    async personaBriefs() {
      const reply = await ask({ type: 'list' });
      if (!reply.ok) return reply.error;
      const data = reply.data as { personas?: { name?: unknown; callsign?: unknown }[] } | null;
      if (!data || !Array.isArray(data.personas)) return 'The personas could not be read.';
      // Built field by field rather than passed through. A persona record
      // carries provider entries, and an application has no business seeing
      // which services an operator holds credentials for.
      return data.personas.flatMap(persona =>
        typeof persona.name === 'string' && typeof persona.callsign === 'string'
          ? [{ name: persona.name, callsign: persona.callsign }]
          : []);
    },
    async serviceLookup(service, persona, operation, parameters) {
      const reply = await ask({ type: 'service-lookup', service, persona, operation, parameters: { ...parameters } });
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
