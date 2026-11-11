// SPDX-License-Identifier: GPL-3.0-or-later
import { ipcRenderer } from 'electron';
window.addEventListener('DOMContentLoaded', () => {
  let sent = false;
  const send = (answer: number[] | null) => { if (!sent) { sent = true; ipcRenderer.send('tqsl:sync-answer', answer); } };
  document.querySelector('form')?.addEventListener('submit', event => {
    event.preventDefault();
    send(Array.from(document.querySelectorAll<HTMLInputElement>('input[name="location"]:checked')).map(input => Number(input.value)));
  });
  document.getElementById('cancel')?.addEventListener('click', () => send(null));
});
