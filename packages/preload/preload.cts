// SPDX-License-Identifier: GPL-3.0-only
import { contextBridge, ipcRenderer } from 'electron';
// QGD-SEC-0007: named functions only. Never ipcRenderer, never a generic send,
// never anything that forwards a channel the caller chooses.
// The platform, so the screens name the credential store the operator has
// (packages/personas/credential-store.ts). A fixed string, not a capability.
contextBridge.exposeInMainWorld('callsigns', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('callsigns:request', command),
  platform: process.platform
}));
contextBridge.exposeInMainWorld('settings', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('settings:request', command)
}));
// Storage's status: asked for once, then pushed when it changes (QGD-ENG-0006).
// onStatus hands back the function that removes the listener, so a screen
// that stops listening leaves nothing behind. The listener receives the
// status only, never the event, which would carry the sender.
contextBridge.exposeInMainWorld('storage', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('storage:request', command),
  onStatus: (listener: (status: unknown) => void) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = (_event: unknown, status: unknown) => listener(status);
    ipcRenderer.on('storage:status', handler);
    return () => { ipcRenderer.removeListener('storage:status', handler); };
  }
}));
// Home (QGD-HOM-*): the state, whether Home is showing, and the pins. Each
// card's data is pushed; onCard hands back the function that stops listening,
// and the listener receives the card only, never the event.
contextBridge.exposeInMainWorld('home', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('home:request', command),
  onCard: (listener: (card: unknown) => void) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = (_event: unknown, card: unknown) => listener(card);
    ipcRenderer.on('home:card', handler);
    return () => { ipcRenderer.removeListener('home:card', handler); };
  },
  // The extension host's notice (QGD-APP-0022), checked by the window.
  onNotice: (listener: (notice: unknown) => void) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = (_event: unknown, notice: unknown) => listener(notice);
    ipcRenderer.on('home:notice', handler);
    return () => { ipcRenderer.removeListener('home:notice', handler); };
  }
}));
// The Help menu's Troubleshooting (KI7MT, 2026-10-22): main says it was
// chosen and the window opens the panel. No payload: the signal is all.
contextBridge.exposeInMainWorld('menu', Object.freeze({
  onTroubleshooting: (listener: () => void) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = () => listener();
    ipcRenderer.on('menu:troubleshooting', handler);
    return () => { ipcRenderer.removeListener('menu:troubleshooting', handler); };
  }
}));
// A page in the operator's browser (QGD-SEC-0009): a name, or a park or summit
// reference. The URL is built by main from its register, never here.
contextBridge.exposeInMainWorld('links', Object.freeze({
  open: (command: unknown) => ipcRenderer.invoke('links:open', command)
}));
// The extension inventory, for Settings (QGD-APP-0012). There is no way for
// the window to make an extension request: extension code runs only in the
// extension host (QGD-APP-0015), on channels the broker binds (QGD-APP-0018).
contextBridge.exposeInMainWorld('extensions', Object.freeze({
  // For Settings, not for an application: what loaded and what each holds
  // (QGD-APP-0012).
  inventory: (command: unknown) => ipcRenderer.invoke('extensions:inventory', command)
}));
contextBridge.exposeInMainWorld('logs', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('logs:request', command)
}));
// The operating system's appearance, which the main process is the authority on
// (see src/system-appearance.ts for why the renderer's media query is not).
// The listener is handed a boolean and never the Electron event.
contextBridge.exposeInMainWorld('appearance', Object.freeze({
  prefersDark: () => ipcRenderer.invoke('system:prefers-dark'),
  onChange: (listener: (prefersDark: boolean) => void) => {
    const forward = (_event: unknown, prefersDark: unknown) => listener(prefersDark === true);
    ipcRenderer.on('system:appearance-changed', forward);
    return () => { ipcRenderer.removeListener('system:appearance-changed', forward); };
  }
}));
