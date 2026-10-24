// SPDX-License-Identifier: GPL-3.0-only
// What's new (QGD-FRM-0016, KI7MT 2026-10-24): the notes are CHANGELOG.md,
// which ships with the application, read here into plain blocks the window
// draws as text. No HTML is made from it anywhere, so nothing in a note can
// become markup. Pure, so it runs under unit tests.
export const WHATS_NEW_CHANNEL = 'whatsnew:request';

// A note's text in runs: plain, **bold** or `code`, which is all the
// changelog uses.
export interface Run { text: string; bold?: true; code?: true }
export type Block =
  | { kind: 'heading'; runs: Run[] }
  | { kind: 'item'; runs: Run[] }
  | { kind: 'paragraph'; runs: Run[] };
export interface NotesSection { version: string; date: string; blocks: Block[] }
export interface WhatsNewNotes { version: string; sections: NotesSection[] }

const RELEASE = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;
// The release a version belongs to: 0.2.0 for 0.2.0, and for a preview,
// 0.2.0-202610240100-abc, the release it is heading for.
export function releaseOf(version: string): string | undefined {
  const head = version.split('-')[0];
  return RELEASE.test(head) ? head : undefined;
}
export function isPreview(version: string): boolean {
  return version.includes('-');
}
function compare(a: string, b: string): number {
  const [x, y] = [a, b].map(v => v.split('.').map(Number));
  for (let at = 0; at < 3; at++) if (x[at] !== y[at]) return x[at] - y[at];
  return 0;
}

export function runs(text: string): Run[] {
  const out: Run[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    out.push(match[1] !== undefined ? { text: match[1], bold: true } : { text: match[2], code: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  // Links are written [text](url); the text is kept and the address dropped,
  // because nothing in the notes opens a page.
  return out.map(run => ({ ...run, text: run.text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') }));
}

// `## [0.1.0] - 2026-10-30` or `## [Unreleased]`, read without a regular
// expression that could backtrack.
function versionHeading(line: string): { version: string; date: string } | undefined {
  if (!line.startsWith('## [')) return undefined;
  const close = line.indexOf(']');
  if (close < 5) return undefined;
  const version = line.slice(4, close);
  const rest = line.slice(close + 1).trim();
  if (rest === '') return { version, date: '' };
  const date = rest.startsWith('- ') ? rest.slice(2) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { version, date } : undefined;
}

// Each `## [version] - date` (or `## [Unreleased]`) and what is under it.
// Lines continuing a list item or paragraph are joined to it.
export function parseChangelog(markdown: string): NotesSection[] {
  const sections: NotesSection[] = [];
  let section: NotesSection | undefined;
  let open: { kind: 'item' | 'paragraph'; text: string } | undefined;
  const flush = (): void => {
    if (open && section) section.blocks.push({ kind: open.kind, runs: runs(open.text.trim()) });
    open = undefined;
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    const heading = versionHeading(line);
    if (heading) {
      flush();
      section = { version: heading.version, date: heading.date, blocks: [] };
      sections.push(section);
      continue;
    }
    if (!section) continue;
    if (/^#{1,2} /.test(line)) { flush(); section = undefined; continue; }
    const sub = /^#{3,6} (.+)$/.exec(line);
    if (sub) { flush(); section.blocks.push({ kind: 'heading', runs: runs(sub[1]) }); continue; }
    const item = /^\s*[-*] (.+)$/.exec(line);
    if (item) { flush(); open = { kind: 'item', text: item[1] }; continue; }
    if (line.trim() === '') { flush(); continue; }
    if (open) open.text += ` ${line.trim()}`;
    else open = { kind: 'paragraph', text: line.trim() };
  }
  flush();
  return sections.filter(entry => entry.blocks.length > 0);
}

// The notes for this version, since the one last seen. A preview's notes are
// what develop has gathered, [Unreleased]; a release's are its own section
// and any between it and the last one seen, newest first.
export function notesFor(sections: NotesSection[], version: string, since: string | null): WhatsNewNotes {
  const release = releaseOf(version);
  if (isPreview(version) || !release) {
    return { version, sections: sections.filter(entry => entry.version === 'Unreleased') };
  }
  const from = since ? releaseOf(since) : undefined;
  // A preview comes before its release, so the release it was a preview of
  // is still new (#57, found by Turing: 0.1.1 after its preview showed
  // Unreleased).
  const after = since !== null && isPreview(since) ? 0 : 1;
  const chosen = sections.filter(entry => RELEASE.test(entry.version)
    && compare(entry.version, release) <= 0
    && (from ? compare(entry.version, from) >= after : entry.version === release));
  // A version the changelog has no section for yet is develop's, built
  // before its release: what develop has gathered.
  return { version, sections: chosen.length ? chosen : sections.filter(entry => entry.version === 'Unreleased') };
}

// Who may ask, and what: the version last seen, or none for this release's.
export function validateWhatsNewCommand(value: unknown): value is { type: 'notes'; since: string | null } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && record.type === 'notes'
    && (record.since === null || (typeof record.since === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(record.since)));
}

export function isWhatsNewNotes(value: unknown): value is WhatsNewNotes {
  if (typeof value !== 'object' || value === null) return false;
  const notes = value as Record<string, unknown>;
  return typeof notes.version === 'string' && Array.isArray(notes.sections);
}
