// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
const electron = vi.hoisted(() => ({ windows: [] as any[], choose: vi.fn(), confirm: vi.fn(), ipc: undefined as any, partition: vi.fn(), send: vi.fn(), options: [] as any[] }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    static getFocusedWindow() { return undefined; }
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler: vi.fn() });
    destroyed = false;
    constructor(options: unknown) { super(); electron.options.push(options); electron.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show = vi.fn();
    loadURL = vi.fn(async () => { this.emit('ready-to-show'); });
  }
  electron.ipc = new EventEmitter();
  electron.partition.mockImplementation(() => ({ setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } }));
  return { BrowserWindow: Window, dialog: { showOpenDialog: electron.choose, showMessageBox: electron.confirm }, ipcMain: electron.ipc, ipcRenderer: { send: electron.send }, session: { fromPartition: electron.partition } };
});
import { lotwDialogs } from '../packages/main/lotw-dialogs.js';
import type { NativeLotwPreview } from '../packages/callsign-core/native.js';
// A failed test must not leave its password receiver for the next one to count.
beforeEach(() => { electron.windows.length = 0; electron.options.length = 0; electron.ipc.removeAllListeners(); vi.clearAllMocks(); });
it('QGD-LTW-0004: main filters its OS file chooser and cancellation sends no path', async () => {
  const dialogs = lotwDialogs('/dist');
  electron.choose.mockResolvedValue({ canceled: true, filePaths: ['/test-only/unselected.tbk'] });
  expect(await dialogs.choose(true)).toBeUndefined();
  expect(electron.choose).toHaveBeenLastCalledWith(expect.objectContaining({ filters: [{ name: 'TQSL backup', extensions: ['tbk'] }], properties: ['openFile'] }));
  electron.choose.mockResolvedValue({ canceled: false, filePaths: ['/test-only/selected.p12'] });
  expect(await dialogs.choose(false)).toBe('/test-only/selected.p12');
  expect(electron.choose).toHaveBeenLastCalledWith(expect.objectContaining({ filters: [{ name: 'LoTW certificate', extensions: ['tq6', 'p12'] }] }));
});
it('QGD-LTW-0003/0008: main confirmation names inspected identities, root fingerprint, signed record and final Location names', async () => {
  const preview: NativeLotwPreview = { token: 'test-token', needsPassword: false, certificates: [{ call: 'QG0TEST', serial: 'ABCD', disposition: 'new', reason: '', fileHasKey: true, keyPresent: false, needsPassword: false, dxcc: 291, qsoFirst: '2020-01-01', qsoLast: '2030-01-01', validFrom: '2020-01-01', validTo: '2030-01-01' }], roots: [{ fingerprint: 'AA:BB:TEST' }], signedQsos: 123, signedQsoBytes: 4567, locations: [] };
  electron.confirm.mockResolvedValue({ response: 0, checkboxChecked: true });
  const dialogs = lotwDialogs('/dist');
  expect(await dialogs.confirm('test-only.tbk', preview, [{ id: 'test-id', name: 'Test location (TQSL)', place: { MY_GRIDSQUARE: 'DN13' } }], [], false)).toEqual({ accepted: false, locations: true });
  const options = electron.confirm.mock.calls[0][0];
  for (const text of ['test-only.tbk', 'QG0TEST', 'ABCD', 'AA:BB:TEST', '123', '4567', 'Test location (TQSL)', 'Key in file: yes']) expect(options.detail).toContain(text);
  expect(options.defaultId).toBe(0); expect(options.cancelId).toBe(0);
  expect(options.checkboxLabel).toBe('Also create these Desktop Locations');
  expect(options.checkboxChecked).toBe(false);
  electron.confirm.mockResolvedValue({ response: 1, checkboxChecked: false });
  expect((await dialogs.confirm('', preview, [], [], true)).accepted).toBe(true);
  expect(electron.confirm.mock.calls[1][0].message).toBe('Delete this certificate and its key?');
});
it('QGD-LTW-0003/0005, QGD-CRD-0007: only the dedicated main window and frame can send one password', async () => {
  const pending = lotwDialogs('/dist').password('QG0TEST <planted>, serial ABCD');
  const window = electron.windows[0]; const options = electron.options[0];
  expect(options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, preload: join('/dist', 'preload', 'lotw-password.cjs') });
  expect(window.loadURL.mock.calls[0][0]).toContain('%26lt%3Bplanted%26gt%3B');
  let done = false; void pending.then(() => { done = true; });
  electron.ipc.emit('lotw:password', { sender: {}, senderFrame: window.webContents.mainFrame }, 'planted-extension-password');
  electron.ipc.emit('lotw:password', { sender: window.webContents, senderFrame: {} }, 'planted-subframe-password');
  await Promise.resolve(); expect(done).toBe(false);
  electron.ipc.emit('lotw:password', { sender: window.webContents, senderFrame: window.webContents.mainFrame }, 'test-only-password');
  expect(await pending).toBe('test-only-password');
  expect(window.destroyed).toBe(true); expect(electron.ipc.listenerCount('lotw:password')).toBe(0);
});
it('QGD-LTW-0005: closing the main password window cancels and removes its receiver', async () => {
  const pending = lotwDialogs('/dist').password('QG0TEST, serial ABCD');
  electron.windows[0].destroy(); expect(await pending).toBeUndefined();
  expect(electron.ipc.listenerCount('lotw:password')).toBe(0);
});
it('password window blocks requests, permissions, navigation, and new windows and has a strict script policy', async () => {
  const pending = lotwDialogs('/dist').password('test');
  const window = electron.windows[0];
  const isolated = electron.partition.mock.results[0].value;
  const html = decodeURIComponent(window.loadURL.mock.calls[0][0].slice('data:text/html,'.length));
  expect(html).toContain('http-equiv="Content-Security-Policy"');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  expect(csp.split(';').map(part => part.trim())).toContain("script-src 'none'");
  const style = /<style>(.*?)<\/style>/.exec(html)![1];
  expect(csp).toContain(`style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'`);
  const request = isolated.webRequest.onBeforeRequest.mock.calls[0][0];
  const answer = vi.fn();
  request({ url: 'https://example.test/' }, answer); expect(answer).toHaveBeenLastCalledWith({ cancel: true });
  request({ url: 'data:text/html,ok' }, answer); expect(answer).toHaveBeenLastCalledWith({ cancel: false });
  const permission = vi.fn(); isolated.setPermissionRequestHandler.mock.calls[0][0]({}, 'camera', permission);
  expect(permission).toHaveBeenCalledWith(false);
  expect(window.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
  const preventDefault = vi.fn(); window.webContents.emit('will-navigate', { preventDefault }); expect(preventDefault).toHaveBeenCalledOnce();
  window.destroy(); await pending;
});

it('password preload submits once and clears the input', async () => {
  const handlers = new Map<string, EventListener>();
  const form = new EventTarget();
  const input = { value: 'test-only-password' };
  vi.stubGlobal('window', { addEventListener: (name: string, handler: EventListener) => handlers.set(name, handler) });
  vi.stubGlobal('document', { getElementById: (id: string) => id === 'password' ? input : new EventTarget(), querySelector: () => form });
  try {
    const source = readFileSync('packages/preload/lotw-password.cts', 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(compiled, { window, document, exports: {}, require: () => ({ ipcRenderer: { send: electron.send } }) });
    handlers.get('DOMContentLoaded')!(new Event('DOMContentLoaded'));
    electron.send.mockImplementation(() => { expect(input.value).toBe(''); });
    const submit = new Event('submit', { cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(input.value).toBe('');
    input.value = 'test-only-second-password';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(electron.send).toHaveBeenCalledOnce();
    expect(electron.send).toHaveBeenCalledWith('lotw:password', 'test-only-password');
    electron.send.mockReset();
  } finally { vi.unstubAllGlobals(); }
});

it('aborting the password dialog destroys its window and removes its IPC receiver', async () => {
  const stop = new AbortController();
  const pending = lotwDialogs('/dist').password('test-only key', stop.signal);
  const window = electron.windows[0];
  stop.abort();
  expect(window.destroyed).toBe(true);
  expect(await pending).toBeUndefined();
  expect(electron.ipc.listenerCount('lotw:password')).toBe(0);
});

it('QGD-STN-0013: main Sync confirmation shows every status, field, difference and resulting name with correct defaults', async () => {
  const { tqslSyncDialog } = await import('../packages/main/tqsl-sync-dialog.js');
  const plan = { folder: '/test-only/tqsl', locations: [
    { name: 'Test new', resultName: 'Test new', place: { MY_GRIDSQUARE:'EM17' }, park:'NP01', reason:'', status:'new' as const, differences:[], offered:true, checked:true },
    { name: 'Test clash', resultName: 'Test clash (TQSL) 2', place:{MY_GRIDSQUARE:'EM18'}, park:'', reason:'', status:'differs' as const, differences:[{field:'MY_GRIDSQUARE',tqsl:'EM18',stored:'EM17'}], offered:true, checked:false },
    { name:'Test same',resultName:'Test same',place:{},park:'',reason:'',status:'same' as const,differences:[],offered:false,checked:false },
    { name:'Test refused <injected>',resultName:'Test refused',place:{},park:'',reason:'Correct the grid.',status:'refused' as const,differences:[],offered:false,checked:false }
  ] };
  const pending = tqslSyncDialog('/dist', plan);
  const window = electron.windows[0];
  const html = decodeURIComponent(window.loadURL.mock.calls[0][0].slice('data:text/html,'.length));
  for (const value of ['New','Differs','Same','Refused','Test clash (TQSL) 2','MY_GRIDSQUARE: EM17','LoTW park: NP01','TQSL EM18; your Location EM17','Correct the grid.','/test-only/tqsl']) expect(html).toContain(value);
  expect(html).toContain('value="0" checked'); expect(html).toContain('value="1">'); expect(html).not.toContain('value="2"'); expect(html).not.toContain('value="3"');
  expect(html).toContain('&lt;injected&gt;'); expect(html).not.toContain('<injected>');
  expect(electron.options[0].webPreferences).toMatchObject({ sandbox:true,contextIsolation:true,nodeIntegration:false,devTools:false,preload:join('/dist','preload','tqsl-sync.cjs') });
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  const style = /<style>(.*?)<\/style>/.exec(html)![1];
  expect(csp).toContain("script-src 'none'"); expect(csp).toContain(`style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'`);
  let done = false; void pending.then(() => { done = true; });
  electron.ipc.emit('tqsl:sync-answer',{sender:{},senderFrame:window.webContents.mainFrame},[0]);
  electron.ipc.emit('tqsl:sync-answer',{sender:window.webContents,senderFrame:{}},[0]);
  electron.ipc.emit('tqsl:sync-answer',{sender:window.webContents,senderFrame:window.webContents.mainFrame},[2]);
  await Promise.resolve(); expect(done).toBe(false);
  electron.ipc.emit('tqsl:sync-answer',{sender:window.webContents,senderFrame:window.webContents.mainFrame},[1]);
  expect(await pending).toEqual([1]); expect(window.destroyed).toBe(true); expect(electron.ipc.listenerCount('tqsl:sync-answer')).toBe(0);
});
it('Sync confirmation abort and close clean up the receiver; missing-file text names the folder', async () => {
  const { tqslSyncDialog } = await import('../packages/main/tqsl-sync-dialog.js');
  for (const how of ['abort','close']) {
    const controller = new AbortController();
    const pending = tqslSyncDialog('/dist',{folder:'/test-only/empty-tqsl',locations:[]},controller.signal);
    const window = electron.windows.at(-1);
    const html = decodeURIComponent(window.loadURL.mock.calls[0][0].slice('data:text/html,'.length));
    expect(html).toContain('TQSL has no station locations in this folder.'); expect(html).toContain('/test-only/empty-tqsl');
    if (how === 'abort') controller.abort(); else window.destroy();
    expect(await pending).toBeUndefined(); expect(electron.ipc.listenerCount('tqsl:sync-answer')).toBe(0); expect(window.destroyed).toBe(true);
  }
});
it('Sync preload sends only checked row indices once', async () => {
  const handlers = new Map<string, () => void>(); const form = new EventTarget(); const cancel = new EventTarget();
  const doc = { querySelector: () => form, getElementById: () => cancel, querySelectorAll: () => [{value:'0'},{value:'3'}] };
  const source = readFileSync('packages/preload/tqsl-sync.cts','utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(compiled,{window:{addEventListener:(name:string,handler:()=>void)=>handlers.set(name,handler)},document:doc,exports:{},require:()=>({ipcRenderer:{send:electron.send}})});
  handlers.get('DOMContentLoaded')!(); form.dispatchEvent(new Event('submit',{cancelable:true})); cancel.dispatchEvent(new Event('click'));
  expect(electron.send).toHaveBeenCalledOnce(); expect(electron.send).toHaveBeenCalledWith('tqsl:sync-answer',[0,3]);
});
