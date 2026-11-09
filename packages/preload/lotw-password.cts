// SPDX-License-Identifier: GPL-3.0-or-later
// A single password, from this main-owned window, sent once and cleared immediately.
import { ipcRenderer } from 'electron';
window.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('password') as HTMLInputElement;
  const send = (value: string | null) => { input.value = ''; ipcRenderer.send('lotw:password', value); };
  document.querySelector('form')?.addEventListener('submit', event => { event.preventDefault(); send(input.value); }, { once: true });
  document.getElementById('cancel')?.addEventListener('click', () => send(null), { once: true });
});
