// SPDX-License-Identifier: GPL-3.0-only
import { contextBridge, ipcRenderer } from 'electron';
// QGD-SEC-0007: named functions only. Never ipcRenderer, never a generic send,
// never anything that forwards a channel the caller chooses.
// The platform, so the screens name the credential store the operator has
// (packages/personas/credential-store.ts). A fixed string, not a capability.
contextBridge.exposeInMainWorld('personas', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('persona:request', command),
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
// QGD-APP-0002: one path, and this is it. The application names itself and
// passes a command; the core decides (see extension-broker.ts on why that claim is
// taken at its word until each application has its own process).
contextBridge.exposeInMainWorld('extensions', Object.freeze({
  request: (app: unknown, command: unknown) => ipcRenderer.invoke('extension:request', app, command),
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
