// SPDX-License-Identifier: GPL-3.0-only
// The extension host's notice, in words (QGD-APP-0022). The core sends what
// happened and the affected extensions' names (packages/main/home-notice.ts);
// this writes the sentence, so every affected extension is named however
// long their names are. Never a cause: they are affected, not blamed.
import type { HostNotice } from '../main/home-notice.js';

function list(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function utc(at: string | undefined): string {
  if (!at) return '';
  const time = new Date(at);
  return Number.isNaN(time.getTime())
    ? '' : ` at ${String(time.getUTCHours()).padStart(2, '0')}:${String(time.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function noticeText(notice: HostNotice): string {
  const affected = notice.affected.length ? ` It affected ${list(notice.affected)}.` : '';
  const when = utc(notice.at);
  if (notice.kind === 'not restarted') {
    return `The extension host stopped repeatedly${when} and was not restarted.${affected} Restart QSO Graph Desktop to try again.`;
  }
  if (notice.kind === 'restarting') return `The extension host stopped${when} and is being restarted.${affected}`;
  return `The extension host stopped${when} and was restarted.${affected}`;
}
