// SPDX-License-Identifier: GPL-3.0-or-later
import type { LotwCertificate, LotwTrustedRoot } from '../../../packages/extension-api/api-contract.js';
import { PAGE_DATA_VERSION, PAGE_LIMITS, type PageAnswer, type Row, type Section } from '../../../packages/extension-api/pages.js';

function tables(columns: readonly string[], rows: readonly Row[], empty: string): PageAnswer {
  if (rows.length > PAGE_LIMITS.rows * PAGE_LIMITS.sections) return { ok: false, reason: 'This store has more entries than one page can display.' };
  const sections: Section[] = [];
  if (rows.length === 0) sections.push({ shape: 'text', text: empty });
  for (let at = 0; at < rows.length; at += PAGE_LIMITS.rows) {
    sections.push({ shape: 'table', columns, rows: rows.slice(at, at + PAGE_LIMITS.rows), sortable: true });
  }
  return { ok: true, data: { version: PAGE_DATA_VERSION, observedAt: new Date().toISOString(), sections } };
}
export function certificatesPage(certificates: readonly LotwCertificate[]): PageAnswer {
  return tables(['Call', 'DXCC', 'Serial', 'QSO dates first–last', 'Valid from–to', 'Key'], certificates.map(c => ({
    key: c.id,
    cells: [c.call, c.dxccName ? `${c.dxcc} · ${c.dxccName}` : String(c.dxcc), c.serial,
      `${c.qsoFirst} – ${c.qsoLast}`, `${c.validFrom} – ${c.validTo}`, c.hasKey ? 'Key: installed' : 'Key: not installed']
  })), 'No LoTW certificates are installed. Choose Load certificate… for a .tq6 or .p12 file, or Restore TQSL backup… for a .tbk file.');
}
export function rootsPage(roots: readonly LotwTrustedRoot[]): PageAnswer {
  return tables(['Kind', 'Subject', 'Serial', 'Valid from–to', 'Fingerprint', 'Source', 'Accepted'], roots.map(r => [
    r.kind === 'root' ? 'Root' : 'Certificate authority', r.subject, r.serial, `${r.validFrom} – ${r.validTo}`, r.fingerprint, r.source, r.acceptedAt ?? 'Built in'
  ]), 'No trusted roots are installed. Load a certificate file or restore a TQSL backup to add trusted roots.');
}
