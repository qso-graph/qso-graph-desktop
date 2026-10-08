// SPDX-License-Identifier: GPL-3.0-only
import { contextBridge, ipcRenderer } from 'electron';
// QGD-SEC-0007: named functions only. Never ipcRenderer, never a generic send,
// never anything that forwards a channel the caller chooses.
contextBridge.exposeInMainWorld('personas', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('persona:request', command)
}));
contextBridge.exposeInMainWorld('settings', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('settings:request', command)
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
