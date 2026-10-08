// SPDX-License-Identifier: GPL-3.0-only
import { app, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { allowsSender, validateCommand, type PersonaReply } from './persona-contract.js';

export function startPersonaBroker(compiledDirectory: string): () => void {
  let worker: UtilityProcess | undefined;
  let ready = false;
  let stopped = false;
  let nextId = 0;
  let failures = 0;
  const pending = new Map<number, { resolve: (reply: PersonaReply) => void; timer: NodeJS.Timeout }>();
  const profileDirectory = process.env.QG_DESKTOP_PROFILE_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'adif-mcp');
  function failPending() {
    for (const item of pending.values()) { clearTimeout(item.timer); item.resolve({ ok: false, error: 'The persona service is restarting. Try again.' }); }
    pending.clear();
  }
  function start() {
    if (stopped) return;
    ready = false;
    worker = utilityProcess.fork(join(compiledDirectory, 'persona-service.js'), [profileDirectory], {
      serviceName: 'QG Personas', stdio: 'ignore', allowLoadingUnsignedLibraries: true
    });
    worker.on('message', message => {
      if (message?.ready === true) { ready = true; failures = 0; return; }
      const item = pending.get(message?.id);
      if (item) { clearTimeout(item.timer); pending.delete(message.id); item.resolve(message.reply); }
    });
    worker.once('exit', () => {
      ready = false; worker = undefined; failPending();
      if (!stopped) setTimeout(start, Math.min(250 * 2 ** failures++, 10_000));
    });
  }
  start();
  ipcMain.handle('persona:request', (event, command: unknown): Promise<PersonaReply> | PersonaReply => {
    if (!allowsSender(event.senderFrame, event.sender.mainFrame, event.senderFrame?.url) || !validateCommand(command)) return { ok: false, error: 'Invalid persona request.' };
    if (!ready || !worker) return { ok: false, error: 'The persona service is starting. Try again.' };
    if (pending.size >= 16) return { ok: false, error: 'A persona operation is still running. Try again shortly.' };
    const id = ++nextId;
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'Keychain did not respond. Check for a macOS permission dialog, then try again.' }); }, 30_000);
      pending.set(id, { resolve, timer });
      worker!.postMessage({ id, command });
    });
  });
  return () => { stopped = true; failPending(); worker?.kill(); ipcMain.removeHandler('persona:request'); };
}
