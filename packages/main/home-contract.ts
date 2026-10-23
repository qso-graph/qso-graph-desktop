// SPDX-License-Identifier: GPL-3.0-only
// What the window may ask about Home, and what it is told (QGD-HOM-0001 to
// QGD-HOM-0006). Checked on both sides, refused rather than coerced
// (QGD-SEC-0006).
//
// The window asks for the state, says which extension page is open, and sets
// the pins. Home itself shows tiles drawn from the manifests and fetches
// nothing (KI7MT, 2026-10-22); the open page's data arrives unasked, pushed as
// the broker gets it, so the window never polls.
import { INPUT_KINDS, MAX_INPUTS, TEXT_MAX, type PageInput } from '../extension-api/inputs.js';
import { validatePageAnswer, type PageAnswer } from '../extension-api/pages.js';
import { isPins } from './settings-contract.js';

export const HOME_CHANNEL = 'home:request';
export const HOME_CARD_CHANNEL = 'home:page';
// The extension host's notice, pushed when it changes (QGD-APP-0022).
export const HOME_NOTICE_CHANNEL = 'home:notice';

// Which extensions a stopped extension host affected, until the operator
// dismisses it (home-notice.ts); the window words it (renderer/host-notice.ts).
import type { HostNotice } from './home-notice.js';
export type { HostNotice } from './home-notice.js';

// A page some extension offers: what its tile, its rail item and "Customize
// your pins" are drawn from. Nothing here is fetched; it is the manifest's.
export interface AvailablePage {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly extensionName: string;
  // A key in the core's icon set, or 'extension'.
  readonly icon: string;
  // Whether it also has an item in the rail.
  readonly rail: boolean;
  // The fields the page asks for, which the window draws (inputs.ts).
  readonly inputs: readonly PageInput[];
}

export type PageView =
  | { readonly key: string; readonly state: 'waiting' }
  | { readonly key: string; readonly state: 'ready'; readonly answer: PageAnswer; readonly fetchedAt: string }
  | { readonly key: string; readonly state: 'failed'; readonly reason: string };

export interface HomeState {
  readonly available: readonly AvailablePage[];
  readonly pins: readonly string[];
  // What the open page last said, if a page is open: at most one.
  readonly pages: readonly PageView[];
  readonly notice: HostNotice | null;
}

export type HomeCommand =
  | { readonly type: 'read' }
  // The extension page now on screen, or null when none is, and what is in
  // its fields: checked by kind against the page's own fields by the broker.
  | { readonly type: 'open'; readonly key: string | null; readonly inputs?: Readonly<Record<string, string>> }
  | { readonly type: 'pin'; readonly pins: readonly string[] }
  | { readonly type: 'dismiss'; readonly id: number }
  // Ask the open page again now (Refresh): the broker asks only for the page
  // that is open, and the scheduler only when nothing is in flight.
  | { readonly type: 'refresh'; readonly key: string };

export type HomeReply = { readonly ok: true; readonly state: HomeState } | { readonly ok: false; readonly error: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const exactly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

const KEY = /^[a-z][a-z0-9-]{1,30}\/[a-z][a-z0-9-]{1,30}$/;
const plainText = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[<>]/.test(value);

export function validateHomeCommand(value: unknown): value is HomeCommand {
  if (!record(value)) return false;
  if (value.type === 'read') return exactly(value, ['type']);
  if (value.type === 'open') {
    const shape = exactly(value, ['type', 'key']) || exactly(value, ['type', 'key', 'inputs']);
    const key = value.key === null || (typeof value.key === 'string' && KEY.test(value.key));
    // The shape only: at most four plain strings. Which ids, and whether each
    // value is one its kind takes, is the broker's to check against the page.
    const inputs = value.inputs === undefined || (record(value.inputs) && Object.keys(value.inputs).length <= MAX_INPUTS
      && Object.entries(value.inputs).every(([id, entry]) => /^[a-z][a-z0-9-]{1,30}$/.test(id) && typeof entry === 'string' && entry.length <= TEXT_MAX));
    return shape && key && inputs;
  }
  if (value.type === 'pin') return exactly(value, ['type', 'pins']) && isPins(value.pins);
  if (value.type === 'refresh') return exactly(value, ['type', 'key']) && typeof value.key === 'string' && KEY.test(value.key);
  if (value.type === 'dismiss') return exactly(value, ['type', 'id']) && Number.isSafeInteger(value.id) && (value.id as number) > 0;
  return false;
}

// Each name bounded as a manifest name is (64, no markup), and as many as
// there can be extensions: so a notice the core makes always passes here.
export function isHostNotice(value: unknown): value is HostNotice | null {
  if (value === null) return true;
  if (!record(value)) return false;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'affected,id,kind' && keys !== 'affected,at,id,kind') return false;
  return Number.isSafeInteger(value.id) && (value.id as number) > 0
    && (value.kind === 'restarting' || value.kind === 'restarted' || value.kind === 'not restarted')
    && (value.at === undefined || (typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at))))
    && Array.isArray(value.affected) && value.affected.length <= 64 && everyIndex(value.affected, name => plainText(name, 64));
}

export function isPageView(value: unknown): value is PageView {
  if (!record(value) || typeof value.key !== 'string' || !KEY.test(value.key)) return false;
  if (value.state === 'waiting') return exactly(value, ['key', 'state']);
  if (value.state === 'failed') return exactly(value, ['key', 'state', 'reason']) && plainText(value.reason, 160);
  if (value.state === 'ready') {
    if (!exactly(value, ['key', 'state', 'answer', 'fetchedAt']) || typeof value.fetchedAt !== 'string' || Number.isNaN(Date.parse(value.fetchedAt))) return false;
    try { validatePageAnswer(value.answer); return true; } catch { return false; }
  }
  return false;
}

function isInput(value: unknown): boolean {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'id,kind,label' && keys !== 'id,kind,label,max') return false;
  return typeof value.id === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(value.id) && plainText(value.label, 32)
    && (INPUT_KINDS as readonly unknown[]).includes(value.kind)
    && (value.max === undefined || (Number.isInteger(value.max) && (value.max as number) >= 1 && (value.max as number) <= TEXT_MAX));
}

function isAvailable(value: unknown): value is AvailablePage {
  return record(value) && exactly(value, ['key', 'name', 'description', 'extensionName', 'icon', 'rail', 'inputs'])
    && typeof value.key === 'string' && KEY.test(value.key)
    && plainText(value.name, 40) && plainText(value.description, 120) && plainText(value.extensionName, 64)
    && typeof value.icon === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(value.icon) && typeof value.rail === 'boolean'
    && everyIndex(value.inputs, isInput) && (value.inputs as unknown[]).length <= MAX_INPUTS;
}

// Every index, holes included: every() skips a hole, so a list with gaps in it
// would pass with nothing in the gaps checked (QGD-SEC-0006).
function everyIndex(list: unknown, check: (value: unknown) => boolean): boolean {
  if (!Array.isArray(list)) return false;
  for (let at = 0; at < list.length; at++) {
    if (!Object.hasOwn(list, at) || !check(list[at])) return false;
  }
  return true;
}

export function isHomeReply(value: unknown): value is HomeReply {
  if (!record(value)) return false;
  if (value.ok === false) return exactly(value, ['ok', 'error']) && typeof value.error === 'string';
  if (value.ok !== true || !exactly(value, ['ok', 'state']) || !record(value.state)) return false;
  const state = value.state;
  return exactly(state, ['available', 'pins', 'pages', 'notice'])
    && isHostNotice(state.notice)
    && everyIndex(state.available, isAvailable)
    && isPins(state.pins)
    && Array.isArray(state.pages) && state.pages.length <= 1 && everyIndex(state.pages, isPageView);
}
