// SPDX-License-Identifier: GPL-3.0-only
// What the window may ask about Home, and what it is told (QGD-HOM-0001 to
// QGD-HOM-0006). Checked on both sides, refused rather than coerced
// (QGD-SEC-0006).
//
// The window asks for the state, says which extension page is open, and sets
// the pins. Home itself shows tiles drawn from the manifests and fetches
// nothing (KI7MT, 2026-10-22); the open page's data arrives unasked, pushed as
// the broker gets it, so the window never polls.
import { HINT_MAX, INPUT_KINDS, MAX_INPUTS, TEXT_MAX, type PageInput } from '../extension-api/inputs.js';
import { validatePageAnswer, type PageAnswer } from '../extension-api/pages.js';
import { isPins } from './settings-contract.js';

export const HOME_CHANNEL = 'home:request';
export const HOME_CARD_CHANNEL = 'home:page';
// The extension host's notice, pushed when it changes (QGD-APP-0022).
export const HOME_NOTICE_CHANNEL = 'home:notice';
// Whether the last request a page made reached its source, pushed when it
// changes: the Internet lamp's yellow (QGD-HOM-0005).
export const HOME_REACH_CHANNEL = 'home:reach';

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
  // Whether it needs the internet, so the window can say it is offline.
  readonly network: boolean;
  // Its area: the key of the area's first page, its own when it is under
  // none; and the name on its tab (KI7MT, 2026-10-23).
  readonly area: string;
  readonly tab: string;
  // Its colour on the rail, as a theme token: general, callsigns, locations
  // or settings (manifest.ts PAGE_HUES).
  readonly hue: string;
  // Its own settings, which the window draws as its Settings tab, each with
  // the choice in force (QGD-HOM-0017). Empty for a page with none.
  readonly settings: readonly PageSettingView[];
}

export interface PageSettingView {
  readonly id: string;
  readonly label: string;
  readonly choices: readonly string[];
  readonly value: string;
  readonly hint?: string;
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
  // Whether the last request a page made reached its source: true, false
  // when it could not connect, null when none has been made since the
  // network came up (KI7MT, 2026-10-23: the Internet lamp).
  readonly reached: boolean | null;
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
  | { readonly type: 'refresh'; readonly key: string }
  // The window's network went or came back, as the operating system says
  // (its online and offline events): nothing is polled to find out.
  | { readonly type: 'connection'; readonly online: boolean }
  // One of a page's own settings chosen on its Settings tab (QGD-HOM-0017):
  // checked by the broker against the page's own choices.
  | { readonly type: 'page-setting'; readonly key: string; readonly id: string; readonly value: string };

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
  if (value.type === 'connection') return exactly(value, ['type', 'online']) && typeof value.online === 'boolean';
  if (value.type === 'refresh') return exactly(value, ['type', 'key']) && typeof value.key === 'string' && KEY.test(value.key);
  if (value.type === 'dismiss') return exactly(value, ['type', 'id']) && Number.isSafeInteger(value.id) && (value.id as number) > 0;
  if (value.type === 'page-setting') return exactly(value, ['type', 'key', 'id', 'value']) && typeof value.key === 'string' && KEY.test(value.key)
    && typeof value.id === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(value.id) && plainText(value.value, 16);
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
  // Every field a manifest's input may have (manifest.ts INPUT_FIELDS): one
  // missing here refuses the whole of Home's state, as a missing reply field
  // refused ADIF's bands (2026-10-23).
  if (!Object.keys(value).every(key => ['id', 'label', 'kind', 'max', 'hint'].includes(key))) return false;
  return (value.hint === undefined || plainText(value.hint, HINT_MAX)) && typeof value.id === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(value.id) && plainText(value.label, 32)
    && (INPUT_KINDS as readonly unknown[]).includes(value.kind)
    && (value.max === undefined || (Number.isInteger(value.max) && (value.max as number) >= 1 && (value.max as number) <= TEXT_MAX));
}

function isAvailable(value: unknown): value is AvailablePage {
  return record(value) && exactly(value, ['key', 'name', 'description', 'extensionName', 'icon', 'rail', 'inputs', 'network', 'area', 'tab', 'hue', 'settings'])
    && everyIndex(value.settings, isSettingView) && (value.settings as unknown[]).length <= 4
    && typeof value.hue === 'string' && ['general', 'callsigns', 'locations', 'settings'].includes(value.hue)
    && typeof value.area === 'string' && KEY.test(value.area) && plainText(value.tab, 40)
    && typeof value.network === 'boolean'
    && typeof value.key === 'string' && KEY.test(value.key)
    && plainText(value.name, 40) && plainText(value.description, 120) && plainText(value.extensionName, 64)
    && typeof value.icon === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(value.icon) && typeof value.rail === 'boolean'
    && everyIndex(value.inputs, isInput) && (value.inputs as unknown[]).length <= MAX_INPUTS;
}

function isSettingView(value: unknown): boolean {
  if (!record(value)) return false;
  const keys = ['id', 'label', 'choices', 'value'];
  if (!(exactly(value, keys) || exactly(value, [...keys, 'hint']))) return false;
  return typeof value.id === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(value.id) && plainText(value.label, 32)
    && everyIndex(value.choices, choice => plainText(choice, 16)) && (value.choices as unknown[]).length <= 8
    && typeof value.value === 'string' && (value.choices as unknown[]).includes(value.value)
    && (value.hint === undefined || plainText(value.hint, HINT_MAX));
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
  return exactly(state, ['available', 'pins', 'pages', 'notice', 'reached'])
    && (state.reached === null || typeof state.reached === 'boolean')
    && isHostNotice(state.notice)
    && everyIndex(state.available, isAvailable)
    && isPins(state.pins)
    && Array.isArray(state.pages) && state.pages.length <= 1 && everyIndex(state.pages, isPageView);
}
