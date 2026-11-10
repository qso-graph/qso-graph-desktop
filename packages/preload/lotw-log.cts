// SPDX-License-Identifier: GPL-3.0-or-later
import { ipcRenderer } from 'electron';
window.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form')!;
  const sign = document.getElementById('sign') as HTMLButtonElement;
  const status = document.getElementById('preview')!;
  const choice = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  let revision = 0;
  let ready = true;
  const refresh = async () => {
    ready = false; sign.disabled = true;
    const current = ++revision;
    const answer: unknown = await ipcRenderer.invoke('lotw:log-preview', { call: choice('call'), location: choice('location'), certificate: choice('certificate'), from: choice('from'), to: choice('to'), signAgain: (document.getElementById('again') as HTMLInputElement).checked });
    if (current !== revision) return;
    if (typeof answer !== 'object' || !answer) { status.textContent = 'Check your Location and dates, then change the selection to update the preview.'; return; }
    const value = answer as { text: string; certificates: { id: string; label: string }[]; selected: string; ready: boolean };
    status.textContent = value.text;
    const certificates = document.getElementById('certificate') as HTMLSelectElement;
    certificates.replaceChildren();
    for (const c of value.certificates) { const option = document.createElement('option'); option.value=c.id; option.textContent=c.label; certificates.append(option); }
    certificates.value=value.selected; certificates.disabled=value.certificates.length<=1;
    ready = value.ready; sign.disabled=!ready;
  };
  form.addEventListener('change', () => { void refresh().catch(() => { ready=false; sign.disabled=true; status.textContent='The preview could not be read. Cancel and inspect the log again.'; }); });
  form.addEventListener('submit', event => { event.preventDefault(); if (ready) { sign.disabled=true; ipcRenderer.send('lotw:log-answer',true); } });
  document.getElementById('cancel')?.addEventListener('click', () => ipcRenderer.send('lotw:log-answer',false));
});
