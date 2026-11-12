// SPDX-License-Identifier: GPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { createWindowLifecycle } from '../packages/main/window-lifecycle.js';
import { createShellStore } from '../packages/renderer/shell-store.js';

const electron = vi.hoisted(() => ({ ipcMain: undefined as unknown as EventEmitter }));
vi.mock('electron', async () => { const { EventEmitter } = await import('node:events'); electron.ipcMain = new EventEmitter(); return { ipcMain: electron.ipcMain }; });
import { startWindowCloseBroker } from '../packages/main/window-close-broker.js';

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const event = () => ({ preventDefault: vi.fn() });
function fixture() {
  const shell = createShellStore(); shell.set({ page: 'stations' });
  let dirty = true; const save = vi.fn(async () => false);
  shell.registerWork('stations', { isDirty: () => dirty, save, discard: () => { dirty = false; } });
  const window = { id: 1, close: vi.fn(), setEnabled: vi.fn(), isDestroyed: () => false };
  const stop = vi.fn(async () => {}), quit = vi.fn();
  const ask = vi.fn(() => shell.mayCloseWindow());
  const deps = { windows: () => [window], ask, stop, quit };
  return { shell, save, window, deps, lifecycle: createWindowLifecycle(deps), clean: () => { dirty = false; } };
}

describe('P14-window-exit (QGD-FRM-0025, QGD-FRM-0030)', () => {
  it('holds native close for the draft question, keeps Cancel, and shares repeated requests', async () => {
    const f = fixture(), first = event(); f.lifecycle.close(first, f.window);
    expect(first.preventDefault).toHaveBeenCalledOnce(); expect(f.shell.get().closeQuestion).toEqual(['Locations']);
    f.lifecycle.close(event(), f.window); expect(f.deps.ask).toHaveBeenCalledOnce();
    f.shell.answerClose('cancel'); await flush(); expect(f.window.close).not.toHaveBeenCalled(); expect(f.deps.stop).not.toHaveBeenCalled();
    f.lifecycle.close(event(), f.window); f.shell.answerClose('discard'); await flush();
    expect(f.window.close).toHaveBeenCalledOnce();
    const approved = event(); f.lifecycle.close(approved, f.window); expect(approved.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps an unsuccessful Save open, waits for confirmed Save, then permits one close', async () => {
    const f = fixture(); f.lifecycle.close(event(), f.window); f.shell.answerClose('save'); await flush();
    expect(f.save).toHaveBeenCalledOnce(); expect(f.window.close).not.toHaveBeenCalled();
    let finish!: () => void;
    f.save.mockImplementationOnce(() => new Promise(resolve => { finish = () => { f.clean(); resolve(true); }; }));
    f.lifecycle.close(event(), f.window); f.shell.answerClose('save'); await flush(); expect(f.window.close).not.toHaveBeenCalled();
    finish(); await flush(); expect(f.window.close).toHaveBeenCalledOnce();
  });

  it('guards explicit quit too; Cancel and failed saves stop all shutdown', async () => {
    const f = fixture(), first = event(); f.lifecycle.quit(first); expect(first.preventDefault).toHaveBeenCalledOnce();
    f.lifecycle.quit(event()); expect(f.deps.ask).toHaveBeenCalledOnce();
    f.shell.answerClose('cancel'); await flush(); expect(f.deps.stop).not.toHaveBeenCalled(); expect(f.deps.quit).not.toHaveBeenCalled(); expect(f.window.setEnabled).not.toHaveBeenCalled();
    f.lifecycle.quit(event()); f.shell.answerClose('save'); await flush(); expect(f.deps.stop).not.toHaveBeenCalled();
    f.lifecycle.quit(event()); f.shell.answerClose('discard'); await flush();
    expect(f.deps.stop).toHaveBeenCalledOnce(); expect(f.deps.quit).toHaveBeenCalledOnce();
    const approved = event(); f.lifecycle.quit(approved); expect(approved.preventDefault).not.toHaveBeenCalled();
    const closing = event(); f.lifecycle.close(closing, f.window); expect(closing.preventDefault).not.toHaveBeenCalled();
  });

  it('waits for port/store shutdown before the final quit and never restarts shutdown', async () => {
    const f = fixture(); f.clean(); let finish!: () => void;
    f.deps.stop.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.lifecycle.quit(event()); await flush(); expect(f.deps.stop).toHaveBeenCalledOnce(); expect(f.deps.quit).not.toHaveBeenCalled(); expect(f.window.setEnabled).toHaveBeenCalledWith(false);
    f.lifecycle.quit(event()); f.lifecycle.close(event(), f.window); await flush(); expect(f.deps.stop).toHaveBeenCalledOnce();
    finish(); await flush(); expect(f.deps.quit).toHaveBeenCalledOnce();
  });

  it('still exits after approved shutdown if a broker fails, retaining recovery for next start', async () => {
    const f = fixture(); f.clean(); f.deps.stop.mockRejectedValueOnce(new Error('shutdown failed'));
    f.lifecycle.quit(event()); await flush(); expect(f.deps.quit).toHaveBeenCalledOnce();
  });

  it('shares a pending native-close question with quit, without closing a window after quit is cancelled', async () => {
    const f = fixture(); f.lifecycle.close(event(), f.window); f.lifecycle.quit(event());
    expect(f.deps.ask).toHaveBeenCalledOnce(); f.shell.answerClose('cancel'); await flush();
    expect(f.window.close).not.toHaveBeenCalled(); expect(f.deps.stop).not.toHaveBeenCalled();
  });

  it('treats unknown or rejected confirmations as refusal', async () => {
    const f = fixture(); f.deps.ask.mockRejectedValueOnce(new Error('renderer gone'));
    f.lifecycle.close(event(), f.window); await flush(); expect(f.window.close).not.toHaveBeenCalled();
  });

  it.each(['darwin', 'win32', 'linux'])('quits after the last window closes on %s', platform => {
    // This module has no platform branch; run the actual main listener too.
    const quit = vi.fn();
    const main = readFileSync('packages/main/main.ts', 'utf8');
    const callback = main.slice(main.lastIndexOf("app.on('window-all-closed'"));
    const lifecycle = createWindowLifecycle({ windows: () => [], ask: async () => true, stop: async () => {}, quit });
    runInNewContext(callback, { app: { on: (_name: string, cb: () => void) => cb(), quit }, lifecycle, process: { platform } });
    expect(quit).toHaveBeenCalledOnce();
  });
});

describe('checked window close IPC and production wiring', () => {
  function bridge() {
    const exposed: Record<string, any> = {};
    const ipc = Object.assign(new EventEmitter(), { send: vi.fn(), isLoadingMainFrame: () => false });
    const source = readFileSync('packages/preload/preload.cts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { exports: {}, require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (key: string, value: unknown) => { exposed[key] = value; } } }), process: { platform: 'darwin' } });
    return { exposed, ipc };
  }
  it('preload forwards a checked request, a boolean answer, and removes its listener', async () => {
    const { exposed, ipc } = bridge(), listener = vi.fn(async () => true);
    const unsubscribe = exposed.windowClose.onRequest(listener);
    for (const invalid of [null, {}, '../anything', 'close']) ipc.emit('window:may-close', {}, invalid);
    await flush(); expect(listener).not.toHaveBeenCalled();
    const token = '00000000-0000-4000-8000-000000000001';
    ipc.emit('window:may-close', {}, token); await flush(); expect(ipc.send).toHaveBeenLastCalledWith('window:close-answer', token, true);
    listener.mockResolvedValueOnce('yes' as any); ipc.emit('window:may-close', {}, token); await flush();
    expect(ipc.send).toHaveBeenLastCalledWith('window:close-answer', token, false);
    listener.mockRejectedValueOnce(new Error('unknown')); ipc.emit('window:may-close', {}, token); await flush();
    expect(ipc.send).toHaveBeenLastCalledWith('window:close-answer', token, false);
    unsubscribe(); expect(ipc.listenerCount('window:may-close')).toBe(0);
  });

  it('main rejects malformed, wrong-frame, wrong-window and stale answers', async () => {
    electron.ipcMain.removeAllListeners(); const ask = startWindowCloseBroker();
    const mainFrame = { url: 'qg://desktop/index.html' };
    const contents = Object.assign(new EventEmitter(), { mainFrame, send: vi.fn(), isLoadingMainFrame: () => false });
    const window = { webContents: contents } as any;
    let result: boolean | undefined; const answer = ask(window).then(value => { result = value; });
    const token = contents.send.mock.calls[0][1]; const valid = { sender: contents, senderFrame: mainFrame };
    for (const [e, args] of [[valid, [token, 'yes']], [valid, [token, true, 'extra']],
      [{ ...valid, senderFrame: { url: mainFrame.url } }, [token, true]],
      [{ sender: { mainFrame }, senderFrame: mainFrame }, [token, true]], [valid, ['stale', true]]
    ] as const) electron.ipcMain.emit('window:close-answer', e, ...args);
    await flush(); expect(result).toBeUndefined();
    electron.ipcMain.emit('window:close-answer', valid, token, false); await answer;
    expect(result).toBe(false); expect(contents.listenerCount('destroyed')).toBe(0);
    const next = ask(window); const newToken = contents.send.mock.calls.at(-1)![1];
    electron.ipcMain.emit('window:close-answer', valid, newToken, true); expect(await next).toBe(true);
  });

  it('waits for a loading shell to install its close listener before sending the question', async () => {
    electron.ipcMain.removeAllListeners(); const ask = startWindowCloseBroker();
    const mainFrame = { url: 'qg://desktop/index.html' };
    const contents = Object.assign(new EventEmitter(), { mainFrame, send: vi.fn(), isLoadingMainFrame: () => true });
    const answer = ask({ webContents: contents } as any); expect(contents.send).not.toHaveBeenCalled();
    contents.emit('did-finish-load'); const token = contents.send.mock.calls[0][1];
    electron.ipcMain.emit('window:close-answer', { sender: contents, senderFrame: mainFrame }, token, true);
    expect(await answer).toBe(true); expect(contents.listenerCount('did-finish-load')).toBe(0);
  });

  it.each(['destroyed', 'render-process-gone', 'did-start-navigation', 'did-fail-load'])('refuses close if the renderer %s while answering', async reason => {
    electron.ipcMain.removeAllListeners(); const ask = startWindowCloseBroker();
    const contents = Object.assign(new EventEmitter(), { send: vi.fn(), isLoadingMainFrame: () => false });
    const answer = ask({ webContents: contents } as any); contents.emit(reason);
    expect(await answer).toBe(false);
  });

  it('the real main close/quit handlers and renderer registration use the guarded lifecycle', () => {
    const main = readFileSync('packages/main/main.ts', 'utf8');
    const close = main.match(/window\.on\('close', event => \{([\s\S]*?)\n  \}\);/)![1];
    const lifecycle = { close: vi.fn((event: { defaultPrevented: boolean }) => { event.defaultPrevented = true; }) };
    const save = vi.fn(); const e = { defaultPrevented: false };
    runInNewContext('(() => {' + close + '})()', { event: e, window: {}, lifecycle, save }); expect(lifecycle.close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
    const renderer = readFileSync('packages/renderer/app.ts', 'utf8'); const registered = vi.fn(), mayClose = vi.fn();
    const wiring = renderer.match(/export const mayCloseWindow = .*;\n.*onRequest\(mayCloseWindow\);/)![0];
    runInNewContext(wiring.replace('export ', ''), { shell: { mayCloseWindow: mayClose }, window: { windowClose: { onRequest: registered } } });
    registered.mock.calls[0][0](); expect(mayClose).toHaveBeenCalledOnce();
    expect(main).toContain("app.on('before-quit', event => lifecycle?.quit(event))");
    expect(main.indexOf('startProcessRun(true')).toBeLessThan(main.indexOf('startCallsignBroker(\n'));
    expect(main.indexOf('processRun?.stop()')).toBeLessThan(main.indexOf('processRun?.endChildren()'));
    // The installer is detached and only starts in will-quit, after shutdown.
    expect(main).toContain("app.on('will-quit', () => updater.applyOnQuit())");
    expect(readFileSync('packages/main/updater.ts', 'utf8')).toContain('detached: true');
    // No broker may abort work on the first, still-cancellable quit signal.
    expect(readFileSync('packages/main/tqsl-sync-broker.ts', 'utf8')).not.toContain("app.once('before-quit'");
  });
});
