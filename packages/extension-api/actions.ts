// SPDX-License-Identifier: GPL-3.0-or-later
// Declarative buttons and the operator's press (QGD-HOM-0018–0020).
import { hasControlCharacters } from './text.js';
import type { PageAnswer, Row } from './pages.js';

export interface PageAction { readonly id: string; readonly label: string; readonly hint?: string }
export interface PageActionEvent { readonly page: string; readonly action: string; readonly row?: string }
export interface PageActions { readonly actions?: readonly PageAction[]; readonly rowActions?: readonly PageAction[] }
export type PageActionAnswer = { readonly ok: true; readonly status?: string } | { readonly ok: false; readonly error: string };
export const MAX_ACTIONS = 4;
export const MAX_ROW_ACTIONS = 2;
export const ROW_KEY_MAX = 160;
export const ACTION_STATUS_MAX = 240;
const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function actionText(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || /[<>]/.test(value)) return false;
  if (hasControlCharacters(value)) return false;
  return true;
}
export function isPageAction(value: unknown): value is PageAction {
  return record(value) && Object.keys(value).every(key => ['id', 'label', 'hint'].includes(key))
    && typeof value.id === 'string' && SLUG.test(value.id) && actionText(value.label, 32)
    && (value.hint === undefined || actionText(value.hint, 80));
}
export function isPageActionEvent(value: unknown): value is PageActionEvent {
  return record(value) && Object.keys(value).length === (Object.hasOwn(value, 'row') ? 3 : 2)
    && Object.keys(value).every(key => ['page', 'action', 'row'].includes(key))
    && typeof value.page === 'string' && SLUG.test(value.page) && typeof value.action === 'string' && SLUG.test(value.action)
    && (!Object.hasOwn(value, 'row') || actionText(value.row, ROW_KEY_MAX));
}
export function isPageActionAnswer(value: unknown): value is PageActionAnswer {
  if (!record(value)) return false;
  if (value.ok === false) return Object.keys(value).sort().join(',') === 'error,ok' && actionText(value.error, ACTION_STATUS_MAX);
  return value.ok === true && (Object.keys(value).sort().join(',') === 'ok'
    || (Object.keys(value).sort().join(',') === 'ok,status' && actionText(value.status, ACTION_STATUS_MAX)));
}
export function rowKey(row: Row): string | undefined { return 'cells' in row ? row.key : undefined; }
export function pageRowKeys(answer: PageAnswer | undefined): Set<string> {
  const keys = new Set<string>();
  if (answer?.ok) for (const section of answer.data.sections) {
    if (section.shape !== 'table') continue;
    const rows = 'rows' in section ? section.rows : section.groups.flatMap(group => group.rows);
    for (const row of rows) { const key = rowKey(row); if (key !== undefined) keys.add(key); }
  }
  return keys;
}
// The manifest decides the kind of press; only keys in the current answer
// can go back. Called in main and independently in the extension host.
export function permitsPageAction(page: PageActions, event: PageActionEvent, answer: PageAnswer | undefined): boolean {
  return event.row === undefined ? (page.actions ?? []).some(action => action.id === event.action)
    : (page.rowActions ?? []).some(action => action.id === event.action) && pageRowKeys(answer).has(event.row);
}
