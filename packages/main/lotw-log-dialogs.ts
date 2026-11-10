// SPDX-License-Identifier: GPL-3.0-or-later
import { isLotwLocationMessage } from '../callsigns/lotw-contract.js';
import { BrowserWindow, dialog, ipcMain, session } from 'electron';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LotwLogPorts, LotwLogContext } from './lotw-log.js';
import type { NativeLotwLogPreview, NativeLotwSelection } from '../callsign-core/native.js';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const certificateLabel = (c: NativeLotwLogPreview['certificates'][number]) =>
  `${c.call}, serial ${c.serial}; QSOs ${c.qsoFirst} to ${c.qsoLast}`;

// Refusals grouped by reason, so each reason is written once over the lines it applies to.
const refusalLines = (refused: NativeLotwLogPreview['refused']) => {
  const groups = new Map<string, string[]>();
  for (const r of refused) {
    const where = `${r.line === null ? `Record ${r.record}` : `Line ${r.line}`}${r.field ? `: ${r.field}` : ''}`;
    groups.set(r.reason, [...(groups.get(r.reason) ?? []), where]);
  }
  return [...groups].flatMap(([reason, lines]) => ['', `Refused (${lines.length}): ${reason}`, ...lines.map(l => `  ${l}`)]);
};

export function logPreviewText(p: NativeLotwLogPreview): string {
  return [
    `QSOs in log: ${p.qsos}; dates (UTC): ${p.first || 'none'} to ${p.last || 'none'}`,
    `Station calls named by log: ${p.calls.join(', ') || 'none'}`,
    '',
    `To sign: ${p.toSign}; already signed: ${p.alreadySigned}; sign again: ${p.signAgainCount}; refused: ${p.refused.length}`,
    `Outside the dates: ${p.outsideDates}`,
    ...refusalLines(p.refused),
    '',
    'Station fields sent to LoTW:',
    ...Object.entries(p.fields).map(([k, v]) => `  ${k}: ${v}`),
    ...(p.certificates.length ? [] : ['', 'No certificate with an installed key fits these QSOs.'])
  ].join('\n');
}

export function uploadConfirmation(file: string, p: NativeLotwLogPreview): Electron.MessageBoxOptions {
  return {
    type: 'question',
    title: 'Upload to LoTW',
    message: 'Upload this signed log to LoTW?',
    detail: [file, ...p.certificates.map(certificateLabel), `${p.qsos} QSOs; ${p.first} to ${p.last} UTC`].join('\n'),
    buttons: ['Cancel', 'Upload'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
}

const box = async (options: Electron.MessageBoxOptions) => {
  const parent = BrowserWindow.getFocusedWindow();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
};

// Main owns every dialog here. Nothing in them accepts text or answers from an extension.
export function lotwLogDialogs(dist: string): Pick<LotwLogPorts, 'choose' | 'save' | 'confirmSign' | 'confirmUpload' | 'result'> {
  return {
    async choose(upload) {
      const options: Electron.OpenDialogOptions = {
        title: upload ? 'Upload signed log' : 'Sign log',
        properties: ['openFile'],
        filters: [{ name: upload ? 'Signed LoTW log' : 'Log', extensions: upload ? ['tq8'] : ['adi', 'adx', 'log'] }]
      };
      const parent = BrowserWindow.getFocusedWindow();
      const answer = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return !answer.canceled && answer.filePaths.length === 1 ? answer.filePaths[0] : undefined;
    },
    async save(input) {
      const options: Electron.SaveDialogOptions = {
        title: 'Save signed log',
        defaultPath: join(dirname(input), basename(input, extname(input)) + '.tq8'),
        filters: [{ name: 'Signed LoTW log', extensions: ['tq8'] }]
      };
      const parent = BrowserWindow.getFocusedWindow();
      const answer = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      return answer.canceled ? undefined : answer.filePath;
    },
    confirmSign: (file, preview, context, update, signal) => signDialog(dist, file, preview, context, update, signal),
    async confirmUpload(file, p, signal) {
      return (await box({ ...uploadConfirmation(file, p), signal })).response === 1;
    },
    async result(outcome, canUpload, signal) {
      const detail = [
        `${outcome.alreadySigned} left out as already signed; ${outcome.signAgainCount} signed again; ${outcome.refused.length} refused; ${outcome.outsideDates} outside the dates.`,
        ...refusalLines(outcome.refused)
      ].join('\n');
      const answer = await box({
        type: 'info',
        signal,
        title: 'Log signed',
        message: `Signed ${outcome.signed} QSOs.`,
        detail,
        buttons: canUpload ? ['Close', 'Upload to LoTW…'] : ['Close'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return answer.response === 1;
    }
  };
}

// The window's only style. The CSP names its hash, so no other style can apply; the
// dialog tests check the hash, so change both together. `color-scheme` follows the app's
// theme, which Electron reports to every window.
const STYLE =
  ':root{color-scheme:light dark}' +
  'body{font:14px system-ui,sans-serif;margin:0;padding:20px 24px}' +
  'h1{font-size:17px;font-weight:600;margin:0 0 16px;overflow-wrap:anywhere}' +
  '.row{display:grid;grid-template-columns:7em 1fr;align-items:center;gap:8px;margin:0 0 10px}' +
  'select,input[type=date]{font:inherit;padding:3px 4px;min-width:0}' +
  '.dates{display:flex;align-items:center;gap:12px;flex-wrap:wrap}' +
  '.again{display:block;margin:4px 0 14px}' +
  'pre{font:13px ui-monospace,monospace;white-space:pre-wrap;border:1px solid GrayText;border-radius:4px;padding:10px 12px;margin:0 0 16px;max-height:340px;overflow:auto}' +
  '.actions{display:flex;justify-content:flex-end;gap:8px}' +
  'button{font:inherit;padding:5px 18px}';

function signDialog(
  dist: string,
  file: string,
  initial: NativeLotwLogPreview,
  context: LotwLogContext,
  update: (selection: NativeLotwSelection) => Promise<NativeLotwLogPreview>,
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const parent = BrowserWindow.getFocusedWindow();
    const isolated = session.fromPartition(`lotw-log-${randomUUID()}`);
    isolated.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    isolated.webRequest.onBeforeRequest((details, answer) => answer({ cancel: !details.url.startsWith('data:text/html,') }));
    const window = new BrowserWindow({
      parent: parent ?? undefined,
      modal: !!parent,
      width: 760,
      height: 780,
      title: 'Sign log',
      show: false,
      webPreferences: {
        session: isolated,
        preload: join(dist, 'preload', 'lotw-log.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: false
      }
    });
    let finished = false;
    let pending = 0;
    let ready = initial.certificate !== null && initial.toSign > 0;
    let serial = 0;
    const sender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
      event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    const finish = (accepted = false) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      ipcMain.removeListener('lotw:log-answer', receive);
      ipcMain.removeHandler('lotw:log-preview');
      resolve(accepted);
      if (!window.isDestroyed()) window.destroy();
    };
    const abort = () => finish();
    // Sign is accepted only while the preview on screen is the current one.
    const receive = (event: Electron.IpcMainEvent, value: unknown) => {
      if (sender(event) && typeof value === 'boolean' && (!value || (ready && pending === 0))) finish(value);
    };
    ipcMain.on('lotw:log-answer', receive);

    // Serialize previews: a slow answer must never replace the plan shown by a newer one.
    let queue: Promise<unknown> = Promise.resolve();
    ipcMain.handle('lotw:log-preview', async (event, value: unknown) => {
      if (!sender(event) || finished || typeof value !== 'object' || value === null || Array.isArray(value)) return null;
      const v = value as Record<string, unknown>;
      if (Object.keys(v).sort().join(',') !== 'call,certificate,from,location,signAgain,to') return null;
      if (!['call', 'location', 'certificate', 'from', 'to'].every(k => typeof v[k] === 'string' && (v[k] as string).length <= 160)) return null;
      if (typeof v.signAgain !== 'boolean') return null;
      const place = context.locations.find(l => l.id === v.location);
      if (!place || !context.calls.some(c => c.call === v.call)) return null;
      const selection: NativeLotwSelection = {
        call: v.call as string,
        place: { ...place.place },
        park: place.lotwPark ?? '',
        certificate: v.certificate as string,
        from: v.from as string,
        to: v.to as string,
        signAgain: v.signAgain
      };
      const generation = ++serial;
      ready = false;
      pending++;
      const job = queue
        .then(async () => {
          if (finished) return null;
          try {
            const p = await update(selection);
            const canSign = p.certificate !== null && p.toSign > 0;
            if (generation === serial) ready = canSign;
            return {
              text: logPreviewText(p),
              certificates: [
                ...(p.certificates.length > 1 ? [{ id: '', label: 'Choose a certificate' }] : []),
                ...p.certificates.map(c => ({ id: c.id, label: certificateLabel(c) }))
              ],
              selected: p.certificate?.id ?? '',
              ready: canSign
            };
          } catch (error) {
            ready = false;
            return error instanceof Error && isLotwLocationMessage(error.message)
              ? { text: error.message, certificates: [], selected: '', ready: false }
              : null;
          }
        })
        .finally(() => {
          pending--;
        });
      queue = job;
      return job;
    });

    signal?.addEventListener('abort', abort, { once: true });
    window.on('closed', () => finish());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());

    // Every value goes through escaping; the log supplies no HTML.
    const options = (entries: readonly { value: string; label: string }[], selected: string) =>
      entries.map(e => `<option value="${escape(e.value)}"${e.value === selected ? ' selected' : ''}>${escape(e.label)}</option>`).join('');
    const calls = options(context.calls.map(c => ({ value: c.call, label: c.call })), context.activeCall);
    const locations = options(
      context.locations.map(l => ({ value: l.id, label: l.name })),
      context.activeLocation ?? context.locations[0].id
    );
    const certificates = options(
      [
        ...(initial.certificates.length > 1 ? [{ value: '', label: 'Choose a certificate' }] : []),
        ...initial.certificates.map(c => ({ value: c.id, label: certificateLabel(c) }))
      ],
      initial.certificate?.id ?? ''
    );
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-HQqBncVXxC8ZTOMxEHHuwLz8z1PUX+CLjVwOMDhm/jo='; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"><title>Sign log</title><style>${STYLE}</style><h1>Sign ${escape(file)}</h1><form><label class="row">Callsign: <select id="call">${calls}</select></label><label class="row">Location: <select id="location">${locations}</select></label><label class="row">Certificate: <select id="certificate"${initial.certificates.length <= 1 ? ' disabled' : ''}>${certificates}</select></label><div class="row"><span>Dates (UTC):</span><span class="dates"><label>From <input id="from" type="date"></label> <label>To <input id="to" type="date"></label> <span>Leave blank for all</span></span></div><label class="again"><input id="again" type="checkbox"> Sign again: include already-signed QSOs</label><pre id="preview" role="status">${escape(context.previewProblem ?? logPreviewText(initial))}</pre><div class="actions"><button id="cancel" type="button">Cancel</button> <button id="sign" type="submit"${ready ? '' : ' disabled'}>Sign…</button></div></form></html>`;
    window.once('ready-to-show', () => window.show());
    void window.loadURL(`data:text/html,${encodeURIComponent(html)}`).catch(() => finish());
  });
}
