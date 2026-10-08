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
