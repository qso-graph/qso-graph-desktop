// SPDX-License-Identifier: GPL-3.0-only
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('personas', Object.freeze({
  request: (command: unknown) => ipcRenderer.invoke('persona:request', command)
}));
